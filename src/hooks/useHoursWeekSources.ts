import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { hoursReadScan, hoursWorkflowRpc, type HoursScanReadingResult } from '@/lib/hours-workflow-api';
import { qk } from '@/lib/query-keys';
import {
  HOURS_SOURCE_BUCKET, HOURS_SOURCE_MAX_BYTES, hoursSourceDigest, hoursSourcePath, hoursSourceTypeError,
  parseWeekSources, type HoursSourceContentType, type HoursWeekSources,
} from '@/lib/hours-sources';
import { countPdfPages } from '@/lib/hours-pdf-pages';
import {
  attachmentSourceType, countWorkbookSheets, decodeWorkbook, isMailSource, isReadableWorkbook,
  isWordSource, isWorkbookSource, wordBytesError, workbookBytesError, wordSourceContentType,
  workbookContentType,
} from '@/lib/hours-workbook-file';
import { countWordTables, decodeWordDocument } from '@/lib/hours-docx';
import { decodeEmailMessage, type EmailAttachment } from '@/lib/hours-eml';
import { readHoursFromMailText, type MailReadingContext } from '@/lib/hours-mail-text';
import { readHoursWorkbook, type WorkbookContext, type WorkbookReading } from '@/lib/hours-workbook';
import type { HoursPageEntry, HoursReadingEntry } from '@/lib/hours-workflow-api';
import type { HoursPageAssignment } from '@/lib/hours-sources';
import type { HoursSourceInput } from '@/components/hours-workflow/hours-day-source';

export interface HoursSourceUploadResult {
  duplicate: boolean; sourceId: string;
  /** Attachments of a delivered message, stored as sources of this same receipt. */
  attachmentsStored: number;
  /** Attachments left alone, named so a delivery never halves in silence. */
  attachmentsSkipped: string[];
}

/** The secret is shown once, right here; the database keeps only its digest. */
export interface HoursClientLinkIssued { secret: string; linkId: string }

export interface CreateProposalInput {
  sourceId: string; dayId: string; minutes: number;
  noHoursReason: string | null; note: string | null;
  sourceInput: HoursSourceInput | null; pageLabel: string | null;
  pageNumber: number | null; assignmentUncertain: boolean;
}

export interface SetSourcePageInput {
  sourceId: string; pageNumber: number; assignment: HoursPageAssignment;
  memberId: string | null; note: string | null;
}

export interface PageTakeoverInput { sourceId: string; pageNumber: number; entries: HoursPageEntry[] }

export interface ReadingInput { sourceId: string; entries: HoursReadingEntry[] }

/**
 * A photo is one page and so is the body of a message. A PDF is counted here, a
 * workbook reports its worksheets and a Word file its tables; a file that cannot
 * be read stays honestly unknown rather than being called a single page.
 */
async function deliveredPageCount(contentType: string, bytes: ArrayBuffer): Promise<number | null> {
  try {
    if (contentType === 'application/pdf') return await countPdfPages(bytes);
    // A legacy .xls or .doc can never be read out, so there is nothing to count.
    if (isReadableWorkbook(contentType)) return await countWorkbookSheets(bytes);
    if (contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      return await countWordTables(bytes);
    }
    if (isMailSource(contentType)) return 1;
    return null;
  } catch {
    return null;
  }
}

/**
 * What the browser refuses to store before it costs a round trip. The declared
 * media type is not proof: Windows reports the legacy Office types for modern
 * files and for a plain .csv alike, so the first bytes decide.
 */
function storedContentType(file: { type: string }, bytes: ArrayBuffer): HoursSourceContentType {
  if (isWorkbookSource(file.type)) {
    const rejection = workbookBytesError(bytes);
    if (rejection) throw new Error(rejection);
    return (workbookContentType(file.type, bytes) ?? file.type) as HoursSourceContentType;
  }
  if (isWordSource(file.type)) {
    const rejection = wordBytesError(bytes);
    if (rejection) throw new Error(rejection);
    return (wordSourceContentType(file.type, bytes) ?? file.type) as HoursSourceContentType;
  }
  return file.type as HoursSourceContentType;
}

