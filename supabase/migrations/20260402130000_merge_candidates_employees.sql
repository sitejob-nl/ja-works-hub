-- ============================================================
-- FASE 1: Kandidaat/Medewerker Merge
-- Kandidaat = altijd kandidaat (Carerix-model)
-- ============================================================

-- ============================================================
-- STAP 1: Voeg employment-velden toe aan candidates
-- ============================================================

ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS employee_number text,
  ADD COLUMN IF NOT EXISTS employee_status text,
  ADD COLUMN IF NOT EXISTS auth_user_id uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS portal_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS portal_activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS portal_last_login timestamptz,
  ADD COLUMN IF NOT EXISTS portal_language text,
  ADD COLUMN IF NOT EXISTS onboarding_completed boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;

-- Index voor portal login lookup
CREATE INDEX IF NOT EXISTS candidates_auth_user_id_idx ON public.candidates(auth_user_id) WHERE auth_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS candidates_employee_status_idx ON public.candidates(employee_status) WHERE employee_status IS NOT NULL;

-- ============================================================
-- STAP 2: Maak candidate_employment tabel (meerdere dienstverbanden)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.candidate_employment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  start_date date NOT NULL,
  end_date date,
  end_reason text,
  contract_type text,
  contract_hours numeric,
  pay_frequency text,
  vacation_days_total numeric DEFAULT 0,
  vacation_days_used numeric DEFAULT 0,
  vacation_money_percentage numeric,
  pension_scheme text,
  pension_start_date date,
  insurance_type text,
  insurance_notes text,
  senior_days numeric DEFAULT 0,
  notes text,
  is_current boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.candidate_employment ENABLE ROW LEVEL SECURITY;

