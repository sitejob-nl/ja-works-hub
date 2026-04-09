-- Exact Online integratie uitbreidingen
-- 1. exact_account_id op companies voor relatie-koppeling
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS exact_account_id text;

-- 2. exact_sync_error op invoices voor foutmelding UI
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS exact_sync_error text;

-- 3. GLAccount mapping per uurtype
CREATE TABLE IF NOT EXISTS public.exact_glaccount_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  hour_type_code text NOT NULL,
  gl_account_id text NOT NULL,
  gl_account_code text,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, hour_type_code)
);

ALTER TABLE public.exact_glaccount_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_select" ON public.exact_glaccount_mappings
  FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id());

CREATE POLICY "tenant_insert" ON public.exact_glaccount_mappings
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org_id());

CREATE POLICY "tenant_update" ON public.exact_glaccount_mappings
  FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id());

CREATE POLICY "tenant_delete" ON public.exact_glaccount_mappings
  FOR DELETE TO authenticated
  USING (organization_id = get_user_org_id());
