import { supabase } from '@/integrations/supabase/client';
import { unwrap } from '@/lib/db';
import type { HoursMailRuleView } from '@/lib/hours-outbox';

/**
 * The six RPCs of the outgoing hours mail.
 *
 * They are not in `src/integrations/supabase/types.ts` yet, because that file is
 * generated from the **live** schema and migration `20260918090000_hours_outbox`
 * has not been applied to production. Hand-editing the generated file is
 * forbidden, so the argument shapes are written out here instead and checked
 * against the migration by hand.
 *
 * **This module disappears the moment the migration is live.** Regenerate with
 *
 *     npx supabase gen types typescript --project-id noaupcteygfvlyymqtew \
 *       > src/integrations/supabase/types.ts
 *
 * then move these six entries into `HoursRpcArguments` in `hours-workflow-api.ts`
 * as ordinary `RpcArgs<'...'>` lines and delete this file. Until then the cast
 * below is the one place where the client is not checked against the database,
 * and it is deliberately the only place.
 */
interface HoursOutboxRpcArguments {
  hours_get_mail_profile: { p_company_id: string };
  hours_save_mail_profile: {
    p_company_id: string; p_expected_version: number; p_rules: HoursMailRuleView[];
    p_late_approval_mode: 'require_review' | 'send_if_window';
    p_late_approval_window_minutes: number;
  };
  hours_save_mail_template: {
    p_template_id: string; p_language: 'nl' | 'en' | 'pl'; p_subject: string; p_body: string;
  };
  hours_outbox_overview: {
    p_week_id: string | null; p_company_id: string | null; p_limit: number;
  };
  hours_approve_outbox_message: {
    p_id: string; p_expected_content_hash: string; p_expected_source_revision: string;
  };
  hours_withdraw_outbox_message: { p_id: string; p_note: string | null };
}

export async function hoursOutboxRpc<K extends keyof HoursOutboxRpcArguments>(
  name: K, args: HoursOutboxRpcArguments[K],
): Promise<unknown> {
  // See the note above: the generated types cannot know these six yet.
  return unwrap((supabase.rpc as unknown as (
    fn: string, params: Record<string, unknown>,
  ) => ReturnType<typeof supabase.rpc>)(name, args as unknown as Record<string, unknown>));
}
