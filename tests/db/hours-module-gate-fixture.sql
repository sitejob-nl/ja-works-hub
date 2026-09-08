-- Synthetic extension of hours-workflow-fixture.sql, never for production.
-- Module/audit columns, constraints, grants and policies match read-only catalog
-- inspection of JA Werkt on 2026-09-08. Existing fixture already contains the
-- exact get_user_org_id(), is_superadmin() and private.is_active_user() bodies.
-- Reduced superadmins uses user_id as its primary key; production also stores
-- id/email/created_at, which do not participate in authorization.
create table public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  modules text[] not null default '{}',
  is_default boolean default false,
  created_at timestamptz default now()
);
alter table public.organizations add column plan_id uuid references public.subscription_plans(id);

create table public.organization_modules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  module_name text not null,
  enabled boolean default true,
  unique (organization_id, module_name)
);
alter table public.organization_modules enable row level security;
grant all on public.organization_modules to anon, authenticated, service_role;
create policy superadmin_manage_modules on public.organization_modules
  for all to authenticated using (public.is_superadmin()) with check (public.is_superadmin());
create policy org_read_own_modules on public.organization_modules
  for select to authenticated using (organization_id = public.get_user_org_id() or public.is_superadmin());
create policy active_profile_required on public.organization_modules as restrictive
  for all to authenticated using ((select private.is_active_user())) with check ((select private.is_active_user()));

alter table public.superadmins enable row level security;
grant all on public.superadmins to anon, authenticated, service_role;
create policy superadmin_select on public.superadmins
  for select to authenticated using (public.is_superadmin());
create policy active_profile_required on public.superadmins as restrictive
  for all to authenticated using ((select private.is_active_user())) with check ((select private.is_active_user()));

create type public.audit_action as enum ('create','update','delete','status_change','login','export','override');
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references public.profiles(id),
  action public.audit_action not null,
  table_name text not null,
  record_id uuid,
  old_values jsonb,
  new_values jsonb,
  ip_address text,
  reason text,
  created_at timestamptz not null default now()
);
alter table public.audit_log enable row level security;
grant all on public.audit_log to anon, authenticated, service_role;
create policy tenant_insert on public.audit_log for insert to authenticated
  with check (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user()));
create policy tenant_select on public.audit_log for select to authenticated
  using (organization_id = public.get_user_org_id() and public.is_internal_user());
create policy active_profile_required on public.audit_log as restrictive
  for all to authenticated using ((select private.is_active_user())) with check ((select private.is_active_user()));
