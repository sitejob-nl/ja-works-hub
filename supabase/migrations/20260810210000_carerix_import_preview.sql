-- Carerix-import: per-record voorvertoning en selectie.
--
-- Tot nu toe telde een dry-run alleen (created/skipped/failed per entiteit) en
-- bewaarde hij nergens WELKE records hij zou aanmaken. Daardoor was er geen
-- manier om vóór een live import te zien wat er binnenkomt, laat staan om er
-- records uit te vinken. Deze tabel maakt van de dry-run een echte
-- voorvertoning: hij schrijft per record een regel weg, en de daaropvolgende
-- live run leest daaruit welke records overgeslagen (of juist bijgewerkt)
-- moeten worden.
--
-- Twee soorten regels:
--   action='create' — records die de dry-run zou AANMAKEN (standaard aangevinkt;
--     spam standaard uitgevinkt).
--   action='update' — al gekoppelde records waarvan Carerix ándere gegevens
--     heeft dan het platform (veld-diff in `diff`). Standaard uitgevinkt: een
--     lokale wijziging overschrijven is opt-in, per record.
-- Ongewijzigde bestaande records (het overgrote deel) krijgen géén regel —
-- anders zou elke run duizenden regels wegschrijven zonder dat iemand er iets
-- aan heeft.

create table if not exists public.carerix_import_previews (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.carerix_import_jobs(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity text not null,
  carerix_id text not null,
  action text not null default 'create' check (action in ('create', 'update')),
  -- Menselijk leesbare aanduiding: kandidaatnaam, vacaturetitel, bedrijfsnaam.
  label text,
  -- Extra context voor de beoordeling (e-mail, bedrijf, datum) — bewust jsonb
  -- zodat elke entiteit kan meegeven wat relevant is zonder schemawijziging.
  details jsonb,
  -- Alleen bij action='update': { veld: { van, naar } } — wat de live run zou
  -- overschrijven als deze regel wordt aangevinkt. De toepasbare velden zijn
  -- server-side per entiteit ge-whitelist (preview.ts COMPARE_FIELDS); waarden
  -- buiten die lijst worden bij het toepassen genegeerd.
  diff jsonb,
  -- Alleen bij action='update': het bestaande platform-record.
  existing_id uuid,
  -- Gevuld wanneer het spamfilter dit record herkende. De regel wordt dan
  -- standaard uitgevinkt weggeschreven, maar blijft zichtbaar en terug te
  -- zetten — een filterregel die te streng is mag geen kandidaat kosten.
  spam_reason text,
  excluded boolean not null default false,
  created_at timestamptz not null default now(),
  -- De worker kan een pagina opnieuw verwerken na een hervatting of
  -- zelf-trigger; zonder deze sleutel zou dat dubbele regels opleveren.
  unique (job_id, entity, carerix_id)
);

create index if not exists idx_carerix_previews_job_entity
  on public.carerix_import_previews (job_id, entity);

-- De live run laadt alleen de uitgesloten en de door spam geraakte regels.
create index if not exists idx_carerix_previews_selection
  on public.carerix_import_previews (job_id)
  where excluded or spam_reason is not null;

alter table public.carerix_import_previews enable row level security;

-- Zelfde afbakening als de overige carerix_import_*-tabellen: alleen een admin
-- van de eigen organisatie.
drop policy if exists "carerix_previews_select" on public.carerix_import_previews;
create policy "carerix_previews_select" on public.carerix_import_previews
  for select to authenticated
  using (
    organization_id = public.get_user_org_id()
    and public.get_user_role() = 'admin'
  );

-- Alleen `excluded` is bedoeld om vanuit de UI te wijzigen. De overige kolommen
-- worden door de service-role weggeschreven; die omzeilt RLS en heeft deze
-- policy niet nodig.
drop policy if exists "carerix_previews_update" on public.carerix_import_previews;
create policy "carerix_previews_update" on public.carerix_import_previews
  for update to authenticated
  using (
    organization_id = public.get_user_org_id()
    and public.get_user_role() = 'admin'
  )
  with check (
    organization_id = public.get_user_org_id()
    and public.get_user_role() = 'admin'
  );

-- Nieuwe tabellen krijgen de restrictieve gedeactiveerde-gebruiker-policy niet
-- automatisch; die loop draaide eenmalig in 20260726161052.
drop policy if exists active_profile_required on public.carerix_import_previews;
create policy active_profile_required on public.carerix_import_previews
  as restrictive for all to authenticated
  using ((select private.is_active_user()))
  with check ((select private.is_active_user()));

revoke insert, delete on public.carerix_import_previews from authenticated, anon;

-- Kolomrechten: de UI mag alléén het vinkje omzetten. RLS kent geen
-- kolomrechten, dus zonder deze grant zou een ingelogde admin ook `diff` of
-- `existing_id` kunnen herschrijven — en de live run past aangevinkte diffs
-- toe op platformrecords. Service-role omzeilt grants en blijft alles schrijven.
revoke update on public.carerix_import_previews from authenticated, anon;
grant update (excluded) on public.carerix_import_previews to authenticated;

-- Koppelt een live run aan de dry-run waarvan de selectie gerespecteerd moet
-- worden. Null = geen selectie, alles importeren (het gedrag van vóór deze
-- wijziging).
alter table public.carerix_import_jobs
  add column if not exists preview_job_id uuid references public.carerix_import_jobs(id) on delete set null;

-- Teller voor bijgewerkte records: in een dry-run het aantal gevonden
-- afwijkende records, in een live run het aantal daadwerkelijk toegepaste
-- (aangevinkte) updates. Naast created/skipped/failed.
alter table public.carerix_import_entity_runs
  add column if not exists changed integer not null default 0;

comment on table public.carerix_import_previews is
  'Per-record voorvertoning van een Carerix dry-run; excluded stuurt welke records de live run overslaat (create) of juist bijwerkt (update).';
comment on column public.carerix_import_jobs.preview_job_id is
  'Dry-run-job waarvan de record-selectie geldt voor deze live run.';
comment on column public.carerix_import_previews.diff is
  'Bij action=update: { veld: { van, naar } }; toepasbare velden zijn server-side per entiteit ge-whitelist.';
