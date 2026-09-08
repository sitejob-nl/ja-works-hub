-- Versioned, explicitly configured hour matrices. No CAO is guessed and no
-- persistent day classification, release, payroll export or messaging is enabled.
create schema if not exists private;

create table if not exists public.hours_matrices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  scope text not null check (scope in ('client', 'cao')),
  company_id uuid references public.companies(id),
  name text not null check (length(btrim(name)) between 1 and 200),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  check ((scope = 'client' and company_id is not null) or (scope = 'cao' and company_id is null)),
  unique (id, organization_id),
  unique (company_id)
);

create table if not exists public.hours_matrix_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  matrix_id uuid not null,
  version_number integer not null check (version_number > 0),
  status text not null default 'draft' check (status in ('draft', 'published')),
  revision integer not null default 1 check (revision > 0),
  valid_from date not null check (valid_from between date '0001-01-01' and date '9999-12-31'),
  valid_until date check (valid_until > valid_from and valid_until <= date '9999-12-31'),
  config jsonb not null,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  published_by uuid references public.profiles(id),
  published_at timestamptz,
  foreign key (matrix_id, organization_id) references public.hours_matrices(id, organization_id),
  unique (matrix_id, version_number),
  check ((status = 'draft' and published_by is null and published_at is null)
    or (status = 'published' and published_by is not null and published_at is not null))
);
create unique index if not exists hours_matrix_published_start_idx
  on public.hours_matrix_versions(matrix_id, valid_from) where status = 'published';

create table if not exists public.hours_company_cao_bindings (
  company_id uuid primary key references public.companies(id),
  organization_id uuid not null references public.organizations(id),
  cao_matrix_id uuid,
  version integer not null check (version > 0),
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (cao_matrix_id, organization_id) references public.hours_matrices(id, organization_id)
);
create table if not exists public.hours_company_cao_binding_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  organization_id uuid not null references public.organizations(id),
  cao_matrix_id uuid,
  version integer not null check (version > 0),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (cao_matrix_id, organization_id) references public.hours_matrices(id, organization_id),
  unique (company_id, version)
);

create index if not exists hours_matrices_org_idx on public.hours_matrices(organization_id);
create index if not exists hours_matrices_actor_idx on public.hours_matrices(created_by);
create index if not exists hours_matrix_versions_org_idx on public.hours_matrix_versions(organization_id);
create index if not exists hours_matrix_versions_scope_idx on public.hours_matrix_versions(matrix_id, organization_id);
create index if not exists hours_matrix_versions_creator_idx on public.hours_matrix_versions(created_by);
create index if not exists hours_matrix_versions_editor_idx on public.hours_matrix_versions(updated_by);
create index if not exists hours_matrix_versions_publisher_idx on public.hours_matrix_versions(published_by);
create index if not exists hours_cao_bindings_org_idx on public.hours_company_cao_bindings(organization_id);
create index if not exists hours_cao_bindings_matrix_idx on public.hours_company_cao_bindings(cao_matrix_id, organization_id);
create index if not exists hours_cao_bindings_actor_idx on public.hours_company_cao_bindings(updated_by);
create index if not exists hours_cao_history_org_idx on public.hours_company_cao_binding_history(organization_id);
create index if not exists hours_cao_history_matrix_idx on public.hours_company_cao_binding_history(cao_matrix_id, organization_id);
create index if not exists hours_cao_history_actor_idx on public.hours_company_cao_binding_history(created_by);

-- Exact, bounded JSON objects. Do not silently remove unsupported payroll rules.
create or replace function private.hours_matrix_exact_object(p_value jsonb, p_keys text[])
returns boolean language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p_value) = 'object'
    then p_value ?& p_keys and p_value - p_keys = '{}'::jsonb else false end
