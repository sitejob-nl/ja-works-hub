import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { unwrap } from '@/lib/db';
import type { HoursSourceInput } from '@/components/hours-workflow/hours-day-source';
import { HOURS_UNCERTAIN_FIELDS, type HoursPageAssignment, type HoursUncertainField } from '@/lib/hours-sources';
import type { ScanReading } from '../../supabase/functions/_shared/hours-scan';

/** One day of a page take-over; the server reads exactly these fields. */
export interface HoursPageEntry {
  day_id: string; minutes: number;
  no_hours_reason?: string | null; note?: string | null;
  source_input?: HoursSourceInput | null; page_label?: string | null;
}

/** One proposal out of one reading of a delivered file, recorded all at once. */
export interface HoursReadingEntry extends HoursPageEntry {
  page_number?: number | null; assignment_uncertain?: boolean;
  /** What a machine reader was unsure of; it blocks applying until confirmed. */
  uncertain_fields?: HoursUncertainField[] | null;
}

/**
 * Domain arguments refine the generated database signatures; the typed Supabase
 * client checks every RPC call. Every read result is parsed with Zod by the caller.
 */
type RpcArgs<Name extends keyof Database['public']['Functions']> = Database['public']['Functions'][Name]['Args'];

interface HoursRpcArguments {
  hours_list_weeks: Required<RpcArgs<'hours_list_weeks'>>;
  hours_get_week: RpcArgs<'hours_get_week'>;
  hours_get_company_settings: RpcArgs<'hours_get_company_settings'>;
  hours_create_week: RpcArgs<'hours_create_week'>;
  hours_set_company_settings: RpcArgs<'hours_set_company_settings'>;
  hours_save_day: RpcArgs<'hours_save_day'>;
  hours_save_day_source: Omit<RpcArgs<'hours_save_day_source'>, 'p_source_input'> & { p_source_input: HoursSourceInput | null };
  hours_confirm_day: RpcArgs<'hours_confirm_day'> & { p_decision: 'confirmed' | 'disputed' };
  hours_confirm_days: Omit<RpcArgs<'hours_confirm_days'>, 'p_revisions'> & { p_revisions: { day_id: string; revision_id: string }[] };
  hours_review_day: RpcArgs<'hours_review_day'> & { p_status: 'checked' | 'blocked' };
  hours_get_week_sources: RpcArgs<'hours_get_week_sources'>;
  hours_add_week_source: RpcArgs<'hours_add_week_source'>;
  hours_create_source_proposal: Omit<RpcArgs<'hours_create_source_proposal'>, 'p_source_input'> & { p_source_input: HoursSourceInput | null };
  hours_discard_source_proposal: RpcArgs<'hours_discard_source_proposal'>;
  hours_apply_source_proposal: RpcArgs<'hours_apply_source_proposal'>;
  hours_confirm_proposal_assignment: RpcArgs<'hours_confirm_proposal_assignment'>;
  hours_confirm_proposal_values: RpcArgs<'hours_confirm_proposal_values'>;
  hours_set_source_page: RpcArgs<'hours_set_source_page'> & { p_assignment: HoursPageAssignment };
  hours_create_page_proposals: Omit<RpcArgs<'hours_create_page_proposals'>, 'p_entries'> & { p_entries: HoursPageEntry[] };
  hours_create_source_proposals: Omit<RpcArgs<'hours_create_source_proposals'>, 'p_entries'> & { p_entries: HoursReadingEntry[] };
  hours_issue_client_week_link: RpcArgs<'hours_issue_client_week_link'>;
  hours_revoke_client_week_link: RpcArgs<'hours_revoke_client_week_link'>;
  hours_issue_week_request: RpcArgs<'hours_issue_week_request'>;
  hours_revoke_week_request: RpcArgs<'hours_revoke_week_request'>;
  // The generated signature for an argument-less function is `never`, which no
  // caller can satisfy; an empty object is what PostgREST actually wants.
  hours_mail_overview: Record<string, never>;
  hours_mail_set_folder: RpcArgs<'hours_mail_set_folder'>;
  hours_mail_dismiss_message: RpcArgs<'hours_mail_dismiss_message'>;
  hours_mail_assign_message: RpcArgs<'hours_mail_assign_message'>;
}

export async function hoursWorkflowRpc<K extends keyof HoursRpcArguments>(name: K, args: HoursRpcArguments[K]): Promise<unknown> {
  // Each entry above is derived from the generated signature; the client cannot
  // correlate name and arguments across a union this wide.
  return unwrap(supabase.rpc(name, args as Database['public']['Functions'][K]['Args']));
}

/**
 * What an hours edge function reported when it refused.
 *
 * The accounting fields matter as much as the message: a refusal that arrives
 * after the provider was already paid carries the request id that is the only
 * key into the ledger for that charge, and the balance the server just read.
 * Dropping them leaves a support case with nothing to quote.
 */
export interface HoursFunctionError extends Error {
  code: string;
  requestId?: string;
  costCents?: number;
  balanceCents?: number;
}

