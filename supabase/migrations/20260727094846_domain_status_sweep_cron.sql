-- pg_cron schedule voor de domeinstatus-sweep (domain-management, cron-modus)
--
-- Zonder deze sweep verandert een domeinstatus alleen wanneer een admin handmatig op
-- Check klikt. Een domein dat later omvalt (DNS gewijzigd, record verwijderd) blijft dan
-- `verified` en blijft de basis voor links in uitgaande mail — die wijzen dan naar een
-- hostname die niet meer resolveert.
--
-- De sweep hercontroleert elk actief domein tegen de Vercel API en maakt bij een terugval
-- van `verified` naar iets anders een recruiter_task aan (categorie `domein_dns`).
-- Idempotent: zolang die taak open staat komt er geen tweede.
--
-- Draait dagelijks om 03:15 UTC — na de bestaande crons (02:30 housing, 02:45 APK) zodat
-- de externe API-aanroepen niet samenvallen.
--
-- Het shared secret komt uit Supabase Vault via public.get_cron_secret() (zie
-- 20260616143000_cron_secret_vault.sql) — de productierol kan geen
-- `ALTER DATABASE ... SET app.cron_secret` uitvoeren, dus het GUC-patroon werkt hier niet.
--
-- Verwijderen via:
--   SELECT cron.unschedule('domain-status-sweep-daily');

BEGIN;

-- Idempotent: een eerdere versie van deze schedule eerst opruimen.
SELECT cron.unschedule('domain-status-sweep-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'domain-status-sweep-daily');

SELECT cron.schedule(
  'domain-status-sweep-daily',
  '15 3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://noaupcteygfvlyymqtew.supabase.co/functions/v1/domain-management',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', public.get_cron_secret()
    ),
    body := jsonb_build_object('mode', 'cron')
  ) AS request_id;
  $$
);

COMMIT;
