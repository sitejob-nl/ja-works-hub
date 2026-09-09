-- Reading a scan or a photo into reviewable proposals.
--
-- The boundary does not move. A source, a page decision, a reading and a
-- proposal are still not hours: only hours_apply_source_proposal writes a day
-- revision, and it takes the proposal literally. Nothing here touches
-- timesheets, invoicing or communication, and nothing here calls a provider —
-- the paid call lives in the edge function, on the central AI ledger.
--
-- What this migration adds is the one thing a machine reader needs that a
-- person does not: a way to say "I read this, but I am not sure of it". A
-- proposal may now carry the fields the reading was unsure about, and while
-- that doubt stands the proposal cannot be applied. This mirrors the existing
-- doubt about *who* a proposal is for, deliberately: the same shape, the same
-- one-way confirmation, the same separate note.
begin;

-- Which fields a reading may report as read-but-unsure. Closed and short on
-- purpose. "employee" and "date" are absent: doubt about who or which day has
-- nowhere to land in a proposal, so it steers assignment_uncertain or leaves
-- the line out entirely.
create or replace function private.hours_canonical_uncertain_fields(p_fields text[])
returns text[] language sql immutable set search_path = '' as $$
  select case when p_fields is null then null else (
    select coalesce(array_agg(known.field order by known.ord), array[]::text[])
    from unnest(array['total', 'shift', 'break', 'categories', 'reason'])
      with ordinality as known(field, ord)
    where known.field = any(p_fields)) end;
$$;
revoke all on function private.hours_canonical_uncertain_fields(text[]) from public, anon, authenticated, service_role;

alter table public.hours_source_proposals add column if not exists uncertain_fields text[];
alter table public.hours_source_proposals add column if not exists values_confirmed_by uuid references public.profiles(id);
alter table public.hours_source_proposals add column if not exists values_confirmed_at timestamptz;
-- Like assignment_note: an explanation about the proposal, never in note, which
-- is proposed content and is applied verbatim.
alter table public.hours_source_proposals add column if not exists values_note text;

-- Comparing against the canonical form rejects an unknown label, a duplicate
-- and a different order in one check, so two readings of one file can never
-- describe the same doubt differently.
do $$ begin
  alter table public.hours_source_proposals add constraint hours_source_proposals_uncertain_fields_check
    check (uncertain_fields is null
      or (cardinality(uncertain_fields) > 0
          and uncertain_fields = private.hours_canonical_uncertain_fields(uncertain_fields)));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.hours_source_proposals add constraint hours_source_proposals_values_check
    check ((values_confirmed_at is null) = (values_confirmed_by is null)
       and (values_confirmed_at is null or uncertain_fields is not null));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.hours_source_proposals add constraint hours_source_proposals_values_note_check
    check (length(values_note) <= 2000 and (values_note is null or values_confirmed_at is not null));
exception when duplicate_object then null; end $$;

create index if not exists hours_proposals_uncertain_values_idx on public.hours_source_proposals(week_id)
  where status = 'open' and uncertain_fields is not null and values_confirmed_at is null;

-- The proposal's content still never changes; uncertain_fields joins the tuple
-- that may not move, so a reading can never be made to look surer afterwards.
-- Two doubts may now be settled, each exactly once and each in its own act.
create or replace function private.hours_proposal_guard()
returns trigger language plpgsql set search_path = '' as $$
declare v_assignment boolean; v_values boolean; begin
  if tg_op = 'DELETE' then
    raise exception 'Urenvoorstellen zijn onveranderlijk' using errcode = '42501';
  end if;
  if (new.id, new.organization_id, new.week_id, new.source_id, new.day_id, new.minutes,
      new.no_hours_reason, new.note, new.source_input, new.page_label, new.page_number,
      new.assignment_uncertain, new.uncertain_fields, new.client_link_id, new.created_by, new.created_at)
     is distinct from
     (old.id, old.organization_id, old.week_id, old.source_id, old.day_id, old.minutes,
      old.no_hours_reason, old.note, old.source_input, old.page_label, old.page_number,
      old.assignment_uncertain, old.uncertain_fields, old.client_link_id, old.created_by, old.created_at) then
    raise exception 'Urenvoorstellen zijn onveranderlijk' using errcode = '42501';
  end if;
  v_assignment := (new.assignment_confirmed_by, new.assignment_confirmed_at, new.assignment_note)
    is distinct from (old.assignment_confirmed_by, old.assignment_confirmed_at, old.assignment_note);
  v_values := (new.values_confirmed_by, new.values_confirmed_at, new.values_note)
    is distinct from (old.values_confirmed_by, old.values_confirmed_at, old.values_note);
  if old.status = 'open' and new.status = 'open' then
    -- Exactly one doubt per act: settling both at once would hide one of them
    -- behind the other's authorisation.
    if v_assignment = v_values
       or (new.applied_revision_id, new.applied_created_revision, new.resolved_by, new.resolved_at,
           new.resolution_note)
          is distinct from (old.applied_revision_id, old.applied_created_revision, old.resolved_by,
           old.resolved_at, old.resolution_note) then
      raise exception 'Urenvoorstellen zijn onveranderlijk' using errcode = '42501';
    end if;
    if v_assignment and (old.assignment_confirmed_at is not null or new.assignment_confirmed_at is null
       or new.assignment_confirmed_by is null or old.assignment_note is not null) then
      raise exception 'Urenvoorstellen zijn onveranderlijk' using errcode = '42501';
    end if;
    if v_values and (old.values_confirmed_at is not null or new.values_confirmed_at is null
       or new.values_confirmed_by is null or old.values_note is not null) then
      raise exception 'Urenvoorstellen zijn onveranderlijk' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.status <> 'open' or new.status not in ('applied', 'discarded') or v_assignment or v_values then
    raise exception 'Urenvoorstellen zijn onveranderlijk' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.hours_proposal_guard() from public, anon, authenticated, service_role;

