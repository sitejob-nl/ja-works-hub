-- Carerix import: credentials + job tracking tables.
-- Pattern follows voys_integration (encrypted token via trigger + RPC).

-- ============================================================
-- 1. carerix_config: OAuth2 credentials per organisatie
-- ============================================================
CREATE TABLE IF NOT EXISTS public.carerix_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id text,
  client_secret text,
  token_endpoint text,
  instance_url text,
  scope text NOT NULL DEFAULT 'urn:cx/cx5Wrapper:data:manage',
  is_connected boolean NOT NULL DEFAULT false,
  connected_at timestamptz,
  last_test_at timestamptz,
  last_test_ok boolean,
  last_test_error text,
  last_test_total_companies integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id)
);

-- Encrypt client_secret on insert/update
CREATE OR REPLACE FUNCTION public.encrypt_carerix_secret()
RETURNS trigger AS $$
BEGIN
  IF NEW.client_secret IS NOT NULL AND NEW.client_secret != '' THEN
    NEW.client_secret := encrypt_sensitive(NEW.client_secret);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS encrypt_carerix_secret_trigger ON public.carerix_config;
CREATE TRIGGER encrypt_carerix_secret_trigger
  BEFORE INSERT OR UPDATE OF client_secret ON public.carerix_config
  FOR EACH ROW EXECUTE FUNCTION public.encrypt_carerix_secret();

-- RPC to get decrypted credentials (service role only in practice)
CREATE OR REPLACE FUNCTION public.get_carerix_token(p_org_id uuid)
RETURNS TABLE (
  client_id text,
  decrypted_client_secret text,
  token_endpoint text,
  instance_url text,
  scope text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'vault'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.client_id,
    decrypt_sensitive(c.client_secret) AS decrypted_client_secret,
    c.token_endpoint,
    c.instance_url,
    c.scope
  FROM public.carerix_config c
  WHERE c.organization_id = p_org_id
    AND c.is_connected = true;
END;
$$;

-- RLS: admins binnen eigen org
ALTER TABLE public.carerix_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "carerix_config_select" ON public.carerix_config
  FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id() AND get_user_role() = 'admin');

CREATE POLICY "carerix_config_insert" ON public.carerix_config
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org_id() AND get_user_role() = 'admin');

CREATE POLICY "carerix_config_update" ON public.carerix_config
  FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id() AND get_user_role() = 'admin');

CREATE POLICY "carerix_config_delete" ON public.carerix_config
  FOR DELETE TO authenticated
  USING (organization_id = get_user_org_id() AND get_user_role() = 'admin');


-- ============================================================
-- 2. carerix_import_jobs: één import run
-- ============================================================
CREATE TABLE IF NOT EXISTS public.carerix_import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  mode text NOT NULL DEFAULT 'live' CHECK (mode IN ('dry_run', 'live')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  only_entities text[],
  skip_entities text[],
  modified_since timestamptz,
  summary jsonb,
  last_error text
);

CREATE INDEX IF NOT EXISTS idx_carerix_jobs_org ON public.carerix_import_jobs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_carerix_jobs_status ON public.carerix_import_jobs(status) WHERE status IN ('queued', 'running');

ALTER TABLE public.carerix_import_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "carerix_jobs_select" ON public.carerix_import_jobs
  FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id() AND get_user_role() = 'admin');

CREATE POLICY "carerix_jobs_insert" ON public.carerix_import_jobs
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org_id() AND get_user_role() = 'admin');

CREATE POLICY "carerix_jobs_update" ON public.carerix_import_jobs
  FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id() AND get_user_role() = 'admin');


-- ============================================================
-- 3. carerix_import_entity_runs: per entiteit per job
-- ============================================================
CREATE TABLE IF NOT EXISTS public.carerix_import_entity_runs (
  job_id uuid NOT NULL REFERENCES public.carerix_import_jobs(id) ON DELETE CASCADE,
  entity text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'skipped')),
  page_cursor integer NOT NULL DEFAULT 0,
  total_elements integer,
  found integer NOT NULL DEFAULT 0,
  created integer NOT NULL DEFAULT 0,
  skipped integer NOT NULL DEFAULT 0,
  failed integer NOT NULL DEFAULT 0,
  last_error text,
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, entity)
);

CREATE INDEX IF NOT EXISTS idx_carerix_entity_runs_job ON public.carerix_import_entity_runs(job_id);

ALTER TABLE public.carerix_import_entity_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "carerix_entity_runs_select" ON public.carerix_import_entity_runs
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.carerix_import_jobs j
    WHERE j.id = job_id
      AND j.organization_id = get_user_org_id()
      AND get_user_role() = 'admin'
  ));


-- ============================================================
-- 4. carerix_import_failures: gefaalde records
-- ============================================================
CREATE TABLE IF NOT EXISTS public.carerix_import_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.carerix_import_jobs(id) ON DELETE CASCADE,
  entity text NOT NULL,
  carerix_id text,
  error text NOT NULL,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_carerix_failures_job ON public.carerix_import_failures(job_id, entity);

ALTER TABLE public.carerix_import_failures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "carerix_failures_select" ON public.carerix_import_failures
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.carerix_import_jobs j
    WHERE j.id = job_id
      AND j.organization_id = get_user_org_id()
      AND get_user_role() = 'admin'
  ));


-- ============================================================
-- 5. Realtime: entity_runs + jobs + config
-- ============================================================
ALTER TABLE public.carerix_import_jobs REPLICA IDENTITY FULL;
ALTER TABLE public.carerix_import_entity_runs REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'carerix_import_jobs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.carerix_import_jobs;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'carerix_import_entity_runs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.carerix_import_entity_runs;
  END IF;
END
$$;
