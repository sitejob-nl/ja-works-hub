-- Enforce the configurable organization role-permission matrix in Postgres.
-- Frontend visibility remains a UX concern; these policies/triggers are the
-- authorization boundary for authenticated database calls.

BEGIN;

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
  IF v_role NOT IN ('intercedent', 'backoffice', 'finance') THEN RETURN false; END IF;

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

CREATE OR REPLACE FUNCTION public.enforce_role_permission_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_permission text;
  v_allowed boolean := false;
BEGIN
  IF auth.role() = 'service_role' OR public.is_superadmin() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  -- Portal users retain their existing narrowly scoped self-policies. This
  -- guard only adds the configurable matrix to internal staff operations.
  IF NOT public.is_internal_user() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  FOREACH v_permission IN ARRAY TG_ARGV LOOP
    IF public.has_role_permission(v_permission) THEN
      v_allowed := true;
      EXIT;
    END IF;
  END LOOP;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Onvoldoende rechten voor % op %', TG_OP, TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_role_permission_write() FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.enforce_vacancy_write_permission()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'service_role' OR public.is_superadmin() OR NOT public.is_internal_user() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF public.has_role_permission('vacancies.edit') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  -- Creating a placement atomically maintains these vacancy counters. A role
  -- with placements.edit may perform that narrow maintenance without gaining
  -- permission to edit vacancy content, rates or requirements.
  IF TG_OP = 'UPDATE'
     AND public.has_role_permission('placements.edit')
     AND (to_jsonb(OLD) - ARRAY['filled_count','status','updated_at']::text[])
         IS NOT DISTINCT FROM
         (to_jsonb(NEW) - ARRAY['filled_count','status','updated_at']::text[]) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Onvoldoende rechten voor % op %', TG_OP, TG_TABLE_NAME
    USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_vacancy_write_permission() FROM PUBLIC, anon;

-- Core read boundaries. Existing self/client portal policies remain in place.
DROP POLICY IF EXISTS tenant_select ON public.candidates;
CREATE POLICY tenant_select ON public.candidates FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.has_role_permission('candidates.view'));

DROP POLICY IF EXISTS tenant_select ON public.employees;
CREATE POLICY tenant_select ON public.employees FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.has_role_permission('candidates.view'));

DROP POLICY IF EXISTS tenant_select ON public.documents;
CREATE POLICY tenant_select ON public.documents FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.has_role_permission('candidates.view'));

DROP POLICY IF EXISTS candidate_employment_select ON public.candidate_employment;
CREATE POLICY candidate_employment_select ON public.candidate_employment FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.has_role_permission('candidates.view'));

DROP POLICY IF EXISTS candidate_profile_tokens_select ON public.candidate_profile_tokens;
CREATE POLICY candidate_profile_tokens_select ON public.candidate_profile_tokens FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.has_role_permission('candidates.edit'));

DROP POLICY IF EXISTS tenant_select ON public.vacancies;
CREATE POLICY tenant_select ON public.vacancies FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.has_role_permission('vacancies.view'));

DROP POLICY IF EXISTS tenant_select ON public.matches;
CREATE POLICY tenant_select ON public.matches FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.has_role_permission('matching.pipeline.view'));

DROP POLICY IF EXISTS tenant_select ON public.placements;
CREATE POLICY tenant_select ON public.placements FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.has_role_permission('placements.view'));

DROP POLICY IF EXISTS tenant_select ON public.timesheets;
CREATE POLICY tenant_select ON public.timesheets FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.has_role_permission('finance.view'));

DROP POLICY IF EXISTS tenant_select ON public.invoices;
CREATE POLICY tenant_select ON public.invoices FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.has_role_permission('finance.view'));

DROP POLICY IF EXISTS tenant_select ON public.invoice_lines;
CREATE POLICY tenant_select ON public.invoice_lines FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.has_role_permission('finance.view'));

DROP POLICY IF EXISTS hour_letters_internal_select ON public.hour_letters;
CREATE POLICY hour_letters_internal_select ON public.hour_letters FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.has_role_permission('finance.view'));

-- settings.manage can be delegated, while plan/tenant identity stays admin-only.
DROP POLICY IF EXISTS org_update ON public.organizations;
CREATE POLICY org_update ON public.organizations FOR UPDATE TO authenticated
USING (id = public.get_user_org_id() AND public.has_role_permission('settings.manage'))
WITH CHECK (id = public.get_user_org_id() AND public.has_role_permission('settings.manage'));