/** Signed for minutes only; an original is never publicly reachable. */
const VIEW_TTL_SECONDS = 300;

export function useHoursWeekSources(organizationId: string, weekId: string | undefined, enabled: boolean) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: qk.hoursWorkflow.sources(organizationId, weekId ?? ''),
    queryFn: async () => parseWeekSources(await hoursWorkflowRpc('hours_get_week_sources', { p_week_id: weekId! })),
    enabled: enabled && !!organizationId && !!weekId,
  });

  const store = (data: HoursWeekSources) => {
    qc.setQueryData(qk.hoursWorkflow.sources(organizationId, data.week_id), data);
  };

  /**
   * One delivered file, stored and then recorded. The bytes go to their own
   * digest as a path, so the same delivery twice is the same object and the
   * server answers `duplicate` instead of making a second source.
   */
  async function storeSource(
    file: File | Blob, fileName: string, contentType: HoursSourceContentType,
    bytes: ArrayBuffer, receivedWith: string | null,
  ): Promise<Record<string, unknown>> {
    const digest = await hoursSourceDigest(bytes);
    const pageCount = await deliveredPageCount(contentType, bytes);
    const path = hoursSourcePath(organizationId, weekId!, digest, contentType);
    const { error } = await supabase.storage.from(HOURS_SOURCE_BUCKET)
      .upload(path, file, { contentType, upsert: false });
    // The path is the digest, so an existing object already holds these bytes.
    if (error && !isAlreadyStored(error)) throw error;
    return await hoursWorkflowRpc('hours_add_week_source', {
      p_week_id: weekId!, p_content_hash: digest, p_file_name: fileName, p_content_type: contentType,
      p_page_count: pageCount, p_received_with: receivedWith,
    }) as Record<string, unknown>;
  }

  /**
   * A message and what came with it are one receipt: the attachments are stored
   * as sources of their own and each names the message it arrived with, so the
   * screen keeps them together and a reader can tell an office upload from
   * something that came in over mail.
   *
   * An attachment this module does not accept is named rather than dropped. So
   * is a signature logo, which is an image the body points at and not a
   * delivery of hours.
   */
  async function storeAttachments(attachments: EmailAttachment[], receiptId: string):
  Promise<{ stored: number; skipped: string[] }> {
    let stored = 0;
    const skipped: string[] = [];
    for (const attachment of attachments) {
      if (attachment.inline) { skipped.push(`${attachment.fileName} (afbeelding uit de handtekening)`); continue; }
      const contentType = attachmentSourceType(attachment.fileName, attachment.contentType, attachment.bytes);
      if (!contentType) { skipped.push(`${attachment.fileName} (dit bestandstype wordt niet als bron bewaard)`); continue; }
      // The bytes are already in hand; a Blob is only how Storage wants them.
      const bytes = attachment.bytes.slice().buffer as ArrayBuffer;
      if (bytes.byteLength <= 0 || bytes.byteLength > HOURS_SOURCE_MAX_BYTES) {
        skipped.push(`${attachment.fileName} (leeg of groter dan 25 MB)`);
        continue;
      }
      const blob = new Blob([attachment.bytes as BlobPart], { type: contentType });
      const result = await storeSource(blob, attachment.fileName, contentType as HoursSourceContentType,
        bytes, receiptId);
      store(parseWeekSources(result));
      stored += 1;
    }
    return { stored, skipped };
  }

  const upload = useMutation({
    mutationFn: async (file: File): Promise<HoursSourceUploadResult> => {
      const rejection = hoursSourceTypeError(file);
      if (rejection) throw new Error(rejection);
      const bytes = await file.arrayBuffer();
      const contentType = storedContentType(file, bytes);
      const result = await storeSource(file, file.name, contentType, bytes, null);
      store(parseWeekSources(result));
      const sourceId = String(result.source_id);
      const duplicate = result.duplicate === true;
      // A message that was already received keeps the attachments it already
      // has; storing them again would be the same objects and the same answer.
      const attachments = isMailSource(contentType) && !duplicate
        ? decodeEmailMessage(bytes) : null;
      const outcome = attachments?.ok
        ? await storeAttachments(attachments.message.attachments, sourceId)
        : { stored: 0, skipped: [] };
      return {
        duplicate, sourceId,
        attachmentsStored: outcome.stored, attachmentsSkipped: outcome.skipped,
      };
    },
  });

  const createProposal = useMutation({
    mutationFn: async (input: CreateProposalInput) => parseWeekSources(await hoursWorkflowRpc('hours_create_source_proposal', {
      p_source_id: input.sourceId, p_day_id: input.dayId, p_minutes: input.minutes,
      p_no_hours_reason: input.noHoursReason, p_note: input.note,
      p_source_input: input.sourceInput, p_page_label: input.pageLabel,
      p_page_number: input.pageNumber, p_assignment_uncertain: input.assignmentUncertain,
    })),
    onSuccess: store,
  });

  /** Recording who a page belongs to; the server refuses one name for a page that carries several. */
  const setPage = useMutation({
    mutationFn: async (input: SetSourcePageInput) => parseWeekSources(await hoursWorkflowRpc('hours_set_source_page', {
      p_source_id: input.sourceId, p_page_number: input.pageNumber, p_assignment: input.assignment,
      p_member_id: input.memberId, p_note: input.note,
    })),
    onSuccess: store,
  });

  /** Taking over a whole page at once; still proposals, never hours. */
  const takeOverPage = useMutation({
    mutationFn: async (input: PageTakeoverInput) => parseWeekSources(await hoursWorkflowRpc('hours_create_page_proposals', {
      p_source_id: input.sourceId, p_page_number: input.pageNumber, p_entries: input.entries,
    })),
    onSuccess: store,
  });

  /**
   * Reading a delivered spreadsheet, Word file or message. The stored original is
   * fetched back and interpreted here; nothing is written until the reviewer
   * saves the reading as proposals, and even then a proposal is not an hour.
   *
   * All three run in the browser without a model and without a paid call, and
   * all three end in the same reviewable shape. A worksheet, a table and a
   * message are the same kind of page, so the page rules that already govern a
   * delivery govern these too.
   */
  const readWorkbook = useMutation({
    mutationFn: async (input: { path: string; contentType: string; context: MailReadingContext }):
    Promise<WorkbookReading> => {
      const response = await fetch(await hoursSourceViewUrl(input.path));
      if (!response.ok) throw new Error('De bewaarde bron kon niet worden opgehaald. Probeer het opnieuw.');
      const bytes = await response.arrayBuffer();
      if (isMailSource(input.contentType)) {
        const decoding = decodeEmailMessage(bytes);
        if (decoding.ok === false) return { ok: false, issues: decoding.issues };
        return readHoursFromMailText(decoding.message.text,
          { ...input.context, subject: decoding.message.subject });
      }
      if (isWordSource(input.contentType)) {
        const decoding = await decodeWordDocument(bytes);
        if (decoding.ok === false) return { ok: false, issues: decoding.issues };
        return readHoursWorkbook(decoding.tables, input.context,
          { sheetNoun: 'tabel', sourceKind: 'document' });
      }
      const decoding = await decodeWorkbook(bytes);
      if (decoding.ok === false) return { ok: false, issues: decoding.issues };
      return readHoursWorkbook(decoding.sheets, input.context);
    },
  });

  /** One reading becomes proposals in one handling: all of it, or none of it. */
  const saveReading = useMutation({
    mutationFn: async (input: ReadingInput) => parseWeekSources(await hoursWorkflowRpc('hours_create_source_proposals', {
      p_source_id: input.sourceId, p_entries: input.entries,
    })),
    onSuccess: store,
  });

  /**
   * Reading a delivered scan or photo. This is the one act in this panel that
   * costs money, so it never happens as a side effect of uploading: an internal
   * user asks for it, per source. Nothing is written; the reading comes back for
   * review and only saveReading records it as proposals.
   */
  const readScan = useMutation({
    mutationFn: (sourceId: string): Promise<HoursScanReadingResult> => hoursReadScan(sourceId),
  });

  const confirmAssignment = useMutation({
    mutationFn: async (input: { proposalId: string; note: string | null }) => parseWeekSources(
      await hoursWorkflowRpc('hours_confirm_proposal_assignment', {
        p_proposal_id: input.proposalId, p_note: input.note,
      })),
    onSuccess: store,
  });

  /**
   * Handing out a personal week link. The secret comes back exactly once: it is
   * never stored here and never returned by any later read, so a lost link is
   * replaced rather than looked up.
   */
  const issueClientLink = useMutation({
    mutationFn: async (input: { label: string; validDays: number }): Promise<HoursClientLinkIssued> => {
      const result = await hoursWorkflowRpc('hours_issue_client_week_link', {
        p_week_id: weekId!, p_label: input.label, p_valid_days: input.validDays,
      }) as Record<string, unknown>;
      // The link is already committed and only its digest is stored, so the
      // one-time address must survive an unreadable neighbouring field. The
      // cache simply refetches instead.
      try {
        store(parseWeekSources(result));
      } catch (failure) {
        console.warn('Klantweeklink: projectie niet leesbaar, cache wordt opnieuw geladen', failure);
        void qc.invalidateQueries({ queryKey: qk.hoursWorkflow.sources(organizationId, weekId!) });
      }
      return { secret: String(result.secret), linkId: String(result.link_id) };
    },
  });

  /** Settling the doubt a reading recorded about its own values. */
  const confirmValues = useMutation({
    mutationFn: async (input: { proposalId: string; note: string | null }) => parseWeekSources(
      await hoursWorkflowRpc('hours_confirm_proposal_values', {
        p_proposal_id: input.proposalId, p_note: input.note,
      })),
    onSuccess: store,
  });

  const revokeClientLink = useMutation({
    mutationFn: async (input: { linkId: string; note: string | null }) => parseWeekSources(
      await hoursWorkflowRpc('hours_revoke_client_week_link', {
        p_link_id: input.linkId, p_note: input.note,
      })),
    onSuccess: store,
  });

  const discardProposal = useMutation({
    mutationFn: async (input: { proposalId: string; note: string | null }) => parseWeekSources(
      await hoursWorkflowRpc('hours_discard_source_proposal', { p_proposal_id: input.proposalId, p_note: input.note })),
    onSuccess: store,
  });

  return {
    ...query, upload, createProposal, discardProposal, setPage, takeOverPage, confirmAssignment,
    confirmValues, readWorkbook, readScan, saveReading, issueClientLink, revokeClientLink,
  };
}

