-- Duplicatenlijst inkorten: groepen die géén duplicaat zijn moeten weg kunnen blijven.
--
-- `find_duplicate_candidates` groepeert onder andere op telefoonnummer. In productie
-- hangen er tien verschillende mensen onder één nummer (een kantoor- of
-- uitzendbureaunummer) en staat het nummer van de directeur zelf bij een kandidaat.
-- Die groepen zijn niet samen te voegen en komen dus elke keer terug bovenaan de lijst.
-- Met een afwijzing per group_key blijven ze weg tot iemand ze weer terughaalt.
create table if not exists public.candidate_duplicate_dismissals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  group_key text not null,
  reason text,
  dismissed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, group_key)
);

create index if not exists idx_candidate_duplicate_dismissals_org
  on public.candidate_duplicate_dismissals (organization_id);

comment on table public.candidate_duplicate_dismissals is
  'Duplicaatgroepen die als "geen duplicaat" zijn weggezet, op group_key uit find_duplicate_candidates.';

alter table public.candidate_duplicate_dismissals enable row level security;

drop policy if exists tenant_select on public.candidate_duplicate_dismissals;
create policy tenant_select on public.candidate_duplicate_dismissals
  for select to authenticated
  using (organization_id = get_user_org_id() and is_internal_user());

drop policy if exists tenant_insert on public.candidate_duplicate_dismissals;
create policy tenant_insert on public.candidate_duplicate_dismissals
  for insert to authenticated
  with check (organization_id = get_user_org_id() and is_internal_user());

drop policy if exists tenant_delete on public.candidate_duplicate_dismissals;
create policy tenant_delete on public.candidate_duplicate_dismissals
  for delete to authenticated
  using (organization_id = get_user_org_id() and is_internal_user());
