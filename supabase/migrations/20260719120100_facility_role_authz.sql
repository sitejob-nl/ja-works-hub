-- Autorisatie voor de rol "Facility".
--
-- ONTWERPBESLUIT: facility wordt BEWUST NIET toegevoegd aan is_internal_user().
--
--   is_internal_user() is een "grant-by-default"-poort: tientallen policies
--   gebruiken 'm als enige rolcheck. Onder die tabellen zitten juist de
--   loon- en tariefgegevens die facility niet mag zien en die nergens anders
--   worden afgeschermd: payslips, annual_statements, employee_deductions,
--   employee_subsidies, employee_reservations, rate_agreements, company_sla.
--   Facility aan is_internal_user() toevoegen zou al die tabellen in een klap
--   openzetten, en elke tabel die er later bijkomt ook.
--
--   In plaats daarvan krijgt facility een eigen poort, is_facility_user(), en
--   expliciete policies op precies de vastgoed- en wagenparktabellen.
--   Deny-by-default: wat hieronder niet genoemd wordt, kan facility niet.
--   Voor de bestaande rollen verandert er hierdoor niets.

BEGIN;

CREATE OR REPLACE FUNCTION public.is_facility_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT COALESCE(public.get_user_role()::text = 'facility', false);
$$;

REVOKE EXECUTE ON FUNCTION public.is_facility_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_facility_user() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Rechtenmatrix: facility krijgt uitsluitend candidates.view.
-- Dat recht is nodig omdat de huisvestings- en transportschermen laten zien
-- WIE er in een kamer woont en WIE in een auto rijdt; zonder leesrecht op
-- candidates tonen die lijsten lege namen. Alle overige rechten staan uit,
-- inclusief finance.view/finance.manage en settings.manage.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.role_permission_defaults(p_role text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_role
    WHEN 'admin' THEN public.role_permission_admin_defaults()
    WHEN 'intercedent' THEN jsonb_build_object(
      'candidates.view', true, 'candidates.edit', true, 'candidates.screening.manage', true,
      'vacancies.view', true, 'vacancies.edit', true,
      'matching.pipeline.view', true, 'matching.status.update', true,
      'matching.status.bulk_update', true, 'matching.drag_drop', true,
      'matching.feedback.write', true, 'matching.notify_candidates', true,
      'matching.proposal.send', true, 'matching.interview.confirm', true,
      'placements.view', true, 'placements.edit', true,
      'finance.view', false, 'finance.manage', false,
      'settings.manage', false, 'settings.permissions.manage', false
    )
    WHEN 'backoffice' THEN jsonb_build_object(
      'candidates.view', true, 'candidates.edit', true, 'candidates.screening.manage', true,
      'vacancies.view', true, 'vacancies.edit', false,
      'matching.pipeline.view', true, 'matching.status.update', true,
      'matching.status.bulk_update', true, 'matching.drag_drop', true,
      'matching.feedback.write', true, 'matching.notify_candidates', true,
      'matching.proposal.send', false, 'matching.interview.confirm', true,
      'placements.view', true, 'placements.edit', true,
      'finance.view', true, 'finance.manage', false,
      'settings.manage', false, 'settings.permissions.manage', false
    )
    WHEN 'finance' THEN jsonb_build_object(
      'candidates.view', true, 'candidates.edit', false, 'candidates.screening.manage', false,
      'vacancies.view', true, 'vacancies.edit', false,
      'matching.pipeline.view', true, 'matching.status.update', false,
      'matching.status.bulk_update', false, 'matching.drag_drop', false,
      'matching.feedback.write', false, 'matching.notify_candidates', false,
      'matching.proposal.send', false, 'matching.interview.confirm', false,
      'placements.view', true, 'placements.edit', false,
      'finance.view', true, 'finance.manage', true,
      'settings.manage', false, 'settings.permissions.manage', false
    )
    WHEN 'facility' THEN jsonb_build_object(
      'candidates.view', true, 'candidates.edit', false, 'candidates.screening.manage', false,
      'vacancies.view', false, 'vacancies.edit', false,
      'matching.pipeline.view', false, 'matching.status.update', false,
      'matching.status.bulk_update', false, 'matching.drag_drop', false,
      'matching.feedback.write', false, 'matching.notify_candidates', false,
      'matching.proposal.send', false, 'matching.interview.confirm', false,
      'placements.view', false, 'placements.edit', false,
      'finance.view', false, 'finance.manage', false,
      'settings.manage', false, 'settings.permissions.manage', false
    )
    ELSE '{}'::jsonb
  END;
$$;

CREATE OR REPLACE FUNCTION public.has_role_permission(p_permission text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_role text;
  v_permissions jsonb;
  v_defaults jsonb;
BEGIN
  v_org_id := public.get_user_org_id();
  v_role := public.get_user_role()::text;

  IF v_org_id IS NULL OR v_role IS NULL OR NULLIF(p_permission, '') IS NULL THEN
    RETURN false;
  END IF;
  IF v_role = 'admin' THEN RETURN true; END IF;
  IF v_role NOT IN ('intercedent', 'backoffice', 'finance', 'facility') THEN RETURN false; END IF;

  v_defaults := public.role_permission_defaults(v_role);
  SELECT settings->'role_permissions'->v_role
    INTO v_permissions
    FROM public.organizations
   WHERE id = v_org_id;

  IF jsonb_typeof(v_permissions) = 'array' THEN
    RETURN v_permissions ? p_permission;
  END IF;
  IF jsonb_typeof(v_permissions) = 'object'
     AND jsonb_typeof(v_permissions->p_permission) = 'boolean' THEN
    RETURN (v_permissions->>p_permission)::boolean;
  END IF;

  RETURN COALESCE((v_defaults->>p_permission)::boolean, false);
END;
$$;

REVOKE ALL ON FUNCTION public.role_permission_defaults(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_role_permission(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role_permission(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- candidates.view is grofmazig: documents en candidate_employment liften mee
-- op datzelfde recht. Daar zitten identiteitsbewijzen, contracten, pensioen-
-- en vakantiegeldafspraken in — niets waar facility bij hoeft. Alleen voor
-- facility sluiten we die twee daarom expliciet af; voor de bestaande rollen
-- blijft de policy ongewijzigd.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS tenant_select ON public.documents;
CREATE POLICY tenant_select ON public.documents FOR SELECT TO authenticated
USING (
  organization_id = public.get_user_org_id()
  AND public.has_role_permission('candidates.view')
  AND NOT public.is_facility_user()
);

DROP POLICY IF EXISTS candidate_employment_select ON public.candidate_employment;
CREATE POLICY candidate_employment_select ON public.candidate_employment FOR SELECT TO authenticated
USING (
  organization_id = public.get_user_org_id()
  AND public.has_role_permission('candidates.view')
  AND NOT public.is_facility_user()
);

-- ---------------------------------------------------------------------------
-- Vastgoed en wagenpark: lezen, aanmaken en bijwerken.
-- DELETE krijgt facility bewust nergens — verwijderen blijft admin-only,
-- precies zoals de bestaande tenant_delete-policies het al regelen.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'properties', 'units', 'housing_assignments', 'housing_inspections', 'key_registrations',
    'vehicles', 'vehicle_assignments', 'vehicle_damage_reports', 'vehicle_fines', 'mileage_entries'
  ] LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('DROP POLICY IF EXISTS facility_select ON public.%I', v_table);
    EXECUTE format(
      'CREATE POLICY facility_select ON public.%I FOR SELECT TO authenticated
         USING (organization_id = public.get_user_org_id() AND public.is_facility_user())',
      v_table
    );

    EXECUTE format('DROP POLICY IF EXISTS facility_insert ON public.%I', v_table);
    EXECUTE format(
      'CREATE POLICY facility_insert ON public.%I FOR INSERT TO authenticated
         WITH CHECK (organization_id = public.get_user_org_id() AND public.is_facility_user())',
      v_table
    );

    EXECUTE format('DROP POLICY IF EXISTS facility_update ON public.%I', v_table);
    EXECUTE format(
      'CREATE POLICY facility_update ON public.%I FOR UPDATE TO authenticated
         USING (organization_id = public.get_user_org_id() AND public.is_facility_user())
         WITH CHECK (organization_id = public.get_user_org_id() AND public.is_facility_user())',
      v_table
    );
  END LOOP;
END;
$$;

-- Eigenaren van panden: alleen lezen, zodat een pand een eigenaarsnaam kan
-- tonen. Beheer van deze masterdata blijft achter settings.manage zitten.
DROP POLICY IF EXISTS facility_select ON public.property_owners;
CREATE POLICY facility_select ON public.property_owners FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_facility_user());

-- Taken: facility ziet en werkt uitsluitend de taken bij die aan hem/haar zijn
-- toegewezen (o.a. de huisvestings- en APK-herinneringen uit de cronjobs).
-- De volledige recruitment-takenlijst blijft buiten bereik.
DROP POLICY IF EXISTS facility_assigned_select ON public.recruiter_tasks;
CREATE POLICY facility_assigned_select ON public.recruiter_tasks FOR SELECT TO authenticated
USING (
  organization_id = public.get_user_org_id()
  AND public.is_facility_user()
  AND assigned_to = auth.uid()
);

DROP POLICY IF EXISTS facility_assigned_update ON public.recruiter_tasks;
CREATE POLICY facility_assigned_update ON public.recruiter_tasks FOR UPDATE TO authenticated
USING (
  organization_id = public.get_user_org_id()
  AND public.is_facility_user()
  AND assigned_to = auth.uid()
)
WITH CHECK (
  organization_id = public.get_user_org_id()
  AND public.is_facility_user()
  AND assigned_to = auth.uid()
);

COMMIT;