-- One shape for a proposal, wherever it is read. The two lists in this
-- projection had drifted apart once already; a single definition makes a new
-- field impossible to add to one and forget in the other.
create or replace function private.hours_proposal_projection(p public.hours_source_proposals,
  d public.hours_days, m public.hours_week_members)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'day_id', p.day_id, 'member_id', d.member_id, 'work_date', d.work_date,
    'candidate_name', m.candidate_name, 'status', p.status, 'minutes', p.minutes,
    'no_hours_reason', p.no_hours_reason, 'note', p.note, 'source_input', p.source_input,
    'page_label', p.page_label, 'page_number', p.page_number,
    'assignment_uncertain', p.assignment_uncertain,
    'assignment_confirmed_at', p.assignment_confirmed_at, 'assignment_note', p.assignment_note,
    'uncertain_fields', p.uncertain_fields, 'values_confirmed_at', p.values_confirmed_at,
    'values_note', p.values_note,
    'applied_revision_id', p.applied_revision_id,
    'applied_created_revision', p.applied_created_revision, 'resolution_note', p.resolution_note,
    'resolved_at', p.resolved_at, 'created_at', p.created_at);
$$;
revoke all on function private.hours_proposal_projection(public.hours_source_proposals, public.hours_days,
  public.hours_week_members) from public, anon, authenticated, service_role;

-- The projection grows the recorded doubt and its week-wide count, so a screen
-- never has to add up what happens to be on it.
create or replace function private.hours_week_sources_projection(p_week_id uuid, p_org uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('week_id', p_week_id,
    'open_proposals', (select count(*) from public.hours_source_proposals p
      where p.week_id = p_week_id and p.organization_id = p_org and p.status = 'open'),
    'undecided_assignments', (select count(*) from public.hours_source_proposals p
      where p.week_id = p_week_id and p.organization_id = p_org and p.status = 'open'
        and p.assignment_uncertain and p.assignment_confirmed_at is null),
    'uncertain_values', (select count(*) from public.hours_source_proposals p
      where p.week_id = p_week_id and p.organization_id = p_org and p.status = 'open'
        and p.uncertain_fields is not null and p.values_confirmed_at is null),
    'can_manage', public.is_internal_user() and public.has_role_permission('finance.manage')
      and exists (select 1 from public.hours_weeks w
        join public.hours_company_settings c on c.company_id = w.company_id and c.organization_id = w.organization_id
        where w.id = p_week_id and w.organization_id = p_org and c.enabled),
    'client_links', coalesce((select jsonb_agg(jsonb_build_object(
      'id', l.id, 'label', l.label, 'created_at', l.created_at, 'expires_at', l.expires_at,
      'last_opened_at', l.last_opened_at, 'revoked_at', l.revoked_at, 'revoke_note', l.revoke_note,
      'report', private.hours_client_link_report(l.id),
      'proposals', (select coalesce(jsonb_agg(private.hours_proposal_projection(p, d, m)
        order by p.created_at, p.id), '[]'::jsonb)
        from public.hours_source_proposals p
        join public.hours_days d on d.id = p.day_id and d.organization_id = p.organization_id
        join public.hours_week_members m on m.id = d.member_id
        where p.client_link_id = l.id and p.organization_id = p_org))
      || private.hours_client_link_progress(l) order by l.created_at, l.id)
      from public.hours_client_week_links l
      where l.week_id = p_week_id and l.organization_id = p_org), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(jsonb_build_object(
      'id', s.id, 'file_name', s.file_name, 'content_type', s.content_type, 'byte_size', s.byte_size,
      'content_hash', s.content_hash, 'storage_path', s.storage_path, 'created_at', s.created_at,
      'page_count', s.page_count, 'client_link_id', s.client_link_id,
      'pages', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', g.id, 'page_number', g.page_number, 'assignment', g.assignment, 'member_id', g.member_id,
        'candidate_name', gm.candidate_name, 'note', g.note, 'created_at', g.created_at)
        order by g.page_number), '[]'::jsonb)
        from public.hours_source_pages g
        left join public.hours_week_members gm on gm.id = g.member_id
        where g.source_id = s.id and g.organization_id = p_org and g.status = 'active'),
      'proposals', (select coalesce(jsonb_agg(private.hours_proposal_projection(p, d, m)
        order by p.created_at, p.id), '[]'::jsonb)
        from public.hours_source_proposals p
        join public.hours_days d on d.id = p.day_id and d.organization_id = p.organization_id
        join public.hours_week_members m on m.id = d.member_id
        where p.source_id = s.id and p.organization_id = p_org)
      ) order by s.created_at, s.id) from public.hours_week_sources s
      where s.week_id = p_week_id and s.organization_id = p_org), '[]'::jsonb));
