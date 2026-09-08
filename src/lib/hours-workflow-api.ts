import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { unwrap } from '@/lib/db';

/**
 * Explicit boundary for the additive, not-yet-deployed workflow RPCs. The existing
 * generated database types describe production and remain untouched. Regenerate
 * them after deploying the migration, before merging/activating these routes.
 * Inputs are typed here; every read result is parsed with Zod by the caller.
 */
interface HoursRpcArguments {
  hours_list_weeks: { p_week_start: string | null };
  hours_get_week: { p_week_id: string };
  hours_get_company_settings: { p_company_id: string };
  hours_create_week: { p_company_id: string; p_week_start: string };
  hours_set_company_settings: {
    p_company_id: string; p_expected_version: number; p_enabled: boolean;
    p_submission_day_offset: number; p_submission_time: string;
    p_confirmation_day_offset: number; p_confirmation_time: string;
  };
  hours_save_day: { p_day_id: string; p_expected_revision_id: string | null; p_minutes: number; p_no_hours_reason: string | null; p_note: string | null };
  hours_confirm_day: { p_day_id: string; p_expected_revision_id: string; p_decision: 'confirmed' | 'disputed'; p_note: string | null };
  hours_confirm_days: { p_week_id: string; p_revisions: { day_id: string; revision_id: string }[]; p_note: string | null };
  hours_review_day: { p_day_id: string; p_expected_revision_id: string; p_status: 'checked' | 'blocked'; p_note: string | null };
}

export async function hoursWorkflowRpc<K extends keyof HoursRpcArguments>(name: K, args: HoursRpcArguments[K]): Promise<unknown> {
  return unwrap((supabase as SupabaseClient).rpc(name, args));
}
