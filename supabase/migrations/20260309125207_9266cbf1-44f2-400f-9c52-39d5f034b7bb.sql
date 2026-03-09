
-- Regulations table: versioned company regulations/policies
CREATE TABLE public.regulations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  content text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  published_at timestamp with time zone DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.regulations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_select" ON public.regulations FOR SELECT USING (organization_id = get_user_org_id());
CREATE POLICY "tenant_insert" ON public.regulations FOR INSERT WITH CHECK (organization_id = get_user_org_id());
CREATE POLICY "tenant_update" ON public.regulations FOR UPDATE USING (organization_id = get_user_org_id());
CREATE POLICY "tenant_delete" ON public.regulations FOR DELETE USING (organization_id = get_user_org_id() AND get_user_role() = 'admin'::user_role);

-- Regulation acknowledgements: tracks employee signatures
CREATE TABLE public.regulation_acknowledgements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  regulation_id uuid NOT NULL REFERENCES public.regulations(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  signed_at timestamp with time zone NOT NULL DEFAULT now(),
  ip_address text,
  UNIQUE(regulation_id, employee_id)
);

ALTER TABLE public.regulation_acknowledgements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_select" ON public.regulation_acknowledgements FOR SELECT USING (organization_id = get_user_org_id());
CREATE POLICY "tenant_insert" ON public.regulation_acknowledgements FOR INSERT WITH CHECK (organization_id = get_user_org_id());
CREATE POLICY "tenant_delete" ON public.regulation_acknowledgements FOR DELETE USING (organization_id = get_user_org_id() AND get_user_role() = 'admin'::user_role);

-- Contract templates table
CREATE TABLE public.contract_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  content text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.contract_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_select" ON public.contract_templates FOR SELECT USING (organization_id = get_user_org_id());
CREATE POLICY "tenant_insert" ON public.contract_templates FOR INSERT WITH CHECK (organization_id = get_user_org_id());
CREATE POLICY "tenant_update" ON public.contract_templates FOR UPDATE USING (organization_id = get_user_org_id());
CREATE POLICY "tenant_delete" ON public.contract_templates FOR DELETE USING (organization_id = get_user_org_id() AND get_user_role() = 'admin'::user_role);

-- Contracts table
CREATE TYPE public.contract_status AS ENUM ('concept', 'verzonden', 'getekend', 'verlopen');

CREATE TABLE public.contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  template_id uuid REFERENCES public.contract_templates(id),
  title text NOT NULL,
  content text NOT NULL,
  status public.contract_status NOT NULL DEFAULT 'concept',
  sent_at timestamp with time zone,
  signed_at timestamp with time zone,
  sign_token text UNIQUE,
  pdf_url text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_select" ON public.contracts FOR SELECT USING (organization_id = get_user_org_id());
CREATE POLICY "tenant_insert" ON public.contracts FOR INSERT WITH CHECK (organization_id = get_user_org_id());
CREATE POLICY "tenant_update" ON public.contracts FOR UPDATE USING (organization_id = get_user_org_id());
CREATE POLICY "tenant_delete" ON public.contracts FOR DELETE USING (organization_id = get_user_org_id() AND get_user_role() = 'admin'::user_role);

-- Also allow public access to contracts by sign_token (for e-sign flow)
CREATE POLICY "public_sign_token_select" ON public.contracts FOR SELECT TO anon USING (sign_token IS NOT NULL);
CREATE POLICY "public_sign_token_update" ON public.contracts FOR UPDATE TO anon USING (sign_token IS NOT NULL);

-- Updated_at triggers
CREATE TRIGGER handle_regulations_updated_at BEFORE UPDATE ON public.regulations FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER handle_contract_templates_updated_at BEFORE UPDATE ON public.contract_templates FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
CREATE TRIGGER handle_contracts_updated_at BEFORE UPDATE ON public.contracts FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
