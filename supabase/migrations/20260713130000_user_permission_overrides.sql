-- Per-user permission exceptions on top of the organization role matrix.
-- Empty overrides preserve the existing role-based behavior.

BEGIN;

CREATE TABLE IF NOT EXISTS public.user_permission_overrides (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  permission_key text NOT NULL CHECK (permission_key IN (
    'candidates.view',
    'candidates.edit',
    'candidates.screening.manage',
    'vacancies.view',
    'vacancies.edit',
    'matching.pipeline.view',
    'matching.status.update',
    'matching.status.bulk_update',
    'matching.drag_drop',
    'matching.feedback.write',
    'matching.notify_candidates',
    'matching.proposal.send',
    'matching.interview.confirm',
    'placements.view',
    'placements.edit',
    'finance.view',
    'finance.manage',
    'settings.manage',
    'settings.permissions.manage'
  )),
  allowed boolean NOT NULL,
  updated_by uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, permission_key)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'user_permission_overrides_individual_key_check'
       AND conrelid = 'public.user_permission_overrides'::regclass
  ) THEN
    ALTER TABLE public.user_permission_overrides
      ADD CONSTRAINT user_permission_overrides_individual_key_check
      CHECK (permission_key NOT IN ('candidates.edit', 'finance.manage'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS user_permission_overrides_org_user_idx
  ON public.user_permission_overrides (organization_id, user_id);

DROP TRIGGER IF EXISTS user_permission_overrides_touch_updated_at
  ON public.user_permission_overrides;
CREATE TRIGGER user_permission_overrides_touch_updated_at
BEFORE UPDATE ON public.user_permission_overrides
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.user_permission_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_permission_overrides_self_select
  ON public.user_permission_overrides;
CREATE POLICY user_permission_overrides_self_select
ON public.user_permission_overrides
FOR SELECT TO authenticated
USING (
  user_id = (SELECT auth.uid())
  AND organization_id = (SELECT public.get_user_org_id())
);

REVOKE ALL ON TABLE public.user_permission_overrides FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.user_permission_overrides TO authenticated;
GRANT ALL ON TABLE public.user_permission_overrides TO service_role;

-- Atomic service-only write boundary used by the admin-only user management
-- edge function. The actor and target are revalidated here to contain edge bugs.
CREATE OR REPLACE FUNCTION public.replace_user_permission_overrides(
  p_organization_id uuid,
  p_user_id uuid,
  p_actor_id uuid,
  p_overrides jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_role text;
  v_actor_active boolean;
  v_target_role text;
  v_target_org_id uuid;
  v_key text;
  v_value jsonb;
  v_old_overrides jsonb;
  v_new_overrides jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Deze functie is alleen beschikbaar voor de service role'
      USING ERRCODE = '42501';
  END IF;

  SELECT role::text, is_active
    INTO v_actor_role, v_actor_active
    FROM public.profiles
   WHERE id = p_actor_id
     AND organization_id = p_organization_id;

  IF v_actor_role IS DISTINCT FROM 'admin' OR v_actor_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Alleen een actieve admin kan individuele rechten beheren'
      USING ERRCODE = '42501';
  END IF;

  SELECT organization_id, role::text
    INTO v_target_org_id, v_target_role
    FROM public.profiles
   WHERE id = p_user_id;

  IF v_target_org_id IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'Gebruiker niet gevonden binnen deze organisatie'
      USING ERRCODE = '42501';
  END IF;
  IF v_target_role = 'admin' THEN
    RAISE EXCEPTION 'Adminrechten kunnen niet individueel worden aangepast'
      USING ERRCODE = '42501';
  END IF;
  IF v_target_role NOT IN ('intercedent', 'backoffice', 'finance') THEN
    RAISE EXCEPTION 'Alleen interne gebruikers ondersteunen individuele rechten'
      USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(COALESCE(p_overrides, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Rechten moeten als object worden aangeleverd'
      USING ERRCODE = '22023';
  END IF;

  FOR v_key, v_value IN
    SELECT key, value FROM jsonb_each(COALESCE(p_overrides, '{}'::jsonb))
  LOOP
    IF NOT (public.role_permission_defaults('admin') ? v_key) THEN
      RAISE EXCEPTION 'Onbekend recht: %', v_key USING ERRCODE = '22023';
    END IF;
    IF v_key IN ('candidates.edit', 'finance.manage') THEN
      RAISE EXCEPTION 'Recht % kan alleen via rolrechten worden ingesteld', v_key
        USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_value) <> 'boolean' THEN
      RAISE EXCEPTION 'Recht % moet true of false zijn', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;

  SELECT COALESCE(jsonb_object_agg(permission_key, allowed), '{}'::jsonb)
    INTO v_old_overrides
    FROM public.user_permission_overrides
   WHERE organization_id = p_organization_id
     AND user_id = p_user_id;

  DELETE FROM public.user_permission_overrides
   WHERE organization_id = p_organization_id
     AND user_id = p_user_id;

  INSERT INTO public.user_permission_overrides (
    organization_id,
    user_id,
    permission_key,
    allowed,
    updated_by
  )
  SELECT
    p_organization_id,
    p_user_id,
    entry.key,
    (entry.value #>> '{}')::boolean,
    p_actor_id
  FROM jsonb_each(COALESCE(p_overrides, '{}'::jsonb)) AS entry;

  SELECT COALESCE(jsonb_object_agg(permission_key, allowed), '{}'::jsonb)
    INTO v_new_overrides
    FROM public.user_permission_overrides
   WHERE organization_id = p_organization_id
     AND user_id = p_user_id;

  IF v_old_overrides IS DISTINCT FROM v_new_overrides THEN
    INSERT INTO public.audit_log (
      organization_id,
      user_id,
      action,
      table_name,
      record_id,
      old_values,
      new_values,
      reason
    ) VALUES (
      p_organization_id,
      p_actor_id,
      'override',
      'user_permission_overrides',
      p_user_id,
      jsonb_build_object('permission_overrides', v_old_overrides),
      jsonb_build_object('permission_overrides', v_new_overrides),
      'user_permission_overrides_replaced'
    );
  END IF;

  RETURN v_new_overrides;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_user_permission_overrides(uuid, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_user_permission_overrides(uuid, uuid, uuid, jsonb)
  TO service_role;

-- A role change intentionally resets individual exceptions. This prevents
-- privileges granted under one role from silently surviving another role.
CREATE OR REPLACE FUNCTION public.reset_user_permission_overrides_on_role_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_overrides jsonb;
  v_actor_id uuid;
BEGIN
  IF OLD.role IS NOT DISTINCT FROM NEW.role THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(jsonb_object_agg(permission_key, allowed), '{}'::jsonb)
    INTO v_old_overrides
    FROM public.user_permission_overrides
   WHERE organization_id = OLD.organization_id
     AND user_id = OLD.id;

  IF v_old_overrides = '{}'::jsonb THEN
    RETURN NEW;
  END IF;

  DELETE FROM public.user_permission_overrides
   WHERE organization_id = OLD.organization_id
     AND user_id = OLD.id;

  SELECT id INTO v_actor_id
    FROM public.profiles
   WHERE id = auth.uid();

  INSERT INTO public.audit_log (
    organization_id,
    user_id,
    action,
    table_name,
    record_id,
    old_values,
    new_values,
    reason
  ) VALUES (
    OLD.organization_id,
    v_actor_id,
    'override',
    'user_permission_overrides',
    OLD.id,
    jsonb_build_object('role', OLD.role, 'permission_overrides', v_old_overrides),
    jsonb_build_object('role', NEW.role, 'permission_overrides', '{}'::jsonb),
    'user_permission_overrides_reset_after_role_change'
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_user_permission_overrides_on_role_change()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_reset_user_permission_overrides
  ON public.profiles;
CREATE TRIGGER profiles_reset_user_permission_overrides
AFTER UPDATE OF role ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.reset_user_permission_overrides_on_role_change();

-- Central database resolver used by RLS and permission write guards.
CREATE OR REPLACE FUNCTION public.has_role_permission(p_permission text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_org_id uuid;
  v_role text;
  v_override boolean;
  v_permissions jsonb;
  v_defaults jsonb;
BEGIN
  v_user_id := auth.uid();
  v_org_id := public.get_user_org_id();
  v_role := public.get_user_role()::text;

  IF v_user_id IS NULL OR v_org_id IS NULL OR v_role IS NULL OR NULLIF(p_permission, '') IS NULL THEN
    RETURN false;
  END IF;
  IF v_role = 'admin' THEN RETURN true; END IF;
  IF v_role NOT IN ('intercedent', 'backoffice', 'finance') THEN RETURN false; END IF;

  SELECT allowed
    INTO v_override
    FROM public.user_permission_overrides
   WHERE organization_id = v_org_id
     AND user_id = v_user_id
     AND permission_key = p_permission;
  IF FOUND THEN
    RETURN v_override;
  END IF;

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

REVOKE ALL ON FUNCTION public.has_role_permission(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role_permission(text) TO authenticated, service_role;

COMMIT;
