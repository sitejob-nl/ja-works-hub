-- Stage-2 matching: cache van Gemini-rerank-resultaten per (vacature × kandidaat).
-- Reruns zijn gratis zolang de input (vacaturetekst + dossier) niet verandert (input_hash).
create table if not exists public.match_rerank_cache (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vacancy_id uuid not null references public.vacancies(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  input_hash text not null,
  fit_score integer not null check (fit_score between 0 and 100),
  verdict text not null,
  reasoning text not null default '',
  strengths text[] not null default '{}',
  concerns text[] not null default '{}',
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (vacancy_id, candidate_id)
);

create index if not exists idx_match_rerank_cache_org_vac
  on public.match_rerank_cache (organization_id, vacancy_id);

alter table public.match_rerank_cache enable row level security;

-- Lezen: alleen interne gebruikers binnen de eigen organisatie. Schrijven gebeurt
-- uitsluitend via de service-role in de edge function (bypasst RLS), dus géén
-- user-insert/update/delete policy.
drop policy if exists rerank_cache_select_own_org on public.match_rerank_cache;
drop policy if exists rerank_cache_select_internal_org on public.match_rerank_cache;
create policy rerank_cache_select_internal_org on public.match_rerank_cache
  for select to authenticated
  using (organization_id = public.get_user_org_id() and public.is_internal_user());

-- updated_at trigger (zelfde helper als de rest van het schema)
drop trigger if exists set_updated_at on public.match_rerank_cache;
create trigger set_updated_at before update on public.match_rerank_cache
  for each row execute function public.handle_updated_at();
