-- T10: explicit replacement of a pinned matrix basis.
--
-- The pinned basis stays immutable and every earlier classification stays byte
-- for byte as it was. A replacement is an append-only ledger row that moves the
-- effective basis forward; the earlier basis and the earlier outcome remain
-- readable next to the new ones. The replacement itself calculates nothing: the
-- existing trusted classification route recomputes on the new basis.
--
-- Release does not exist yet (T12). `hours_day_releases` is the one register a
-- release may ever be recorded in, and the guard below only lets a day through
-- when it can prove there is no row for it. T12 turns the block on by writing
-- its release there; it needs no change here.
--
-- No payroll release, export, communication, legacy `timesheets` write or paid
-- provider call is added by this migration.
begin;

create table if not exists public.hours_day_matrix_basis_replacements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  day_id uuid not null,
  basis_version integer not null check (basis_version between 1 and 50),
  replaced_matrix_version_id uuid not null references public.hours_matrix_versions(id),
  matrix_id uuid not null,
  matrix_version_id uuid not null references public.hours_matrix_versions(id),
  matrix_name text not null,
  scope text not null check (scope in ('client','cao')),
  definition jsonb not null,
  original_definition jsonb not null,
  binding_snapshot jsonb not null,
  selection_snapshot jsonb not null,
  -- The explanation of a decision, in a column of its own. It is never read
  -- back as a value that gets applied to an hours day.
  reason text not null check (length(btrim(reason)) between 1 and 500),
  revision_id uuid not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  unique (day_id, basis_version),
  check (matrix_version_id <> replaced_matrix_version_id),
  foreign key (day_id, organization_id) references public.hours_days(id, organization_id),
  foreign key (revision_id, day_id, organization_id) references public.hours_day_revisions(id, day_id, organization_id),
  foreign key (matrix_id, organization_id) references public.hours_matrices(id, organization_id),
  -- Nothing to replace without a pinned basis, enforced by the database itself.
  foreign key (day_id) references public.hours_day_matrix_basis(day_id)
);

-- The single register a payroll release may be recorded in. Empty, and with no
-- write route for any API role: T12 adds its own trusted definer RPC here.
create table if not exists public.hours_day_releases (
  day_id uuid not null,
  organization_id uuid not null references public.organizations(id),
  revision_id uuid not null,
  batch_id uuid,
  released_by uuid not null references public.profiles(id),
  released_at timestamptz not null default clock_timestamp(),
  primary key (day_id, revision_id),
  foreign key (day_id, organization_id) references public.hours_days(id, organization_id),
  foreign key (revision_id, day_id, organization_id) references public.hours_day_revisions(id, day_id, organization_id)
);

create index if not exists hours_basis_replacements_org_idx on public.hours_day_matrix_basis_replacements(organization_id);
-- Serves both the tenant-scoped foreign key and the "newest replacement" read.
drop index if exists public.hours_basis_replacements_day_idx;
create index if not exists hours_basis_replacements_day_idx on public.hours_day_matrix_basis_replacements(day_id, organization_id, basis_version desc);
create index if not exists hours_basis_replacements_matrix_idx on public.hours_day_matrix_basis_replacements(matrix_id, organization_id);
create index if not exists hours_basis_replacements_version_idx on public.hours_day_matrix_basis_replacements(matrix_version_id);
create index if not exists hours_basis_replacements_replaced_idx on public.hours_day_matrix_basis_replacements(replaced_matrix_version_id);
create index if not exists hours_basis_replacements_revision_idx on public.hours_day_matrix_basis_replacements(revision_id, day_id, organization_id);
create index if not exists hours_basis_replacements_actor_idx on public.hours_day_matrix_basis_replacements(created_by);
create index if not exists hours_day_releases_org_idx on public.hours_day_releases(organization_id);
create index if not exists hours_day_releases_day_org_idx on public.hours_day_releases(day_id, organization_id);
create index if not exists hours_day_releases_revision_idx on public.hours_day_releases(revision_id, day_id, organization_id);
create index if not exists hours_day_releases_batch_idx on public.hours_day_releases(batch_id);
create index if not exists hours_day_releases_actor_idx on public.hours_day_releases(released_by);

