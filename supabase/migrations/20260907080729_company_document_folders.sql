-- Ticket "Mappenstructuur en toegangsrechten op opdrachtgeverdocumenten"
-- (buglijst 02-09-2026; tweede helft van de klantvraag waarvan #247 de
-- beheerbare documenttypen was).
--
-- Documenten bij een opdrachtgever krijgen een map (company_document_folders,
-- per organisatie beheerbaar via Instellingen > HR & documenten) en per map
-- staat vast wie hem mag zien. De afscherming zit op twee lagen:
--
--   1. RLS op documents (de rij) én op company_document_folders (de map zelf),
--      zodat een gebruiker zonder recht de map ook leeg niet te zien krijgt.
--   2. private.can_access_storage_object (het bestand in de documents-bucket):
--      voor paden onder <org>/companies/... wordt de documentrij bij het pad
--      opgezocht en dezelfde mapcontrole toegepast, zodat een signed URL niet
--      om de weergave heen kan.
--
-- Rechtenmodel per map: allowed_roles (welke interne rollen; admin zit er
-- altijd in) plus een optionele required_permission. Daarmee sluit de map
-- Financieel aan op de bestaande rechtensleutel 'finance.view' — dezelfde
-- matrix als /uren, /facturatie en loonstroken (20260727100222) — in plaats
-- van een tweede finance-mechanisme. has_role_permission() respecteert de
-- per-org matrix én de per-gebruiker overrides.
--
-- Bestaande bedrijfsdocumenten (19 in productie) landen in de standaardmap
-- 'Algemeen' van hun organisatie; de trigger documents_default_company_folder
-- doet hetzelfde voor elke toekomstige insert zonder map, zodat geen enkel
-- insert-pad een bedrijfsdocument zonder map kan opleveren. De standaardmap is
-- via CHECK altijd open voor alle interne rollen en kan niet worden verwijderd,
-- dus wat er nu staat blijft bereikbaar.
--
-- Bewust NIET aangeraakt: documents_enforce_storage_path en
-- document_path_matches_* (20260829132004, 20260903085828) en de kandidaat-,
-- facility- en portaaltakken in can_access_storage_object. Die functie krijgt
-- alleen een 'companies'-tak vóór de generieke interne-rollen-return; de
-- overige takken zijn letterlijk overgenomen van de live definitie.

-- === 1. Mappen ===============================================================

create table if not exists public.company_document_folders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  label text not null,
  sort_order integer not null default 0,
  is_default boolean not null default false,
  allowed_roles public.user_role[] not null
    default array['admin', 'intercedent', 'backoffice', 'finance']::public.user_role[],
  required_permission text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, key),
  -- Alleen interne rollen; portaal- en facility-rollen zien nooit bedrijfsdocumenten.
  constraint company_document_folders_roles_internal
    check (allowed_roles <@ array['admin', 'intercedent', 'backoffice', 'finance']::public.user_role[]),
  -- Admin ziet altijd alles; een map zonder admin zou onbeheerbaar worden.
  constraint company_document_folders_admin_always
    check ('admin'::public.user_role = any (allowed_roles)),
  -- Rechtensleutel in de vorm 'finance.view' (zie src/lib/permissions.ts).
  constraint company_document_folders_permission_key
    check (required_permission is null or required_permission ~ '^[a-z]+(\.[a-z_]+)+$'),
  -- De standaardmap vangt elk document zonder map op en moet dus voor iedere
  -- interne rol open blijven — anders zou een intercedent geen document meer
  -- kunnen toevoegen en raakten bestaande documenten buiten bereik.
  constraint company_document_folders_default_open
    check (
      not is_default
      or (
        required_permission is null
        and allowed_roles @> array['admin', 'intercedent', 'backoffice', 'finance']::public.user_role[]
      )
    )
);

comment on table public.company_document_folders is
  'Mappen voor opdrachtgeverdocumenten (documents.company_id), per organisatie. allowed_roles + required_permission bepalen wie de map (en de documenten en bestanden erin) mag zien. Beheer via Instellingen > HR & documenten.';
comment on column public.company_document_folders.allowed_roles is
  'Interne rollen die deze map mogen zien. Admin zit er altijd in (CHECK).';
comment on column public.company_document_folders.required_permission is
  'Optionele rechtensleutel (bv. finance.view) die bovenop de rol vereist is; loopt via has_role_permission() en dus via de rechtenmatrix + per-gebruiker overrides.';
comment on column public.company_document_folders.is_default is
  'Precies één per organisatie. Vangt elk bedrijfsdocument zonder map op; altijd open voor alle interne rollen en niet te verwijderen.';

