-- Synthetic fixture for isolated hours-workflow QA, never for production.
-- Auth JWT shim and reduced tables are synthetic; public/private helper bodies
-- below were retrieved read-only from JA Werkt production on 2026-09-08.
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA public, auth, private TO anon, authenticated, service_role;
CREATE TYPE public.user_role AS ENUM ('admin','intercedent','backoffice','finance','medewerker','opdrachtgever','facility');
CREATE TYPE public.placement_status AS ENUM ('gepland','actief','afgerond','voortijdig_beeindigd');
CREATE TYPE public.payroller_type AS ENUM ('flexpedia','brioworks','bromida','retiva');
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, settings jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY, organization_id uuid REFERENCES public.organizations(id),
  role public.user_role NOT NULL, is_active boolean NOT NULL DEFAULT true
);
CREATE TABLE public.superadmins (user_id uuid PRIMARY KEY);
CREATE TABLE public.user_permission_overrides (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  permission_key text NOT NULL, allowed boolean NOT NULL,
  UNIQUE (organization_id, user_id, permission_key)
);
CREATE TABLE public.candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  auth_user_id uuid, first_name text NOT NULL DEFAULT 'Synthetic',
  last_name text NOT NULL DEFAULT 'Worker'
);
CREATE TABLE public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  name text NOT NULL DEFAULT 'Synthetic company', is_active boolean NOT NULL DEFAULT true
);
CREATE TABLE public.placements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  candidate_id uuid REFERENCES public.candidates(id),
  company_id uuid REFERENCES public.companies(id),
  start_date date NOT NULL, end_date date,
  status public.placement_status NOT NULL DEFAULT 'actief',
  payroller public.payroller_type NOT NULL DEFAULT 'flexpedia'
);
CREATE OR REPLACE FUNCTION public.get_user_org_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'vault', 'pg_temp'
AS $function$
  select organization_id
  from public.profiles
  where id = (select auth.uid())
    and is_active is true
$function$;

CREATE OR REPLACE FUNCTION public.get_user_role()
 RETURNS user_role
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'vault', 'pg_temp'
AS $function$
  select role
  from public.profiles
  where id = (select auth.uid())
    and is_active is true
$function$;

CREATE OR REPLACE FUNCTION public.is_superadmin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'vault', 'pg_temp'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.superadmins WHERE user_id = auth.uid())
$function$;

CREATE OR REPLACE FUNCTION public.get_employee_candidate_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'vault', 'pg_temp'
AS $function$
  select c.id
  from public.candidates c
  join public.profiles p
    on p.id = (select auth.uid())
   and p.organization_id = c.organization_id
   and p.role = 'medewerker'::public.user_role
   and p.is_active is true
  where c.auth_user_id = (select auth.uid())
$function$;

CREATE OR REPLACE FUNCTION public.is_internal_user()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'vault', 'pg_temp'
AS $function$ SELECT COALESCE(public.get_user_role() IN ('admin','intercedent','backoffice','finance'), false); $function$;

CREATE OR REPLACE FUNCTION private.is_active_user()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.is_active is true
    )
    or (
      not exists (
        select 1
        from public.profiles p
        where p.id = (select auth.uid())
      )
      and public.is_superadmin()
    );
$function$;

CREATE OR REPLACE FUNCTION public.role_permission_admin_defaults()
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.role_permission_defaults(p_role text)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
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
$function$;


CREATE OR REPLACE FUNCTION public.has_role_permission(p_permission text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  IF v_role = 'facility' THEN RETURN false; END IF;
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
$function$;