do $$ declare t text; begin
  foreach t in array array['hours_day_matrix_basis_replacements','hours_day_releases'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists hours_internal_read on public.%I', t);
    execute format('create policy hours_internal_read on public.%I for select to authenticated using (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user()) and ((select public.has_role_permission(''finance.view'')) or (select public.has_role_permission(''finance.manage''))))', t);
    execute format('drop policy if exists hours_workflow_module_required on public.%I', t);
    execute format('create policy hours_workflow_module_required on public.%I as restrictive for select to authenticated using ((select private.hours_module_enabled()))', t);
    execute format('drop trigger if exists hours_history_immutable on public.%I', t);
    execute format('create trigger hours_history_immutable before update or delete on public.%I for each row execute function private.hours_history_immutable()', t);
  end loop;
end $$;

-- Which basis an attempt actually used. Null for a result without a matrix, and
-- for every attempt recorded before this migration.
alter table public.hours_day_classifications add column if not exists basis_version integer;

-- The only function that may name the release register. A day counts as
-- unreleased solely when this read succeeds and finds nothing; a missing
-- register, an unreadable one or a null answer all count as released.
create or replace function private.hours_day_released(p_day_id uuid, p_org uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_released boolean; begin
  select exists (select 1 from public.hours_day_releases
    where day_id = p_day_id and organization_id = p_org) into strict v_released;
  return coalesce(v_released, true);
end $$;

create or replace function private.hours_require_day_not_released(p_day_id uuid, p_org uuid)
returns void language plpgsql stable security definer set search_path = '' as $$ begin
  if private.hours_day_released(p_day_id, p_org) then
    raise exception 'Deze urendag is al vrijgegeven; een andere matrixbasis loopt dan via de correctieroute'
      using errcode = '22023';
  end if;
end $$;

-- Whether a published definition covers a work day. Compared as dates, so the
-- session's DateStyle can never turn a textual comparison into a wrong answer.
create or replace function private.hours_matrix_effective_on(p_definition jsonb, p_work_date date)
returns boolean language sql immutable set search_path = '' as $$
  select (p_definition->>'validFrom')::date <= p_work_date
    and (p_definition->>'validUntil' is null or p_work_date < (p_definition->>'validUntil')::date)
$$;

-- One truth for "which matrices could this day have used". The context builder
-- and the replacement RPC both read it, so the set a replacement may choose
-- from is exactly the set the calculation accepts.
create or replace function private.hours_day_matrix_candidates(p_org uuid, p_company uuid, p_lock boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_binding jsonb; v_matrix record; v_detail jsonb; v_version jsonb; v_source jsonb;
  v_sources jsonb := '[]'; v_clients jsonb := '[]'; v_caos jsonb := '[]';
begin
  v_binding := public.hours_get_company_matrix_binding(p_company) - 'can_manage';
  for v_matrix in select id, scope from public.hours_matrices
    where organization_id = p_org
      and (company_id = p_company or id = (v_binding->>'cao_matrix_id')::uuid)
    order by id loop
    if p_lock then
      perform 1 from public.hours_matrices where id = v_matrix.id and organization_id = p_org for update;
    end if;
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
  return jsonb_build_object('matrix_sources', v_sources, 'binding_snapshot', v_binding,
    'client_matrices', v_clients, 'cao_matrices', v_caos);
end $$;

-- The basis that governs this day now: the newest replacement, or the original
-- pinned row when there is none. Never two at once.
create or replace function private.hours_effective_day_basis(p_day_id uuid, p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_basis public.hours_day_matrix_basis%rowtype;
  v_replacement public.hours_day_matrix_basis_replacements%rowtype;
begin
  select * into v_basis from public.hours_day_matrix_basis where day_id = p_day_id and organization_id = p_org;
  if not found then return null; end if;
  select * into v_replacement from public.hours_day_matrix_basis_replacements
    where day_id = p_day_id and organization_id = p_org order by basis_version desc limit 1;
  if found then
    return jsonb_build_object('basis_version', v_replacement.basis_version, 'matrix_id', v_replacement.matrix_id,
      'matrix_name', v_replacement.matrix_name, 'matrix_version_id', v_replacement.matrix_version_id,
      'scope', v_replacement.scope, 'definition', v_replacement.definition,
      'original_definition', v_replacement.original_definition,
      'binding_snapshot', v_replacement.binding_snapshot, 'selection_snapshot', v_replacement.selection_snapshot);
  end if;
  return jsonb_build_object('basis_version', 0, 'matrix_id', v_basis.matrix_id,
    'matrix_name', v_basis.matrix_name, 'matrix_version_id', v_basis.matrix_version_id,
    'scope', v_basis.scope, 'definition', v_basis.definition,
    'original_definition', v_basis.original_definition,
    'binding_snapshot', v_basis.binding_snapshot, 'selection_snapshot', v_basis.selection_snapshot);
end $$;

-- The whole chain for one day, oldest first, with the effective head repeated
-- at the top level. Identity and audit only: no factors or definitions.
create or replace function private.hours_day_basis_projection(p_day_id uuid, p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_basis public.hours_day_matrix_basis%rowtype; v_entries jsonb; v_head jsonb; begin
  select * into v_basis from public.hours_day_matrix_basis where day_id = p_day_id and organization_id = p_org;
  if not found then return null; end if;
  v_entries := jsonb_build_array(jsonb_build_object('basis_version', 0, 'matrix_id', v_basis.matrix_id,
    'matrix_version_id', v_basis.matrix_version_id, 'matrix_name', v_basis.matrix_name, 'scope', v_basis.scope,
    'reason', null, 'revision_id', v_basis.first_revision_id, 'created_by', v_basis.created_by,
    'created_at', v_basis.created_at));
  select v_entries || coalesce(jsonb_agg(jsonb_build_object('basis_version', x.basis_version,
      'matrix_id', x.matrix_id, 'matrix_version_id', x.matrix_version_id, 'matrix_name', x.matrix_name,
      'scope', x.scope, 'reason', x.reason, 'revision_id', x.revision_id, 'created_by', x.created_by,
      'created_at', x.created_at) order by x.basis_version), '[]'::jsonb) into v_entries
    from public.hours_day_matrix_basis_replacements x
    where x.day_id = p_day_id and x.organization_id = p_org;
  v_head := v_entries -> (jsonb_array_length(v_entries) - 1);
  return jsonb_build_object('basis_version', v_head->'basis_version', 'matrix_id', v_head->'matrix_id',
    'matrix_version_id', v_head->'matrix_version_id', 'matrix_name', v_head->'matrix_name',
    'scope', v_head->'scope', 'entries', v_entries);
end $$;

-- Previous definition: 20260908140000_hours_day_sources_and_classification.sql
create or replace function private.hours_classification_summary(p_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', x.id, 'revision_id', x.revision_id, 'status', x.status,
    'matrix_version_id', x.matrix_version_id, 'matrix_name', x.matrix_name, 'matrix_scope', x.matrix_scope,
    'engine_version', x.engine_version, 'created_at', x.created_at, 'allocations', x.allocations, 'issues', x.issues,
    'basis_version', x.basis_version,
    'basis_pinned', exists (select 1 from public.hours_day_matrix_basis b where b.day_id = x.day_id))
  from public.hours_day_classifications x where x.id = p_id
$$;

-- Previous definition: 20260908180000_hours_conflict_http_status.sql
-- Only the basis lookup changed: the effective basis replaces the direct read of
-- the pinned row, and the candidate loop moved into the shared helper. A
-- replacement carries its own identity in the selection material, so a
-- recalculation after a replacement gets a context hash of its own.
create or replace function private.hours_build_classification_context(p_day_id uuid, p_expected_revision_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_day public.hours_days%rowtype; v_revision public.hours_day_revisions%rowtype;
  v_basis jsonb; v_company uuid; v_candidates jsonb;
  v_binding jsonb; v_sources jsonb := '[]'; v_clients jsonb := '[]'; v_caos jsonb := '[]';
  v_pinned jsonb; v_selection jsonb; v_material jsonb; v_hash text; v_basis_version integer;
begin
  v_day := private.hours_lock_day(p_day_id, true);
  if p_expected_revision_id is null or v_day.current_revision_id is distinct from p_expected_revision_id then
    raise exception 'Uren zijn gewijzigd of ontbreken; laad opnieuw' using errcode = 'PT409';
  end if;
  select * into v_revision from public.hours_day_revisions where id = p_expected_revision_id and organization_id = v_day.organization_id;
  select company_id into v_company from public.hours_weeks where id = v_day.week_id and organization_id = v_day.organization_id;
  perform 1 from public.companies where id = v_company and organization_id = v_day.organization_id for update;
  if not found then raise exception 'Opdrachtgever niet beschikbaar' using errcode = '42501'; end if;
  -- Settings edits share the company lock; recheck after acquiring it.
  if not exists (select 1 from public.hours_company_settings where company_id = v_company and organization_id = v_day.organization_id and enabled) then
    raise exception 'Nieuwe urenwerkwijze staat uit voor deze opdrachtgever' using errcode = '22023';
  end if;
  v_basis := private.hours_effective_day_basis(p_day_id, v_day.organization_id);
  if v_basis is not null then
    v_basis_version := (v_basis->>'basis_version')::integer;
    v_binding := v_basis->'binding_snapshot';
    v_pinned := jsonb_build_object('matrix_id', (v_basis->>'matrix_id')::uuid, 'matrix_name', v_basis->>'matrix_name',
      'matrix_version_id', v_basis->>'matrix_version_id', 'scope', v_basis->>'scope', 'definition', v_basis->'definition',
      'original_definition', v_basis->'original_definition', 'binding_snapshot', v_basis->'binding_snapshot');
    v_sources := jsonb_build_array(v_pinned);
    if v_basis->>'scope' = 'client' then v_clients := jsonb_build_array(v_basis->'definition');
    else v_caos := jsonb_build_array(v_basis->'definition'); end if;
    -- Keep the recorded selection material in the hash. First pinning therefore
    -- does not turn a successful request's immediate retry into a new attempt,
    -- and a replacement is a different context rather than a second answer to
    -- the same one.
    v_selection := v_basis->'selection_snapshot';
  else
    v_candidates := private.hours_day_matrix_candidates(v_day.organization_id, v_company, true);
    v_binding := v_candidates->'binding_snapshot';
    v_sources := v_candidates->'matrix_sources';
    v_clients := v_candidates->'client_matrices';
    v_caos := v_candidates->'cao_matrices';
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
    'basis_version', v_basis_version, 'binding_snapshot', v_binding, 'matrix_sources', v_sources);
end $$;

-- Previous definition: 20260908180000_hours_conflict_http_status.sql
-- Only the recorded basis version is new; the pinning rule is unchanged and a
-- replaced basis is never overwritten by a later attempt.
create or replace function public.hours_finalize_day_classification(p_actor_id uuid, p_day_id uuid,
  p_expected_revision_id uuid, p_expected_context_hash text, p_engine_version text, p_result jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_saved_sub text := current_setting('request.jwt.claim.sub', true);
  v_saved_role text := current_setting('request.jwt.claim.role', true);
  v_saved_claims text := current_setting('request.jwt.claims', true);
  v_context jsonb; v_source jsonb; v_id uuid; v_old public.hours_day_classifications%rowtype;
  v_org uuid; v_summary jsonb; v_basis_exists boolean; v_basis_version integer;
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
      raise exception 'Uren of matrixcontext zijn gewijzigd; bereken opnieuw' using errcode = 'PT409';
    end if;
    v_source := private.hours_validate_classification_result(v_context, p_result);
    select * into v_old from public.hours_day_classifications
      where revision_id = p_expected_revision_id and context_hash = p_expected_context_hash and engine_version = p_engine_version;
    if found then
      if v_old.result is distinct from p_result then raise exception 'Dezelfde rekencontext heeft al een ander resultaat' using errcode = 'PT409'; end if;
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
      -- Which basis governed this attempt's context. The context was built under
      -- the day lock, so its basis_version is current; a first pinning above
      -- makes that basis version 0. A day without any basis stays null, also
      -- for a no-hours or matrix-less outcome that a pinned basis still governed.
      v_basis_version := case when v_source is not null
        then coalesce((v_context->>'basis_version')::integer, 0)
        else (v_context->>'basis_version')::integer end;
      insert into public.hours_day_classifications(organization_id, day_id, revision_id, context_hash, engine_version,
        status, matrix_version_id, matrix_name, matrix_scope, basis_version, input_snapshot, context_snapshot, matrix_snapshot,
        original_matrix_snapshot, binding_snapshot, allocations, issues, result, created_by)
        values (v_org, p_day_id, p_expected_revision_id, p_expected_context_hash, p_engine_version,
          p_result->>'status', (p_result->>'matrix_version_id')::uuid, v_source->>'matrix_name', v_source->>'scope', v_basis_version,
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

-- What a replacement may choose from, and what the day stands on right now.
create or replace function public.hours_get_day_matrix_options(p_day_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := private.hours_require_internal(false);
  v_day public.hours_days%rowtype; v_company uuid; v_basis jsonb; v_candidates jsonb; v_options jsonb;
begin
  select d.* into v_day from public.hours_days d where d.id = p_day_id and d.organization_id = v_org;
  if not found then raise exception 'Geen toegang tot deze urendag' using errcode = '42501'; end if;
  select company_id into v_company from public.hours_weeks where id = v_day.week_id and organization_id = v_org;
  if not exists (select 1 from public.hours_company_settings where company_id = v_company and organization_id = v_org and enabled) then
    raise exception 'Nieuwe urenwerkwijze staat uit voor deze opdrachtgever' using errcode = '22023';
  end if;
  v_basis := private.hours_day_basis_projection(p_day_id, v_org);
  v_candidates := private.hours_day_matrix_candidates(v_org, v_company, false);
  select coalesce(jsonb_agg(jsonb_build_object(
      'matrix_id', value->>'matrix_id', 'matrix_version_id', value->>'matrix_version_id',
      'matrix_name', value->>'matrix_name', 'scope', value->>'scope',
      'valid_from', value->'definition'->>'validFrom', 'valid_until', value->'definition'->>'validUntil',
      'is_current', coalesce(v_basis->>'matrix_version_id' = value->>'matrix_version_id', false))
      order by value->>'scope', value->>'matrix_name', value->'definition'->>'validFrom'), '[]'::jsonb)
    into v_options from jsonb_array_elements(v_candidates->'matrix_sources')
    where private.hours_matrix_effective_on(value->'definition', v_day.work_date);
  return jsonb_build_object('day_id', v_day.id, 'work_date', v_day.work_date,
    'released', private.hours_day_released(p_day_id, v_org),
    'can_manage', public.has_role_permission('finance.manage'),
    'basis', v_basis, 'options', v_options);
end $$;

-- The replacement itself. It moves the effective basis and records why; it
-- calculates nothing and rewrites nothing. Recalculating stays the job of the
-- existing trusted classification route.
create or replace function public.hours_replace_day_matrix_basis(p_day_id uuid, p_expected_revision_id uuid,
  p_expected_basis_version integer, p_matrix_version_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_day public.hours_days%rowtype; v_company uuid; v_current jsonb; v_candidates jsonb; v_chosen jsonb;
  v_reason text; v_id uuid := gen_random_uuid(); v_next integer;
begin
  v_day := private.hours_lock_day(p_day_id, true);
  if p_expected_revision_id is null or v_day.current_revision_id is distinct from p_expected_revision_id then
    raise exception 'Uren zijn gewijzigd of ontbreken; laad opnieuw' using errcode = 'PT409';
  end if;
  v_reason := nullif(private.hours_source_trim(p_reason), '');
  if v_reason is null or length(v_reason) > 500 then
    raise exception 'Leg vast waarom deze dag op een andere matrixbasis komt (maximaal 500 tekens)' using errcode = '22023';
  end if;
  if p_matrix_version_id is null then
    raise exception 'Kies de matrixversie die voortaan voor deze dag geldt' using errcode = '22023';
  end if;
  perform private.hours_require_day_not_released(p_day_id, v_day.organization_id);
  v_current := private.hours_effective_day_basis(p_day_id, v_day.organization_id);
  if v_current is null then
    raise exception 'Deze dag heeft nog geen vastgelegde matrixbasis; voer eerst de uursoortencontrole uit' using errcode = '22023';
  end if;
  if p_expected_basis_version is distinct from (v_current->>'basis_version')::integer then
    raise exception 'De matrixbasis van deze dag is gewijzigd; laad opnieuw' using errcode = 'PT409';
  end if;
  if p_matrix_version_id = (v_current->>'matrix_version_id')::uuid then
    raise exception 'Kies een andere matrixversie dan de basis die deze dag al heeft' using errcode = '22023';
  end if;
  v_next := (v_current->>'basis_version')::integer + 1;
  if v_next > 50 then
    raise exception 'Deze dag heeft het maximum van vijftig vervangingen bereikt' using errcode = '22023';
  end if;
  select company_id into v_company from public.hours_weeks where id = v_day.week_id and organization_id = v_day.organization_id;
  perform 1 from public.companies where id = v_company and organization_id = v_day.organization_id for update;
  if not found then raise exception 'Opdrachtgever niet beschikbaar' using errcode = '42501'; end if;
  -- Settings edits share the company lock; recheck after acquiring it, exactly
  -- as the calculation context does. hours_lock_day read the switch before the
  -- row was ours, and a switch-off that committed in between must still win.
  if not exists (select 1 from public.hours_company_settings where company_id = v_company and organization_id = v_day.organization_id and enabled) then
    raise exception 'Nieuwe urenwerkwijze staat uit voor deze opdrachtgever' using errcode = '22023';
  end if;
  v_candidates := private.hours_day_matrix_candidates(v_day.organization_id, v_company, true);
  select value into v_chosen from jsonb_array_elements(v_candidates->'matrix_sources')
    where value->>'matrix_version_id' = p_matrix_version_id::text
      and private.hours_matrix_effective_on(value->'definition', v_day.work_date);
  if v_chosen is null then
    raise exception 'Deze matrixversie is niet gepubliceerd, hoort niet bij deze opdrachtgever of geldt niet op deze werkdatum'
      using errcode = '22023';
  end if;
  insert into public.hours_day_matrix_basis_replacements(id, organization_id, day_id, basis_version,
    replaced_matrix_version_id, matrix_id, matrix_version_id, matrix_name, scope, definition,
    original_definition, binding_snapshot, selection_snapshot, reason, revision_id, created_by)
    values (v_id, v_day.organization_id, p_day_id, v_next, (v_current->>'matrix_version_id')::uuid,
      (v_chosen->>'matrix_id')::uuid, p_matrix_version_id, v_chosen->>'matrix_name', v_chosen->>'scope',
      v_chosen->'definition', v_chosen->'original_definition', v_chosen->'binding_snapshot',
      -- The replacement identity travels in the selection material, so a later
      -- recalculation gets a context hash of its own and can never collide with
      -- the earlier attempt's unique key while carrying a different outcome.
      jsonb_build_object('replacement_id', v_id, 'basis_version', v_next,
        'matrix_sources', v_candidates->'matrix_sources', 'binding_snapshot', v_candidates->'binding_snapshot'),
      v_reason, p_expected_revision_id, auth.uid());
  return public.hours_get_week(v_day.week_id);
end $$;

-- Previous definition: 20260908160000_hours_workflow_organization_gate.sql
-- The basis chain and the superseded outcomes of the current day version are
-- added for internal readers; an older version keeps its last outcome only,
-- and the portal projection is unchanged.
create or replace function public.hours_get_week(p_week_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid := private.hours_require_module(false); v_candidate uuid; v_internal boolean;
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
      'matrix_basis', case when v_internal then private.hours_day_basis_projection(d.id, v_org) else null end,
      'previous_classifications', case when v_internal then (select coalesce(jsonb_agg(private.hours_classification_summary(k.id) order by k.created_at desc, k.id desc), '[]'::jsonb)
        from (select k2.id, k2.created_at from public.hours_day_classifications k2 where k2.revision_id = r.id order by k2.created_at desc, k2.id desc offset 1) k) else '[]'::jsonb end,
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

do $$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname in ('hours_day_released','hours_require_day_not_released',
      'hours_matrix_effective_on','hours_day_matrix_candidates','hours_effective_day_basis','hours_day_basis_projection') loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('hours_replace_day_matrix_basis','hours_get_day_matrix_options') loop
    execute format('revoke all on function %s from public, anon, service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

comment on table public.hours_day_matrix_basis_replacements is 'Append-only chain of explicit basis replacements for one work day. The pinned basis and every earlier classification stay unchanged; reason is an explanation and is never applied as a value.';
comment on table public.hours_day_releases is 'The single register a payroll release may be recorded in (T12). Empty until then, with no write route for anon, authenticated or service_role. hours_replace_day_matrix_basis blocks any day that has a row here.';
comment on column public.hours_day_classifications.basis_version is 'Which matrix basis governed this attempt''s context: 0 for the first pinned basis, N for the Nth replacement, null when the day had no basis at all or for attempts recorded before basis replacement existed.';
commit;
notify pgrst, 'reload schema';
