
create table public.compliance_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null,
  sector text,
  contract_type text,
  required_documents text[] not null default '{}',
  required_fields text[] not null default '{}',
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.compliance_rules enable row level security;

create policy "tenant_select" on public.compliance_rules for select using (organization_id = get_user_org_id());
create policy "tenant_insert" on public.compliance_rules for insert with check (organization_id = get_user_org_id());
create policy "tenant_update" on public.compliance_rules for update using (organization_id = get_user_org_id());
create policy "tenant_delete" on public.compliance_rules for delete using (organization_id = get_user_org_id() and get_user_role() = 'admin');
