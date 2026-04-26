-- D3 — pg_cron schedules voor dynamische talentpools
--
-- LET OP: deze migration is OPTIONEEL en wordt pas toegepast als je
-- scheduled refresh wilt aanzetten. Vereist:
--   1. CRON_SECRET als edge function secret (Supabase Dashboard → Functions → Secrets)
--   2. Database setting `app.cron_secret` met dezelfde waarde
--
-- Voer eerst handmatig uit:
--   ALTER DATABASE postgres SET app.cron_secret = '<jouw-secret>';
--
-- En dan deze migration. Verwijder via:
--   SELECT cron.unschedule('refresh-talentpools-daily');
--   SELECT cron.unschedule('refresh-talentpools-weekly');

BEGIN;

-- Daily om 02:00 UTC (03:00 NL winter / 04:00 zomer)
SELECT cron.schedule(
  'refresh-talentpools-daily',
  '0 2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://noaupcteygfvlyymqtew.supabase.co/functions/v1/refresh-talentpool-members',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', current_setting('app.cron_secret', true)
    ),
    body := jsonb_build_object('mode', 'cron', 'frequency', 'daily')
  ) AS request_id;
  $$
);

-- Weekly: zondag om 03:00 UTC
SELECT cron.schedule(
  'refresh-talentpools-weekly',
  '0 3 * * 0',
  $$
  SELECT net.http_post(
    url := 'https://noaupcteygfvlyymqtew.supabase.co/functions/v1/refresh-talentpool-members',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', current_setting('app.cron_secret', true)
    ),
    body := jsonb_build_object('mode', 'cron', 'frequency', 'weekly')
  ) AS request_id;
  $$
);

COMMIT;
