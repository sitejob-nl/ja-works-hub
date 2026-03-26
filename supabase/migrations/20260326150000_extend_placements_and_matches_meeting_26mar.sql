-- Payroller enum
CREATE TYPE public.payroller_type AS ENUM ('flexpedia', 'brioworks', 'bromida', 'retiva');

-- Terminated by enum
CREATE TYPE public.terminated_by_type AS ENUM ('opdrachtgever', 'medewerker', 'uitzendbureau');

-- Extend placements
ALTER TABLE public.placements
  ADD COLUMN IF NOT EXISTS payroller public.payroller_type,
  ADD COLUMN IF NOT EXISTS expected_end_date date,
  ADD COLUMN IF NOT EXISTS terminated_by public.terminated_by_type,
  ADD COLUMN IF NOT EXISTS termination_reason text,
  ADD COLUMN IF NOT EXISTS termination_notes text,
  ADD COLUMN IF NOT EXISTS terminated_at timestamptz,
  ADD COLUMN IF NOT EXISTS housing_payment_type text CHECK (housing_payment_type IN ('betaald', 'inhouding', 'gratis')),
  ADD COLUMN IF NOT EXISTS salary_indication text;

-- Extend match statuses
ALTER TYPE public.match_status ADD VALUE IF NOT EXISTS 'nieuwe_match' BEFORE 'voorgesteld';
ALTER TYPE public.match_status ADD VALUE IF NOT EXISTS 'gescreend' AFTER 'nieuwe_match';

-- Extend matches
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS screening_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS screening_completed_by uuid REFERENCES public.profiles(id);

-- Termination reasons
CREATE TABLE public.termination_reasons (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  terminated_by public.terminated_by_type NOT NULL,
  reason text NOT NULL,
  sort_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.termination_reasons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_select" ON public.termination_reasons FOR SELECT TO authenticated USING (organization_id = get_user_org_id());
CREATE POLICY "tenant_insert" ON public.termination_reasons FOR INSERT TO authenticated WITH CHECK (organization_id = get_user_org_id());
CREATE POLICY "tenant_update" ON public.termination_reasons FOR UPDATE TO authenticated USING (organization_id = get_user_org_id());
