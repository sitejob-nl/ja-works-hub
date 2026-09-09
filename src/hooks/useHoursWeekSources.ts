import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { hoursWorkflowRpc } from '@/lib/hours-workflow-api';
import { qk } from '@/lib/query-keys';
import {
  HOURS_SOURCE_BUCKET, hoursSourceDigest, hoursSourcePath, hoursSourceTypeError,
  parseWeekSources, type HoursSourceContentType, type HoursWeekSources,
} from '@/lib/hours-sources';
import { countPdfPages } from '@/lib/hours-pdf-pages';
import {
  countWorkbookSheets, decodeWorkbook, isReadableWorkbook, isWorkbookSource, workbookBytesError,
  workbookContentType,
} from '@/lib/hours-workbook-file';
import { readHoursWorkbook, type WorkbookContext, type WorkbookReading } from '@/lib/hours-workbook';
import type { HoursPageEntry, HoursReadingEntry } from '@/lib/hours-workflow-api';
import type { HoursPageAssignment } from '@/lib/hours-sources';
import type { HoursSourceInput } from '@/components/hours-workflow/hours-day-source';

export interface HoursSourceUploadResult { duplicate: boolean; sourceId: string }

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
 * A photo is one page. A PDF is counted here and a workbook reports its
 * worksheets; a file that cannot be read stays honestly unknown rather than
 * being called a single page.
 */
async function deliveredPageCount(contentType: string, bytes: ArrayBuffer): Promise<number | null> {
  try {
    if (contentType === 'application/pdf') return await countPdfPages(bytes);
    // A legacy .xls can never be read out, so there is nothing to count either.
    if (isReadableWorkbook(contentType)) return await countWorkbookSheets(bytes);
    return null;
  } catch {
    return null;
  }
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

  const upload = useMutation({
    mutationFn: async (file: File): Promise<HoursSourceUploadResult> => {
      const rejection = hoursSourceTypeError(file);
      if (rejection) throw new Error(rejection);
      const bytes = await file.arrayBuffer();
      // The declared media type is not proof; a workbook has to be one, and it
      // is stored as what it really is so a mislabelled .xlsx stays readable.
      const notAWorkbook = isWorkbookSource(file.type) ? workbookBytesError(bytes) : null;
      if (notAWorkbook) throw new Error(notAWorkbook);
      const contentType = (workbookContentType(file.type, bytes) ?? file.type) as HoursSourceContentType;
      const digest = await hoursSourceDigest(bytes);
      const pageCount = await deliveredPageCount(contentType, bytes);
      const path = hoursSourcePath(organizationId, weekId!, digest, contentType);
      const { error } = await supabase.storage.from(HOURS_SOURCE_BUCKET)
        .upload(path, file, { contentType, upsert: false });
      // The path is the digest, so an existing object already holds these bytes.
      if (error && !isAlreadyStored(error)) throw error;
      const result = await hoursWorkflowRpc('hours_add_week_source', {
        p_week_id: weekId!, p_content_hash: digest, p_file_name: file.name, p_content_type: contentType,
        p_page_count: pageCount,
      }) as Record<string, unknown>;
      store(parseWeekSources(result));
      return { duplicate: result.duplicate === true, sourceId: String(result.source_id) };
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
   * Reading a delivered spreadsheet. The stored original is fetched back and
   * interpreted here; nothing is written until the reviewer saves the reading as
   * proposals, and even then a proposal is not an hour.
   */
  const readWorkbook = useMutation({
    mutationFn: async (input: { path: string; context: WorkbookContext }): Promise<WorkbookReading> => {
      const response = await fetch(await hoursSourceViewUrl(input.path));
      if (!response.ok) throw new Error('De bewaarde bron kon niet worden opgehaald. Probeer het opnieuw.');
      const decoding = await decodeWorkbook(await response.arrayBuffer());
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

  const confirmAssignment = useMutation({
    mutationFn: async (input: { proposalId: string; note: string | null }) => parseWeekSources(
      await hoursWorkflowRpc('hours_confirm_proposal_assignment', {
        p_proposal_id: input.proposalId, p_note: input.note,
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
    readWorkbook, saveReading,
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
