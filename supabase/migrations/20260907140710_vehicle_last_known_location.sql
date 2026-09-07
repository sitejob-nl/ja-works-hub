-- Laatste bekende locatie van een voertuig.
--
-- Operationeel probleem: soms weet niemand waar een auto staat. Bewust een handmatig
-- veld (geen GPS-koppeling), maar zo gemodelleerd dat een latere automatische bron
-- dezelfde kolommen kan vullen: het tijdstip staat los van `updated_at` en `..._by`
-- is nullable — een automatische bron heeft geen profiel.
--
-- Additief en idempotent; `vehicles` heeft al tenant-policies (tenant_select/insert/
-- update/delete + active_profile_required), dus geen RLS-wijziging nodig.
--
-- Spiegel van de via Supabase MCP toegepaste migratie (versie 20260907140710).
alter table public.vehicles
  add column if not exists last_known_location text,
  add column if not exists last_known_location_at timestamptz,
  add column if not exists last_known_location_by uuid references public.profiles(id) on delete set null;

comment on column public.vehicles.last_known_location is
  'Vrije tekst: waar het voertuig voor het laatst is gezien. NULL = onbekend, een geldige staat.';
comment on column public.vehicles.last_known_location_at is
  'Tijdstip waarop de locatie is vastgelegd. NULL zolang er geen locatie is — nooit afleiden uit updated_at.';
comment on column public.vehicles.last_known_location_by is
  'Profiel dat de locatie bijwerkte. NULL = niet door een persoon gezet (ruimte voor een latere automatische bron).';

-- Leeg is geldig, half ingevuld niet: zonder locatie mag er ook geen datum of naam staan,
-- anders toont het overzicht een tijdstip zonder plek.
alter table public.vehicles drop constraint if exists vehicles_last_known_location_complete;
alter table public.vehicles add constraint vehicles_last_known_location_complete
  check (
    last_known_location is not null
    or (last_known_location_at is null and last_known_location_by is null)
  );

-- Covering index op de nieuwe foreign key (advisor Pri 4: unindexed FKs).
create index if not exists idx_vehicles_last_known_location_by
  on public.vehicles (last_known_location_by);
