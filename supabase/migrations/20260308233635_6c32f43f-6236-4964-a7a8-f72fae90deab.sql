
create table public.recruiter_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  assigned_to uuid references public.profiles(id),
  title text not null,
  description text,
  priority text not null default 'medium' check (priority in ('critical','high','medium','low')),
  status text not null default 'open' check (status in ('open','in_progress','done','dismissed')),
  category text,
  related_entity_type text,
  related_entity_id uuid,
  due_date date,
  ai_generated boolean not null default false,
  ai_reasoning text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.recruiter_tasks enable row level security;

create policy "tenant_select" on public.recruiter_tasks for select using (organization_id = get_user_org_id());
create policy "tenant_insert" on public.recruiter_tasks for insert with check (organization_id = get_user_org_id());
create policy "tenant_update" on public.recruiter_tasks for update using (organization_id = get_user_org_id());
create policy "tenant_delete" on public.recruiter_tasks for delete using (organization_id = get_user_org_id() and get_user_role() = 'admin');

create trigger handle_updated_at before update on public.recruiter_tasks
  for each row execute function public.handle_updated_at();
