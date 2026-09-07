-- Disposable PostgreSQL fixture only; the runner never accepts a database URL.
-- These small auth helpers model Supabase JWT claims without real user data.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE SCHEMA private;
GRANT USAGE ON SCHEMA public, auth, private TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  settings jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id)
);
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id),
  organization_id uuid REFERENCES public.organizations(id),
  role text NOT NULL DEFAULT 'admin',
  is_active boolean NOT NULL DEFAULT true
);
CREATE TABLE public.superadmins (user_id uuid PRIMARY KEY REFERENCES auth.users(id));
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
$$;
CREATE FUNCTION public.get_user_org_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT organization_id FROM public.profiles WHERE id = auth.uid()
$$;
CREATE FUNCTION public.get_user_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid()
$$;
CREATE FUNCTION public.is_internal_user() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT coalesce(public.get_user_role() IN ('admin', 'intercedent', 'backoffice', 'finance'), false)
$$;
CREATE FUNCTION public.is_superadmin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM public.superadmins WHERE user_id = auth.uid())
$$;
CREATE FUNCTION public.is_active_user() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT coalesce((SELECT is_active FROM public.profiles WHERE id = auth.uid()), public.is_superadmin())
$$;
CREATE FUNCTION private.get_user_org_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT public.get_user_org_id() $$;
CREATE FUNCTION private.is_internal_user() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT public.is_internal_user() $$;
CREATE FUNCTION private.is_superadmin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT public.is_superadmin() $$;
CREATE FUNCTION private.is_active_user() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT public.is_active_user() $$;
