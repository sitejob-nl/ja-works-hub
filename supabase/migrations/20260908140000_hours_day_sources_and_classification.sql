-- Immutable source facts and a trusted, revision-bound classification boundary.
-- No payroll release, export, communication or inferred CAO/rounding rules.
alter table public.hours_day_revisions add column if not exists source_input jsonb;

create or replace function private.hours_source_trim(p_value text)
returns text language sql immutable set search_path = '' as $$
  select btrim(p_value,
    U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
$$;
create or replace function private.hours_source_clock(p_value jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(jsonb_typeof(p_value) = 'string'
    and (p_value #>> '{}') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$', false)
$$;
create or replace function private.hours_source_minutes(p_value jsonb, p_max integer default 1440)
returns boolean language plpgsql immutable set search_path = '' as $$ begin
  if jsonb_typeof(p_value) is distinct from 'number' then return false; end if;
  return (p_value #>> '{}')::numeric between 0 and p_max
    and (p_value #>> '{}')::numeric = trunc((p_value #>> '{}')::numeric);
end $$;

-- Structural validation only: wrong totals, duplicate source categories,
-- overlapping shifts/breaks and breaks outside a shift remain observable facts.
create or replace function private.hours_validate_source_input(p_input jsonb)
returns void language plpgsql immutable set search_path = '' as $$
declare v_shift jsonb; v_break jsonb; v_category jsonb; begin
  if p_input is null then return; end if;
  if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'Ongeldige brongegevens' using errcode = '22023'; end if;
  if pg_column_size(p_input) > 65536 or p_input - array['schemaVersion','shifts','categories'] <> '{}'::jsonb
     or p_input->'schemaVersion' is distinct from '1'::jsonb then
    raise exception 'Onbekende bronvelden of bronversie' using errcode = '22023';
  end if;
  if p_input ? 'shifts' then
    if jsonb_typeof(p_input->'shifts') is distinct from 'array' then raise exception 'Diensten moeten een lijst zijn' using errcode = '22023'; end if;
    if jsonb_array_length(p_input->'shifts') > 32 then raise exception 'Maximaal 32 diensten per dag' using errcode = '22023'; end if;
    for v_shift in select value from jsonb_array_elements(p_input->'shifts') loop
      if not private.hours_matrix_exact_object(v_shift, array['start','end','endDayOffset','breaks'])
         or not private.hours_source_clock(v_shift->'start') or not private.hours_source_clock(v_shift->'end')
         or not private.hours_source_minutes(v_shift->'endDayOffset', 1)
         or jsonb_typeof(v_shift->'breaks') is distinct from 'array' then
        raise exception 'Dienst vereist tijden, expliciete dagovergang en pauzelijst' using errcode = '22023';
      end if;
      if jsonb_array_length(v_shift->'breaks') > 32 then raise exception 'Maximaal 32 pauzes per dienst' using errcode = '22023'; end if;
      for v_break in select value from jsonb_array_elements(v_shift->'breaks') loop
        if jsonb_typeof(v_break) is distinct from 'object' then raise exception 'Ongeldige pauze' using errcode = '22023'; end if;
        if v_break - array['start','end','startDayOffset','endDayOffset'] <> '{}'::jsonb
           or not private.hours_source_clock(v_break->'start') or not private.hours_source_clock(v_break->'end')
           or (v_break ? 'startDayOffset' and not private.hours_source_minutes(v_break->'startDayOffset', 1))
           or (v_break ? 'endDayOffset' and not private.hours_source_minutes(v_break->'endDayOffset', 1)) then
          raise exception 'Ongeldige pauzetijden of dagovergang' using errcode = '22023';
        end if;
      end loop;
    end loop;
  end if;
  if p_input ? 'categories' then
    if jsonb_typeof(p_input->'categories') is distinct from 'array' then raise exception 'Broncategorieën moeten een lijst zijn' using errcode = '22023'; end if;
    if jsonb_array_length(p_input->'categories') > 256 then raise exception 'Maximaal 256 broncategorieën per dag' using errcode = '22023'; end if;
    for v_category in select value from jsonb_array_elements(p_input->'categories') loop
      if not private.hours_matrix_exact_object(v_category, array['sourceCode','minutes'])
         or not private.hours_matrix_text(v_category->'sourceCode')
         or not private.hours_source_minutes(v_category->'minutes') then
        raise exception 'Broncategorie vereist een code en gehele minuten van 0 tot 1440' using errcode = '22023';
      end if;
    end loop;
  end if;
end $$;
create or replace function private.hours_source_input_guard()
returns trigger language plpgsql set search_path = '' as $$ begin
  perform private.hours_validate_source_input(new.source_input);
  return new;
end $$;
drop trigger if exists hours_source_input_guard on public.hours_day_revisions;
create trigger hours_source_input_guard before insert on public.hours_day_revisions
  for each row execute function private.hours_source_input_guard();

create table if not exists public.hours_day_matrix_basis (
  day_id uuid primary key,
  organization_id uuid not null references public.organizations(id),
  first_revision_id uuid not null,
  matrix_id uuid not null,
  matrix_version_id uuid not null references public.hours_matrix_versions(id),
  matrix_name text not null,
  scope text not null check (scope in ('client','cao')),
  definition jsonb not null,
  original_definition jsonb not null,
  binding_snapshot jsonb not null,
  selection_snapshot jsonb not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (day_id, organization_id) references public.hours_days(id, organization_id),
  foreign key (first_revision_id, day_id, organization_id) references public.hours_day_revisions(id, day_id, organization_id),
  foreign key (matrix_id, organization_id) references public.hours_matrices(id, organization_id)
);
create table if not exists public.hours_day_classifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  day_id uuid not null,
  revision_id uuid not null,
  context_hash text not null check (context_hash ~ '^[0-9a-f]{64}$'),
  engine_version text not null check (engine_version = 'hours-calculation-v1'),
  status text not null check (status in ('classified','blocked','no_hours')),
  matrix_version_id uuid references public.hours_matrix_versions(id),
  matrix_name text,
  matrix_scope text check (matrix_scope in ('client','cao')),
  input_snapshot jsonb not null,
  context_snapshot jsonb not null,
  matrix_snapshot jsonb,
  original_matrix_snapshot jsonb,
  binding_snapshot jsonb not null,
  allocations jsonb not null,
  issues jsonb not null,
  result jsonb not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (revision_id, day_id, organization_id) references public.hours_day_revisions(id, day_id, organization_id),
  unique (revision_id, context_hash, engine_version)
);
create index if not exists hours_day_basis_org_idx on public.hours_day_matrix_basis(organization_id);
create index if not exists hours_day_basis_revision_idx on public.hours_day_matrix_basis(first_revision_id, day_id, organization_id);
create index if not exists hours_day_basis_matrix_idx on public.hours_day_matrix_basis(matrix_id, organization_id);
create index if not exists hours_day_basis_matrix_version_idx on public.hours_day_matrix_basis(matrix_version_id);
create index if not exists hours_day_basis_actor_idx on public.hours_day_matrix_basis(created_by);
create index if not exists hours_classifications_org_idx on public.hours_day_classifications(organization_id);
create index if not exists hours_classifications_revision_idx on public.hours_day_classifications(revision_id, day_id, organization_id, created_at desc, id desc);
create index if not exists hours_classifications_day_idx on public.hours_day_classifications(day_id);
create index if not exists hours_classifications_matrix_idx on public.hours_day_classifications(matrix_version_id);
create index if not exists hours_classifications_actor_idx on public.hours_day_classifications(created_by);
do $$ declare t text; begin
  foreach t in array array['hours_day_matrix_basis','hours_day_classifications'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists hours_internal_read on public.%I', t);
    execute format('create policy hours_internal_read on public.%I for select to authenticated using (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user()) and ((select public.has_role_permission(''finance.view'')) or (select public.has_role_permission(''finance.manage''))))', t);
    execute format('drop trigger if exists hours_history_immutable on public.%I', t);
    execute format('create trigger hours_history_immutable before update or delete on public.%I for each row execute function private.hours_history_immutable()', t);
  end loop;
end $$;

create or replace function private.hours_classification_summary(p_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', x.id, 'revision_id', x.revision_id, 'status', x.status,
    'matrix_version_id', x.matrix_version_id, 'matrix_name', x.matrix_name, 'matrix_scope', x.matrix_scope,
    'engine_version', x.engine_version, 'created_at', x.created_at, 'allocations', x.allocations, 'issues', x.issues,
    'basis_pinned', exists (select 1 from public.hours_day_matrix_basis b where b.day_id = x.day_id))
  from public.hours_day_classifications x where x.id = p_id
$$;

create or replace function public.hours_save_day_source(p_day_id uuid, p_expected_revision_id uuid, p_minutes integer,
  p_no_hours_reason text, p_note text, p_source_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_day public.hours_days%rowtype; v_old public.hours_day_revisions%rowtype; v_revision uuid; begin
  v_day := private.hours_lock_day(p_day_id, true);
  if v_day.current_revision_id is distinct from p_expected_revision_id then raise exception 'Uren zijn gewijzigd; laad opnieuw' using errcode = '40001'; end if;
  p_no_hours_reason := nullif(private.hours_source_trim(p_no_hours_reason), ''); p_note := nullif(private.hours_source_trim(p_note), '');
  if p_minutes is null or p_minutes not between 0 and 1440 or (p_minutes = 0 and p_no_hours_reason is null)
     or (p_minutes > 0 and p_no_hours_reason is not null) or length(p_no_hours_reason) > 500 or length(p_note) > 2000 then
    raise exception 'Vul geldige minuten in; nul uren vereist een reden' using errcode = '22023';
  end if;
  perform private.hours_validate_source_input(p_source_input);
  select * into v_old from public.hours_day_revisions where id = v_day.current_revision_id;
  if found and (v_old.minutes, v_old.no_hours_reason, v_old.note, v_old.source_input)
     is not distinct from (p_minutes, p_no_hours_reason, p_note, p_source_input) then
    return public.hours_get_week(v_day.week_id);
  end if;
  insert into public.hours_day_revisions(organization_id, day_id, revision_number, minutes, no_hours_reason,
    note, source_references, source_input, created_by)
    values (v_day.organization_id, v_day.id, coalesce(v_old.revision_number, 0) + 1, p_minutes, p_no_hours_reason,
      p_note, '[{"kind":"manual","label":"Handmatige invoer"}]'::jsonb, p_source_input, auth.uid()) returning id into v_revision;
  update public.hours_days set current_revision_id = v_revision where id = v_day.id;
  return public.hours_get_week(v_day.week_id);
end $$;

create or replace function public.hours_save_day(p_day_id uuid, p_expected_revision_id uuid, p_minutes integer, p_no_hours_reason text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_day public.hours_days%rowtype; begin
  v_day := private.hours_lock_day(p_day_id, true);
  if v_day.current_revision_id is distinct from p_expected_revision_id then raise exception 'Uren zijn gewijzigd; laad opnieuw' using errcode = '40001'; end if;
  if exists (select 1 from public.hours_day_revisions where id = v_day.current_revision_id and source_input is not null) then
    raise exception 'Deze dag bevat brongegevens; gebruik het volledige bronformulier om ze expliciet te wijzigen' using errcode = '22023';
  end if;
  return public.hours_save_day_source(p_day_id, p_expected_revision_id, p_minutes, p_no_hours_reason, p_note, null);
end $$;

-- Context reads are short transactions with the same lock order as finalization:
-- week -> day -> company -> selected matrix registers ordered by UUID.
create or replace function private.hours_build_classification_context(p_day_id uuid, p_expected_revision_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_day public.hours_days%rowtype; v_revision public.hours_day_revisions%rowtype;
  v_basis public.hours_day_matrix_basis%rowtype; v_company uuid; v_matrix record;
  v_binding jsonb; v_detail jsonb; v_version jsonb; v_source jsonb;
  v_sources jsonb := '[]'; v_clients jsonb := '[]'; v_caos jsonb := '[]';
  v_pinned jsonb; v_selection jsonb; v_material jsonb; v_hash text;
begin
  v_day := private.hours_lock_day(p_day_id, true);
  if p_expected_revision_id is null or v_day.current_revision_id is distinct from p_expected_revision_id then
    raise exception 'Uren zijn gewijzigd of ontbreken; laad opnieuw' using errcode = '40001';
  end if;
  select * into v_revision from public.hours_day_revisions where id = p_expected_revision_id and organization_id = v_day.organization_id;
  select company_id into v_company from public.hours_weeks where id = v_day.week_id and organization_id = v_day.organization_id;
  perform 1 from public.companies where id = v_company and organization_id = v_day.organization_id for update;
  if not found then raise exception 'Opdrachtgever niet beschikbaar' using errcode = '42501'; end if;
  -- Settings edits share the company lock; recheck after acquiring it.
  if not exists (select 1 from public.hours_company_settings where company_id = v_company and organization_id = v_day.organization_id and enabled) then
    raise exception 'Nieuwe urenwerkwijze staat uit voor deze opdrachtgever' using errcode = '22023';
  end if;
  select * into v_basis from public.hours_day_matrix_basis where day_id = p_day_id and organization_id = v_day.organization_id;
  if found then
    v_binding := v_basis.binding_snapshot;
    v_pinned := jsonb_build_object('matrix_id', v_basis.matrix_id, 'matrix_name', v_basis.matrix_name,
      'matrix_version_id', v_basis.matrix_version_id, 'scope', v_basis.scope, 'definition', v_basis.definition,
      'original_definition', v_basis.original_definition, 'binding_snapshot', v_basis.binding_snapshot);
    v_sources := jsonb_build_array(v_pinned);
    if v_basis.scope = 'client' then v_clients := jsonb_build_array(v_basis.definition);
    else v_caos := jsonb_build_array(v_basis.definition); end if;
    -- Keep the original selection material in the hash. First pinning therefore
    -- does not turn a successful request's immediate retry into a new attempt.
    v_selection := v_basis.selection_snapshot;
  else
    v_binding := public.hours_get_company_matrix_binding(v_company) - 'can_manage';
    for v_matrix in select id, scope from public.hours_matrices
      where organization_id = v_day.organization_id
        and (company_id = v_company or id = (v_binding->>'cao_matrix_id')::uuid)
      order by id for update loop
      v_detail := public.hours_get_matrix(v_matrix.id);
      for v_version in select value from jsonb_array_elements(v_detail->'versions')
        where value->>'status' = 'published' order by value->>'id' loop
        v_source := jsonb_build_object('matrix_id', v_matrix.id, 'matrix_name', v_detail->>'name',
          'matrix_version_id', v_version->>'id', 'scope', v_matrix.scope, 'definition', v_version->'definition',
          'original_definition', v_version->'published_definition', 'binding_snapshot', v_binding);
        v_sources := v_sources || jsonb_build_array(v_source);
        if v_matrix.scope = 'client' then v_clients := v_clients || jsonb_build_array(v_version->'definition');
        else v_caos := v_caos || jsonb_build_array(v_version->'definition'); end if;
      end loop;
    end loop;
    v_selection := jsonb_build_object('matrix_sources', v_sources, 'binding_snapshot', v_binding);
  end if;
  v_material := jsonb_build_object('day_id', v_day.id, 'revision_id', v_revision.id, 'work_date', v_day.work_date,
    'total_minutes', v_revision.minutes, 'no_hours_reason', v_revision.no_hours_reason,
    'source_input', v_revision.source_input, 'selection', v_selection);
  -- SHA-256 is built into PostgreSQL; no extension/search-path dependency.
  v_hash := encode(sha256(convert_to(v_material::text, 'UTF8')), 'hex');
  return jsonb_build_object('day_id', v_day.id, 'revision_id', v_revision.id, 'week_id', v_day.week_id,
    'company_id', v_company, 'organization_id', v_day.organization_id, 'work_date', v_day.work_date,
    'total_minutes', v_revision.minutes, 'no_hours_reason', v_revision.no_hours_reason, 'source_input', v_revision.source_input,
    'context_hash', v_hash, 'client_matrices', v_clients, 'cao_matrices', v_caos, 'pinned_matrix', v_pinned,
    'binding_snapshot', v_binding, 'matrix_sources', v_sources);
end $$;

create or replace function public.hours_get_day_classification_context(p_day_id uuid, p_expected_revision_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$ begin
  perform private.hours_require_internal(true);
  return private.hours_build_classification_context(p_day_id, p_expected_revision_id);
end $$;

-- Contain malformed service results without reimplementing the calculation
-- engine. Validate shape, exact references, source provenance and control sums.
create or replace function private.hours_validate_classification_result(p_context jsonb, p_result jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_source jsonb; v_definition jsonb; v_allocation jsonb; v_issue jsonb;
  v_status text; v_total integer := 0; v_rule_valid boolean;
  v_seen text[] := '{}'; v_key text; v_source_minutes integer;
begin
  if not private.hours_matrix_exact_object(p_result, array['status','matrix_version_id','allocations','issues'])
     or pg_column_size(p_result) > 131072 or p_result->>'status' not in ('classified','blocked','no_hours')
     or jsonb_typeof(p_result->'status') is distinct from 'string'
     or jsonb_typeof(p_result->'allocations') is distinct from 'array'
     or jsonb_typeof(p_result->'issues') is distinct from 'array' then
    raise exception 'Ongeldig classificatieresultaat' using errcode = '22023';
  end if;
  v_status := p_result->>'status';
  if jsonb_array_length(p_result->'allocations') > 512 or jsonb_array_length(p_result->'issues') > 50 then
    raise exception 'Classificatieresultaat is te groot' using errcode = '22023';
  end if;
  if p_result->'matrix_version_id' is distinct from 'null'::jsonb then
    if jsonb_typeof(p_result->'matrix_version_id') is distinct from 'string'
       or p_result->>'matrix_version_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Ongeldige matrixverwijzing' using errcode = '22023';
    end if;
    select value into v_source from jsonb_array_elements(p_context->'matrix_sources')
      where value->>'matrix_version_id' = p_result->>'matrix_version_id'
        and value->'definition'->>'validFrom' <= p_context->>'work_date'
        and (value->'definition'->>'validUntil' is null or p_context->>'work_date' < value->'definition'->>'validUntil');
    if v_source is null then raise exception 'Matrix hoort niet bij de vastgelegde context en werkdatum' using errcode = '22023'; end if;
    if v_source->>'scope' = 'cao' and exists (select 1 from jsonb_array_elements(p_context->'client_matrices') x
      where x->>'validFrom' <= p_context->>'work_date' and (x->>'validUntil' is null or p_context->>'work_date' < x->>'validUntil')) then
      raise exception 'De toepasselijke klantmatrix gaat vóór de CAO' using errcode = '22023';
    end if;
    v_definition := v_source->'definition';
  end if;
  for v_issue in select value from jsonb_array_elements(p_result->'issues') loop
    if jsonb_typeof(v_issue) is distinct from 'object' then raise exception 'Ongeldige controlebevinding' using errcode = '22023'; end if;
    if v_issue - array['code','message','field','expectedMinutes','actualMinutes'] <> '{}'::jsonb
       or jsonb_typeof(v_issue->'code') is distinct from 'string'
       or (v_issue->>'code') !~ '^[A-Z][A-Z0-9_]{0,99}$'
       or jsonb_typeof(v_issue->'message') is distinct from 'string'
       or length(btrim(v_issue->>'message')) not between 1 and 2000
       or (v_issue ? 'field' and (jsonb_typeof(v_issue->'field') is distinct from 'string' or length(v_issue->>'field') > 200))
       or (v_issue ? 'expectedMinutes' and not private.hours_source_minutes(v_issue->'expectedMinutes', 46080))
       or (v_issue ? 'actualMinutes' and not private.hours_source_minutes(v_issue->'actualMinutes', 46080)) then
      raise exception 'Ongeldige controlebevinding' using errcode = '22023';
    end if;
  end loop;
  if v_status = 'no_hours' then
    if (p_context->>'total_minutes')::integer <> 0 or p_context->'source_input' is distinct from 'null'::jsonb
       or nullif(private.hours_source_trim(p_context->>'no_hours_reason'), '') is null or v_source is not null
       or p_result->'allocations' <> '[]'::jsonb or p_result->'issues' <> '[]'::jsonb then
      raise exception 'Geen uren vereist expliciet nul zonder tegenstrijdige brongegevens' using errcode = '22023';
    end if;
    return null;
  end if;
  if v_status = 'blocked' then
    if p_result->'allocations' <> '[]'::jsonb or jsonb_array_length(p_result->'issues') = 0 then
      raise exception 'Een blokkade vereist bevindingen en mag geen definitieve indeling bevatten' using errcode = '22023';
    end if;
    if v_source is null and (p_context->>'total_minutes')::integer > 0 and exists (
      select 1 from jsonb_array_elements(p_context->'matrix_sources') x
      where x->'definition'->>'validFrom' <= p_context->>'work_date'
        and (x->'definition'->>'validUntil' is null or p_context->>'work_date' < x->'definition'->>'validUntil')) then
      raise exception 'Een toepasselijke matrix moet als controlebasis worden vastgelegd' using errcode = '22023';
    end if;
    return v_source;
  end if;
  if v_source is null or (p_context->>'total_minutes')::integer <= 0
     or jsonb_array_length(p_result->'allocations') = 0 or p_result->'issues' <> '[]'::jsonb then
    raise exception 'Een indeling vereist een matrix, positieve uren en geen blokkades' using errcode = '22023';
  end if;
  for v_allocation in select value from jsonb_array_elements(p_result->'allocations') loop
    if jsonb_typeof(v_allocation) is distinct from 'object' then raise exception 'Ongeldige uurcodeverdeling' using errcode = '22023'; end if;
    if v_allocation - array['categoryCode','factor','minutes','ruleId','sourceCategory'] <> '{}'::jsonb
       or not private.hours_matrix_text(v_allocation->'categoryCode')
       or not private.hours_matrix_text(v_allocation->'ruleId')
       or jsonb_typeof(v_allocation->'factor') is distinct from 'string'
       or not private.hours_source_minutes(v_allocation->'minutes')
       or (v_allocation ? 'sourceCategory' and not private.hours_matrix_text(v_allocation->'sourceCategory')) then
      raise exception 'Ongeldige uurcodeverdeling' using errcode = '22023';
    end if;
    if not exists (select 1 from jsonb_array_elements(v_definition->'categories') c
      where c->'code' = v_allocation->'categoryCode' and c->'factor' = v_allocation->'factor') then
      raise exception 'Uurcode of factor wijkt af van de matrixbasis' using errcode = '22023';
    end if;
    v_key := jsonb_build_array(v_allocation->>'ruleId', v_allocation->>'sourceCategory')::text;
    if v_key = any(v_seen) then raise exception 'Dubbele verdeling voor dezelfde bronregel' using errcode = '22023'; end if;
    v_seen := array_append(v_seen, v_key);
    if v_allocation ? 'sourceCategory' then
      select exists (select 1 from jsonb_array_elements(v_definition->'categoryMappings') m
        where m->'id' = v_allocation->'ruleId' and m->'categoryCode' = v_allocation->'categoryCode'
          and m->'sourceCode' = v_allocation->'sourceCategory') into v_rule_valid;
      select sum((c->>'minutes')::integer) into v_source_minutes
        from jsonb_array_elements(coalesce(p_context->'source_input'->'categories', '[]'::jsonb)) c
        where c->'sourceCode' = v_allocation->'sourceCategory';
      if v_source_minutes is null or v_source_minutes <> (v_allocation->>'minutes')::integer then
        raise exception 'Broncategorie of minuten wijken af van de opgeslagen bron' using errcode = '22023';
      end if;
    else
      if p_context->'source_input' ? 'categories' then raise exception 'Expliciete broncategorieën mogen niet worden weggelaten' using errcode = '22023'; end if;
      v_rule_valid := case v_definition->'automaticRules'->>'kind'
        when 'flat' then v_definition->'automaticRules'->'rule'->'id' = v_allocation->'ruleId'
          and v_definition->'automaticRules'->'rule'->'categoryCode' = v_allocation->'categoryCode'
        when 'time_windows' then exists (select 1 from jsonb_array_elements(v_definition->'automaticRules'->'rules') r
          where r->'id' = v_allocation->'ruleId' and r->'categoryCode' = v_allocation->'categoryCode')
        else false end;
    end if;
    if v_rule_valid is not true then raise exception 'Verdeling verwijst niet naar de bevestigde bronregel' using errcode = '22023'; end if;
    v_total := v_total + (v_allocation->>'minutes')::integer;
  end loop;
  if v_total <> (p_context->>'total_minutes')::integer then raise exception 'Som van de uurcodes wijkt af van het dagtotaal' using errcode = '22023'; end if;
  return v_source;
end $$;

create or replace function public.hours_finalize_day_classification(p_actor_id uuid, p_day_id uuid,
  p_expected_revision_id uuid, p_expected_context_hash text, p_engine_version text, p_result jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_saved_sub text := current_setting('request.jwt.claim.sub', true);
  v_saved_role text := current_setting('request.jwt.claim.role', true);
  v_saved_claims text := current_setting('request.jwt.claims', true);
  v_context jsonb; v_source jsonb; v_id uuid; v_old public.hours_day_classifications%rowtype;
  v_org uuid; v_summary jsonb; v_basis_exists boolean;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Alleen de vertrouwde classificatieservice kan resultaten vastleggen' using errcode = '42501'; end if;
  if p_actor_id is null or p_engine_version is distinct from 'hours-calculation-v1' then
    raise exception 'Ongeldige actor of onbekende rekenkernversie' using errcode = '22023';
  end if;
  -- Reuse the actual authorization resolver, including live role matrix and
  -- user overrides. Override all JWT lookup paths only inside this private
  -- transaction scope, then restore every GUC on success AND caught failure.
  begin
    perform set_config('request.jwt.claim.sub', p_actor_id::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', p_actor_id, 'role', 'authenticated')::text, true);
    perform 1 from public.profiles where id = p_actor_id for share;
    v_org := private.hours_require_internal(true);
    perform 1 from public.organizations where id = v_org for share;
    perform 1 from public.user_permission_overrides where organization_id = v_org and user_id = p_actor_id
      and permission_key = 'finance.manage' for share;
    -- Permission may have changed while acquiring its controlling row locks.
    perform private.hours_require_internal(true);
    v_context := private.hours_build_classification_context(p_day_id, p_expected_revision_id);
    if p_expected_context_hash is null or v_context->>'context_hash' <> p_expected_context_hash then
      raise exception 'Uren of matrixcontext zijn gewijzigd; bereken opnieuw' using errcode = '40001';
    end if;
    v_source := private.hours_validate_classification_result(v_context, p_result);
    select * into v_old from public.hours_day_classifications
      where revision_id = p_expected_revision_id and context_hash = p_expected_context_hash and engine_version = p_engine_version;
    if found then
      if v_old.result is distinct from p_result then raise exception 'Dezelfde rekencontext heeft al een ander resultaat' using errcode = '40001'; end if;
      v_id := v_old.id;
    else
      select exists (select 1 from public.hours_day_matrix_basis where day_id = p_day_id) into v_basis_exists;
      if v_source is not null and not v_basis_exists then
        insert into public.hours_day_matrix_basis(day_id, organization_id, first_revision_id, matrix_id, matrix_version_id,
          matrix_name, scope, definition, original_definition, binding_snapshot, selection_snapshot, created_by)
          values (p_day_id, v_org, p_expected_revision_id, (v_source->>'matrix_id')::uuid,
            (v_source->>'matrix_version_id')::uuid, v_source->>'matrix_name', v_source->>'scope',
            v_source->'definition', v_source->'original_definition', v_source->'binding_snapshot',
            jsonb_build_object('matrix_sources', v_context->'matrix_sources', 'binding_snapshot', v_context->'binding_snapshot'), p_actor_id);
      end if;
      insert into public.hours_day_classifications(organization_id, day_id, revision_id, context_hash, engine_version,
        status, matrix_version_id, matrix_name, matrix_scope, input_snapshot, context_snapshot, matrix_snapshot,
        original_matrix_snapshot, binding_snapshot, allocations, issues, result, created_by)
        values (v_org, p_day_id, p_expected_revision_id, p_expected_context_hash, p_engine_version,
          p_result->>'status', (p_result->>'matrix_version_id')::uuid, v_source->>'matrix_name', v_source->>'scope',
          jsonb_build_object('workDate', v_context->>'work_date', 'totalMinutes', v_context->'total_minutes',
            'sourceInput', v_context->'source_input', 'noHoursReason', v_context->'no_hours_reason'),
          v_context, v_source->'definition', v_source->'original_definition', v_context->'binding_snapshot',
          p_result->'allocations', p_result->'issues', p_result, p_actor_id) returning id into v_id;
    end if;
    v_summary := private.hours_classification_summary(v_id);
  exception when others then
    perform set_config('request.jwt.claim.sub', coalesce(v_saved_sub, ''), true);
    perform set_config('request.jwt.claim.role', coalesce(v_saved_role, ''), true);
    perform set_config('request.jwt.claims', coalesce(v_saved_claims, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claim.sub', coalesce(v_saved_sub, ''), true);
  perform set_config('request.jwt.claim.role', coalesce(v_saved_role, ''), true);
  perform set_config('request.jwt.claims', coalesce(v_saved_claims, ''), true);
  return v_summary;
end $$;

-- Additive projections. Portal sees own source facts, never internal matrix results.
create or replace function public.hours_get_week(p_week_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid := public.get_user_org_id(); v_candidate uuid; v_internal boolean;
  v_week public.hours_weeks%rowtype; v_members jsonb; v_enabled boolean;
begin
  if auth.uid() is null or v_org is null then raise exception 'Geen toegang tot deze urenweek' using errcode = '42501'; end if;
  v_internal := public.is_internal_user() and (public.has_role_permission('finance.view') or public.has_role_permission('finance.manage'));
  if not v_internal then
    if public.get_user_role() is distinct from 'medewerker'::public.user_role then raise exception 'Geen toegang tot deze urenweek' using errcode = '42501'; end if;
    v_candidate := public.get_employee_candidate_id();
    if v_candidate is null then raise exception 'Medewerkersaccount niet gekoppeld' using errcode = '42501'; end if;
  end if;
  select * into v_week from public.hours_weeks where id = p_week_id and organization_id = v_org;
  if not found or (not v_internal and not exists (select 1 from public.hours_week_members where week_id = p_week_id and organization_id = v_org and candidate_id = v_candidate)) then
    raise exception 'Geen toegang tot deze urenweek' using errcode = '42501';
  end if;
  select enabled into v_enabled from public.hours_company_settings where company_id = v_week.company_id and organization_id = v_org;
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'placement_id', m.placement_id, 'candidate_id', m.candidate_id,
    'candidate_name', m.candidate_name, 'start_date', m.start_date, 'end_date', m.end_date,
    'days', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'work_date', d.work_date,
      'current_revision', case when r.id is not null then jsonb_build_object('id', r.id, 'revision_number', r.revision_number,
        'minutes', r.minutes, 'no_hours_reason', r.no_hours_reason, 'note', r.note, 'source_references', r.source_references, 'source_input', r.source_input, 'created_at', r.created_at) end,
      'confirmation', (select jsonb_build_object('id', a.id, 'revision_id', a.revision_id, 'decision', a.decision, 'note', a.note, 'created_at', a.created_at)
        from public.hours_day_confirmations a where a.revision_id = r.id order by a.created_at desc, a.id desc limit 1),
      'review', (select jsonb_build_object('id', x.id, 'revision_id', x.revision_id, 'status', x.status, 'note', case when v_internal then x.note else null end, 'created_at', x.created_at)
        from public.hours_day_reviews x where x.revision_id = r.id order by x.created_at desc, x.id desc limit 1),
      'classification', case when v_internal then (select private.hours_classification_summary(k.id) from public.hours_day_classifications k where k.revision_id = r.id order by k.created_at desc, k.id desc limit 1) else null end,
      'history', case when v_internal then (select coalesce(jsonb_agg(jsonb_build_object(
        'id', h.id, 'revision_number', h.revision_number, 'minutes', h.minutes, 'no_hours_reason', h.no_hours_reason,
        'note', h.note, 'source_references', h.source_references, 'source_input', h.source_input, 'created_by', h.created_by, 'created_at', h.created_at,
        'classification', (select private.hours_classification_summary(k.id) from public.hours_day_classifications k where k.revision_id = h.id order by k.created_at desc, k.id desc limit 1),
        'confirmations', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'decision', a.decision, 'note', a.note, 'created_at', a.created_at) order by a.created_at, a.id), '[]'::jsonb) from public.hours_day_confirmations a where a.revision_id = h.id),
        'reviews', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'status', x.status, 'note', x.note, 'created_at', x.created_at) order by x.created_at, x.id), '[]'::jsonb) from public.hours_day_reviews x where x.revision_id = h.id)
        ) order by h.revision_number desc), '[]'::jsonb) from public.hours_day_revisions h where h.day_id = d.id) else '[]'::jsonb end
      ) order by d.work_date), '[]'::jsonb) from public.hours_days d left join public.hours_day_revisions r on r.id = d.current_revision_id where d.member_id = m.id)
    ) order by m.candidate_name, m.id), '[]'::jsonb) into v_members from public.hours_week_members m
    where m.week_id = p_week_id and m.organization_id = v_org and (v_internal or m.candidate_id = v_candidate);
  return jsonb_build_object('id', v_week.id, 'company_id', v_week.company_id, 'company_name', v_week.company_name,
    'week_start', v_week.week_start, 'submission_deadline_at', v_week.submission_deadline_at,
    'confirmation_deadline_at', v_week.confirmation_deadline_at,
    'settings_snapshot', case when v_internal then v_week.settings_snapshot else '{}'::jsonb end,
    'workflow_enabled', coalesce(v_enabled, false),
    'can_manage', coalesce(v_enabled, false) and v_internal and public.has_role_permission('finance.manage'),
    'can_confirm', coalesce(v_enabled, false) and not v_internal,
    'release_available', false, 'members', v_members);
end $$;

create or replace function public.hours_list_weeks(p_week_start date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := public.get_user_org_id(); v_candidate uuid; v_internal boolean; v_rows jsonb; begin
  if auth.uid() is null or v_org is null then raise exception 'Geen toegang tot uren' using errcode = '42501'; end if;
  v_internal := public.is_internal_user() and (public.has_role_permission('finance.view') or public.has_role_permission('finance.manage'));
  if not v_internal then
    if public.get_user_role() is distinct from 'medewerker'::public.user_role then raise exception 'Geen toegang tot uren' using errcode = '42501'; end if;
    v_candidate := public.get_employee_candidate_id();
    if v_candidate is null then raise exception 'Medewerkersaccount niet gekoppeld' using errcode = '42501'; end if;
  end if;
  if p_week_start is not null and extract(isodow from p_week_start) <> 1 then raise exception 'Kies de maandag van de werkweek' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'company_id', w.company_id, 'company_name', w.company_name,
    'week_start', w.week_start, 'submission_deadline_at', w.submission_deadline_at, 'confirmation_deadline_at', w.confirmation_deadline_at,
    'member_count', counts.member_count, 'day_count', counts.day_count, 'received_day_count', counts.received_day_count,
    'confirmed_day_count', counts.confirmed_day_count, 'blocked_day_count', counts.blocked_day_count)
    order by w.week_start desc, w.company_name), '[]'::jsonb) into v_rows
  from public.hours_weeks w cross join lateral (
    select count(distinct m.id) as member_count, count(d.id) as day_count,
      count(d.current_revision_id) as received_day_count,
      count(*) filter (where a.decision = 'confirmed') as confirmed_day_count,
      count(*) filter (where a.decision = 'disputed' or x.status = 'blocked' or (v_internal and k.status = 'blocked')) as blocked_day_count
    from public.hours_week_members m join public.hours_days d on d.member_id = m.id
    left join lateral (select decision from public.hours_day_confirmations where revision_id = d.current_revision_id order by created_at desc, id desc limit 1) a on true
    left join lateral (select status from public.hours_day_reviews where revision_id = d.current_revision_id order by created_at desc, id desc limit 1) x on true
    left join lateral (select status from public.hours_day_classifications where revision_id = d.current_revision_id order by created_at desc, id desc limit 1) k on v_internal
    where m.week_id = w.id and (v_internal or m.candidate_id = v_candidate)
  ) counts
  where w.organization_id = v_org and (p_week_start is null or w.week_start = p_week_start)
    and (v_internal or counts.member_count > 0);
  return jsonb_build_object('weeks', v_rows, 'can_manage', v_internal and public.has_role_permission('finance.manage'));
end $$;

do $$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname in ('hours_source_trim','hours_source_clock','hours_source_minutes','hours_validate_source_input',
      'hours_source_input_guard','hours_classification_summary','hours_build_classification_context','hours_validate_classification_result') loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('hours_save_day_source','hours_save_day','hours_get_week','hours_list_weeks','hours_get_day_classification_context') loop
    execute format('revoke all on function %s from public, anon, service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function public.hours_finalize_day_classification(uuid, uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.hours_finalize_day_classification(uuid, uuid, uuid, text, text, jsonb) to service_role;
comment on table public.hours_day_matrix_basis is 'First explicit matrix selection for a work day, immutable across later source revisions. No automatic replacement, including after CAO or matrix configuration changes.';
comment on table public.hours_day_classifications is 'Trusted deterministic result for one immutable input revision/context/engine. classified is not employee consent, internal approval, payroll release or export.';
comment on column public.hours_day_revisions.source_input is 'Original structured source facts, schema 1. Null is legacy total-only. Semantic contradictions are preserved for a blocked classification.';
notify pgrst, 'reload schema';
