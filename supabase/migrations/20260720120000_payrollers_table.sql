-- Payrollers van een vaste enum naar een tabel per organisatie, zodat een org er
-- zelf een kan toevoegen. `payroller_type` kende exact vier waarden, dus een vijfde
-- payroller vroeg tot nu toe een migratie + codewijziging.
--
-- BEWUST VOLLEDIG ADDITIEF. `placements.payroller` (de enum-kolom) blijft staan en
-- behoudt zijn waarden. De frontend die op dit moment in productie draait leest die
-- kolom nog; hem hier droppen zou de live app breken in het gat tussen migratie en
-- Vercel-deploy. Opruimen kan later, in een aparte migratie, als de nieuwe frontend
-- een tijd draait.
--
-- `invoiced_by_us` vervangt de hardcoded JA_WERKT_PAYROLLERS-array in
-- src/lib/payroller.ts: het is een eigenschap van de payroller (Flexpedia factureert
-- rechtstreeks aan de eindklant), niet van onze code.

create table if not exists public.payrollers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  -- Factureert onze organisatie voor plaatsingen bij deze payroller?
  invoiced_by_us boolean not null default true,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  -- Enum-waarde waaruit deze rij is gemigreerd; zelf toegevoegde payrollers = null.
  -- Nodig om bestaande placements.payroller-waarden te kunnen koppelen.
  legacy_key public.payroller_type,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_payrollers_org on public.payrollers (organization_id);

-- Eén payroller per naam per org (hoofdletterongevoelig), en één rij per enum-waarde.
create unique index if not exists payrollers_org_name_uniq
  on public.payrollers (organization_id, lower(name));
create unique index if not exists payrollers_org_legacy_key_uniq
  on public.payrollers (organization_id, legacy_key) where legacy_key is not null;

alter table public.payrollers enable row level security;

-- RLS: interne gebruikers (admin/intercedent/backoffice/finance) binnen de eigen org.
-- De portaalrollen (medewerker, opdrachtgever) krijgen bewust niets — zij hebben geen
-- zicht op de facturatiekant.
drop policy if exists payrollers_select_internal_org on public.payrollers;
create policy payrollers_select_internal_org on public.payrollers
  for select to authenticated
  using (organization_id = public.get_user_org_id() and public.is_internal_user());

drop policy if exists payrollers_insert_internal_org on public.payrollers;
create policy payrollers_insert_internal_org on public.payrollers
  for insert to authenticated
  with check (organization_id = public.get_user_org_id() and public.is_internal_user());

drop policy if exists payrollers_update_internal_org on public.payrollers;
create policy payrollers_update_internal_org on public.payrollers
  for update to authenticated
  using (organization_id = public.get_user_org_id() and public.is_internal_user())
  with check (organization_id = public.get_user_org_id() and public.is_internal_user());

drop policy if exists payrollers_delete_internal_org on public.payrollers;
create policy payrollers_delete_internal_org on public.payrollers
  for delete to authenticated
  using (organization_id = public.get_user_org_id() and public.is_internal_user());

drop trigger if exists set_updated_at on public.payrollers;
create trigger set_updated_at before update on public.payrollers
  for each row execute function public.handle_updated_at();

-- ── Seed: de vier bestaande payrollers voor elke organisatie ──
-- Labels exact zoals src/lib/payroller.ts ze toonde, zodat de UI niet verandert.
insert into public.payrollers (organization_id, name, invoiced_by_us, legacy_key, sort_order)
select o.id, v.name, v.invoiced_by_us, v.legacy_key::public.payroller_type, v.sort_order
from public.organizations o
cross join (values
  ('Flexpedia', false, 'flexpedia', 1),
  ('BrioWorks', true,  'brioworks', 2),
  ('Bromida',   true,  'bromida',   3),
  ('Retiva/A1', true,  'retiva',    4)
) as v(name, invoiced_by_us, legacy_key, sort_order)
on conflict do nothing;

-- ── Koppeling op placements ──
alter table public.placements
  add column if not exists payroller_id uuid references public.payrollers(id) on delete set null;

-- FK-index: het schema heeft al veel ongedekte FK's, daar niet nog een aan toevoegen.
create index if not exists idx_placements_payroller_id on public.placements (payroller_id);

-- Backfill vanuit de enum-kolom.
update public.placements p
set payroller_id = pr.id
from public.payrollers pr
where pr.organization_id = p.organization_id
  and pr.legacy_key = p.payroller
  and p.payroller is not null
  and p.payroller_id is null;

comment on table public.payrollers is
  'Payrollers (loonmotoren) per organisatie. Vervangt de vaste enum payroller_type. invoiced_by_us=false betekent dat de payroller zelf aan de eindklant factureert (bv. Flexpedia).';
comment on column public.placements.payroller_id is
  'FK naar payrollers. Vervangt de enum-kolom placements.payroller, die bewust blijft staan tot de nieuwe frontend een tijd draait.';

-- Standaard-payroller: voorgeselecteerd in de wizard. Vervangt
-- organizations.settings.payrollers.default, zodat de hele payroller-configuratie
-- in één tabel zit en niet meer meelift op de settings-JSON (waar acht andere
-- schermen read-modify-write op doen en elkaar kunnen overschrijven).
alter table public.payrollers add column if not exists is_default boolean not null default false;

create unique index if not exists payrollers_org_default_uniq
  on public.payrollers (organization_id) where is_default;

comment on column public.payrollers.is_default is
  'Voorgeselecteerd in de plaatsingswizard. Vervangt organizations.settings.payrollers.default.';

comment on column public.placements.payroller is
  'BEVROREN LEGACY. Vervangen door payroller_id. Blijft staan voor rollback-veiligheid, maar wordt niet meer geschreven: bij een payroller-wijziging via de UI verandert alleen payroller_id, dus deze kolom kan afwijken. Niet gebruiken voor rapportages of facturatie.';
