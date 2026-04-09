-- ============================================================
-- Job Feed Configs: geautomatiseerde recurring job imports
-- ============================================================

CREATE TABLE public.job_feed_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  schedule text NOT NULL DEFAULT 'daily',  -- 'hourly', 'daily', 'weekly'
  source_type text NOT NULL DEFAULT 'career_site',  -- 'career_site' of 'linkedin'
  filters_config jsonb NOT NULL DEFAULT '{}',
  last_run_at timestamptz,
  last_run_status text,
  last_run_job_count integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

ALTER TABLE public.job_feed_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_select" ON public.job_feed_configs
  FOR SELECT USING (organization_id = get_user_org_id());

CREATE POLICY "tenant_insert" ON public.job_feed_configs
  FOR INSERT WITH CHECK (organization_id = get_user_org_id());

CREATE POLICY "tenant_update" ON public.job_feed_configs
  FOR UPDATE USING (organization_id = get_user_org_id());

CREATE POLICY "tenant_delete" ON public.job_feed_configs
  FOR DELETE USING (organization_id = get_user_org_id() AND get_user_role() = 'admin'::user_role);

-- Trigger voor updated_at
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.job_feed_configs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- pg_cron scheduling: elk uur checken welke feeds moeten draaien
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'job-feed-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/job-feed-runner',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', current_setting('app.settings.job_feed_secret')
    ),
    body := jsonb_build_object('trigger', 'cron')
  );
  $$
);
