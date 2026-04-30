-- pg_cron schedule voor housing-reminder-cron edge function
--
-- Roept dagelijks om 02:30 UTC (03:30 NL winter / 04:30 zomer) housing-reminder-cron
-- aan met cron-mode header. De edge function controleert: (a) properties met
-- rental_contract_end_date binnen 90 dagen, (b) units met overbezetting.
-- Per overtreding wordt één recruiter_task aangemaakt (idempotent).
--
-- Vereist:
--   1. `CRON_SECRET` als secret op edge function (Supabase Dashboard → Functions → Secrets)
--   2. `app.cron_secret` setting in DB met dezelfde waarde:
--        ALTER DATABASE postgres SET app.cron_secret = '<jouw-secret>';
--      (uitvoeren via Supabase SQL editor — niet via migration)
--
-- Verwijderen via:
--   SELECT cron.unschedule('housing-reminder-daily');

BEGIN;

SELECT cron.schedule(
  'housing-reminder-daily',
  '30 2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://noaupcteygfvlyymqtew.supabase.co/functions/v1/housing-reminder-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', current_setting('app.cron_secret', true)
    ),
    body := jsonb_build_object('mode', 'cron')
  ) AS request_id;
  $$
);

COMMIT;