/** Applying changes the week itself, so both caches are refreshed together. */
export function useApplyHoursProposal(organizationId: string, weekId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { proposalId: string; expectedRevisionId: string | null }) => {
      const result = await hoursWorkflowRpc('hours_apply_source_proposal', {
        p_proposal_id: input.proposalId, p_expected_revision_id: input.expectedRevisionId,
      }) as Record<string, unknown>;
      return {
        createdRevision: result.applied_created_revision === true,
        sources: parseWeekSources(result.sources),
      };
    },
    onSuccess: async result => {
      qc.setQueryData(qk.hoursWorkflow.sources(organizationId, result.sources.week_id), result.sources);
      await qc.invalidateQueries({ queryKey: qk.hoursWorkflow.all(organizationId) });
    },
  });
}

export async function hoursSourceViewUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(HOURS_SOURCE_BUCKET).createSignedUrl(path, VIEW_TTL_SECONDS);
  if (error || !data?.signedUrl) throw error ?? new Error('De bron kon niet worden geopend.');
  return data.signedUrl;
}

function isAlreadyStored(error: unknown): boolean {
  const value = error as { statusCode?: string | number; message?: string } | null;
  return String(value?.statusCode ?? '') === '409' || /already exists|duplicate/i.test(value?.message ?? '');
}
