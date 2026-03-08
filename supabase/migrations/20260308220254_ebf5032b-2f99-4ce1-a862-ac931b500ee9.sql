
CREATE TABLE public.exact_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tenant_id text,
  webhook_secret text,
  division integer,
  company_name text,
  region text DEFAULT 'nl',
  base_url text,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id)
);

ALTER TABLE public.exact_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_select" ON public.exact_config FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id());
CREATE POLICY "tenant_insert" ON public.exact_config FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org_id());
CREATE POLICY "tenant_update" ON public.exact_config FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id());
CREATE POLICY "tenant_delete" ON public.exact_config FOR DELETE TO authenticated
  USING (organization_id = get_user_org_id() AND get_user_role() = 'admin');
