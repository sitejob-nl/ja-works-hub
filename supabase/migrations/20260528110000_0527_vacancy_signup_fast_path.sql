-- 05-27 vacature-sollicitatie fast path: publieke aanmeldlinks kunnen direct aan een vacature hangen.
ALTER TABLE public.candidate_signup_links
  ADD COLUMN IF NOT EXISTS vacancy_id uuid REFERENCES public.vacancies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_candidate_signup_links_vacancy_id
  ON public.candidate_signup_links (organization_id, vacancy_id)
  WHERE vacancy_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_matches_org_vacancy_candidate
  ON public.matches (organization_id, vacancy_id, candidate_id);

COMMENT ON COLUMN public.candidate_signup_links.vacancy_id IS
  'Optionele vacaturekoppeling voor publieke sollicitaties; de signup edge function maakt hiermee direct een match aan.';

ALTER TABLE public.candidate_signup_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS candidate_signup_links_tenant_select ON public.candidate_signup_links;
CREATE POLICY candidate_signup_links_tenant_select
  ON public.candidate_signup_links
  FOR SELECT
  TO authenticated
  USING (organization_id = public.get_user_org_id());

DROP POLICY IF EXISTS candidate_signup_links_tenant_insert ON public.candidate_signup_links;
CREATE POLICY candidate_signup_links_tenant_insert
  ON public.candidate_signup_links
  FOR INSERT
  TO authenticated
  WITH CHECK (organization_id = public.get_user_org_id());

DROP POLICY IF EXISTS candidate_signup_links_tenant_update ON public.candidate_signup_links;
CREATE POLICY candidate_signup_links_tenant_update
  ON public.candidate_signup_links
  FOR UPDATE
  TO authenticated
  USING (organization_id = public.get_user_org_id())
  WITH CHECK (organization_id = public.get_user_org_id());
