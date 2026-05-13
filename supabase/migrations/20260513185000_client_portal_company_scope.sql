-- Client portal users need a narrow company scope after tenant-wide policies
-- were restricted to internal users. Keep the scope tied to their own
-- company_contact row and block broad tenant reads.

CREATE OR REPLACE FUNCTION public.get_client_portal_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT cc.company_id
  FROM public.company_contacts cc
  JOIN public.profiles p
    ON p.id = auth.uid()
   AND p.organization_id = cc.organization_id
   AND p.role = 'opdrachtgever'
  WHERE cc.auth_user_id = auth.uid()
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.get_client_portal_company_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_client_portal_company_id() TO authenticated, service_role;

DROP POLICY IF EXISTS company_contact_client_portal_self_select ON public.company_contacts;
CREATE POLICY company_contact_client_portal_self_select
ON public.company_contacts
FOR SELECT
TO authenticated
USING (
  auth_user_id = auth.uid()
  AND organization_id = public.get_user_org_id()
);

DROP POLICY IF EXISTS company_contact_client_portal_self_update ON public.company_contacts;
CREATE POLICY company_contact_client_portal_self_update
ON public.company_contacts
FOR UPDATE
TO authenticated
USING (
  auth_user_id = auth.uid()
  AND organization_id = public.get_user_org_id()
)
WITH CHECK (
  auth_user_id = auth.uid()
  AND organization_id = public.get_user_org_id()
);

DROP POLICY IF EXISTS company_client_portal_select ON public.companies;
CREATE POLICY company_client_portal_select
ON public.companies
FOR SELECT
TO authenticated
USING (
  id = public.get_client_portal_company_id()
  AND organization_id = public.get_user_org_id()
);

DROP POLICY IF EXISTS placement_client_portal_select ON public.placements;
CREATE POLICY placement_client_portal_select
ON public.placements
FOR SELECT
TO authenticated
USING (
  company_id = public.get_client_portal_company_id()
  AND organization_id = public.get_user_org_id()
);

DROP POLICY IF EXISTS candidate_client_portal_select ON public.candidates;
CREATE POLICY candidate_client_portal_select
ON public.candidates
FOR SELECT
TO authenticated
USING (
  organization_id = public.get_user_org_id()
  AND EXISTS (
    SELECT 1
    FROM public.placements p
    WHERE p.candidate_id = candidates.id
      AND p.company_id = public.get_client_portal_company_id()
      AND p.organization_id = candidates.organization_id
  )
);

DROP POLICY IF EXISTS timesheet_client_portal_select ON public.timesheets;
CREATE POLICY timesheet_client_portal_select
ON public.timesheets
FOR SELECT
TO authenticated
USING (
  organization_id = public.get_user_org_id()
  AND EXISTS (
    SELECT 1
    FROM public.placements p
    WHERE p.id = timesheets.placement_id
      AND p.company_id = public.get_client_portal_company_id()
      AND p.organization_id = timesheets.organization_id
  )
);

DROP POLICY IF EXISTS timesheet_client_portal_update ON public.timesheets;
CREATE POLICY timesheet_client_portal_update
ON public.timesheets
FOR UPDATE
TO authenticated
USING (
  organization_id = public.get_user_org_id()
  AND EXISTS (
    SELECT 1
    FROM public.placements p
    WHERE p.id = timesheets.placement_id
      AND p.company_id = public.get_client_portal_company_id()
      AND p.organization_id = timesheets.organization_id
  )
)
WITH CHECK (
  organization_id = public.get_user_org_id()
  AND EXISTS (
    SELECT 1
    FROM public.placements p
    WHERE p.id = timesheets.placement_id
      AND p.company_id = public.get_client_portal_company_id()
      AND p.organization_id = timesheets.organization_id
  )
);

CREATE OR REPLACE FUNCTION public.enforce_client_portal_timesheet_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  IF public.get_user_role() = 'opdrachtgever' THEN
    IF (
      to_jsonb(NEW)
        - 'client_approved'
        - 'client_approved_at'
        - 'client_approved_by'
        - 'client_rejection_notes'
        - 'updated_at'
    ) IS DISTINCT FROM (
      to_jsonb(OLD)
        - 'client_approved'
        - 'client_approved_at'
        - 'client_approved_by'
        - 'client_rejection_notes'
        - 'updated_at'
    ) THEN
      RAISE EXCEPTION 'Klantportaal mag alleen goedkeuringsvelden van uren wijzigen';
    END IF;

    IF NEW.client_approved_by IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Klantportaal goedkeuring moet door de ingelogde contactpersoon gebeuren';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_client_portal_timesheet_update_trg ON public.timesheets;
CREATE TRIGGER enforce_client_portal_timesheet_update_trg
BEFORE UPDATE ON public.timesheets
FOR EACH ROW
EXECUTE FUNCTION public.enforce_client_portal_timesheet_update();

CREATE OR REPLACE FUNCTION public.enforce_client_portal_contact_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  IF public.get_user_role() = 'opdrachtgever' THEN
    IF (
      to_jsonb(NEW)
        - 'portal_last_login'
        - 'updated_at'
    ) IS DISTINCT FROM (
      to_jsonb(OLD)
        - 'portal_last_login'
        - 'updated_at'
    ) THEN
      RAISE EXCEPTION 'Klantportaal mag alleen laatste login bijwerken';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_client_portal_contact_update_trg ON public.company_contacts;
CREATE TRIGGER enforce_client_portal_contact_update_trg
BEFORE UPDATE ON public.company_contacts
FOR EACH ROW
EXECUTE FUNCTION public.enforce_client_portal_contact_update();
