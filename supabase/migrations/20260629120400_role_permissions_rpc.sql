-- 29-06 fine-tuning vervolg: server-side helpers voor configureerbare rolrechten.
-- Algemene organization updates blijven admin-only; deze RPC werkt alleen
-- de role_permissions-sleutel bij en forceert adminrechten naar alles-aan.

CREATE OR REPLACE FUNCTION public.role_permission_admin_defaults()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'candidates.view', true,
    'candidates.edit', true,
    'candidates.screening.manage', true,
    'vacancies.view', true,
    'vacancies.edit', true,
    'matching.pipeline.view', true,
    'matching.status.update', true,
    'matching.status.bulk_update', true,
    'matching.drag_drop', true,
    'matching.feedback.write', true,
    'matching.notify_candidates', true,
    'matching.proposal.send', true,
    'matching.interview.confirm', true,
    'placements.view', true,
    'placements.edit', true,
    'finance.view', true,
    'finance.manage', true,
    'settings.manage', true,
    'settings.permissions.manage', true
  );
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
BEGIN
  v_org_id := public.get_user_org_id();
  v_role := public.get_user_role()::text;

  IF v_org_id IS NULL OR v_role IS NULL OR NULLIF(p_permission, '') IS NULL THEN
    RETURN false;
  END IF;

  IF v_role = 'admin' THEN
    RETURN true;
  END IF;

  SELECT settings->'role_permissions'->v_role
  INTO v_permissions
  FROM public.organizations
  WHERE id = v_org_id;

  IF jsonb_typeof(v_permissions) = 'object' THEN
    IF jsonb_typeof(v_permissions->p_permission) = 'boolean' THEN
      RETURN (v_permissions->>p_permission)::boolean;
    END IF;
    RETURN false;
  END IF;

  IF jsonb_typeof(v_permissions) = 'array' THEN
    RETURN v_permissions ? p_permission;
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_role_permissions(p_role_permissions jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_role public.user_role;
  v_next jsonb;
BEGIN
  v_org_id := public.get_user_org_id();
  v_role := public.get_user_role();

  IF v_org_id IS NULL OR v_role IS NULL THEN
    RAISE EXCEPTION 'Niet ingelogd' USING ERRCODE = '42501';
  END IF;

  IF v_role <> 'admin'::public.user_role AND NOT public.has_role_permission('settings.permissions.manage') THEN
    RAISE EXCEPTION 'Geen recht om rolrechten te beheren' USING ERRCODE = '42501';
  END IF;

  IF p_role_permissions IS NULL OR jsonb_typeof(p_role_permissions) <> 'object' THEN
    RAISE EXCEPTION 'role_permissions moet een JSON object zijn' USING ERRCODE = '22023';
  END IF;

  v_next := jsonb_set(
    p_role_permissions,
    '{admin}',
    public.role_permission_admin_defaults(),
    true
  );

  UPDATE public.organizations
  SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{role_permissions}', v_next, true),
      updated_at = now()
  WHERE id = v_org_id;
END;
$$;

REVOKE ALL ON FUNCTION public.role_permission_admin_defaults() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_role_permission(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_role_permissions(jsonb) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.has_role_permission(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_role_permissions(jsonb) TO authenticated, service_role;
