-- Dubbele opdrachtgevers samenvoegen — spiegelt de kandidaten-dedup
-- (20260604120000/20260604130000, gehard in 20260609203000, en de documentpad-fix
-- van 20260829132004) een-op-een voor `companies`.
--
-- De val zit in de foreign keys naar companies.id:
--   CASCADE:  client_portal_invites, communications, company_contacts,
--             company_functions, company_sla, rate_agreements, vacancies
--   RESTRICT/NO ACTION: documents, invoices, placements, employee_notifications
-- Een naïeve delete van de verliezer gooit de CASCADE-tabellen stilzwijgend weg; de
-- RESTRICT-tabellen blokkeren de delete hard (gunstig — fail loud — maar geen
-- vervanging voor volledig omhangen). merge_company_records hangt daarom élke tabel
-- met een company_id-kolom om vóór de delete, met dezelfde dynamische
-- pg_class/pg_attribute-loop als merge_candidate_records, zodat een nieuwe tabel met
-- die kolom automatisch meedoet zonder dat deze functie hem hoeft te kennen.
--
-- In tegenstelling tot candidates heeft geen enkele company_id-tabel een unique
-- constraint die op de company_id zelf botst (geverifieerd tegen het live schema) —
-- er is dus geen "matches"-achtige dedupe-voor-de-move nodig, en geen guard voor
-- dubbele payroll/loyalty-records. Wel identiek: documents heeft een
-- padcontrole-trigger die het bestandspad tegen de kandidaat/company-map valideert;
-- die kende companies al voor het losse (niet-samengevoegde) geval, maar niet voor
-- een company die net is opgegaan in een ander. Zonder fix breekt elke merge met een
-- bedrijfsdocument op exact dezelfde manier als bij kandidaten in 20260829132004.

-- === 1. Herkomst van een samenvoeging ========================================

create table if not exists public.company_merges (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  survivor_id     uuid not null references public.companies(id) on delete cascade,
  loser_id        uuid not null unique,
  merged_at       timestamptz not null default now(),
  -- Geen FK: bij een superadmin-merge is de actor geen rij in `profiles`.
  merged_by       uuid
);

comment on table public.company_merges is
  'Welke opdrachtgever is in welke opgegaan. Gevuld door merge_company_records; gelezen door de padcontrole op documents zodat bestanden in de map van de verdwenen opdrachtgever bereikbaar blijven.';

create index if not exists company_merges_survivor_idx on public.company_merges (survivor_id);
create index if not exists company_merges_org_idx      on public.company_merges (organization_id);

alter table public.company_merges enable row level security;

revoke all on public.company_merges from anon, authenticated;
grant select on public.company_merges to authenticated;

drop policy if exists company_merges_select_internal on public.company_merges;
create policy company_merges_select_internal on public.company_merges
  for select to authenticated
  using (organization_id = public.get_user_org_id() and public.is_internal_user());

-- === 2. Padcontrole uitgebreid met de company-kant ===========================

create or replace function public.document_path_matches_company(
  p_path text,
  p_org uuid,
  p_company uuid
)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select p_path is not null
     and p_org is not null
     and p_company is not null
     and p_path like p_org::text || '/companies/' || p_company::text || '/%';
$fn$;

create or replace function public.enforce_document_storage_path()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.file_path is null then
    return new;
  end if;

  if public.document_path_matches_candidate(new.file_path, new.organization_id, new.candidate_id) then
    return new;
  end if;

  if public.document_path_matches_company(new.file_path, new.organization_id, new.company_id) then
    return new;
  end if;

  -- Samengevoegde kandidaat: het bestand staat in de map van de kandidaat die
  -- verdween. Alleen goed als die samenvoeging is vastgelegd.
  if new.candidate_id is not null and exists (
    select 1
    from public.candidate_merges m
    where m.survivor_id = new.candidate_id
      and m.organization_id = new.organization_id
      and public.document_path_matches_candidate(new.file_path, new.organization_id, m.loser_id)
  ) then
    return new;
  end if;

  -- Samengevoegde opdrachtgever: zelfde redenering, nu voor company_id.
  if new.company_id is not null and exists (
    select 1
    from public.company_merges m
    where m.survivor_id = new.company_id
      and m.organization_id = new.organization_id
      and public.document_path_matches_company(new.file_path, new.organization_id, m.loser_id)
  ) then
    return new;
  end if;

  raise exception 'Documentpad hoort niet bij deze kandidaat'
    using errcode = '23514';
