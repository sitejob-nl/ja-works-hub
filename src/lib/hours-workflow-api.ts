import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { unwrap } from '@/lib/db';
import type { HoursSourceInput } from '@/components/hours-workflow/hours-day-source';
import type { HoursPageAssignment, HoursUncertainField } from '@/lib/hours-sources';
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
}

export async function hoursWorkflowRpc<K extends keyof HoursRpcArguments>(name: K, args: HoursRpcArguments[K]): Promise<unknown> {
  // Each entry above is derived from the generated signature; the client cannot
  // correlate name and arguments across a union this wide.
  return unwrap(supabase.rpc(name, args as Database['public']['Functions'][K]['Args']));
}

/** The server reads all facts and matrices; the browser sends identifiers only. */
export async function hoursClassifyDay(input: { dayId: string; expectedRevisionId: string }): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke('hours-classify-day', {
    body: { day_id: input.dayId, expected_revision_id: input.expectedRevisionId },
  });
  if (error) {
    if (error.context instanceof Response) {
      let body: unknown;
      try { body = await error.context.clone().json(); } catch { /* Preserve the original transport error if the server returned no JSON. */ }
      if (body && typeof body === 'object' && 'code' in body && typeof body.code === 'string') {
        throw Object.assign(new Error('error' in body && typeof body.error === 'string' ? body.error : error.message), { code: body.code });
      }
    }
    throw error;
  }
  return data;
}

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
  const { data, error } = await supabase.functions.invoke('hours-read-scan', {
    body: { source_id: sourceId },
  });
  if (error) {
    if (error.context instanceof Response) {
      let body: unknown;
      try { body = await error.context.clone().json(); } catch { /* Keep the transport error when the server sent no JSON. */ }
      if (body && typeof body === 'object' && 'code' in body && typeof body.code === 'string') {
        throw Object.assign(new Error('error' in body && typeof body.error === 'string' ? body.error : error.message),
          { code: body.code });
      }
    }
    throw error;
  }
  const payload = (data ?? {}) as Record<string, unknown>;
  if (!payload.reading || typeof payload.reading !== 'object') {
    throw new Error('De uitlezing kwam onvolledig terug. Er zijn geen voorstellen gemaakt.');
  }
  return {
    reading: payload.reading as ScanReading, model: String(payload.model ?? ''),
    requestId: String(payload.request_id ?? ''),
    costCents: Number(payload.cost_cents ?? 0), balanceCents: Number(payload.balance_cents ?? 0),
    durationMs: Number(payload.duration_ms ?? 0),
  };
}
