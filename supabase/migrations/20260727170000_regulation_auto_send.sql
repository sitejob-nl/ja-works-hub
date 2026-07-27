-- Reglementen automatisch meesturen bij een toewijzing (voertuig of kamer) en aantoonbaar
-- laten bevestigen.
--
-- Aanleiding (doorloop 27-07): Maria wil dat iemand die een auto krijgt automatisch de regels
-- voor autogebruik toegestuurd krijgt; Jeroen wil dat aantoonbaar is dát ze het gelezen hebben.
-- Dat moet ook werken als de auto los wordt toegewezen, buiten de plaatsingswizard om.
--
-- Bestaande bouwstenen worden hergebruikt: `regulations` (titel, versie, inhoud) en
-- `regulation_acknowledgements` (ondertekening met tijdstip + IP) doen dit patroon al bij
-- onboarding. Nieuw is alleen: waar hoort het bij, gaat het automatisch, en de tokenlink.

-- 1. Reglement-metadata -------------------------------------------------------------------

alter table public.regulations
  add column if not exists category text not null default 'algemeen',
  add column if not exists auto_send boolean not null default false,
  add column if not exists requires_acknowledgement boolean not null default true,
  -- Pad in de `documents`-bucket. JA Werkt levert het autoreglement als PDF aan; de
  -- acceptatiepagina rendert die en houdt bij of de laatste pagina is bereikt.
  add column if not exists file_url text;

-- Categorie bepaalt bij welke gebeurtenis het reglement hoort.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'regulations_category_check') then
    alter table public.regulations
      add constraint regulations_category_check
      check (category in ('algemeen', 'voertuig', 'huisvesting'));
  end if;
end $$;

-- PDF-only reglementen hebben geen ingetypte tekst. content blijft NOT NULL (bestaande rijen
-- en de onboarding-flow rekenen erop), maar krijgt een default zodat 'm weglaten mag.
alter table public.regulations alter column content set default '';

comment on column public.regulations.category is
  'algemeen | voertuig | huisvesting — bepaalt bij welke toewijzing het reglement hoort.';
comment on column public.regulations.auto_send is
  'Automatisch meesturen bij een toewijzing in deze categorie.';
comment on column public.regulations.requires_acknowledgement is
  'Ontvanger moet het document doorlopen en expliciet bevestigen.';

-- Alleen actieve, automatisch te versturen reglementen worden opgehaald bij een toewijzing.
create index if not exists idx_regulations_autosend
  on public.regulations (organization_id, category)
  where is_active and auto_send;

-- 2. Verzendtokens ------------------------------------------------------------------------

-- De token zelf staat NIET in de tabel — alleen de SHA-256. Zo kunnen interne gebruikers de
-- verzendstatus lezen (verstuurd op / bevestigd op) zonder de acceptatielink te kunnen
-- reconstrueren en namens een medewerker te tekenen.
create table if not exists public.regulation_send_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  regulation_id uuid not null references public.regulations(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  -- Waar de verzending vandaan kwam, puur voor herleidbaarheid in de UI.
  context_type text check (context_type in ('voertuig', 'huisvesting')),
  context_id uuid,
  token_hash text not null unique,
  sent_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '60 days',
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_regulation_send_tokens_candidate
  on public.regulation_send_tokens (organization_id, candidate_id, regulation_id);

alter table public.regulation_send_tokens enable row level security;

-- Lezen mag intern (statusweergave). Schrijven gaat uitsluitend via de service-role in de
-- edge functions: een gebruiker mag geen token aanmaken of als gebruikt markeren.
drop policy if exists regulation_send_tokens_tenant_select on public.regulation_send_tokens;
create policy regulation_send_tokens_tenant_select
  on public.regulation_send_tokens
  for select
  using (organization_id = (select get_user_org_id()) and (select is_internal_user()));

comment on table public.regulation_send_tokens is
  'Verzendlog + eenmalige acceptatielink per (reglement × kandidaat). Token gehasht opgeslagen; schrijven alleen via service-role.';