create unique index if not exists company_document_folders_one_default_per_org
  on public.company_document_folders (organization_id)
  where is_default;

create index if not exists idx_company_document_folders_org
  on public.company_document_folders (organization_id, sort_order);

drop trigger if exists set_updated_at on public.company_document_folders;
create trigger set_updated_at before update on public.company_document_folders
  for each row execute function public.handle_updated_at();

-- De standaardmap is een vast ankerpunt: niet verwijderen, niet omzetten.
create or replace function public.protect_default_company_document_folder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if tg_op = 'DELETE' then
    if old.is_default then
      raise exception 'De standaardmap kan niet worden verwijderd'
        using errcode = '23514';
    end if;
    return old;
  end if;

  if old.is_default is distinct from new.is_default then
    raise exception 'Welke map de standaardmap is, kan niet worden gewijzigd'
      using errcode = '23514';
  end if;
  return new;
end;
$fn$;

revoke all on function public.protect_default_company_document_folder() from public, anon, authenticated;

drop trigger if exists company_document_folders_protect_default on public.company_document_folders;
create trigger company_document_folders_protect_default
before update or delete on public.company_document_folders
for each row execute function public.protect_default_company_document_folder();

-- === 2. Zichtbaarheid =======================================================

-- Eén functie voor alle drie de lagen (map-RLS, document-RLS, opslag).
-- NULL (geen map) betekent "geen extra beperking": dat komt alleen voor bij
-- kandidaatdocumenten, want bedrijfsdocumenten krijgen via de trigger altijd
-- een map.
create or replace function public.can_view_company_document_folder(p_folder_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select case
    when p_folder_id is null then true
    when not public.is_internal_user() then false
    else exists (
      select 1
      from public.company_document_folders f
      where f.id = p_folder_id
        and f.organization_id = public.get_user_org_id()
        and (
          public.get_user_role() = 'admin'::public.user_role
          or public.get_user_role() = any (f.allowed_roles)
        )
        and (
          f.required_permission is null
          or public.has_role_permission(f.required_permission)
        )
    )
  end;
$fn$;

revoke all on function public.can_view_company_document_folder(uuid) from public, anon;
grant execute on function public.can_view_company_document_folder(uuid) to authenticated, service_role;

alter table public.company_document_folders enable row level security;

-- Lezen: alleen de mappen die je mag zien — ook een lege map blijft verborgen.
drop policy if exists company_document_folders_select_visible on public.company_document_folders;
create policy company_document_folders_select_visible on public.company_document_folders
  for select to authenticated
  using (
    organization_id = public.get_user_org_id()
    and public.is_internal_user()
    and public.can_view_company_document_folder(id)
  );

-- Beheren (incl. wie wat mag zien) hoort bij settings.manage, niet bij elke
-- interne rol: anders kan een intercedent zichzelf toegang tot Financieel geven.
drop policy if exists company_document_folders_insert_manage on public.company_document_folders;
create policy company_document_folders_insert_manage on public.company_document_folders
  for insert to authenticated
  with check (
    organization_id = public.get_user_org_id()
    and public.is_internal_user()
    and public.has_role_permission('settings.manage')
  );

drop policy if exists company_document_folders_update_manage on public.company_document_folders;
create policy company_document_folders_update_manage on public.company_document_folders
  for update to authenticated
  using (
    organization_id = public.get_user_org_id()
    and public.is_internal_user()
    and public.has_role_permission('settings.manage')
  )
  with check (
    organization_id = public.get_user_org_id()
    and public.is_internal_user()
    and public.has_role_permission('settings.manage')
  );

drop policy if exists company_document_folders_delete_manage on public.company_document_folders;
create policy company_document_folders_delete_manage on public.company_document_folders
  for delete to authenticated
  using (
    organization_id = public.get_user_org_id()
    and public.is_internal_user()
    and public.has_role_permission('settings.manage')
  );

-- === 3. documents: kolom, standaardmap-trigger, RLS ==========================

alter table public.documents
  add column if not exists company_document_folder_id uuid
    references public.company_document_folders(id);

comment on column public.documents.company_document_folder_id is
  'Map van een bedrijfsdocument (company_document_folders). Altijd gevuld voor documents.company_id (trigger vult de standaardmap in); altijd leeg voor kandidaatdocumenten.';

create index if not exists idx_documents_company_document_folder_id
  on public.documents (company_document_folder_id)
  where company_document_folder_id is not null;

-- De opslagcontrole zoekt de documentrij op via het objectpad.
create index if not exists idx_documents_company_file_path
  on public.documents (file_path)
  where company_id is not null;

create or replace function public.assign_default_company_document_folder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_folder_org uuid;
begin
  -- Kandidaatdocument: nooit een map.
  if new.company_id is null then
    new.company_document_folder_id := null;
    return new;
  end if;

  if new.company_document_folder_id is null then
    select f.id
      into new.company_document_folder_id
    from public.company_document_folders f
    where f.organization_id = new.organization_id
      and f.is_default
    limit 1;

    if new.company_document_folder_id is null then
      raise exception 'Deze organisatie heeft geen standaardmap voor documenten'
        using errcode = '23514';
    end if;
    return new;
  end if;

  -- Een map van een andere organisatie mag nooit aan een document hangen.
  select f.organization_id
    into v_folder_org
  from public.company_document_folders f
  where f.id = new.company_document_folder_id;

  if v_folder_org is distinct from new.organization_id then
    raise exception 'Documentmap hoort niet bij deze organisatie'
      using errcode = '23514';
  end if;
  return new;
end;
$fn$;

revoke all on function public.assign_default_company_document_folder() from public, anon, authenticated;

drop trigger if exists documents_default_company_folder on public.documents;
create trigger documents_default_company_folder
before insert or update of company_id, organization_id, company_document_folder_id on public.documents
for each row execute function public.assign_default_company_document_folder();

-- Policy-namen geverifieerd tegen de live DB (pg_policies, 2026-09-07):
-- tenant_select / tenant_insert / tenant_update / tenant_delete +
-- document_self_select / document_self_insert (portaal, ongemoeid) +
-- active_profile_required (restrictief, ongemoeid).
drop policy if exists tenant_select on public.documents;
create policy tenant_select on public.documents
  for select to authenticated
  using (
    organization_id = public.get_user_org_id()
    and (
      (candidate_id is not null and public.has_role_permission('candidates.view'))
      or (
        company_id is not null
        and public.is_internal_user()
        and public.can_view_company_document_folder(company_document_folder_id)
      )
    )
  );

-- tenant_insert stond op {public}; anon kwam daar toch nooit doorheen
-- (get_user_org_id() is dan NULL). Nu expliciet authenticated, en een
-- bedrijfsdocument kan alleen in een map die je zelf mag zien. De BEFORE-
-- trigger vult de standaardmap in vóórdat WITH CHECK wordt geëvalueerd.
drop policy if exists tenant_insert on public.documents;
create policy tenant_insert on public.documents
  for insert to authenticated
  with check (
    organization_id = public.get_user_org_id()
    and public.is_internal_user()
    and (
      company_id is null
      or public.can_view_company_document_folder(company_document_folder_id)
    )
  );

-- Bewerken (incl. verplaatsen naar een andere map): alleen documenten in een
-- zichtbare map, en alleen naar een zichtbare map.
drop policy if exists tenant_update on public.documents;
create policy tenant_update on public.documents
  for update to authenticated
  using (
    organization_id = public.get_user_org_id()
    and public.is_internal_user()
    and (
      company_id is null
      or public.can_view_company_document_folder(company_document_folder_id)
    )
  )
  with check (
    organization_id = public.get_user_org_id()
    and public.is_internal_user()
    and (
      company_id is null
      or public.can_view_company_document_folder(company_document_folder_id)
    )
  );

-- tenant_delete (admin-only) blijft ongewijzigd: admin ziet elke map.

-- === 4. Documenttypen: logische standaardmap =================================

alter table public.company_document_types
  add column if not exists default_folder_id uuid
    references public.company_document_folders(id) on delete set null;

comment on column public.company_document_types.default_folder_id is
  'Map die het uploadformulier voorstelt zodra dit type wordt gekozen. Leeg = de standaardmap van de organisatie.';

create index if not exists idx_company_document_types_default_folder_id
  on public.company_document_types (default_folder_id)
  where default_folder_id is not null;

-- Koppelt de geseedde typen aan hun logische map, alleen waar nog niets staat.
-- Wordt vanuit beide seeds aangeroepen zodat de volgorde van de twee
-- organisatie-triggers niet uitmaakt.
create or replace function public.link_default_company_document_folders(p_org_id uuid)
returns void
language sql
set search_path = ''
as $fn$
  update public.company_document_types t
     set default_folder_id = f.id
    from public.company_document_folders f
   where t.organization_id = p_org_id
     and f.organization_id = p_org_id
     and t.default_folder_id is null
     and f.key = case t.key
                   when 'contract' then 'contracten'
                   when 'financieel' then 'financieel'
                   when 'tekeningen' then 'technisch'
                   when 'inventarisatie_formulier' then 'technisch'
                 end;
$fn$;

revoke all on function public.link_default_company_document_folders(uuid) from public, anon, authenticated;

-- === 5. Seed: 4 mappen per organisatie ======================================

create or replace function public.seed_default_company_document_folders(p_org_id uuid)
returns void
language plpgsql
set search_path = ''
as $fn$
declare
  v_all public.user_role[] := array['admin', 'intercedent', 'backoffice', 'finance']::public.user_role[];
  v_has_default boolean;
begin
  select exists (
    select 1 from public.company_document_folders f
    where f.organization_id = p_org_id and f.is_default
  ) into v_has_default;

  insert into public.company_document_folders
    (organization_id, key, label, sort_order, is_default, allowed_roles, required_permission)
  values
    (p_org_id, 'algemeen',   'Algemeen',   10, not v_has_default, v_all, null),
    (p_org_id, 'contracten', 'Contracten', 20, false,             v_all, null),
    (p_org_id, 'technisch',  'Technisch',  30, false,             v_all, null),
    (p_org_id, 'financieel', 'Financieel', 40, false,             v_all, 'finance.view')
  on conflict (organization_id, key) do nothing;

  perform public.link_default_company_document_folders(p_org_id);
end;
$fn$;

revoke all on function public.seed_default_company_document_folders(uuid) from public, anon, authenticated;

-- De typen-seed uit #247 koppelt voortaan ook de standaardmap (additief).
create or replace function public.seed_default_company_document_types(p_org_id uuid)
returns void
language sql
set search_path = ''
as $fn$
  insert into public.company_document_types
    (organization_id, key, label, legacy_document_type, sort_order)
  values
    (p_org_id, 'contract', 'Contract / overeenkomst', 'contract', 10),
    (p_org_id, 'reglement', 'Reglement', 'reglement', 20),
    (p_org_id, 'certificaat', 'Certificaat', 'certificaat', 30),
    (p_org_id, 'inventarisatie_formulier', 'Inventarisatie-formulier', null, 40),
    (p_org_id, 'tekeningen', 'Tekeningen', null, 50),
    (p_org_id, 'financieel', 'Financieel', null, 60),
    (p_org_id, 'vacatures', 'Vacatures', null, 70),
    (p_org_id, 'overig', 'Overig', 'overig', 999)
  on conflict (organization_id, key) do nothing;
  select public.link_default_company_document_folders(p_org_id);
$fn$;

revoke all on function public.seed_default_company_document_types(uuid) from public, anon, authenticated;

create or replace function public.seed_default_company_document_folders_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  perform public.seed_default_company_document_folders(new.id);
  return new;
end;
$fn$;

revoke all on function public.seed_default_company_document_folders_trg() from public, anon, authenticated;

drop trigger if exists seed_default_company_document_folders_trg on public.organizations;
create trigger seed_default_company_document_folders_trg
  after insert on public.organizations
  for each row execute function public.seed_default_company_document_folders_trg();

-- === 6. Backfill ============================================================

select public.seed_default_company_document_folders(id) from public.organizations;

-- Elk bestaand bedrijfsdocument in de standaardmap van zijn organisatie.
update public.documents d
   set company_document_folder_id = f.id
  from public.company_document_folders f
 where d.company_id is not null
   and d.company_document_folder_id is null
   and f.organization_id = d.organization_id
   and f.is_default;

-- === 7. Opslag: map-check op bedrijfspaden =================================
-- Letterlijke live definitie (20260829132004) + de 'companies'-tak.

create or replace function private.can_access_storage_object(
  p_bucket text,
  p_name text,
  p_operation text,
  p_owner_id text default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_org_id uuid;
  v_role text;
  v_category text := split_part(p_name, '/', 2);
  v_subject text := split_part(p_name, '/', 3);
  v_candidate_direct boolean := false;
  v_candidate_service boolean := false;
  v_facility_write boolean := false;
  v_facility_read boolean := false;
begin
  if v_user_id is null
     or p_bucket not in ('documents', 'property-contracts')
     or p_operation not in ('select', 'insert', 'update', 'delete') then
    return false;
  end if;

  select p.organization_id, p.role::text
    into v_org_id, v_role
  from public.profiles p
  where p.id = v_user_id;

  if not found then
    return public.is_superadmin();
  end if;

  if v_role is null
     or not exists (
       select 1
       from public.profiles p
       where p.id = v_user_id
         and p.is_active is true
     ) then
    return false;
  end if;

  if split_part(p_name, '/', 1) <> v_org_id::text then
    return false;
  end if;

  if p_bucket = 'property-contracts' then
    if p_operation = 'select' then
      return v_role = any (array['admin', 'intercedent', 'backoffice', 'finance']);
    end if;
    if p_operation = 'insert' then
      return v_role = any (array['admin', 'intercedent', 'backoffice']);
    end if;
    return p_operation = 'delete' and v_role = 'admin';
  end if;

  -- Bedrijfsdocumenten (<org>/companies/<bedrijf>/...): de map van de
  -- documentrij bepaalt wie het bestand mag openen — dezelfde controle als de
  -- RLS op documents, zodat een signed URL niet om de weergave heen kan.
  -- Zonder documentrij (upload vóór registratie, of een verweesd object) geldt
  -- de bestaande regel: interne rollen, finance alleen lezend.
  if v_category = 'companies' then
    if p_operation = 'select' then
      if not (v_role = any (array['admin', 'intercedent', 'backoffice', 'finance'])) then
        return false;
      end if;
    elsif not (v_role = any (array['admin', 'intercedent', 'backoffice'])) then
      return false;
    end if;

    return not exists (
      select 1
      from public.documents d
      where d.organization_id = v_org_id
        and d.file_path = p_name
        and d.company_document_folder_id is not null
        and not public.can_view_company_document_folder(d.company_document_folder_id)
    );
  end if;

  v_facility_write := v_category = any (
    array['cleaning', 'inspections', 'damage']
  );
  v_facility_read := v_facility_write
    or v_category = any (array['checkin', 'vehicle-damage']);

  -- Existing internal roles retain the reads their screens rely on. Finance is
  -- read-only in Storage; mutation remains with operational staff.
  if p_operation = 'select'
     and v_role = any (array['admin', 'intercedent', 'backoffice', 'finance']) then
    return true;
  end if;
  if p_operation in ('insert', 'update', 'delete')
     and v_role = any (array['admin', 'intercedent', 'backoffice']) then
    return true;
  end if;

  -- Facility gets operational evidence only: never candidate folders, task
  -- attachments, vehicle fines or property contracts. Deletion stays admin/
  -- operational-staff only, matching the table policies.
  if v_role = 'facility' then
    if p_operation = 'select' then
      return v_facility_read;
    end if;
    return p_operation = 'insert' and v_facility_write;
  end if;

  if v_role <> 'medewerker' then
    return false;
  end if;

  -- Na een samenvoeging staat het bestand nog in de map van de kandidaat die
  -- verdween. De bewoner die overblijft moet er wel bij kunnen, dus telt ook een
  -- map die aantoonbaar in zijn eigen dossier is opgegaan als eigen map.
  select
    exists (
      select 1
      from public.candidates c
      where c.auth_user_id = v_user_id
        and c.organization_id = v_org_id
        and (
          c.id::text = v_category
          or exists (
            select 1
            from public.candidate_merges m
            where m.survivor_id = c.id
              and m.organization_id = v_org_id
              and m.loser_id::text = v_category
          )
        )
    ),
    exists (
      select 1
      from public.candidates c
      where c.auth_user_id = v_user_id
        and c.organization_id = v_org_id
        and v_category in ('candidates', 'candidate-signups')
        and (
          c.id::text = v_subject
          or exists (
            select 1
            from public.candidate_merges m
            where m.survivor_id = c.id
              and m.organization_id = v_org_id
              and m.loser_id::text = v_subject
          )
        )
    )
  into v_candidate_direct, v_candidate_service;

  -- Residents may read/upload their own candidate documents. Operational
  -- uploads are tied either to the new candidate-id path segment or to Storage's
  -- immutable owner_id for legacy app paths. They cannot update/delete objects.
  if p_operation = 'select' then
    return v_candidate_direct
      or v_candidate_service
      or (
        v_category = any (array['checkin', 'inspections', 'vehicle-damage'])
        and p_owner_id = v_user_id::text
      );
  end if;

  if p_operation = 'insert' then
    return v_candidate_direct
      or (
        v_category = any (array['checkin', 'inspections', 'vehicle-damage'])
        and (
          p_owner_id = v_user_id::text
          or exists (
            select 1
            from public.candidates c
            where c.auth_user_id = v_user_id
              and c.organization_id = v_org_id
              and c.id::text = v_subject
          )
        )
      );
  end if;

  return false;
end;
$$;