/** One place where an edge-function refusal becomes an error a screen can read. */
async function invokeHoursFunction(name: string, body: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (!error) return data;
  if (error.context instanceof Response) {
    let payload: unknown;
    try { payload = await error.context.clone().json(); } catch { /* Preserve the transport error when the server sent no JSON. */ }
    if (payload && typeof payload === 'object' && 'code' in payload && typeof payload.code === 'string') {
      const value = payload as Record<string, unknown>;
      const number = (field: unknown) => typeof field === 'number' ? field : undefined;
      throw Object.assign(new Error(typeof value.error === 'string' ? value.error : error.message), {
        code: value.code,
        requestId: typeof value.request_id === 'string' ? value.request_id : undefined,
        costCents: number(value.cost_cents), balanceCents: number(value.balance_cents),
      }) as HoursFunctionError;
    }
  }
  throw error;
}

/** The server reads all facts and matrices; the browser sends identifiers only. */
export async function hoursClassifyDay(input: { dayId: string; expectedRevisionId: string }): Promise<unknown> {
  return invokeHoursFunction('hours-classify-day',
    { day_id: input.dayId, expected_revision_id: input.expectedRevisionId });
}

const scanIssueSchema = z.object({
  code: z.string(), message: z.string(),
  field: z.string().optional(),
  expectedMinutes: z.number().optional(), actualMinutes: z.number().optional(),
});
const scanCandidateSchema = z.object({
  dayId: z.string(), memberId: z.string(), employeeName: z.string(), workDate: z.string(),
  minutes: z.number().int().min(0).max(1440), noHoursReason: z.string().nullable(),
  sourceInput: z.unknown().nullable(),
  pageNumber: z.number().int().min(1), pageLabel: z.string(),
  assignmentUncertain: z.boolean(),
  uncertainFields: z.array(z.enum(HOURS_UNCERTAIN_FIELDS)).default([]),
  employeeText: z.string(),
  readText: z.object({
    total: z.string().nullable(), start: z.string().nullable(),
    end: z.string().nullable(), break: z.string().nullable(),
  }).default({ total: null, start: null, end: null, break: null }),
  notices: z.array(scanIssueSchema).default([]),
});
const scanReadingSchema = z.union([
  z.object({ ok: z.literal(false), issues: z.array(scanIssueSchema) }),
  z.object({
    ok: z.literal(true), candidates: z.array(scanCandidateSchema),
    skipped: z.array(z.object({
      pageNumber: z.number().int().nullable(), text: z.string(), reason: z.string(),
    })).default([]),
    pagesRead: z.array(z.number().int()).default([]),
    pagesUnread: z.array(z.object({ pageNumber: z.number().int(), reason: z.string() })).default([]),
  }),
]);

/** What one paid reading of a scan or photo returned, and what it cost. */
export interface HoursScanReadingResult {
  reading: ScanReading;
  model: string;
  requestId: string;
  costCents: number;
  balanceCents: number;
  durationMs: number;
}

/**
 * Reading a delivered scan or photo. The browser sends one source identifier;
 * the file, the week and the model are the server's to choose, and the paid
 * call runs on the central AI ledger. Nothing is written: what comes back is a
 * reading for review.
 */
export async function hoursReadScan(sourceId: string): Promise<HoursScanReadingResult> {
  const data = await invokeHoursFunction('hours-read-scan', { source_id: sourceId });
  const payload = (data ?? {}) as Record<string, unknown>;
  // Parsed, not cast. Edge functions deploy by hand while the frontend deploys
  // on merge, so a reading from an older or newer function has to fail as a
  // readable message rather than as a blank panel after a paid call.
  const parsed = scanReadingSchema.safeParse(payload.reading);
  if (!parsed.success) {
    throw new Error('De uitlezing kwam in een onbekende vorm terug. Er zijn geen voorstellen gemaakt.');
  }
  return {
    reading: parsed.data as ScanReading, model: String(payload.model ?? ''),
    requestId: String(payload.request_id ?? ''),
    costCents: Number(payload.cost_cents ?? 0), balanceCents: Number(payload.balance_cents ?? 0),
    durationMs: Number(payload.duration_ms ?? 0),
  };
}

// The mail-intake vocabulary lives in a module of its own: a screen that only
// needs the words must not drag the Supabase client into a test that has no
// environment. This module keeps them reachable from the data layer.
export {
  hoursMailFolderSchema, hoursMailAttentionSchema, hoursMailOverviewSchema,
  parseMailOverview, HOURS_MAIL_REASONS, describeMailReason,
} from '@/lib/hours-mail';
export type { HoursMailFollowed, HoursMailAttention, HoursMailOverview } from '@/lib/hours-mail';

/** Fetching the mailbox now, by hand. The unattended run does exactly the same. */
export async function hoursRunMailIntake(): Promise<{ folders: number; filed: number; attention: number }> {
  const data = await invokeHoursFunction('hours-mail-intake', {}) as Record<string, unknown>;
  return {
    folders: Number(data?.folders ?? 0),
    filed: Number(data?.filed ?? 0),
    attention: Number(data?.attention ?? 0),
  };
}