CREATE POLICY "candidate_employment_select" ON public.candidate_employment
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "candidate_employment_insert" ON public.candidate_employment
  FOR INSERT TO authenticated
  WITH CHECK (organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "candidate_employment_update" ON public.candidate_employment
  FOR UPDATE TO authenticated
  USING (organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "candidate_employment_delete" ON public.candidate_employment
  FOR DELETE TO authenticated
  USING (organization_id IN (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));

CREATE INDEX IF NOT EXISTS candidate_employment_candidate_id_idx ON public.candidate_employment(candidate_id);
CREATE INDEX IF NOT EXISTS candidate_employment_is_current_idx ON public.candidate_employment(candidate_id) WHERE is_current = true;

-- ============================================================
-- STAP 3: Kopieer employee data naar candidates
-- ============================================================

UPDATE public.candidates c SET
  employee_number = e.employee_number,
  employee_status = e.status::text,
  auth_user_id = e.auth_user_id,
  portal_enabled = COALESCE(e.portal_enabled, false),
  portal_activated_at = e.portal_activated_at,
  portal_last_login = e.portal_last_login,
  portal_language = e.portal_language,
  onboarding_completed = COALESCE(e.onboarding_completed, false),
  onboarding_completed_at = e.onboarding_completed_at
FROM public.employees e
WHERE e.candidate_id = c.id;

-- Maak candidate_employment records van bestaande employees
INSERT INTO public.candidate_employment (
  candidate_id, organization_id, start_date, end_date, end_reason,
  contract_type, contract_hours, pay_frequency,
  vacation_days_total, vacation_days_used, vacation_money_percentage,
  pension_scheme, pension_start_date, insurance_type, insurance_notes,
  senior_days, notes, is_current
)
SELECT
  e.candidate_id, e.organization_id, e.start_date, e.end_date, e.end_reason,
  e.contract_type, e.contract_hours, e.pay_frequency,
  COALESCE(e.vacation_days_total, 0), COALESCE(e.vacation_days_used, 0), e.vacation_money_percentage,
  e.pension_scheme, e.pension_start_date, e.insurance_type, e.insurance_notes,
  COALESCE(e.senior_days, 0), e.notes,
  CASE WHEN e.status IN ('actief', 'onboarding', 'ziek') THEN true ELSE false END
FROM public.employees e;

-- ============================================================
-- STAP 4: Voeg candidate_id toe aan alle afhankelijke tabellen
-- (nullable nu, wordt NOT NULL na frontend migratie)
-- ============================================================

-- placements (heeft nog geen candidate_id)
ALTER TABLE public.placements ADD COLUMN IF NOT EXISTS candidate_id uuid REFERENCES public.candidates(id);
UPDATE public.placements p SET candidate_id = e.candidate_id FROM public.employees e WHERE e.id = p.employee_id;
CREATE INDEX IF NOT EXISTS placements_candidate_id_idx ON public.placements(candidate_id) WHERE candidate_id IS NOT NULL;

-- timesheets
ALTER TABLE public.timesheets ADD COLUMN IF NOT EXISTS candidate_id uuid REFERENCES public.candidates(id);
UPDATE public.timesheets t SET candidate_id = e.candidate_id FROM public.employees e WHERE e.id = t.employee_id;
CREATE INDEX IF NOT EXISTS timesheets_candidate_id_idx ON public.timesheets(candidate_id) WHERE candidate_id IS NOT NULL;

-- housing_assignments
ALTER TABLE public.housing_assignments ADD COLUMN IF NOT EXISTS candidate_id uuid REFERENCES public.candidates(id);
UPDATE public.housing_assignments h SET candidate_id = e.candidate_id FROM public.employees e WHERE e.id = h.employee_id;

-- vehicle_assignments
ALTER TABLE public.vehicle_assignments ADD COLUMN IF NOT EXISTS candidate_id uuid REFERENCES public.candidates(id);
UPDATE public.vehicle_assignments v SET candidate_id = e.candidate_id FROM public.employees e WHERE e.id = v.employee_id;

-- contracts
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS candidate_id uuid REFERENCES public.candidates(id);
UPDATE public.contracts c SET candidate_id = e.candidate_id FROM public.employees e WHERE e.id = c.employee_id;

-- payslips
ALTER TABLE public.payslips ADD COLUMN IF NOT EXISTS candidate_id uuid REFERENCES public.candidates(id);
UPDATE public.payslips p SET candidate_id = e.candidate_id FROM public.employees e WHERE e.id = p.employee_id;

-- annual_statements
ALTER TABLE public.annual_statements ADD COLUMN IF NOT EXISTS candidate_id uuid REFERENCES public.candidates(id);
UPDATE public.annual_statements a SET candidate_id = e.candidate_id FROM public.employees e WHERE e.id = a.employee_id;

-- sick_reports
ALTER TABLE public.sick_reports ADD COLUMN IF NOT EXISTS candidate_id uuid REFERENCES public.candidates(id);
UPDATE public.sick_reports s SET candidate_id = e.candidate_id FROM public.employees e WHERE e.id = s.employee_id;

-- employee_deductions
ALTER TABLE public.employee_deductions ADD COLUMN IF NOT EXISTS candidate_id uuid REFERENCES public.candidates(id);
UPDATE public.employee_deductions d SET candidate_id = e.candidate_id FROM public.employees e WHERE e.id = d.employee_id;

-- employee_subsidies
ALTER TABLE public.employee_subsidies ADD COLUMN IF NOT EXISTS candidate_id uuid REFERENCES public.candidates(id);
UPDATE public.employee_subsidies s SET candidate_id = e.candidate_id FROM public.employees e WHERE e.id = s.employee_id;

-- employee_reservations
ALTER TABLE public.employee_reservations ADD COLUMN IF NOT EXISTS candidate_id uuid REFERENCES public.candidates(id);
UPDATE public.employee_reservations r SET candidate_id = e.candidate_id FROM public.employees e WHERE e.id = r.employee_id;

-- employee_notifications
ALTER TABLE public.employee_notifications ADD COLUMN IF NOT EXISTS candidate_id uuid REFERENCES public.candidates(id);
UPDATE public.employee_notifications n SET candidate_id = e.candidate_id FROM public.employees e WHERE e.id = n.employee_id AND n.employee_id IS NOT NULL;

-- onboarding_tokens
ALTER TABLE public.onboarding_tokens ADD COLUMN IF NOT EXISTS candidate_id uuid REFERENCES public.candidates(id);
UPDATE public.onboarding_tokens t SET candidate_id = e.candidate_id FROM public.employees e WHERE e.id = t.employee_id;

-- onboarding_responses
ALTER TABLE public.onboarding_responses ADD COLUMN IF NOT EXISTS candidate_id uuid REFERENCES public.candidates(id);
UPDATE public.onboarding_responses r SET candidate_id = e.candidate_id FROM public.employees e WHERE e.id = r.employee_id;

-- portal_invites
ALTER TABLE public.portal_invites ADD COLUMN IF NOT EXISTS candidate_id uuid REFERENCES public.candidates(id);
UPDATE public.portal_invites p SET candidate_id = e.candidate_id FROM public.employees e WHERE e.id = p.employee_id;

-- mileage_entries
ALTER TABLE public.mileage_entries ADD COLUMN IF NOT EXISTS candidate_id uuid REFERENCES public.candidates(id);
UPDATE public.mileage_entries m SET candidate_id = e.candidate_id FROM public.employees e WHERE e.id = m.employee_id;

-- hour_letters
ALTER TABLE public.hour_letters ADD COLUMN IF NOT EXISTS candidate_id uuid REFERENCES public.candidates(id);
UPDATE public.hour_letters h SET candidate_id = e.candidate_id FROM public.employees e WHERE e.id = h.employee_id;

-- fuel_card_transactions
ALTER TABLE public.fuel_card_transactions ADD COLUMN IF NOT EXISTS candidate_id uuid REFERENCES public.candidates(id);
UPDATE public.fuel_card_transactions f SET candidate_id = e.candidate_id FROM public.employees e WHERE e.id = f.employee_id AND f.employee_id IS NOT NULL;

-- invoice_lines (employee_id is nullable)
ALTER TABLE public.invoice_lines ADD COLUMN IF NOT EXISTS candidate_id uuid REFERENCES public.candidates(id);
UPDATE public.invoice_lines i SET candidate_id = e.candidate_id FROM public.employees e WHERE e.id = i.employee_id AND i.employee_id IS NOT NULL;

-- key_registrations
ALTER TABLE public.key_registrations ADD COLUMN IF NOT EXISTS candidate_id uuid REFERENCES public.candidates(id);
UPDATE public.key_registrations k SET candidate_id = e.candidate_id FROM public.employees e WHERE e.id = k.employee_id;

-- regulation_acknowledgements
ALTER TABLE public.regulation_acknowledgements ADD COLUMN IF NOT EXISTS candidate_id uuid REFERENCES public.candidates(id);
UPDATE public.regulation_acknowledgements r SET candidate_id = e.candidate_id FROM public.employees e WHERE e.id = r.employee_id;

-- vehicle_damage_reports
ALTER TABLE public.vehicle_damage_reports ADD COLUMN IF NOT EXISTS candidate_id uuid REFERENCES public.candidates(id);
UPDATE public.vehicle_damage_reports v SET candidate_id = e.candidate_id FROM public.employees e WHERE e.id = v.employee_id;

-- vehicle_fines (employee_id is nullable)
ALTER TABLE public.vehicle_fines ADD COLUMN IF NOT EXISTS candidate_id uuid REFERENCES public.candidates(id);
UPDATE public.vehicle_fines v SET candidate_id = e.candidate_id FROM public.employees e WHERE e.id = v.employee_id AND v.employee_id IS NOT NULL;

-- documents: heeft al candidate_id, hoeft niet aangepast

-- ============================================================
-- STAP 5: Sync trigger — houdt candidate_id in sync zolang
-- employee_id nog gebruikt wordt (transitieperiode)
-- ============================================================

CREATE OR REPLACE FUNCTION public.sync_candidate_id_from_employee()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.employee_id IS NOT NULL AND NEW.candidate_id IS NULL THEN
    SELECT candidate_id INTO NEW.candidate_id
    FROM public.employees
    WHERE id = NEW.employee_id;
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger op de meest kritieke tabellen
CREATE OR REPLACE TRIGGER sync_candidate_id_placements
  BEFORE INSERT OR UPDATE ON public.placements
  FOR EACH ROW EXECUTE FUNCTION public.sync_candidate_id_from_employee();

CREATE OR REPLACE TRIGGER sync_candidate_id_timesheets
  BEFORE INSERT OR UPDATE ON public.timesheets
  FOR EACH ROW EXECUTE FUNCTION public.sync_candidate_id_from_employee();

CREATE OR REPLACE TRIGGER sync_candidate_id_hour_letters
  BEFORE INSERT OR UPDATE ON public.hour_letters
  FOR EACH ROW EXECUTE FUNCTION public.sync_candidate_id_from_employee();

CREATE OR REPLACE TRIGGER sync_candidate_id_payslips
  BEFORE INSERT OR UPDATE ON public.payslips
  FOR EACH ROW EXECUTE FUNCTION public.sync_candidate_id_from_employee();

CREATE OR REPLACE TRIGGER sync_candidate_id_contracts
  BEFORE INSERT OR UPDATE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.sync_candidate_id_from_employee();