CREATE OR REPLACE FUNCTION public.enforce_organization_settings_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'service_role' OR public.is_superadmin() OR public.get_user_role() = 'admin' THEN
    RETURN NEW;
  END IF;
  IF NOT public.has_role_permission('settings.manage') THEN
    RAISE EXCEPTION 'Geen recht om organisatie-instellingen te beheren' USING ERRCODE = '42501';
  END IF;
  IF (OLD.settings->'role_permissions') IS DISTINCT FROM (NEW.settings->'role_permissions')
     AND NOT public.has_role_permission('settings.permissions.manage') THEN
    RAISE EXCEPTION 'Geen recht om rolrechten te beheren' USING ERRCODE = '42501';
  END IF;
  IF (to_jsonb(OLD) - ARRAY[
        'name','email','phone','website','address_street','address_postal','address_city',
        'address_lat','address_lng','kvk_number','btw_number','logo_url','settings','updated_at'
      ]::text[])
     IS DISTINCT FROM
     (to_jsonb(NEW) - ARRAY[
        'name','email','phone','website','address_street','address_postal','address_city',
        'address_lat','address_lng','kvk_number','btw_number','logo_url','settings','updated_at'
      ]::text[]) THEN
    RAISE EXCEPTION 'Alleen een admin kan tenant- of abonnementsvelden wijzigen' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organizations_permission_guard ON public.organizations;
CREATE TRIGGER organizations_permission_guard
BEFORE UPDATE ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.enforce_organization_settings_update();

-- Attach fail-closed write guards. OR semantics are intentional for match
-- operations, which share one table but have separate UI capabilities.
DO $$
DECLARE
  v_table text;
  v_permissions text[];
BEGIN
  FOR v_table, v_permissions IN
    SELECT * FROM (VALUES
      ('candidates', ARRAY['candidates.edit']),
      ('employees', ARRAY['candidates.edit']),
      ('candidate_employment', ARRAY['candidates.edit']),
      ('documents', ARRAY['candidates.edit']),
      ('candidate_profile_tokens', ARRAY['candidates.edit']),
      ('portal_invites', ARRAY['candidates.edit']),
      ('candidate_skills', ARRAY['candidates.edit']),
      ('custom_field_values', ARRAY['candidates.edit']),
      ('company_functions', ARRAY['vacancies.edit']),
      ('vacancy_required_skills', ARRAY['vacancies.edit']),
      ('company_function_skills', ARRAY['vacancies.edit']),
      ('placements', ARRAY['placements.edit']),
      ('placement_hour_types', ARRAY['placements.edit']),
      ('placement_travel_types', ARRAY['placements.edit']),
      ('placement_allowances', ARRAY['placements.edit']),
      ('timesheets', ARRAY['finance.manage']),
      ('invoices', ARRAY['finance.manage']),
      ('invoice_lines', ARRAY['finance.manage']),
      ('invoice_sequences', ARRAY['finance.manage']),
      ('hour_letters', ARRAY['finance.manage']),
      ('exact_glaccount_mappings', ARRAY['finance.manage','settings.manage']),
      ('custom_fields', ARRAY['settings.manage']),
      ('match_feedback_reasons', ARRAY['settings.manage']),
      ('onboarding_forms', ARRAY['settings.manage']),
      ('onboarding_form_steps', ARRAY['settings.manage']),
      ('onboarding_form_fields', ARRAY['settings.manage']),
      ('property_owners', ARRAY['settings.manage']),
      ('regulations', ARRAY['settings.manage']),
      ('skills', ARRAY['settings.manage']),
      ('skill_aliases', ARRAY['settings.manage']),
      ('termination_reasons', ARRAY['settings.manage']),
      ('compliance_rules', ARRAY['settings.manage']),
      ('contract_templates', ARRAY['settings.manage']),
      ('email_templates', ARRAY['settings.manage']),
      ('organization_domains', ARRAY['settings.manage'])
    ) AS specs(table_name, permissions)
  LOOP
    IF to_regclass(format('public.%I', v_table)) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS role_permission_write_guard ON public.%I', v_table);
      EXECUTE format(
        'CREATE TRIGGER role_permission_write_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enforce_role_permission_write(%s)',
        v_table,
        (SELECT string_agg(quote_literal(item), ', ') FROM unnest(v_permissions) AS item)
      );
    END IF;
  END LOOP;

  IF to_regclass('public.vacancies') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS role_permission_write_guard ON public.vacancies;
    CREATE TRIGGER role_permission_write_guard
    BEFORE INSERT OR UPDATE OR DELETE ON public.vacancies
    FOR EACH ROW EXECUTE FUNCTION public.enforce_vacancy_write_permission();
  END IF;

  IF to_regclass('public.matches') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS role_permission_write_guard ON public.matches;
    CREATE TRIGGER role_permission_write_guard
    BEFORE INSERT OR UPDATE OR DELETE ON public.matches
    FOR EACH ROW EXECUTE FUNCTION public.enforce_role_permission_write(
      'matching.status.update', 'matching.status.bulk_update', 'matching.drag_drop',
      'matching.feedback.write', 'matching.interview.confirm'
    );
  END IF;
END;
$$;

COMMIT;
