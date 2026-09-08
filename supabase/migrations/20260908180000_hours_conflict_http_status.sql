-- Business revision/context conflicts are HTTP 409, not PostgreSQL serialization
-- failures. PostgREST retries SQLSTATE 40001; an unchanged stale revision cannot
-- succeed on retry. Actual database serialization failures retain their native code.
-- Every function body below is copied from its latest deployed definition with
-- only explicit business-conflict errcodes changed. Existing ACLs are preserved.
begin;

-- Previous definition: 20260908090000_hours_workflow_foundation.sql
create or replace function public.hours_set_company_settings(p_company_id uuid, p_expected_version integer, p_enabled boolean,
  p_submission_day_offset integer, p_submission_time time, p_confirmation_day_offset integer, p_confirmation_time time)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.hours_require_internal(true); v_version integer; begin
  perform 1 from public.companies where id = p_company_id and organization_id = v_org for update;
  if not found then raise exception 'Opdrachtgever niet beschikbaar' using errcode = '42501'; end if;
  if p_expected_version is null or p_expected_version < 0 or p_enabled is null
     or p_submission_day_offset is null or p_submission_day_offset not between 0 and 27
     or p_confirmation_day_offset is null or p_confirmation_day_offset not between 0 and 34
     or p_submission_time is null or p_submission_time >= time '24:00' or extract(second from p_submission_time) <> 0
     or p_confirmation_time is null or p_confirmation_time >= time '24:00' or extract(second from p_confirmation_time) <> 0
     or (p_confirmation_day_offset, p_confirmation_time) <= (p_submission_day_offset, p_submission_time) then
    raise exception 'Ongeldige ureninstellingen of deadlines' using errcode = '22023';
  end if;
  select version into v_version from public.hours_company_settings where company_id = p_company_id and organization_id = v_org for update;
  if coalesce(v_version, 0) <> p_expected_version then raise exception 'Instellingen zijn gewijzigd; laad opnieuw' using errcode = 'PT409'; end if;
  insert into public.hours_company_settings(company_id, organization_id, enabled, version, submission_day_offset, submission_time, confirmation_day_offset, confirmation_time, updated_by)
    values (p_company_id, v_org, p_enabled, 1, p_submission_day_offset, p_submission_time, p_confirmation_day_offset, p_confirmation_time, auth.uid())
  on conflict (company_id) do update set enabled = excluded.enabled, version = hours_company_settings.version + 1,
    submission_day_offset = excluded.submission_day_offset, submission_time = excluded.submission_time,
    confirmation_day_offset = excluded.confirmation_day_offset, confirmation_time = excluded.confirmation_time,
    updated_by = excluded.updated_by, updated_at = clock_timestamp();
  return public.hours_get_company_settings(p_company_id);
end $$;

