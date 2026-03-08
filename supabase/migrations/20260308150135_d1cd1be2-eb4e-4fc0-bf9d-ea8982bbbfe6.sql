
-- Superadmins table FIRST
CREATE TABLE public.superadmins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  email text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Now create the function
CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.superadmins WHERE user_id = auth.uid())
$$;

ALTER TABLE public.superadmins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "superadmin_select" ON public.superadmins FOR SELECT TO authenticated USING (public.is_superadmin());

-- Subscription plans
CREATE TABLE public.subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  modules text[] NOT NULL DEFAULT '{}',
  is_default boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "superadmin_all_plans" ON public.subscription_plans FOR ALL TO authenticated USING (public.is_superadmin()) WITH CHECK (public.is_superadmin());
CREATE POLICY "authenticated_read_plans" ON public.subscription_plans FOR SELECT TO authenticated USING (true);

ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS plan_id uuid REFERENCES public.subscription_plans(id);

-- Organization modules
CREATE TABLE public.organization_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  module_name text NOT NULL,
  enabled boolean DEFAULT true,
  UNIQUE(organization_id, module_name)
);
ALTER TABLE public.organization_modules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_read_own_modules" ON public.organization_modules FOR SELECT TO authenticated USING (organization_id = get_user_org_id() OR is_superadmin());
CREATE POLICY "superadmin_manage_modules" ON public.organization_modules FOR ALL TO authenticated USING (is_superadmin()) WITH CHECK (is_superadmin());

-- Client errors
CREATE TABLE public.client_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid,
  user_email text,
  error_message text NOT NULL,
  stack_trace text,
  component_stack text,
  url text,
  user_agent text,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.client_errors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone_insert_errors" ON public.client_errors FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "superadmin_read_errors" ON public.client_errors FOR SELECT TO authenticated USING (is_superadmin());
CREATE POLICY "superadmin_delete_errors" ON public.client_errors FOR DELETE TO authenticated USING (is_superadmin());

-- Security definer functions
CREATE OR REPLACE FUNCTION public.sa_get_organizations()
RETURNS TABLE(
  id uuid, name text, slug text, email text, phone text, website text,
  logo_url text, is_active boolean, plan_id uuid,
  kvk_number text, btw_number text,
  address_street text, address_postal text, address_city text,
  settings jsonb, created_at timestamptz, updated_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT id, name, slug, email, phone, website, logo_url, is_active, plan_id,
         kvk_number, btw_number, address_street, address_postal, address_city,
         settings, created_at, updated_at
  FROM public.organizations
  WHERE (SELECT is_superadmin())
  ORDER BY created_at DESC
$$;

CREATE OR REPLACE FUNCTION public.sa_get_profiles()
RETURNS TABLE(
  id uuid, email text, full_name text, role user_role,
  organization_id uuid, is_active boolean, phone text, avatar_url text,
  created_at timestamptz, updated_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT id, email, full_name, role, organization_id, is_active, phone, avatar_url, created_at, updated_at
  FROM public.profiles
  WHERE (SELECT is_superadmin())
  ORDER BY created_at DESC
$$;

CREATE OR REPLACE FUNCTION public.sa_get_org_stats(org_uuid uuid)
RETURNS TABLE(
  employees_count bigint, candidates_count bigint, companies_count bigint,
  placements_count bigint, vehicles_count bigint, properties_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    (SELECT count(*) FROM public.employees WHERE organization_id = org_uuid),
    (SELECT count(*) FROM public.candidates WHERE organization_id = org_uuid),
    (SELECT count(*) FROM public.companies WHERE organization_id = org_uuid),
    (SELECT count(*) FROM public.placements WHERE organization_id = org_uuid),
    (SELECT count(*) FROM public.vehicles WHERE organization_id = org_uuid),
    (SELECT count(*) FROM public.properties WHERE organization_id = org_uuid)
  WHERE (SELECT is_superadmin())
$$;

CREATE OR REPLACE FUNCTION public.sa_get_audit_log(p_limit int DEFAULT 100, p_offset int DEFAULT 0)
RETURNS TABLE(
  id uuid, organization_id uuid, user_id uuid, action audit_action,
  table_name text, record_id uuid, old_values jsonb, new_values jsonb,
  reason text, ip_address text, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT id, organization_id, user_id, action, table_name, record_id,
         old_values, new_values, reason, ip_address, created_at
  FROM public.audit_log
  WHERE (SELECT is_superadmin())
  ORDER BY created_at DESC
  LIMIT p_limit OFFSET p_offset
$$;

CREATE OR REPLACE FUNCTION public.sa_update_org_active(org_uuid uuid, active boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT is_superadmin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  UPDATE public.organizations SET is_active = active, updated_at = now() WHERE id = org_uuid;
END;
$$;

CREATE OR REPLACE FUNCTION public.sa_update_org_plan(org_uuid uuid, new_plan_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT is_superadmin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  UPDATE public.organizations SET plan_id = new_plan_id, updated_at = now() WHERE id = org_uuid;
END;
$$;

-- Insert default subscription plans
INSERT INTO public.subscription_plans (name, description, modules, is_default) VALUES
  ('Basis', 'Basispakket met kernmodules', ARRAY['opdrachtgevers','kandidaten','medewerkers','vacatures','planning','uren'], false),
  ('Pro', 'Uitgebreid pakket met alle modules', ARRAY['opdrachtgevers','kandidaten','medewerkers','vacatures','planning','uren','huisvesting','transport','communicatie','kennisbank'], true),
  ('Enterprise', 'Volledig pakket met alle features', ARRAY['opdrachtgevers','kandidaten','medewerkers','vacatures','planning','uren','huisvesting','transport','communicatie','kennisbank'], false);
