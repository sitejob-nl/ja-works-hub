-- Configurable WhatsApp automation support.

CREATE TABLE IF NOT EXISTS public.whatsapp_conversation_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  candidate_id uuid REFERENCES public.candidates(id) ON DELETE CASCADE,
  phone text NOT NULL,
  flow_type text NOT NULL,
  step text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '2 hours'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, phone, flow_type)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversation_states_lookup
  ON public.whatsapp_conversation_states(organization_id, phone, flow_type, expires_at);

WITH duplicates AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY campaign_id, candidate_id
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM public.campaign_recipients
)
DELETE FROM public.campaign_recipients cr
USING duplicates d
WHERE cr.id = d.id
  AND d.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_recipients_campaign_candidate
  ON public.campaign_recipients(campaign_id, candidate_id);

ALTER TABLE public.whatsapp_conversation_states ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select ON public.whatsapp_conversation_states;
CREATE POLICY tenant_select ON public.whatsapp_conversation_states
  FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id());

DROP POLICY IF EXISTS tenant_delete ON public.whatsapp_conversation_states;
CREATE POLICY tenant_delete ON public.whatsapp_conversation_states
  FOR DELETE TO authenticated
  USING (organization_id = get_user_org_id());

DROP TRIGGER IF EXISTS update_whatsapp_conversation_states_updated_at ON public.whatsapp_conversation_states;
CREATE TRIGGER update_whatsapp_conversation_states_updated_at
  BEFORE UPDATE ON public.whatsapp_conversation_states
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

UPDATE public.organizations
SET settings = jsonb_set(
  coalesce(settings, '{}'::jsonb),
  '{whatsapp_automation_settings}',
  coalesce(settings->'whatsapp_automation_settings', jsonb_build_object(
    'bulk_enabled', true,
    'bulk_rate_limit_per_minute', 20,
    'bulk_rate_limit_per_hour', 1000,
    'bulk_batch_size', 50,
    'bulk_max_concurrent', 5,
    'bulk_delay_between_batches_ms', 2000,
    'onboarding_reminders_enabled', true,
    'onboarding_reminder_days', jsonb_build_array(1, 3, 7),
    'document_expiry_enabled', false,
    'document_expiry_days', jsonb_build_array(30, 14, 7, 0),
    'placement_employee_whatsapp_enabled', false,
    'placement_client_whatsapp_enabled', false,
    'sick_report_enabled', true,
    'sick_report_ask_reason', true,
    'sick_report_deadline_time', '09:00',
    'sick_report_after_deadline_task_priority', 'urgent'
  )),
  true
)
WHERE settings->'whatsapp_automation_settings' IS NULL;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT cron.unschedule('automated-whatsapp-scheduled-campaigns')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'automated-whatsapp-scheduled-campaigns'
);

SELECT cron.schedule(
  'automated-whatsapp-scheduled-campaigns',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://noaupcteygfvlyymqtew.supabase.co/functions/v1/automated-messages?job=scheduled-campaigns',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', current_setting('app.cron_secret', true)
    ),
    body := '{}'::jsonb
  );
  $$
);

SELECT cron.unschedule('automated-document-expiry')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'automated-document-expiry'
);

SELECT cron.schedule(
  'automated-document-expiry',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://noaupcteygfvlyymqtew.supabase.co/functions/v1/check-document-expiry',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Cron-Secret', current_setting('app.cron_secret', true)
    ),
    body := '{}'::jsonb
  );
  $$
);
