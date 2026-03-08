
create table public.people_search_results (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  external_id text not null,
  name text,
  title text,
  url text,
  image_url text,
  published_date timestamptz,
  text_content text,
  highlights text[],
  highlight_scores numeric[],
  search_query text,
  date_imported timestamptz not null default now(),
  raw_data jsonb,
  unique (organization_id, external_id)
);

alter table public.people_search_results enable row level security;

create policy "tenant_select" on public.people_search_results
  as restrictive for select to authenticated
  using (organization_id = get_user_org_id());

create policy "tenant_insert" on public.people_search_results
  as restrictive for insert to authenticated
  with check (organization_id = get_user_org_id());

create policy "tenant_update" on public.people_search_results
  as restrictive for update to authenticated
  using (organization_id = get_user_org_id());

create policy "tenant_delete" on public.people_search_results
  as restrictive for delete to authenticated
  using (organization_id = get_user_org_id() and get_user_role() = 'admin');