$$;
revoke all on function private.hours_week_sources_projection(uuid, uuid) from public, anon, authenticated, service_role;

-- What a reader is allowed to see about one delivered file. The browser sends
-- only a source id; the storage path, the media type and the week come from
-- here, so no caller can point the reader at a file of its own choosing.
-- Authorisation is the ordinary write gate: reading leads to proposals.
-- Volatile, like the classification context beside it. This function takes the
-- write gate, and that gate locks a row; PostgREST runs a STABLE function in a
-- read-only transaction, where a lock fails with 25006 and the whole route dies
-- behind a bare 405. Volatility is a promise about transactions here, not about
-- what this function writes — it writes nothing.
create or replace function public.hours_get_source_reading_context(p_source_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_org uuid := private.hours_require_internal(true); v_source public.hours_week_sources%rowtype; begin
  select * into v_source from public.hours_week_sources
    where id = p_source_id and organization_id = v_org;
  if not found then raise exception 'Bron niet beschikbaar' using errcode = '42501'; end if;
  if not exists (select 1 from public.hours_weeks w
      join public.hours_company_settings c on c.company_id = w.company_id and c.organization_id = w.organization_id
      where w.id = v_source.week_id and w.organization_id = v_org and c.enabled) then
    raise exception 'Nieuwe urenwerkwijze staat uit voor deze opdrachtgever' using errcode = '22023';
  end if;
  -- A workbook has its own deterministic reader and a legacy .xls has none at
  -- all; offering a paid reading for either would spend money on the wrong
  -- route.
  if v_source.content_type not in ('application/pdf', 'image/jpeg', 'image/png') then
    raise exception 'Alleen een PDF of foto kan worden uitgelezen' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'source_id', v_source.id, 'week_id', v_source.week_id, 'organization_id', v_org,
    'storage_path', v_source.storage_path, 'content_type', v_source.content_type,
    'byte_size', v_source.byte_size, 'file_name', v_source.file_name, 'page_count', v_source.page_count,
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.candidate_name)
      order by m.candidate_name, m.id) from public.hours_week_members m
      where m.week_id = v_source.week_id), '[]'::jsonb),
    'days', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'member_id', d.member_id,
      'work_date', d.work_date) order by d.work_date, d.member_id) from public.hours_days d
      join public.hours_week_members m on m.id = d.member_id
      where m.week_id = v_source.week_id and d.organization_id = v_org), '[]'::jsonb));
end $$;

