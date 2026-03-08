
-- Add skills_required to vacancies
ALTER TABLE public.vacancies ADD COLUMN IF NOT EXISTS skills_required text[] DEFAULT '{}';

-- Create onboarding_tokens table
CREATE TABLE public.onboarding_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + interval '7 days'),
  used_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.onboarding_tokens ENABLE ROW LEVEL SECURITY;

-- Org users can manage tokens
CREATE POLICY "tenant_select" ON public.onboarding_tokens FOR SELECT USING (organization_id = get_user_org_id());
CREATE POLICY "tenant_insert" ON public.onboarding_tokens FOR INSERT WITH CHECK (organization_id = get_user_org_id());
CREATE POLICY "tenant_update" ON public.onboarding_tokens FOR UPDATE USING (organization_id = get_user_org_id());

-- Public read access for valid tokens (for onboarding page, via edge function with service role)
