-- Enable pg_cron + pg_net en schedule automated jobs.
--
-- Jobs draaien onder de postgres rol via pg_cron's worker. Elke job
-- post via net.http_post naar een edge function. De AUTOMATED_KEY
-- voor automated-messages staat ingemetseld; bij rotatie zowel de
-- edge function secret als deze schedule bijwerken.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

GRANT USAGE ON SCHEMA cron TO postgres;

-- Onboarding reminders — dagelijks 09:00 UTC
SELECT cron.schedule(
  'automated-onboarding-reminders',
  '0 9 * * *',
  $$
  SELECT net.http_post(
    url := 'https://noaupcteygfvlyymqtew.supabase.co/functions/v1/automated-messages?job=onboarding-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Automated-Key', 'VwEQ-VFVx-Gx3wYtN50pP4hpV_Sr-O4QGOebM1KTgNo'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Document expiry markering — dagelijks 06:00 UTC.
-- check-document-expiry heeft verify_jwt=false en optionele user-auth, dus
-- anonymous call is OK voor deze read/update taak.
SELECT cron.schedule(
  'automated-document-expiry',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://noaupcteygfvlyymqtew.supabase.co/functions/v1/check-document-expiry',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
  $$
);