-- Previous definition: 20260908090000_hours_workflow_foundation.sql
create or replace function public.hours_create_week(p_company_id uuid, p_week_start date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := private.hours_require_internal(true); v_company text; v_settings public.hours_company_settings%rowtype;
  v_week uuid; v_sources jsonb; v_count integer; v_submission timestamptz; v_confirmation timestamptz;
begin
  if p_week_start is null or p_week_start < date '1900-01-01' or p_week_start > date '2200-12-31' or extract(isodow from p_week_start) <> 1 then
    raise exception 'Kies de maandag van de werkweek' using errcode = '22023';
  end if;
  select name into v_company from public.companies where id = p_company_id and organization_id = v_org for update;
  if not found then raise exception 'Opdrachtgever niet beschikbaar' using errcode = '42501'; end if;
  select * into v_settings from public.hours_company_settings where company_id = p_company_id and organization_id = v_org for update;
  if not found or not v_settings.enabled then raise exception 'Nieuwe urenwerkwijze staat uit voor deze opdrachtgever' using errcode = '22023'; end if;
  select id into v_week from public.hours_weeks where organization_id = v_org and company_id = p_company_id and week_start = p_week_start;
  if found then return public.hours_get_week(v_week); end if;
  -- Hold source rows while validating and taking the snapshot so reassignment
  -- cannot silently change the expected employee set between the two queries.
  perform p.id from public.placements p where p.organization_id = v_org and p.company_id = p_company_id
    and p.start_date <= p_week_start + 6 and (p.end_date is null or p.end_date >= p_week_start) order by p.id for share of p;
  perform c.id from public.candidates c join public.placements p on p.candidate_id = c.id
    where p.organization_id = v_org and p.company_id = p_company_id and p.start_date <= p_week_start + 6
      and (p.end_date is null or p.end_date >= p_week_start) order by c.id for share of c;
  -- Materialize once: even a concurrently changed, previously nonoverlapping
  -- placement cannot change the validated set between the subsequent statements.
  select coalesce(jsonb_agg(jsonb_build_object('placement_id', p.id, 'candidate_id', p.candidate_id,
    'candidate_valid', c.id is not null, 'candidate_name', concat_ws(' ', c.first_name, c.last_name),
    'start_date', p.start_date, 'end_date', p.end_date, 'status', p.status) order by p.id), '[]'::jsonb)
  into v_sources from public.placements p left join public.candidates c on c.id = p.candidate_id and c.organization_id = v_org
  where p.organization_id = v_org and p.company_id = p_company_id and p.start_date <= p_week_start + 6
    and (p.end_date is null or p.end_date >= p_week_start);
  if exists (select 1 from jsonb_to_recordset(v_sources) as x(candidate_valid boolean, start_date date, end_date date)
    where not x.candidate_valid or x.end_date < x.start_date) then
    raise exception 'Een relevante plaatsing heeft geen geldige medewerkerkoppeling of datums' using errcode = '22023';
  end if;
  if jsonb_array_length(v_sources) = 0 then
    raise exception 'Geen plaatsingen in deze werkweek' using errcode = '22023';
  end if;
  v_submission := private.hours_deadline_at((p_week_start + v_settings.submission_day_offset) + v_settings.submission_time);
  v_confirmation := private.hours_deadline_at((p_week_start + v_settings.confirmation_day_offset) + v_settings.confirmation_time);
  insert into public.hours_weeks(organization_id, company_id, company_name, week_start, settings_snapshot, submission_deadline_at, confirmation_deadline_at, created_by)
    values (v_org, p_company_id, v_company, p_week_start, public.hours_get_company_settings(p_company_id),
      v_submission, v_confirmation, auth.uid()) returning id into v_week;
  insert into public.hours_week_members(organization_id, week_id, placement_id, candidate_id, candidate_name, start_date, end_date, placement_snapshot)
    select v_org, v_week, x.placement_id, x.candidate_id, x.candidate_name,
      greatest(x.start_date, p_week_start), least(coalesce(x.end_date, p_week_start + 6), p_week_start + 6),
      jsonb_build_object('placement_id', x.placement_id, 'candidate_id', x.candidate_id, 'company_id', p_company_id,
        'start_date', x.start_date, 'end_date', x.end_date, 'status', x.status)
    from jsonb_to_recordset(v_sources) as x(placement_id uuid, candidate_id uuid, candidate_name text, start_date date, end_date date, status text);
  get diagnostics v_count = row_count;
  if v_count <> jsonb_array_length(v_sources) or v_count = 0 then raise exception 'Plaatsingssnapshot is onvolledig' using errcode = 'PT409'; end if;
  insert into public.hours_days(organization_id, week_id, member_id, work_date)
    select v_org, v_week, m.id, m.start_date + n from public.hours_week_members m
      cross join lateral generate_series(0, m.end_date - m.start_date) n where m.week_id = v_week;
  return public.hours_get_week(v_week);
end $$;

-- Previous definition: 20260908090000_hours_workflow_foundation.sql
create or replace function public.hours_confirm_day(p_day_id uuid, p_expected_revision_id uuid, p_decision text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_day public.hours_days%rowtype; v_last public.hours_day_confirmations%rowtype; begin
  v_day := private.hours_lock_day(p_day_id, false);
  if p_expected_revision_id is null or v_day.current_revision_id is distinct from p_expected_revision_id then raise exception 'Uren zijn gewijzigd of ontbreken; laad opnieuw' using errcode = 'PT409'; end if;
  p_note := nullif(btrim(p_note), '');
  if p_decision is null or p_decision not in ('confirmed', 'disputed') or length(p_note) > 2000 or (p_decision = 'disputed' and p_note is null) then
    raise exception 'Een afwijking vereist een toelichting' using errcode = '22023';
  end if;
  select * into v_last from public.hours_day_confirmations where revision_id = p_expected_revision_id order by created_at desc, id desc limit 1;
  if found and v_last.decision = p_decision and v_last.note is not distinct from p_note then return public.hours_get_week(v_day.week_id); end if;
  insert into public.hours_day_confirmations(organization_id, day_id, revision_id, decision, note, created_by)
    values (v_day.organization_id, v_day.id, p_expected_revision_id, p_decision, p_note, auth.uid());
  return public.hours_get_week(v_day.week_id);
end $$;

-- Previous definition: 20260908090000_hours_workflow_foundation.sql
create or replace function public.hours_review_day(p_day_id uuid, p_expected_revision_id uuid, p_status text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_day public.hours_days%rowtype; v_last public.hours_day_reviews%rowtype; begin
  v_day := private.hours_lock_day(p_day_id, true);
  if p_expected_revision_id is null or v_day.current_revision_id is distinct from p_expected_revision_id then raise exception 'Uren zijn gewijzigd of ontbreken; laad opnieuw' using errcode = 'PT409'; end if;
  p_note := nullif(btrim(p_note), '');
  if p_status is null or p_status not in ('checked', 'blocked') or length(p_note) > 2000 or (p_status = 'blocked' and p_note is null) then
    raise exception 'Een blokkade vereist een toelichting' using errcode = '22023';
  end if;
  select * into v_last from public.hours_day_reviews where revision_id = p_expected_revision_id order by created_at desc, id desc limit 1;
  if found and v_last.status = p_status and v_last.note is not distinct from p_note then return public.hours_get_week(v_day.week_id); end if;
  insert into public.hours_day_reviews(organization_id, day_id, revision_id, status, note, created_by)
    values (v_day.organization_id, v_day.id, p_expected_revision_id, p_status, p_note, auth.uid());
  return public.hours_get_week(v_day.week_id);
end $$;

-- Previous definition: 20260908120000_hours_matrix_versions.sql
create or replace function public.hours_save_matrix_draft(p_version_id uuid, p_expected_revision integer, p_valid_from date, p_valid_until date, p_config jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_version public.hours_matrix_versions%rowtype := private.hours_lock_matrix_version(p_version_id); begin
  if v_version.status <> 'draft' then raise exception 'Een gepubliceerde versie kan niet worden gewijzigd' using errcode = '42501'; end if;
  if p_expected_revision is null or v_version.revision <> p_expected_revision then raise exception 'Matrixconcept is gewijzigd; laad opnieuw' using errcode = 'PT409'; end if;
  perform private.hours_matrix_check_period(p_valid_from, p_valid_until);
  perform private.hours_validate_matrix_config(p_config);
  if (v_version.valid_from, v_version.valid_until, v_version.config) is not distinct from (p_valid_from, p_valid_until, p_config) then
    return public.hours_get_matrix(v_version.matrix_id);
  end if;
  update public.hours_matrix_versions set valid_from = p_valid_from, valid_until = p_valid_until, config = p_config,
    revision = revision + 1, updated_by = auth.uid(), updated_at = clock_timestamp() where id = p_version_id;
  return public.hours_get_matrix(v_version.matrix_id);
end $$;

-- Previous definition: 20260908120000_hours_matrix_versions.sql
create or replace function public.hours_publish_matrix_version(p_version_id uuid, p_expected_revision integer, p_confirmed boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_version public.hours_matrix_versions%rowtype := private.hours_lock_matrix_version(p_version_id); begin
  if p_confirmed is not true then raise exception 'Bevestig de exacte opgeslagen matrixversie vóór publicatie' using errcode = '22023'; end if;
  if p_expected_revision is null or v_version.revision <> p_expected_revision then raise exception 'Matrixconcept is gewijzigd; laad opnieuw' using errcode = 'PT409'; end if;
  -- An exact retry of a successful publish is harmless. Confirmation belongs to
  -- this immutable revision, not to arbitrary browser-supplied configuration.
  if v_version.status = 'published' then return public.hours_get_matrix(v_version.matrix_id); end if;
  perform private.hours_validate_matrix_config(v_version.config);
  update public.hours_matrix_versions set status = 'published', published_by = auth.uid(),
    published_at = clock_timestamp(), updated_by = auth.uid(), updated_at = clock_timestamp() where id = p_version_id;
  return public.hours_get_matrix(v_version.matrix_id);
end $$;

-- Previous definition: 20260908120000_hours_matrix_versions.sql
create or replace function public.hours_set_company_matrix_binding(p_company_id uuid, p_expected_version integer, p_cao_matrix_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.hours_require_internal(true); v_binding public.hours_company_cao_bindings%rowtype; v_next integer; begin
  perform 1 from public.companies where id = p_company_id and organization_id = v_org for update;
  if not found then raise exception 'Opdrachtgever niet beschikbaar' using errcode = '42501'; end if;
  if p_cao_matrix_id is not null and not exists (select 1 from public.hours_matrices where id = p_cao_matrix_id and organization_id = v_org and scope = 'cao') then
    raise exception 'Kies een CAO-matrix uit de eigen organisatie' using errcode = '42501';
  end if;
  select * into v_binding from public.hours_company_cao_bindings where company_id = p_company_id and organization_id = v_org for update;
  if p_expected_version is null or coalesce(v_binding.version, 0) <> p_expected_version then raise exception 'CAO-koppeling is gewijzigd; laad opnieuw' using errcode = 'PT409'; end if;
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

-- Previous definition: 20260908140000_hours_day_sources_and_classification.sql
create or replace function public.hours_save_day_source(p_day_id uuid, p_expected_revision_id uuid, p_minutes integer,
  p_no_hours_reason text, p_note text, p_source_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_day public.hours_days%rowtype; v_old public.hours_day_revisions%rowtype; v_revision uuid; begin
  v_day := private.hours_lock_day(p_day_id, true);
  if v_day.current_revision_id is distinct from p_expected_revision_id then raise exception 'Uren zijn gewijzigd; laad opnieuw' using errcode = 'PT409'; end if;
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

-- Previous definition: 20260908140000_hours_day_sources_and_classification.sql
create or replace function public.hours_save_day(p_day_id uuid, p_expected_revision_id uuid, p_minutes integer, p_no_hours_reason text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_day public.hours_days%rowtype; begin
  v_day := private.hours_lock_day(p_day_id, true);
  if v_day.current_revision_id is distinct from p_expected_revision_id then raise exception 'Uren zijn gewijzigd; laad opnieuw' using errcode = 'PT409'; end if;
  if exists (select 1 from public.hours_day_revisions where id = v_day.current_revision_id and source_input is not null) then
    raise exception 'Deze dag bevat brongegevens; gebruik het volledige bronformulier om ze expliciet te wijzigen' using errcode = '22023';
  end if;
  return public.hours_save_day_source(p_day_id, p_expected_revision_id, p_minutes, p_no_hours_reason, p_note, null);
end $$;

-- Previous definition: 20260908140000_hours_day_sources_and_classification.sql
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

-- Previous definition: 20260908140000_hours_day_sources_and_classification.sql
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

-- Previous definition: 20260908160000_hours_workflow_organization_gate.sql
create or replace function public.hours_confirm_days(p_week_id uuid, p_revisions jsonb, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_item record; v_day public.hours_days%rowtype; v_last public.hours_day_confirmations%rowtype; v_org uuid := private.hours_require_module(true); begin
  if auth.uid() is null or v_org is null or public.get_user_role() is distinct from 'medewerker'::public.user_role
     or public.get_employee_candidate_id() is null then raise exception 'Geen toegang tot deze urenweek' using errcode = '42501'; end if;
  -- get_week checks both tenant and own membership before acquiring any locks.
  perform public.hours_get_week(p_week_id);
  if p_revisions is null or jsonb_typeof(p_revisions) <> 'array' then raise exception 'Kies ten minste één urendag' using errcode = '22023'; end if;
  if jsonb_array_length(p_revisions) not between 1 and 1000 then raise exception 'Ongeldige selectie urendagen' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_revisions) e where jsonb_typeof(e) <> 'object'
    or jsonb_typeof(e->'day_id') is distinct from 'string' or jsonb_typeof(e->'revision_id') is distinct from 'string'
    or (e->>'day_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or (e->>'revision_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'Ongeldige urendag of revisie' using errcode = '22023';
  end if;
  if (select count(distinct (e->>'day_id')::uuid) from jsonb_array_elements(p_revisions) e) <> jsonb_array_length(p_revisions) then
    raise exception 'Een urendag mag slechts één keer voorkomen' using errcode = '22023';
  end if;
  p_note := nullif(btrim(p_note), '');
  if length(p_note) > 2000 then raise exception 'Toelichting is te lang' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_revisions) e where not exists (
    select 1 from public.hours_days d join public.hours_week_members m on m.id = d.member_id
    where d.id = (e->>'day_id')::uuid and d.week_id = p_week_id and d.organization_id = v_org
      and m.candidate_id = public.get_employee_candidate_id())) then
    raise exception 'Urendag hoort niet bij uw eigen werkweek' using errcode = '42501';
  end if;
  perform 1 from public.hours_weeks where id = p_week_id and organization_id = v_org for update;
  for v_item in select (e->>'day_id')::uuid as day_id, (e->>'revision_id')::uuid as revision_id from jsonb_array_elements(p_revisions) e order by (e->>'day_id')::uuid loop
    v_day := private.hours_lock_day(v_item.day_id, false);
    if v_day.week_id <> p_week_id then raise exception 'Urendag hoort niet bij deze werkweek' using errcode = '42501'; end if;
    if v_day.current_revision_id is distinct from v_item.revision_id then raise exception 'Uren zijn gewijzigd; laad opnieuw' using errcode = 'PT409'; end if;
    select * into v_last from public.hours_day_confirmations where revision_id = v_item.revision_id order by created_at desc, id desc limit 1;
    if not found or v_last.decision <> 'confirmed' or v_last.note is distinct from p_note then
      insert into public.hours_day_confirmations(organization_id, day_id, revision_id, decision, note, created_by)
        values (v_day.organization_id, v_day.id, v_item.revision_id, 'confirmed', p_note, auth.uid());
    end if;
  end loop;
  return public.hours_get_week(p_week_id);
end $$;

notify pgrst, 'reload schema';
commit;