$$;
create or replace function private.hours_matrix_text(p_value jsonb)
returns boolean language sql immutable set search_path = '' as $$
  -- ECMAScript String.trim whitespace, matching hasText in the pure engine.
  select coalesce(jsonb_typeof(p_value) = 'string' and length(p_value #>> '{}') <= 200
    and length(btrim(p_value #>> '{}',
      U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')) > 0, false)
$$;

-- Mirrors HoursMatrixVersion schema 1 in _shared/hours-calculation.ts. Every
-- write, including a draft, validates the complete supported configuration.
create or replace function private.hours_validate_matrix_config(p_config jsonb)
returns void language plpgsql immutable set search_path = '' as $$
declare
  v_item jsonb; v_auto jsonb; v_rule jsonb; v_day jsonb;
  v_codes text[] := '{}'; v_ids text[] := '{}'; v_sources text[] := '{}';
  v_days integer[]; v_start integer; v_end integer; v_duration integer;
  v_minute integer; v_index integer; v_day_number integer;
  v_schedule boolean[] := array_fill(false, array[10080]);
begin
  if p_config is null or pg_column_size(p_config) > 131072
     or not private.hours_matrix_exact_object(p_config, array['schemaVersion','timeBasis','categories','categoryMappings','automaticRules'])
     or p_config->'schemaVersion' is distinct from '1'::jsonb
     or p_config->'timeBasis' is distinct from '"wall_clock"'::jsonb then
    raise exception 'Onbekende matrixinstellingen of niet ondersteunde schemaversie/tijdbasis' using errcode = '22023';
  end if;
  if jsonb_typeof(p_config->'categories') is distinct from 'array'
     or jsonb_typeof(p_config->'categoryMappings') is distinct from 'array' then
    raise exception 'Uurcodes en expliciete categorie-mappings zijn verplicht' using errcode = '22023';
  end if;
  if jsonb_array_length(p_config->'categories') not between 1 and 128
     or jsonb_array_length(p_config->'categoryMappings') > 256 then
    raise exception 'Ongeldig aantal uurcodes of categorie-mappings' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_config->'categories') loop
    if not private.hours_matrix_exact_object(v_item, array['code','factor'])
       or not private.hours_matrix_text(v_item->'code')
       or jsonb_typeof(v_item->'factor') is distinct from 'string' then
      raise exception 'Elke uurcode vereist een expliciete positieve factor als decimale tekst' using errcode = '22023';
    end if;
    if length(v_item->>'factor') > 20 or (v_item->>'factor') !~ '^[0-9]+(\.[0-9]+)?$' then
      raise exception 'Ongeldige uurfactor; gebruik positieve decimale tekst' using errcode = '22023';
    end if;
    if (v_item->>'factor')::numeric <= 0 or (v_item->>'code') = any(v_codes) then
      raise exception 'Uurcode is dubbel of factor is niet positief' using errcode = '22023';
    end if;
    v_codes := array_append(v_codes, v_item->>'code');
  end loop;
  for v_item in select value from jsonb_array_elements(p_config->'categoryMappings') loop
    if not private.hours_matrix_exact_object(v_item, array['id','sourceCode','categoryCode'])
       or not private.hours_matrix_text(v_item->'id') or not private.hours_matrix_text(v_item->'sourceCode')
       or jsonb_typeof(v_item->'categoryCode') is distinct from 'string' then
      raise exception 'Ongeldige categorie-mapping' using errcode = '22023';
    end if;
    if (v_item->>'id') = any(v_ids) or (v_item->>'sourceCode') = any(v_sources)
       or not (v_item->>'categoryCode') = any(v_codes) then
      raise exception 'Dubbele categorie-mapping of onbekende uurcode' using errcode = '22023';
    end if;
    v_ids := array_append(v_ids, v_item->>'id');
    v_sources := array_append(v_sources, v_item->>'sourceCode');
  end loop;
  v_auto := p_config->'automaticRules';
  if v_auto->>'kind' = 'explicit_only' and private.hours_matrix_exact_object(v_auto, array['kind']) then return; end if;
  if v_auto->>'kind' = 'flat' and private.hours_matrix_exact_object(v_auto, array['kind','rule']) then
    v_rule := v_auto->'rule';
    if not private.hours_matrix_exact_object(v_rule, array['id','categoryCode'])
       or not private.hours_matrix_text(v_rule->'id') or jsonb_typeof(v_rule->'categoryCode') is distinct from 'string' then
      raise exception 'Ongeldige vaste uurcoderegel' using errcode = '22023';
    end if;
    if (v_rule->>'id') = any(v_ids) or not (v_rule->>'categoryCode') = any(v_codes) then
      raise exception 'Dubbele regel-id of onbekende vaste uurcode' using errcode = '22023';
    end if;
    return;
  end if;
  if not private.hours_matrix_exact_object(v_auto, array['kind','rules'])
     or v_auto->>'kind' is distinct from 'time_windows' or jsonb_typeof(v_auto->'rules') is distinct from 'array' then
    raise exception 'Automatische indeling of samenloop wordt niet ondersteund' using errcode = '22023';
  end if;
  if jsonb_array_length(v_auto->'rules') not between 1 and 128 then
    raise exception 'Leg ten minste één en maximaal 128 tijdvensters vast' using errcode = '22023';
  end if;
  for v_rule in select value from jsonb_array_elements(v_auto->'rules') loop
    if not private.hours_matrix_exact_object(v_rule, array['id','categoryCode','daysOfWeek','start','end'])
       or not private.hours_matrix_text(v_rule->'id') or jsonb_typeof(v_rule->'categoryCode') is distinct from 'string'
       or jsonb_typeof(v_rule->'daysOfWeek') is distinct from 'array'
       or jsonb_typeof(v_rule->'start') is distinct from 'string' or jsonb_typeof(v_rule->'end') is distinct from 'string' then
      raise exception 'Ongeldig tijdvenster' using errcode = '22023';
    end if;
    if (v_rule->>'id') = any(v_ids) or not (v_rule->>'categoryCode') = any(v_codes)
       or jsonb_array_length(v_rule->'daysOfWeek') not between 1 and 7
       or (v_rule->>'start') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or (v_rule->>'end') !~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$' then
      raise exception 'Tijdvenster heeft ongeldige of dubbele regels, uurcodes, tijden of weekdagen' using errcode = '22023';
    end if;
    v_ids := array_append(v_ids, v_rule->>'id');
    v_days := '{}';
    v_start := substring(v_rule->>'start', 1, 2)::integer * 60 + substring(v_rule->>'start', 4, 2)::integer;
    v_end := substring(v_rule->>'end', 1, 2)::integer * 60 + substring(v_rule->>'end', 4, 2)::integer;
    if v_start = v_end then raise exception 'Gelijke tijden zijn ambigu; gebruik 00:00 tot 24:00 voor een hele dag' using errcode = '22023'; end if;
    v_duration := case when v_end > v_start then v_end - v_start else 1440 - v_start + v_end end;
    for v_day in select value from jsonb_array_elements(v_rule->'daysOfWeek') loop
      if jsonb_typeof(v_day) is distinct from 'number' then raise exception 'Weekdag moet een geheel getal van 1 tot 7 zijn' using errcode = '22023'; end if;
      if (v_day #>> '{}')::numeric not between 1 and 7 or (v_day #>> '{}')::numeric <> trunc((v_day #>> '{}')::numeric) then
        raise exception 'Weekdag moet een geheel getal van 1 tot 7 zijn' using errcode = '22023';
      end if;
      v_day_number := (v_day #>> '{}')::numeric::integer;
      if v_day_number = any(v_days) then raise exception 'Dubbele weekdag in tijdvenster' using errcode = '22023'; end if;
      v_days := array_append(v_days, v_day_number);
      for v_minute in 0..v_duration - 1 loop
        v_index := ((v_day_number - 1) * 1440 + v_start + v_minute) % 10080 + 1;
        if v_schedule[v_index] then raise exception 'Tijdvensters overlappen; samenloop is niet ondersteund' using errcode = '22023'; end if;
        v_schedule[v_index] := true;
      end loop;
    end loop;
  end loop;
end $$;

-- Identity and history remain immutable even for a privileged direct SQL write.
create or replace function private.hours_matrix_identity_guard()
returns trigger language plpgsql set search_path = '' as $$ begin
  if tg_op <> 'INSERT' then raise exception 'Matrixidentiteit is onveranderlijk' using errcode = '42501'; end if;
  if new.scope = 'client' and not exists (select 1 from public.companies where id = new.company_id and organization_id = new.organization_id) then
    raise exception 'Opdrachtgever hoort niet bij deze organisatie' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists hours_matrix_identity_guard on public.hours_matrices;
create trigger hours_matrix_identity_guard before insert or update or delete on public.hours_matrices
  for each row execute function private.hours_matrix_identity_guard();

create or replace function private.hours_matrix_version_guard()
returns trigger language plpgsql set search_path = '' as $$
declare v_latest date; begin
  if tg_op = 'DELETE' then raise exception 'Matrixversies blijven bewaard' using errcode = '42501'; end if;
  if tg_op = 'UPDATE' then
    if old.status = 'published' then raise exception 'Een gepubliceerde matrixversie is onveranderlijk' using errcode = '42501'; end if;
    if (new.id, new.organization_id, new.matrix_id, new.version_number, new.created_by, new.created_at)
       is distinct from (old.id, old.organization_id, old.matrix_id, old.version_number, old.created_by, old.created_at) then
      raise exception 'Matrixversie-identiteit is onveranderlijk' using errcode = '42501';
    end if;
  end if;
  perform private.hours_validate_matrix_config(new.config);
  -- All RPCs take this same parent lock before touching a version. This is the
  -- serialization point for draft numbering and the published timeline.
  perform 1 from public.hours_matrices where id = new.matrix_id and organization_id = new.organization_id for update;
  if not found then raise exception 'Matrix hoort niet bij deze organisatie' using errcode = '42501'; end if;
  if new.status = 'published' then
    select max(valid_from) into v_latest from public.hours_matrix_versions where matrix_id = new.matrix_id and status = 'published' and id <> new.id;
    if v_latest is not null and (new.valid_from <= v_latest or new.valid_from < (now() at time zone 'Europe/Amsterdam')::date) then
      raise exception 'Een opvolger begint na de laatste gepubliceerde startdatum en niet vóór vandaag' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists hours_matrix_version_guard on public.hours_matrix_versions;
create trigger hours_matrix_version_guard before insert or update or delete on public.hours_matrix_versions
  for each row execute function private.hours_matrix_version_guard();

create or replace function private.hours_cao_binding_guard()
returns trigger language plpgsql set search_path = '' as $$ begin
  if not exists (select 1 from public.companies where id = new.company_id and organization_id = new.organization_id) then
    raise exception 'Opdrachtgever hoort niet bij deze organisatie' using errcode = '42501';
  end if;
  if new.cao_matrix_id is not null and not exists (select 1 from public.hours_matrices where id = new.cao_matrix_id and organization_id = new.organization_id and scope = 'cao') then
    raise exception 'Kies een CAO-matrix uit de eigen organisatie' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists hours_cao_binding_guard on public.hours_company_cao_bindings;
create trigger hours_cao_binding_guard before insert or update on public.hours_company_cao_bindings
  for each row execute function private.hours_cao_binding_guard();
drop trigger if exists hours_cao_binding_guard on public.hours_company_cao_binding_history;
create trigger hours_cao_binding_guard before insert on public.hours_company_cao_binding_history
  for each row execute function private.hours_cao_binding_guard();
drop trigger if exists hours_history_immutable on public.hours_company_cao_binding_history;
create trigger hours_history_immutable before update or delete on public.hours_company_cao_binding_history
  for each row execute function private.hours_history_immutable();

do $$ declare t text; begin
  foreach t in array array['hours_matrices','hours_matrix_versions','hours_company_cao_bindings','hours_company_cao_binding_history'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists hours_internal_read on public.%I', t);
    execute format('create policy hours_internal_read on public.%I for select to authenticated using (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user()) and ((select public.has_role_permission(''finance.view'')) or (select public.has_role_permission(''finance.manage''))))', t);
  end loop;
end $$;

create or replace function public.hours_list_matrices(p_company_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.hours_require_internal(false); v_rows jsonb; begin
  if p_company_id is not null and not exists (select 1 from public.companies where id = p_company_id and organization_id = v_org) then
    raise exception 'Opdrachtgever niet beschikbaar' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'scope', m.scope, 'company_id', m.company_id,
    'company_name', c.name, 'version_count', (select count(*) from public.hours_matrix_versions where matrix_id = m.id),
    'published_version_count', (select count(*) from public.hours_matrix_versions where matrix_id = m.id and status = 'published')) order by m.scope, m.name, m.id), '[]'::jsonb)
    into v_rows from public.hours_matrices m left join public.companies c on c.id = m.company_id and c.organization_id = m.organization_id
    where m.organization_id = v_org and (p_company_id is null or m.scope = 'cao' or m.company_id = p_company_id);
  return jsonb_build_object('matrices', v_rows, 'can_manage', public.has_role_permission('finance.manage'));
end $$;

create or replace function public.hours_get_matrix(p_matrix_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.hours_require_internal(false); v_matrix public.hours_matrices%rowtype; v_versions jsonb; v_company_name text; begin
  select * into v_matrix from public.hours_matrices where id = p_matrix_id and organization_id = v_org;
  if not found then raise exception 'Matrix niet beschikbaar' using errcode = '42501'; end if;
  select name into v_company_name from public.companies where id = v_matrix.company_id and organization_id = v_org;
  select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'matrix_id', v.matrix_id, 'version_number', v.version_number,
    'status', v.status, 'revision', v.revision, 'valid_from', v.valid_from, 'valid_until', v.valid_until,
    'effective_valid_until', v.effective_until, 'created_at', v.created_at, 'updated_at', v.updated_at,
    'published_at', v.published_at, 'published_by', v.published_by,
    'definition', v.config || jsonb_build_object('id', v.id, 'scope', v_matrix.scope, 'validFrom', v.valid_from,
      'validUntil', v.effective_until, 'confirmed', v.status = 'published'),
    'published_definition', case when v.status = 'published' then v.config || jsonb_build_object('id', v.id,
      'scope', v_matrix.scope, 'validFrom', v.valid_from, 'validUntil', v.valid_until, 'confirmed', true) else null end
    ) order by v.version_number desc), '[]'::jsonb) into v_versions
  from (select x.*, case when x.status = 'published' then least(x.valid_until,
      (select min(n.valid_from) from public.hours_matrix_versions n where n.matrix_id = x.matrix_id and n.status = 'published' and n.valid_from > x.valid_from))
      else x.valid_until end as effective_until from public.hours_matrix_versions x where x.matrix_id = p_matrix_id and x.organization_id = v_org) v;
  return jsonb_build_object('id', v_matrix.id, 'name', v_matrix.name, 'scope', v_matrix.scope, 'company_id', v_matrix.company_id,
    'company_name', v_company_name, 'version_count', jsonb_array_length(v_versions),
    'published_version_count', (select count(*) from public.hours_matrix_versions where matrix_id = p_matrix_id and status = 'published'),
    'versions', v_versions, 'can_manage', public.has_role_permission('finance.manage'));
end $$;

create or replace function public.hours_create_matrix(p_scope text, p_company_id uuid, p_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.hours_require_internal(true); v_id uuid; begin
  p_name := nullif(btrim(p_name), '');
  if p_scope is null or p_scope not in ('client','cao') or p_name is null or length(p_name) > 200
     or (p_scope = 'client' and p_company_id is null) or (p_scope = 'cao' and p_company_id is not null) then
    raise exception 'Kies de bron, opdrachtgever en een naam voor deze matrix' using errcode = '22023';
  end if;
  if p_scope = 'client' then
    perform 1 from public.companies where id = p_company_id and organization_id = v_org for update;
    if not found then raise exception 'Opdrachtgever niet beschikbaar' using errcode = '42501'; end if;
    if exists (select 1 from public.hours_matrices where company_id = p_company_id) then
      raise exception 'Deze opdrachtgever heeft al een klantmatrix; voeg daar een versie toe' using errcode = '22023';
    end if;
  end if;
  insert into public.hours_matrices(organization_id, scope, company_id, name, created_by)
    values (v_org, p_scope, p_company_id, p_name, auth.uid()) returning id into v_id;
  return public.hours_get_matrix(v_id);
end $$;

create or replace function private.hours_matrix_check_period(p_valid_from date, p_valid_until date)
returns void language plpgsql immutable set search_path = '' as $$ begin
  if p_valid_from is null or p_valid_from not between date '0001-01-01' and date '9999-12-31'
     or (p_valid_until is not null and (p_valid_until <= p_valid_from or p_valid_until > date '9999-12-31')) then
    raise exception 'Geef een geldige startdatum en optionele latere exclusieve einddatum' using errcode = '22023';
  end if;
end $$;

create or replace function public.hours_create_matrix_draft(p_matrix_id uuid, p_valid_from date, p_valid_until date, p_config jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.hours_require_internal(true); v_number integer; begin
  perform 1 from public.hours_matrices where id = p_matrix_id and organization_id = v_org for update;
  if not found then raise exception 'Matrix niet beschikbaar' using errcode = '42501'; end if;
  perform private.hours_matrix_check_period(p_valid_from, p_valid_until);
  perform private.hours_validate_matrix_config(p_config);
  select coalesce(max(version_number), 0) + 1 into v_number from public.hours_matrix_versions where matrix_id = p_matrix_id;
  insert into public.hours_matrix_versions(organization_id, matrix_id, version_number, valid_from, valid_until, config, created_by, updated_by)
    values (v_org, p_matrix_id, v_number, p_valid_from, p_valid_until, p_config, auth.uid(), auth.uid());
  return public.hours_get_matrix(p_matrix_id);
end $$;

create or replace function private.hours_lock_matrix_version(p_version_id uuid)
returns public.hours_matrix_versions language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.hours_require_internal(true); v_matrix uuid; v_version public.hours_matrix_versions%rowtype; begin
  select matrix_id into v_matrix from public.hours_matrix_versions where id = p_version_id and organization_id = v_org;
  if not found then raise exception 'Matrixversie niet beschikbaar' using errcode = '42501'; end if;
  perform 1 from public.hours_matrices where id = v_matrix and organization_id = v_org for update;
  select * into v_version from public.hours_matrix_versions where id = p_version_id and organization_id = v_org for update;
  return v_version;
end $$;

create or replace function public.hours_save_matrix_draft(p_version_id uuid, p_expected_revision integer, p_valid_from date, p_valid_until date, p_config jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_version public.hours_matrix_versions%rowtype := private.hours_lock_matrix_version(p_version_id); begin
  if v_version.status <> 'draft' then raise exception 'Een gepubliceerde versie kan niet worden gewijzigd' using errcode = '42501'; end if;
  if p_expected_revision is null or v_version.revision <> p_expected_revision then raise exception 'Matrixconcept is gewijzigd; laad opnieuw' using errcode = '40001'; end if;
  perform private.hours_matrix_check_period(p_valid_from, p_valid_until);
  perform private.hours_validate_matrix_config(p_config);
  if (v_version.valid_from, v_version.valid_until, v_version.config) is not distinct from (p_valid_from, p_valid_until, p_config) then
    return public.hours_get_matrix(v_version.matrix_id);
  end if;
  update public.hours_matrix_versions set valid_from = p_valid_from, valid_until = p_valid_until, config = p_config,
    revision = revision + 1, updated_by = auth.uid(), updated_at = clock_timestamp() where id = p_version_id;
  return public.hours_get_matrix(v_version.matrix_id);
end $$;

create or replace function public.hours_publish_matrix_version(p_version_id uuid, p_expected_revision integer, p_confirmed boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_version public.hours_matrix_versions%rowtype := private.hours_lock_matrix_version(p_version_id); begin
  if p_confirmed is not true then raise exception 'Bevestig de exacte opgeslagen matrixversie vóór publicatie' using errcode = '22023'; end if;
  if p_expected_revision is null or v_version.revision <> p_expected_revision then raise exception 'Matrixconcept is gewijzigd; laad opnieuw' using errcode = '40001'; end if;
  -- An exact retry of a successful publish is harmless. Confirmation belongs to
  -- this immutable revision, not to arbitrary browser-supplied configuration.
  if v_version.status = 'published' then return public.hours_get_matrix(v_version.matrix_id); end if;
  perform private.hours_validate_matrix_config(v_version.config);
  update public.hours_matrix_versions set status = 'published', published_by = auth.uid(),
    published_at = clock_timestamp(), updated_by = auth.uid(), updated_at = clock_timestamp() where id = p_version_id;
  return public.hours_get_matrix(v_version.matrix_id);
end $$;

create or replace function public.hours_get_company_matrix_binding(p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.hours_require_internal(false); v_binding public.hours_company_cao_bindings%rowtype; begin
  if not exists (select 1 from public.companies where id = p_company_id and organization_id = v_org) then
    raise exception 'Opdrachtgever niet beschikbaar' using errcode = '42501';
  end if;
  select * into v_binding from public.hours_company_cao_bindings where company_id = p_company_id and organization_id = v_org;
  return jsonb_build_object('company_id', p_company_id, 'version', coalesce(v_binding.version, 0),
    'cao_matrix_id', v_binding.cao_matrix_id, 'can_manage', public.has_role_permission('finance.manage'));
end $$;

create or replace function public.hours_set_company_matrix_binding(p_company_id uuid, p_expected_version integer, p_cao_matrix_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.hours_require_internal(true); v_binding public.hours_company_cao_bindings%rowtype; v_next integer; begin
  perform 1 from public.companies where id = p_company_id and organization_id = v_org for update;
  if not found then raise exception 'Opdrachtgever niet beschikbaar' using errcode = '42501'; end if;
  if p_cao_matrix_id is not null and not exists (select 1 from public.hours_matrices where id = p_cao_matrix_id and organization_id = v_org and scope = 'cao') then
    raise exception 'Kies een CAO-matrix uit de eigen organisatie' using errcode = '42501';
  end if;
  select * into v_binding from public.hours_company_cao_bindings where company_id = p_company_id and organization_id = v_org for update;
  if p_expected_version is null or coalesce(v_binding.version, 0) <> p_expected_version then raise exception 'CAO-koppeling is gewijzigd; laad opnieuw' using errcode = '40001'; end if;
  if v_binding.version is not null and v_binding.cao_matrix_id is not distinct from p_cao_matrix_id then
    return public.hours_get_company_matrix_binding(p_company_id);
  end if;
  v_next := coalesce(v_binding.version, 0) + 1;
  insert into public.hours_company_cao_bindings(company_id, organization_id, cao_matrix_id, version, updated_by)
    values (p_company_id, v_org, p_cao_matrix_id, v_next, auth.uid())
    on conflict (company_id) do update set cao_matrix_id = excluded.cao_matrix_id, version = excluded.version,
      updated_by = excluded.updated_by, updated_at = clock_timestamp();
  insert into public.hours_company_cao_binding_history(company_id, organization_id, cao_matrix_id, version, created_by)
    values (p_company_id, v_org, p_cao_matrix_id, v_next, auth.uid());
  return public.hours_get_company_matrix_binding(p_company_id);
end $$;

-- No portal definition access and no anon/service-key write shortcut. Private
-- helpers are callable only through owner-executed, profile-checked public RPCs.
do $$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname in ('hours_matrix_exact_object','hours_matrix_text','hours_validate_matrix_config',
      'hours_matrix_identity_guard','hours_matrix_version_guard','hours_cao_binding_guard','hours_matrix_check_period','hours_lock_matrix_version') loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('hours_list_matrices','hours_get_matrix','hours_create_matrix','hours_create_matrix_draft',
      'hours_save_matrix_draft','hours_publish_matrix_version','hours_get_company_matrix_binding','hours_set_company_matrix_binding') loop
    execute format('revoke all on function %s from public, anon, service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

comment on table public.hours_matrix_versions is 'Published config and original validity immutable. Effective end is min(original end, next published start). Append-only publication timeline, no payroll release.';
comment on table public.hours_company_cao_bindings is 'Explicit current CAO selection only. Not inferred from industry, matrix name or other employers. Future persisted classification must snapshot the chosen version and binding.';
notify pgrst, 'reload schema';
