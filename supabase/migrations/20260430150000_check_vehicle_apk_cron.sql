-- pg_cron schedule voor check-vehicle-apk edge function
--
-- Roept dagelijks om 02:45 UTC check-vehicle-apk aan met cron-mode header.
-- De edge function flagged voertuigen met apk_expiry binnen 60 dagen
-- (en al verlopen) als recruiter_task. Idempotent.
--
-- Vereist:
--   1. `CRON_SECRET` als secret op edge function (Supabase Dashboard → Functions → Secrets)
--   2. `app.cron_secret` setting in DB met dezelfde waarde:
--        ALTER DATABASE postgres SET app.cron_secret = '<jouw-secret>';
--
-- Verwijderen via:
--   SELECT cron.unschedule('check-vehicle-apk-daily');

BEGIN;

SELECT cron.schedule(
  'check-vehicle-apk-daily',
  '45 2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://noaupcteygfvlyymqtew.supabase.co/functions/v1/check-vehicle-apk',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', current_setting('app.cron_secret', true)
    ),
    body := jsonb_build_object('mode', 'cron')
  ) AS request_id;
  $$
);

COMMIT;
