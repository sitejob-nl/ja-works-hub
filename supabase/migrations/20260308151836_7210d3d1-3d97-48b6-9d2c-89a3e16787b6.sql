
-- Create job_listings table
CREATE TABLE public.job_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  title text NOT NULL,
  organization_name text,
  organization_url text,
  organization_logo text,
  url text,
  locations_derived jsonb,
  country text,
  city text,
  description_text text,
  source text,
  employment_type text[],
  work_arrangement text,
  ai_taxonomies text[],
  ai_key_skills text[],
  ai_salary_currency text,
  ai_salary_min numeric,
  ai_salary_max numeric,
  ai_salary_unit text,
  date_posted timestamptz,
  date_imported timestamptz NOT NULL DEFAULT now(),
  linkedin_org_industry text,
  linkedin_org_employees integer,
  raw_data jsonb,
  UNIQUE (organization_id, external_id)
);

ALTER TABLE public.job_listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_select" ON public.job_listings FOR SELECT USING (organization_id = get_user_org_id());
CREATE POLICY "tenant_insert" ON public.job_listings FOR INSERT WITH CHECK (organization_id = get_user_org_id());
CREATE POLICY "tenant_update" ON public.job_listings FOR UPDATE USING (organization_id = get_user_org_id());
CREATE POLICY "tenant_delete" ON public.job_listings FOR DELETE USING (organization_id = get_user_org_id() AND get_user_role() = 'admin'::user_role);

-- Create job_import_logs table
CREATE TABLE public.job_import_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  imported_at timestamptz NOT NULL DEFAULT now(),
  total_jobs integer NOT NULL DEFAULT 0,
  new_jobs integer NOT NULL DEFAULT 0,
  filters_used jsonb,
  status text NOT NULL DEFAULT 'completed'
);

ALTER TABLE public.job_import_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_select" ON public.job_import_logs FOR SELECT USING (organization_id = get_user_org_id());
CREATE POLICY "tenant_insert" ON public.job_import_logs FOR INSERT WITH CHECK (organization_id = get_user_org_id());
