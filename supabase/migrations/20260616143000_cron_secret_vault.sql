-- Read the pg_cron -> Edge shared secret from Supabase Vault instead of a
-- database GUC. The production role used by Management API cannot ALTER
-- DATABASE SET app.cron_secret, and this keeps the secret out of migrations.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.get_cron_secret()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, vault, pg_temp
AS $$
  SELECT decrypted_secret
  FROM vault.decrypted_secrets
  WHERE name = 'cron_secret'
  LIMIT 1
$$;

REVOKE EXECUTE ON FUNCTION public.get_cron_secret() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_cron_secret() TO postgres, service_role;

SELECT cron.unschedule('automated-onboarding-reminders')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'automated-onboarding-reminders');

SELECT cron.schedule(
  'automated-onboarding-reminders',
  '0 9 * * *',
  $$
  SELECT net.http_post(
    url := 'https://noaupcteygfvlyymqtew.supabase.co/functions/v1/automated-messages?job=onboarding-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', public.get_cron_secret()
    ),
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.unschedule('automated-whatsapp-scheduled-campaigns')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'automated-whatsapp-scheduled-campaigns');

SELECT cron.schedule(
  'automated-whatsapp-scheduled-campaigns',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://noaupcteygfvlyymqtew.supabase.co/functions/v1/automated-messages?job=scheduled-campaigns',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', public.get_cron_secret()
    ),
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.unschedule('automated-document-expiry')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'automated-document-expiry');

SELECT cron.schedule(
  'automated-document-expiry',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://noaupcteygfvlyymqtew.supabase.co/functions/v1/check-document-expiry',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', public.get_cron_secret()
    ),
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.unschedule('birthday-loyalty-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'birthday-loyalty-daily');

SELECT cron.schedule(
  'birthday-loyalty-daily',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://noaupcteygfvlyymqtew.supabase.co/functions/v1/birthday-loyalty-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', public.get_cron_secret()
    ),
    body := jsonb_build_object('mode', 'cron')
  ) AS request_id;
  $$
);

SELECT cron.unschedule('housing-reminder-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'housing-reminder-daily');

SELECT cron.schedule(
  'housing-reminder-daily',
  '30 2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://noaupcteygfvlyymqtew.supabase.co/functions/v1/housing-reminder-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', public.get_cron_secret()
    ),
    body := jsonb_build_object('mode', 'cron')
  ) AS request_id;
  $$
);

SELECT cron.unschedule('check-vehicle-apk-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'check-vehicle-apk-daily');

SELECT cron.schedule(
  'check-vehicle-apk-daily',
  '45 2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://noaupcteygfvlyymqtew.supabase.co/functions/v1/check-vehicle-apk',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', public.get_cron_secret()
    ),
    body := jsonb_build_object('mode', 'cron')
  ) AS request_id;
  $$
);

COMMIT;
