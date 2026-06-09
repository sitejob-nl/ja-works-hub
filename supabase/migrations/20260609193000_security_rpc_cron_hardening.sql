-- Security hardening before JA Werkt team launch.
--
-- Fixes:
-- - Voys decrypted-token RPC was executable by anon/authenticated.
-- - Internal trigger/helper SECURITY DEFINER functions were exposed as RPCs.
-- - Some SECURITY DEFINER functions had mutable search_path.
-- - Cron schedules must use app.cron_secret instead of embedded shared keys.

BEGIN;

ALTER FUNCTION public.normalize_skill_name(text) SET search_path = public, pg_temp;
ALTER FUNCTION public.normalize_domain_host(text) SET search_path = public, pg_temp;
ALTER FUNCTION public.touch_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.encrypt_voys_token() SET search_path = public, extensions, vault, pg_temp;
ALTER FUNCTION public.get_voys_token(uuid) SET search_path = public, extensions, vault, pg_temp;
ALTER FUNCTION public.resolve_organization_domain(text) SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.get_voys_token(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_voys_token(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.encrypt_voys_token() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.encrypt_voys_token() TO service_role;

REVOKE EXECUTE ON FUNCTION public.upsert_skill_for_org(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_skill_for_org(uuid, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.sync_unit_status_from_assignments(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_unit_status_from_assignments(uuid) TO service_role;

-- Trigger functions are invoked by table triggers, not by public RPC callers.
REVOKE EXECUTE ON FUNCTION public.seed_default_match_feedback_reasons() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_candidate_skills_from_array() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_company_function_skills_from_array() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_vacancy_required_skills_from_array() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_sync_unit_status_from_assignments() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_client_portal_contact_update() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_client_portal_timesheet_insert() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_client_portal_timesheet_update() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_employee_portal_timesheet_update() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.seed_default_match_feedback_reasons() TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_candidate_skills_from_array() TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_company_function_skills_from_array() TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_vacancy_required_skills_from_array() TO service_role;
GRANT EXECUTE ON FUNCTION public.trg_sync_unit_status_from_assignments() TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_client_portal_contact_update() TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_client_portal_timesheet_insert() TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_client_portal_timesheet_update() TO service_role;
GRANT EXECUTE ON FUNCTION public.enforce_employee_portal_timesheet_update() TO service_role;

-- Replace legacy cron schedules that contained embedded shared keys.
SELECT cron.unschedule('automated-onboarding-reminders')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'automated-onboarding-reminders'
);

SELECT cron.schedule(
  'automated-onboarding-reminders',
  '0 9 * * *',
  $$
  SELECT net.http_post(
    url := 'https://noaupcteygfvlyymqtew.supabase.co/functions/v1/automated-messages?job=onboarding-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', current_setting('app.cron_secret', true)
    ),
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.unschedule('birthday-loyalty-daily')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'birthday-loyalty-daily'
);

SELECT cron.schedule(
  'birthday-loyalty-daily',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://noaupcteygfvlyymqtew.supabase.co/functions/v1/birthday-loyalty-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', current_setting('app.cron_secret', true)
    ),
    body := jsonb_build_object('mode', 'cron')
  ) AS request_id;
  $$
);

COMMIT;
