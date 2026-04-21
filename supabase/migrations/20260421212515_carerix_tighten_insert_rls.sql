-- Defense-in-depth: INSERT policies hadden geen WITH CHECK. Edge functions
-- gebruiken service_role (bypassed RLS) dus functioneel geen wijziging, maar
-- een gelekte anon-key kan hiermee geen rogue config/jobs aanmaken.

DROP POLICY IF EXISTS "carerix_config_insert" ON public.carerix_config;
CREATE POLICY "carerix_config_insert" ON public.carerix_config
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org_id() AND get_user_role() = 'admin');

DROP POLICY IF EXISTS "carerix_jobs_insert" ON public.carerix_import_jobs;
CREATE POLICY "carerix_jobs_insert" ON public.carerix_import_jobs
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org_id() AND get_user_role() = 'admin');
