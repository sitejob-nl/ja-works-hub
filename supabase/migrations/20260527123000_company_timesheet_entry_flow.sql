-- Phase 1 timesheet intake flow per opdrachtgever.
-- medewerker: medewerker voert zelf uren in; klant accordeert na validatie.
-- opdrachtgever: klant geeft uren door; medewerker bevestigt daarna.
-- kloksysteem: klant/kloksysteem levert uren aan; medewerker bevestigt daarna.

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS timesheet_entry_flow text NOT NULL DEFAULT 'medewerker';

ALTER TABLE public.companies
  DROP CONSTRAINT IF EXISTS companies_timesheet_entry_flow_check;

ALTER TABLE public.companies
  ADD CONSTRAINT companies_timesheet_entry_flow_check
  CHECK (timesheet_entry_flow IN ('medewerker', 'opdrachtgever', 'kloksysteem'));

COMMENT ON COLUMN public.companies.timesheet_entry_flow IS
  'Per opdrachtgever gekozen urenstroom: medewerker, opdrachtgever of kloksysteem.';

DROP POLICY IF EXISTS timesheet_client_portal_insert ON public.timesheets;
CREATE POLICY timesheet_client_portal_insert
ON public.timesheets
FOR INSERT
TO authenticated
WITH CHECK (
  organization_id = public.get_user_org_id()
  AND EXISTS (
    SELECT 1
    FROM public.placements p
    JOIN public.companies c ON c.id = p.company_id
    WHERE p.id = timesheets.placement_id
      AND p.company_id = public.get_client_portal_company_id()
      AND p.organization_id = timesheets.organization_id
      AND c.organization_id = timesheets.organization_id
      AND c.timesheet_entry_flow IN ('opdrachtgever', 'kloksysteem')
  )
);

DROP POLICY IF EXISTS timesheet_employee_self_select ON public.timesheets;
CREATE POLICY timesheet_employee_self_select
ON public.timesheets
FOR SELECT
TO authenticated
USING (
  organization_id = public.get_user_org_id()
  AND (candidate_id = public.get_employee_id() OR employee_id = public.get_employee_id())
);

DROP POLICY IF EXISTS timesheet_employee_self_insert ON public.timesheets;
CREATE POLICY timesheet_employee_self_insert
ON public.timesheets
FOR INSERT
TO authenticated
WITH CHECK (
  organization_id = public.get_user_org_id()
  AND (candidate_id = public.get_employee_id() OR employee_id = public.get_employee_id())
  AND source = 'handmatig'::public.timesheet_source
  AND employee_confirmed = TRUE
  AND EXISTS (
    SELECT 1
    FROM public.placements p
    WHERE p.id = timesheets.placement_id
      AND p.candidate_id = timesheets.candidate_id
      AND p.organization_id = timesheets.organization_id
  )
);

DROP POLICY IF EXISTS timesheet_employee_self_update ON public.timesheets;
CREATE POLICY timesheet_employee_self_update
ON public.timesheets
FOR UPDATE
TO authenticated
USING (
  organization_id = public.get_user_org_id()
  AND (candidate_id = public.get_employee_id() OR employee_id = public.get_employee_id())
)
WITH CHECK (
  organization_id = public.get_user_org_id()
  AND (candidate_id = public.get_employee_id() OR employee_id = public.get_employee_id())
);

CREATE OR REPLACE FUNCTION public.enforce_client_portal_timesheet_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_flow text;
  v_company_id uuid;
BEGIN
  IF public.get_user_role() = 'opdrachtgever' THEN
    SELECT p.company_id, c.timesheet_entry_flow
      INTO v_company_id, v_flow
    FROM public.placements p
    JOIN public.companies c ON c.id = p.company_id
    WHERE p.id = NEW.placement_id
      AND p.organization_id = NEW.organization_id;

    IF v_company_id IS NULL OR v_company_id IS DISTINCT FROM public.get_client_portal_company_id() THEN
      RAISE EXCEPTION 'Klantportaal mag alleen uren voor eigen plaatsingen invoeren';
    END IF;

    IF v_flow NOT IN ('opdrachtgever', 'kloksysteem') THEN
      RAISE EXCEPTION 'Deze opdrachtgever is niet geconfigureerd voor ureninvoer via klantportaal';
    END IF;

    IF NEW.hours IS NULL OR NEW.hours <= 0 OR NEW.hours > 24 THEN
      RAISE EXCEPTION 'Uren moeten tussen 0 en 24 liggen';
    END IF;

    IF COALESCE(NEW.overtime_hours, 0) < 0 OR COALESCE(NEW.overtime_hours, 0) > 24 THEN
      RAISE EXCEPTION 'Overuren moeten tussen 0 en 24 liggen';
    END IF;

    NEW.source := CASE WHEN v_flow = 'kloksysteem' THEN 'kloksysteem'::public.timesheet_source ELSE 'klantportaal'::public.timesheet_source END;
    NEW.status := 'concept'::public.timesheet_status;
    NEW.client_approved := TRUE;
    NEW.client_approved_at := COALESCE(NEW.client_approved_at, now());
    NEW.client_approved_by := auth.uid();
    NEW.employee_confirmed := FALSE;
    NEW.employee_confirmed_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_client_portal_timesheet_insert_trg ON public.timesheets;
CREATE TRIGGER enforce_client_portal_timesheet_insert_trg
BEFORE INSERT ON public.timesheets
FOR EACH ROW
EXECUTE FUNCTION public.enforce_client_portal_timesheet_insert();

CREATE OR REPLACE FUNCTION public.enforce_employee_portal_timesheet_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  IF public.get_user_role() = 'medewerker' THEN
    IF (
      to_jsonb(NEW)
        - 'status'
        - 'employee_confirmed'
        - 'employee_confirmed_at'
        - 'updated_at'
    ) IS DISTINCT FROM (
      to_jsonb(OLD)
        - 'status'
        - 'employee_confirmed'
        - 'employee_confirmed_at'
        - 'updated_at'
    ) THEN
      RAISE EXCEPTION 'Medewerkerportaal mag alleen eigen uren indienen of bevestigen';
    END IF;

    IF NEW.status NOT IN ('ingediend', 'concept') THEN
      RAISE EXCEPTION 'Medewerkerportaal mag uren alleen indienen of als concept laten staan';
    END IF;

    IF OLD.source IN ('klantportaal', 'kloksysteem') THEN
      IF NEW.employee_confirmed IS DISTINCT FROM TRUE OR NEW.status IS DISTINCT FROM 'ingediend'::public.timesheet_status THEN
        RAISE EXCEPTION 'Door opdrachtgever aangeleverde uren moeten door de medewerker worden bevestigd en ingediend';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_employee_portal_timesheet_update_trg ON public.timesheets;
CREATE TRIGGER enforce_employee_portal_timesheet_update_trg
BEFORE UPDATE ON public.timesheets
FOR EACH ROW
EXECUTE FUNCTION public.enforce_employee_portal_timesheet_update();