-- One reading of one delivered file, recorded as proposals in a single handling.
-- Unchanged from the released contract except for the doubt a machine reader can
-- report: uncertain_fields defaults to none, so a caller with the old parameter
-- set stays valid and the migration can go live before the frontend.
create or replace function public.hours_create_source_proposals(p_source_id uuid, p_entries jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_source public.hours_week_sources%rowtype; v_entry jsonb; v_day public.hours_days%rowtype;
  v_minutes integer; v_reason text; v_note text; v_label text; v_input jsonb;
  v_page integer; v_uncertain boolean; v_judged boolean; v_ids uuid[]; v_fields text[];
begin
  v_source := private.hours_lock_source(p_source_id);
  if jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries) = 0
     or jsonb_array_length(p_entries) > 500 then
    raise exception 'Geef één tot vijfhonderd voorstellen op' using errcode = '22023';
  end if;
  select array_agg(value->>'day_id' order by value->>'day_id')
    into v_ids from jsonb_array_elements(p_entries) as value;
  if array_length(v_ids, 1) is distinct from (select count(distinct id) from unnest(v_ids) as id) then
    raise exception 'Elke werkdag mag maar één keer in deze uitlezing staan' using errcode = '22023';
  end if;
  v_judged := exists (select 1 from public.hours_source_pages g
    where g.source_id = p_source_id and g.organization_id = v_source.organization_id and g.status = 'active');
  -- A fixed lock order over the days keeps this next to the existing day writers.
  foreach v_entry in array (select array_agg(value order by value->>'day_id')
                            from jsonb_array_elements(p_entries) as value) loop
    v_day := private.hours_lock_day((v_entry->>'day_id')::uuid, true);
    if v_day.week_id <> v_source.week_id or v_day.organization_id <> v_source.organization_id then
      raise exception 'De bron hoort niet bij deze urenweek' using errcode = '42501';
    end if;
    v_minutes := (v_entry->>'minutes')::integer;
    v_reason := nullif(private.hours_source_trim(v_entry->>'no_hours_reason'), '');
    v_note := nullif(private.hours_source_trim(v_entry->>'note'), '');
    v_label := nullif(private.hours_source_trim(v_entry->>'page_label'), '');
    -- An explicit JSON null means "no source details", not the jsonb value 'null'.
    v_input := nullif(v_entry->'source_input', 'null'::jsonb);
    v_page := (v_entry->>'page_number')::integer;
    if v_minutes is null or v_minutes not between 0 and 1440 or (v_minutes = 0 and v_reason is null)
       or (v_minutes > 0 and v_reason is not null) or length(v_reason) > 500 or length(v_note) > 2000
       or length(v_label) > 200 then
      raise exception 'Vul geldige minuten in; nul uren vereist een reden' using errcode = '22023';
    end if;
    if v_page is not null
       and (v_page not between 1 and 2000 or v_page > coalesce(v_source.page_count, v_page)) then
      raise exception 'Deze bron heeft die pagina niet' using errcode = '22023';
    end if;
    if v_page is null and v_judged then
      raise exception 'Deze bron is per pagina beoordeeld; geef aan uit welke pagina dit voorstel komt'
        using errcode = '22023';
    end if;
    perform private.hours_validate_source_input(v_input);
    -- Zero hours with a delivered breakdown is a combination the classifier
    -- refuses, so a proposal carrying it could never be applied usefully.
    if v_minutes = 0 and v_input is not null then
      raise exception 'Geen uren kan niet samengaan met aangeleverde brongegevens' using errcode = '22023';
    end if;
    v_fields := null;
    if v_entry ? 'uncertain_fields' and jsonb_typeof(v_entry->'uncertain_fields') = 'array'
       and jsonb_array_length(v_entry->'uncertain_fields') > 0 then
      select array_agg(value) into v_fields
        from jsonb_array_elements_text(v_entry->'uncertain_fields') as value;
      -- An unknown label is refused rather than silently dropped: dropping it
      -- would turn the reader's own doubt into apparent certainty.
      if exists (select 1 from unnest(v_fields) as f
                 where f is null or f <> all (array['total', 'shift', 'break', 'categories', 'reason'])) then
        raise exception 'Onbekende onzekerheid in deze uitlezing' using errcode = '22023';
      end if;
      v_fields := nullif(private.hours_canonical_uncertain_fields(v_fields), array[]::text[]);
    elsif v_entry ? 'uncertain_fields' and jsonb_typeof(v_entry->'uncertain_fields')
          not in ('null', 'array') then
      raise exception 'Onbekende onzekerheid in deze uitlezing' using errcode = '22023';
    end if;
    v_uncertain := coalesce((v_entry->>'assignment_uncertain')::boolean, false)
      or private.hours_page_contradicts(p_source_id, v_page, v_day.member_id);
    insert into public.hours_source_proposals(organization_id, week_id, source_id, day_id, minutes,
      no_hours_reason, note, source_input, page_label, page_number, assignment_uncertain,
      uncertain_fields, created_by)
      values (v_source.organization_id, v_source.week_id, p_source_id, v_day.id, v_minutes, v_reason,
        v_note, v_input, v_label, v_page, v_uncertain, v_fields, auth.uid());
  end loop;
  return private.hours_week_sources_projection(v_source.week_id, v_source.organization_id);
