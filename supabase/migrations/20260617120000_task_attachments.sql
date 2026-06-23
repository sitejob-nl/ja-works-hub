-- Bijlagen op taken (recruiter_tasks): pdf, foto, word, etc.
-- Bestanden zelf leven in de bestaande 'documents' storage bucket onder
-- pad {org_id}/taken/{task_id}/{uuid}.{ext}; deze tabel is de metadata-index.

create table if not exists public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  task_id uuid not null references public.recruiter_tasks(id) on delete cascade,
  name text not null,
  file_path text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists task_attachments_task_id_idx on public.task_attachments(task_id);
create index if not exists task_attachments_org_idx on public.task_attachments(organization_id);

alter table public.task_attachments enable row level security;

create policy "tenant_select" on public.task_attachments
  for select using (organization_id = get_user_org_id());

create policy "tenant_insert" on public.task_attachments
  for insert with check (organization_id = get_user_org_id());

create policy "tenant_delete" on public.task_attachments
  for delete using (organization_id = get_user_org_id());