end;
$fn$;

revoke all on function public.enforce_document_storage_path() from public, anon, authenticated;
revoke all on function public.document_path_matches_company(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.document_path_matches_company(text, uuid, uuid) to authenticated, service_role;

-- === 3. merge_company_records =================================================

create or replace function public.merge_company_records(
  p_survivor uuid,
  p_loser uuid,
  p_actor uuid default null::uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_survivor  public.companies%rowtype;
  v_loser     public.companies%rowtype;
  -- Alleen kernidentiteit + metadata blijft van de overlever; alle overige velden
  -- vullen aan waar de overlever leeg is (coalesce). Generated kolommen sluiten we uit
  -- op eigenschap (is_generated), niet op naam — precies de fix die
  -- merge_candidate_records op 21-08 nodig had toen search_unaccent erbij kwam.
  v_skip_cols text[] := array['id', 'organization_id', 'created_at', 'updated_at', 'name'];
  v_tbl       text;
  v_set       text;
  v_actor     uuid;
begin
  select * into v_survivor from public.companies where id = p_survivor;
  if not found then raise exception 'merge_company_records: survivor % not found', p_survivor; end if;
  select * into v_loser from public.companies where id = p_loser;
  if not found then raise exception 'merge_company_records: loser % not found', p_loser; end if;
  if p_survivor = p_loser then
    raise exception 'merge_company_records: survivor and loser are identical (%)', p_survivor;
  end if;
  if v_survivor.organization_id <> v_loser.organization_id then
    raise exception 'merge_company_records: cannot merge across organizations (% vs %)',
      v_survivor.organization_id, v_loser.organization_id;
  end if;

  if auth.role() = 'service_role' then
    v_actor := p_actor;
  elsif auth.role() = 'authenticated' then
    if not (
      public.is_superadmin()
      or (
        public.is_internal_user()
        and v_survivor.organization_id = public.get_user_org_id()
      )
    ) then
      raise exception 'merge_company_records: not authorized';
    end if;
    v_actor := auth.uid();
  else
    raise exception 'merge_company_records: not authenticated';
  end if;

  -- Leg de samenvoeging vast voordat er ook maar een rij verhuist — zie
  -- enforce_document_storage_path hierboven. Bestaande ketens platgeslagen (A naar B
  -- en daarna B naar C wordt A naar C), zodat een enkele opzoeking altijd volstaat.
  update public.company_merges set survivor_id = p_survivor where survivor_id = p_loser;
  insert into public.company_merges (organization_id, survivor_id, loser_id, merged_by)
  values (v_survivor.organization_id, p_survivor, p_loser, v_actor)
  on conflict (loser_id) do update
    set survivor_id = excluded.survivor_id,
        merged_at   = now(),
        merged_by   = excluded.merged_by;

  -- Elke tabel met een company_id-kolom omhangen — vangt zowel de CASCADE-tabellen
  -- (vacancies, company_contacts, company_functions, company_sla, rate_agreements,
  -- communications, client_portal_invites) als de RESTRICT/NO ACTION-tabellen
  -- (documents, invoices, placements, employee_notifications), en elke toekomstige
  -- tabel met dezelfde kolom. Geen van die tabellen heeft een unique constraint op
  -- company_id (geverifieerd tegen het live schema), dus een kale UPDATE volstaat —
  -- anders dan bij candidates is er geen dedupe-voor-de-move nodig.
  for v_tbl in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not c.relispartition
      and a.attname = 'company_id'
      and not a.attisdropped
  loop
    execute format('update public.%I set company_id = $1 where company_id = $2', v_tbl)
      using p_survivor, p_loser;
  end loop;

  -- Polymorfe verwijzingen (geen FK naar companies) -> omhangen op entity_id.
  delete from public.external_mappings l
    where l.entity_type = 'company' and l.entity_id = p_loser
      and exists (select 1 from public.external_mappings s
                  where s.entity_type = 'company' and s.entity_id = p_survivor
                    and s.organization_id = l.organization_id
                    and s.external_system = l.external_system);
  update public.external_mappings set entity_id = p_survivor
    where entity_type = 'company' and entity_id = p_loser;

  update public.notes set related_entity_id = p_survivor
    where related_entity_type = 'bedrijf' and related_entity_id = p_loser;

  update public.recruiter_tasks set related_entity_id = p_survivor
    where related_entity_type = 'bedrijf' and related_entity_id = p_loser;

  delete from public.custom_field_values l
    where l.entity_id = p_loser
      and exists (select 1 from public.custom_field_values s
                  where s.entity_id = p_survivor and s.custom_field_id = l.custom_field_id);
  update public.custom_field_values set entity_id = p_survivor where entity_id = p_loser;

  select string_agg(format('%1$I = coalesce(s.%1$I, l.%1$I)', column_name), ', ')
    into v_set
  from information_schema.columns
  where table_schema = 'public' and table_name = 'companies'
    and column_name <> all (v_skip_cols)
    and is_generated <> 'ALWAYS';

  if v_set is not null then
    execute format(
      'update public.companies s set %s from public.companies l where s.id = $1 and l.id = $2',
      v_set
    ) using p_survivor, p_loser;
  end if;

  insert into public.audit_log (organization_id, user_id, action, table_name, record_id, old_values, new_values, reason)
  values (
    v_survivor.organization_id,
    v_actor,
    'delete',
    'companies',
    p_loser,
    to_jsonb(v_loser),
    jsonb_build_object('merged_into', p_survivor),
    format('company merge: %s merged into %s', p_loser, p_survivor)
  );

  delete from public.companies where id = p_loser;

  return jsonb_build_object(
    'survivor', p_survivor,
    'loser', p_loser,
    'organization_id', v_survivor.organization_id,
    'merged', true
  );
end;
$$;

-- SEC: SECURITY DEFINER zonder de auth-guard hierboven zou destructieve merges op
-- willekeurige company-UUID's toelaten. Mag nooit anoniem aanroepbaar zijn.
revoke execute on function public.merge_company_records(uuid, uuid, uuid) from anon, public;
grant execute on function public.merge_company_records(uuid, uuid, uuid) to authenticated, service_role;

-- === 4. find_duplicate_companies — read-only detectie =========================
-- Groepeert op (a) zelfde KVK-nummer, (b) zelfde genormaliseerde bedrijfsnaam of
-- (c) zelfde genormaliseerd adres (postcode + straat + plaats). Binnen de eigen
-- organisatie (tenant-veilig via auth.uid()).

create or replace function public.find_duplicate_companies()
returns table (
  group_key text,
  match_reason text,
  company_id uuid,
  name text,
  kvk_number text,
  address_street text,
  address_postal text,
  address_city text,
  phone text,
  email text,
  is_active boolean,
  created_at timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with me as (
    select organization_id from public.profiles where id = auth.uid()
  ),
  base as (
    select c.id, c.name, c.kvk_number, c.address_street, c.address_postal, c.address_city,
           c.phone, c.email, c.is_active, c.created_at,
           nullif(regexp_replace(coalesce(c.kvk_number, ''), '\D', '', 'g'), '') as kvk_digits,
           nullif(trim(regexp_replace(lower(public.f_unaccent(coalesce(c.name, ''))), '[^a-z0-9]+', ' ', 'g')), '') as name_norm,
           nullif(trim(regexp_replace(lower(public.f_unaccent(
             coalesce(c.address_postal, '') || ' ' || coalesce(c.address_street, '') || ' ' || coalesce(c.address_city, '')
           )), '[^a-z0-9]+', '', 'g')), '') as address_norm
    from public.companies c
    where c.organization_id = (select organization_id from me)
  ),
  kvk_groups as (
    select 'kvk:' || kvk_digits as group_key, 'Zelfde KVK-nummer' as match_reason, id
    from base
    where kvk_digits is not null and length(kvk_digits) >= 8
      and kvk_digits in (
        select kvk_digits from base
        where kvk_digits is not null and length(kvk_digits) >= 8
        group by kvk_digits having count(*) > 1
      )
  ),
  name_groups as (
    select 'name:' || name_norm as group_key, 'Zelfde bedrijfsnaam' as match_reason, id
    from base
    where name_norm is not null
      and name_norm in (
        select name_norm from base
        where name_norm is not null
        group by name_norm having count(*) > 1
      )
  ),
  address_groups as (
    select 'address:' || address_norm as group_key, 'Zelfde adres' as match_reason, id
    from base
    where address_norm is not null and address_street is not null and address_postal is not null
      and address_norm in (
        select address_norm from base
        where address_norm is not null and address_street is not null and address_postal is not null
        group by address_norm having count(*) > 1
      )
  ),
  grouped as (
    select * from kvk_groups
    union all
    select * from name_groups
    union all
    select * from address_groups
  )
  select g.group_key, g.match_reason, b.id as company_id,
         b.name, b.kvk_number, b.address_street, b.address_postal, b.address_city,
         b.phone, b.email, b.is_active, b.created_at
  from grouped g
  join base b on b.id = g.id
  order by g.group_key, b.created_at;
$function$;

-- Alleen ingelogde gebruikers; anon krijgt niets (tenant-scope via auth.uid()).
revoke execute on function public.find_duplicate_companies() from public, anon;
grant execute on function public.find_duplicate_companies() to authenticated;

-- === 5. Groepen wegzetten als "geen duplicaat" ================================
-- Spiegelt candidate_duplicate_dismissals (20260820193025): een gedeeld
-- bedrijfsadres (bijv. een bedrijfsverzamelgebouw of hetzelfde boekhoudkantoor) kan
-- dezelfde valse-positiefgroep opleveren als een gedeeld telefoonnummer bij
-- kandidaten. Met een afwijzing per group_key blijft zo'n groep weg tot iemand hem
-- terughaalt.

create table if not exists public.company_duplicate_dismissals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  group_key text not null,
  reason text,
  dismissed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, group_key)
);

create index if not exists idx_company_duplicate_dismissals_org
  on public.company_duplicate_dismissals (organization_id);

comment on table public.company_duplicate_dismissals is
  'Duplicaatgroepen die als "geen duplicaat" zijn weggezet, op group_key uit find_duplicate_companies.';

alter table public.company_duplicate_dismissals enable row level security;

drop policy if exists tenant_select on public.company_duplicate_dismissals;
create policy tenant_select on public.company_duplicate_dismissals
  for select to authenticated
  using (organization_id = get_user_org_id() and is_internal_user());

drop policy if exists tenant_insert on public.company_duplicate_dismissals;
create policy tenant_insert on public.company_duplicate_dismissals
  for insert to authenticated
  with check (organization_id = get_user_org_id() and is_internal_user());

drop policy if exists tenant_delete on public.company_duplicate_dismissals;
create policy tenant_delete on public.company_duplicate_dismissals
  for delete to authenticated
  using (organization_id = get_user_org_id() and is_internal_user());
