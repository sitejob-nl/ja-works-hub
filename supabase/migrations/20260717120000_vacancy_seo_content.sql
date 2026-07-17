-- AI-vacaturetekstgenerator: opslag voor de gegenereerde SEO-/marketing-output per vacature.
-- Eén rij per vacature (1:1, upsert on conflict vacancy_id). De edge function
-- `generate-vacancy` schrijft via de service-role (bypasst RLS); interne gebruikers
-- lezen/bewerken/verwijderen binnen de eigen organisatie.
--
-- Eerste-klas tekstvelden = de bewerkbare lange teksten die straks (volgende fase)
-- naar de website worden gepusht. De gestructureerde rest (titelvarianten, FAQ,
-- JobPosting JSON-LD, CTA-varianten, matchingprofiel, zoekwoorden, SEO-onderbouwing)
-- leeft in `content` jsonb. `input_answers` bewaart de 16 formulierantwoorden voor
-- hergeneratie + audit.

create table if not exists public.vacancy_seo_content (
  vacancy_id uuid primary key references public.vacancies(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,

  -- Bewerkbare lange teksten (eerste-klas voor edit + toekomstige website-push)
  seo_title text,
  slug text,
  meta_description text,
  body_markdown text,
  vacaturebank_variant text,
  social_text text,
  preview_text text,

  -- Gestructureerde rest van de masterprompt-output
  content jsonb not null default '{}'::jsonb,
  -- De 16 formulierantwoorden (input) — voor hergeneratie + audit
  input_answers jsonb not null default '{}'::jsonb,

  -- Herkomst
  provider text,
  model text,
  generated_at timestamptz,
  generated_by uuid references public.profiles(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_vacancy_seo_content_org
  on public.vacancy_seo_content (organization_id);

alter table public.vacancy_seo_content enable row level security;

-- RLS: interne gebruikers (admin/intercedent/backoffice/finance) binnen de eigen org.
-- Schrijven door de generator gebeurt via service-role (bypasst RLS); deze policies
-- dekken lezen + handmatig bewerken/verwijderen vanuit de UI.
drop policy if exists vacancy_seo_content_select_internal_org on public.vacancy_seo_content;
create policy vacancy_seo_content_select_internal_org on public.vacancy_seo_content
  for select to authenticated
  using (organization_id = public.get_user_org_id() and public.is_internal_user());

drop policy if exists vacancy_seo_content_insert_internal_org on public.vacancy_seo_content;
create policy vacancy_seo_content_insert_internal_org on public.vacancy_seo_content
  for insert to authenticated
  with check (organization_id = public.get_user_org_id() and public.is_internal_user());

drop policy if exists vacancy_seo_content_update_internal_org on public.vacancy_seo_content;
create policy vacancy_seo_content_update_internal_org on public.vacancy_seo_content
  for update to authenticated
  using (organization_id = public.get_user_org_id() and public.is_internal_user())
  with check (organization_id = public.get_user_org_id() and public.is_internal_user());

drop policy if exists vacancy_seo_content_delete_internal_org on public.vacancy_seo_content;
create policy vacancy_seo_content_delete_internal_org on public.vacancy_seo_content
  for delete to authenticated
  using (organization_id = public.get_user_org_id() and public.is_internal_user());

-- updated_at trigger (zelfde helper als de rest van het schema)
drop trigger if exists set_updated_at on public.vacancy_seo_content;
create trigger set_updated_at before update on public.vacancy_seo_content
  for each row execute function public.handle_updated_at();

comment on table public.vacancy_seo_content is
  'AI-gegenereerde SEO-/marketingteksten per vacature (masterprompt-output). 1:1 met vacancies; geschreven door edge function generate-vacancy.';