end $$;

-- Confirming settles the values a reading was unsure about. It decides nothing
-- else: the proposal stays open, its content stays untouched, and applying
-- remains a separate, deliberate act. Disagreeing takes the same road as
-- everywhere else in this module: discard it and record a new proposal.
create or replace function public.hours_confirm_proposal_values(p_proposal_id uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_proposal public.hours_source_proposals%rowtype; begin
  v_proposal := private.hours_lock_open_proposal(p_proposal_id);
  perform private.hours_lock_day(v_proposal.day_id, true);
  if v_proposal.uncertain_fields is null then
    raise exception 'De gelezen gegevens van dit voorstel stonden al vast' using errcode = '22023';
  end if;
  if v_proposal.values_confirmed_at is not null then
    raise exception 'De gelezen gegevens van dit voorstel zijn al bevestigd' using errcode = '22023';
  end if;
  p_note := nullif(private.hours_source_trim(p_note), '');
  if length(p_note) > 2000 then raise exception 'Toelichting is te lang' using errcode = '22023'; end if;
  update public.hours_source_proposals
    set values_confirmed_by = auth.uid(), values_confirmed_at = clock_timestamp(), values_note = p_note
    where id = p_proposal_id;
  return private.hours_week_sources_projection(v_proposal.week_id, v_proposal.organization_id);
end $$;

-- Applying still takes the proposal literally. It now refuses a second kind of
-- open question as well: values a reading reported as unsure. A reading is not
-- allowed to be applied blindly just because it looked confident.
create or replace function public.hours_apply_source_proposal(p_proposal_id uuid, p_expected_revision_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_proposal public.hours_source_proposals%rowtype; v_day public.hours_days%rowtype;
  v_source public.hours_week_sources%rowtype; v_revision uuid; v_created boolean;
  v_references jsonb; v_company text;
begin
  v_proposal := private.hours_lock_open_proposal(p_proposal_id);
  if v_proposal.assignment_uncertain and v_proposal.assignment_confirmed_at is null then
    raise exception 'Bevestig eerst om welke medewerker dit voorstel gaat' using errcode = '22023';
  end if;
  if v_proposal.uncertain_fields is not null and v_proposal.values_confirmed_at is null then
    raise exception 'Bevestig eerst de gegevens die onzeker zijn gelezen' using errcode = '22023';
  end if;
  v_day := private.hours_lock_day(v_proposal.day_id, true);
  if v_day.current_revision_id is distinct from p_expected_revision_id then
    raise exception 'Uren zijn gewijzigd; laad opnieuw' using errcode = 'PT409';
  end if;
  if v_proposal.client_link_id is not null then
    select w.company_name into v_company from public.hours_weeks w where w.id = v_proposal.week_id;
    v_references := jsonb_build_array(jsonb_build_object('kind', 'client', 'label', v_company,
      'reference', null));
  else
    select * into v_source from public.hours_week_sources where id = v_proposal.source_id;
    v_references := jsonb_build_array(jsonb_build_object('kind', 'upload', 'label', v_source.file_name,
      'reference', coalesce(nullif(concat_ws(' · ',
        case when v_proposal.page_number is not null then 'pagina ' || v_proposal.page_number end,
        v_proposal.page_label), ''), null)));
  end if;
  v_revision := private.hours_write_day_revision(v_day, v_proposal.minutes, v_proposal.no_hours_reason,
    v_proposal.note, v_proposal.source_input, v_references);
  v_created := v_revision is not null;
  update public.hours_source_proposals set status = 'applied',
    applied_revision_id = coalesce(v_revision, v_day.current_revision_id), applied_created_revision = v_created,
    resolved_by = auth.uid(), resolved_at = clock_timestamp() where id = p_proposal_id;
  return public.hours_get_week(v_day.week_id) || jsonb_build_object('applied_created_revision', v_created,
    'sources', private.hours_week_sources_projection(v_day.week_id, v_day.organization_id));
end $$;

do $$ declare f text; begin
  foreach f in array array['public.hours_get_source_reading_context(uuid)',
    'public.hours_confirm_proposal_values(uuid, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

comment on column public.hours_source_proposals.uncertain_fields is 'Fields a reading reported as read but not certain. While this stands unconfirmed the proposal cannot be applied. Canonical order and no duplicates; an unknown label is refused, never dropped.';

notify pgrst, 'reload schema';

commit;
