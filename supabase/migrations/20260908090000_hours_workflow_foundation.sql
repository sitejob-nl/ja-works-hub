-- First, isolated hours workflow. No legacy timesheet writes, release, export or mail.
-- Every company is disabled until explicitly configured through the guarded RPC.
create schema if not exists private;

create table if not exists public.hours_company_settings (
  company_id uuid primary key references public.companies(id),
  organization_id uuid not null references public.organizations(id),
  enabled boolean not null default false,
  version integer not null default 1 check (version > 0),
  submission_day_offset integer not null default 7 check (submission_day_offset between 0 and 27),
  submission_time time not null default '12:00',
  confirmation_day_offset integer not null default 9 check (confirmation_day_offset between 0 and 34),
  confirmation_time time not null default '12:00',
  timezone text not null default 'Europe/Amsterdam' check (timezone = 'Europe/Amsterdam'),
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default clock_timestamp(),
  check (submission_time < time '24:00' and extract(second from submission_time) = 0),
  check (confirmation_time < time '24:00' and extract(second from confirmation_time) = 0),
  check ((confirmation_day_offset, confirmation_time) > (submission_day_offset, submission_time))
);

create table if not exists public.hours_weeks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  company_id uuid not null references public.companies(id),
  company_name text not null,
  week_start date not null check (extract(isodow from week_start) = 1),
  settings_snapshot jsonb not null check (jsonb_typeof(settings_snapshot) = 'object'),
  submission_deadline_at timestamptz not null,
  confirmation_deadline_at timestamptz not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id, company_id, week_start),
  unique (id, organization_id),
  check (confirmation_deadline_at > submission_deadline_at)
);

create table if not exists public.hours_week_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  week_id uuid not null,
  placement_id uuid not null references public.placements(id),
  candidate_id uuid not null references public.candidates(id),
  candidate_name text not null,
  start_date date not null,
  end_date date not null check (end_date >= start_date),
  placement_snapshot jsonb not null check (jsonb_typeof(placement_snapshot) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (week_id, organization_id) references public.hours_weeks(id, organization_id),
  unique (week_id, placement_id),
  unique (id, week_id, organization_id)
);

create table if not exists public.hours_days (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  week_id uuid not null,
  member_id uuid not null,
  work_date date not null,
  current_revision_id uuid,
  foreign key (member_id, week_id, organization_id) references public.hours_week_members(id, week_id, organization_id),
  unique (member_id, work_date),
  unique (id, organization_id)
);

create table if not exists public.hours_day_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  day_id uuid not null,
  revision_number integer not null check (revision_number > 0),
  minutes integer not null check (minutes between 0 and 1440),
  no_hours_reason text,
  note text,
  source_references jsonb not null check (jsonb_typeof(source_references) = 'array'),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (day_id, organization_id) references public.hours_days(id, organization_id),
  unique (day_id, revision_number),
  unique (day_id, id),
  unique (id, day_id, organization_id),
  check ((minutes = 0 and nullif(btrim(no_hours_reason), '') is not null) or (minutes > 0 and no_hours_reason is null)),
  check (length(no_hours_reason) <= 500 and length(note) <= 2000)
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'hours_days_current_revision_fk' and conrelid = 'public.hours_days'::regclass) then
    alter table public.hours_days add constraint hours_days_current_revision_fk
      foreign key (id, current_revision_id) references public.hours_day_revisions(day_id, id);
  end if;
end $$;

create table if not exists public.hours_day_confirmations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  day_id uuid not null,
  revision_id uuid not null,
  decision text not null check (decision in ('confirmed', 'disputed')),
  note text check (length(note) <= 2000),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (revision_id, day_id, organization_id) references public.hours_day_revisions(id, day_id, organization_id),
  check (decision <> 'disputed' or nullif(btrim(note), '') is not null)
);

create table if not exists public.hours_day_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  day_id uuid not null,
  revision_id uuid not null,
  status text not null check (status in ('checked', 'blocked')),
  note text check (length(note) <= 2000),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (revision_id, day_id, organization_id) references public.hours_day_revisions(id, day_id, organization_id),
  check (status <> 'blocked' or nullif(btrim(note), '') is not null)
);

create index if not exists hours_settings_org_idx on public.hours_company_settings(organization_id);
create index if not exists hours_settings_actor_idx on public.hours_company_settings(updated_by);
create index if not exists hours_weeks_company_idx on public.hours_weeks(company_id);
create index if not exists hours_weeks_actor_idx on public.hours_weeks(created_by);
create index if not exists hours_members_org_idx on public.hours_week_members(organization_id);
create index if not exists hours_members_week_org_idx on public.hours_week_members(week_id, organization_id);
create index if not exists hours_members_candidate_idx on public.hours_week_members(candidate_id);
create index if not exists hours_members_placement_idx on public.hours_week_members(placement_id);
create index if not exists hours_days_org_idx on public.hours_days(organization_id);
create index if not exists hours_days_week_idx on public.hours_days(week_id);
create index if not exists hours_days_member_scope_idx on public.hours_days(member_id, week_id, organization_id);
create index if not exists hours_days_revision_idx on public.hours_days(id, current_revision_id);
create index if not exists hours_revisions_org_idx on public.hours_day_revisions(organization_id);
create index if not exists hours_revisions_day_org_idx on public.hours_day_revisions(day_id, organization_id);
create index if not exists hours_revisions_actor_idx on public.hours_day_revisions(created_by);
create index if not exists hours_confirmations_org_idx on public.hours_day_confirmations(organization_id);
create index if not exists hours_confirmations_revision_idx on public.hours_day_confirmations(revision_id, day_id, organization_id, created_at desc, id desc);
create index if not exists hours_confirmations_actor_idx on public.hours_day_confirmations(created_by);
create index if not exists hours_reviews_org_idx on public.hours_day_reviews(organization_id);
create index if not exists hours_reviews_revision_idx on public.hours_day_reviews(revision_id, day_id, organization_id, created_at desc, id desc);
create index if not exists hours_reviews_actor_idx on public.hours_day_reviews(created_by);

-- The backend owns all writes, including those performed with a service key.
-- No policy or client payload can turn a review into payroll release.
do $$ declare t text; begin
  foreach t in array array['hours_company_settings','hours_weeks','hours_week_members','hours_days','hours_day_revisions','hours_day_confirmations','hours_day_reviews'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists hours_internal_read on public.%I', t);
    execute format('create policy hours_internal_read on public.%I for select to authenticated using (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user()) and ((select public.has_role_permission(''finance.view'')) or (select public.has_role_permission(''finance.manage''))))', t);
  end loop;
end $$;

-- Employee reads go through the narrowly projected RPCs below. In particular,
-- direct table SELECT must not expose internal snapshots or review metadata.
do $$ declare t text; begin
  foreach t in array array['hours_company_settings','hours_weeks','hours_week_members','hours_days','hours_day_revisions','hours_day_confirmations','hours_day_reviews'] loop
    execute format('drop policy if exists hours_employee_read on public.%I', t);
  end loop;
end $$;

create or replace function private.hours_require_internal(p_write boolean default false)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := public.get_user_org_id(); begin
  if auth.uid() is null or v_org is null or public.is_internal_user() is not true
     or not (public.has_role_permission('finance.manage') or (not p_write and public.has_role_permission('finance.view'))) then
    raise exception 'Geen toegang tot urenbeheer' using errcode = '42501';
  end if;
  return v_org;
end $$;
revoke all on function private.hours_require_internal(boolean) from public, anon, authenticated, service_role;

create or replace function private.hours_history_immutable()
returns trigger language plpgsql set search_path = '' as $$ begin
  raise exception 'Urenhistorie is onveranderlijk; maak een nieuwe revisie of reactie' using errcode = '42501';
end $$;
revoke all on function private.hours_history_immutable() from public, anon, authenticated, service_role;
do $$ declare t text; begin
  foreach t in array array['hours_weeks','hours_week_members','hours_day_revisions','hours_day_confirmations','hours_day_reviews'] loop
    execute format('drop trigger if exists hours_history_immutable on public.%I', t);
    execute format('create trigger hours_history_immutable before update or delete on public.%I for each row execute function private.hours_history_immutable()', t);
  end loop;
end $$;

create or replace function public.hours_get_company_settings(p_company_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.hours_require_internal(false); v_result jsonb; begin
  if not exists (select 1 from public.companies where id = p_company_id and organization_id = v_org) then
    raise exception 'Opdrachtgever niet beschikbaar' using errcode = '42501';
  end if;
  select jsonb_build_object('company_id', company_id, 'enabled', enabled, 'version', version,
    'submission_day_offset', submission_day_offset, 'submission_time', submission_time,
    'confirmation_day_offset', confirmation_day_offset, 'confirmation_time', confirmation_time,
    'timezone', timezone) into v_result from public.hours_company_settings where company_id = p_company_id and organization_id = v_org;
  return coalesce(v_result, jsonb_build_object('company_id', p_company_id, 'enabled', false, 'version', 0,
    'submission_day_offset', 7, 'submission_time', '12:00:00', 'confirmation_day_offset', 9,
    'confirmation_time', '12:00:00', 'timezone', 'Europe/Amsterdam'));
end $$;

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
  if coalesce(v_version, 0) <> p_expected_version then raise exception 'Instellingen zijn gewijzigd; laad opnieuw' using errcode = '40001'; end if;
  insert into public.hours_company_settings(company_id, organization_id, enabled, version, submission_day_offset, submission_time, confirmation_day_offset, confirmation_time, updated_by)
    values (p_company_id, v_org, p_enabled, 1, p_submission_day_offset, p_submission_time, p_confirmation_day_offset, p_confirmation_time, auth.uid())
  on conflict (company_id) do update set enabled = excluded.enabled, version = hours_company_settings.version + 1,
    submission_day_offset = excluded.submission_day_offset, submission_time = excluded.submission_time,
    confirmation_day_offset = excluded.confirmation_day_offset, confirmation_time = excluded.confirmation_time,
    updated_by = excluded.updated_by, updated_at = clock_timestamp();
  return public.hours_get_company_settings(p_company_id);
end $$;

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
        'minutes', r.minutes, 'no_hours_reason', r.no_hours_reason, 'note', r.note, 'source_references', r.source_references, 'created_at', r.created_at) end,
      'confirmation', (select jsonb_build_object('id', a.id, 'revision_id', a.revision_id, 'decision', a.decision, 'note', a.note, 'created_at', a.created_at)
        from public.hours_day_confirmations a where a.revision_id = r.id order by a.created_at desc, a.id desc limit 1),
      'review', (select jsonb_build_object('id', x.id, 'revision_id', x.revision_id, 'status', x.status, 'note', case when v_internal then x.note else null end, 'created_at', x.created_at)
        from public.hours_day_reviews x where x.revision_id = r.id order by x.created_at desc, x.id desc limit 1),
      'history', case when v_internal then (select coalesce(jsonb_agg(jsonb_build_object(
        'id', h.id, 'revision_number', h.revision_number, 'minutes', h.minutes, 'no_hours_reason', h.no_hours_reason,
        'note', h.note, 'source_references', h.source_references, 'created_by', h.created_by, 'created_at', h.created_at,
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
      count(*) filter (where a.decision = 'disputed' or x.status = 'blocked') as blocked_day_count
    from public.hours_week_members m join public.hours_days d on d.member_id = m.id
    left join lateral (select decision from public.hours_day_confirmations where revision_id = d.current_revision_id order by created_at desc, id desc limit 1) a on true
    left join lateral (select status from public.hours_day_reviews where revision_id = d.current_revision_id order by created_at desc, id desc limit 1) x on true
    where m.week_id = w.id and (v_internal or m.candidate_id = v_candidate)
  ) counts
  where w.organization_id = v_org and (p_week_start is null or w.week_start = p_week_start)
    and (v_internal or counts.member_count > 0);
  return jsonb_build_object('weeks', v_rows, 'can_manage', v_internal and public.has_role_permission('finance.manage'));
end $$;

-- Resolve a local deadline only when exactly one UTC instant represents it.
-- Sample the offsets on both sides of a transition instead of silently picking
-- PostgreSQL's preferred fold offset or shifting a nonexistent spring time.
create or replace function private.hours_deadline_at(p_local timestamp)
returns timestamptz language plpgsql stable security definer set search_path = '' as $$
declare v_guess timestamptz := p_local at time zone 'Europe/Amsterdam'; v_count integer; v_result timestamptz; begin
  select count(distinct candidate), min(candidate) into v_count, v_result from (
    select (p_local at time zone 'UTC') - (
      ((v_guess + make_interval(days => n)) at time zone 'Europe/Amsterdam') - ((v_guess + make_interval(days => n)) at time zone 'UTC')
    ) as candidate from generate_series(-2, 2) n
  ) offsets where candidate at time zone 'Europe/Amsterdam' = p_local;
  if v_count <> 1 then raise exception 'Deadline valt in een ontbrekend of dubbel lokaal tijdstip; kies een ander tijdstip' using errcode = '22023'; end if;
  return v_result;
end $$;
revoke all on function private.hours_deadline_at(timestamp) from public, anon, authenticated, service_role;

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
  if v_count <> jsonb_array_length(v_sources) or v_count = 0 then raise exception 'Plaatsingssnapshot is onvolledig' using errcode = '40001'; end if;
  insert into public.hours_days(organization_id, week_id, member_id, work_date)
    select v_org, v_week, m.id, m.start_date + n from public.hours_week_members m
      cross join lateral generate_series(0, m.end_date - m.start_date) n where m.week_id = v_week;
  return public.hours_get_week(v_week);
end $$;

-- All day mutations lock the week and then the day. Correction and confirmation
-- therefore serialize against exactly the revision the employee saw.
create or replace function private.hours_lock_day(p_day_id uuid, p_internal boolean)
returns public.hours_days language plpgsql security definer set search_path = '' as $$
declare v_org uuid := public.get_user_org_id(); v_week uuid; v_day public.hours_days%rowtype; begin
  if p_internal then perform private.hours_require_internal(true);
  elsif auth.uid() is null or v_org is null or public.get_user_role() is distinct from 'medewerker'::public.user_role then
    raise exception 'Geen toegang tot deze urendag' using errcode = '42501';
  end if;
  select d.week_id into v_week from public.hours_days d join public.hours_week_members m on m.id = d.member_id
    where d.id = p_day_id and d.organization_id = v_org
      and (p_internal or m.candidate_id = public.get_employee_candidate_id());
  if not found then raise exception 'Geen toegang tot deze urendag' using errcode = '42501'; end if;
  perform 1 from public.hours_weeks where id = v_week and organization_id = v_org for update;
  select * into v_day from public.hours_days where id = p_day_id and organization_id = v_org for update;
  if not exists (select 1 from public.hours_weeks w join public.hours_company_settings s on s.company_id = w.company_id and s.organization_id = w.organization_id where w.id = v_week and s.enabled) then
    raise exception 'Nieuwe urenwerkwijze staat uit voor deze opdrachtgever' using errcode = '22023';
  end if;
  return v_day;
end $$;
revoke all on function private.hours_lock_day(uuid, boolean) from public, anon, authenticated, service_role;

create or replace function public.hours_save_day(p_day_id uuid, p_expected_revision_id uuid, p_minutes integer, p_no_hours_reason text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_day public.hours_days%rowtype; v_old public.hours_day_revisions%rowtype; v_revision uuid; begin
  v_day := private.hours_lock_day(p_day_id, true);
  if v_day.current_revision_id is distinct from p_expected_revision_id then raise exception 'Uren zijn gewijzigd; laad opnieuw' using errcode = '40001'; end if;
  p_no_hours_reason := nullif(btrim(p_no_hours_reason), ''); p_note := nullif(btrim(p_note), '');
  if p_minutes is null or p_minutes not between 0 and 1440 or (p_minutes = 0 and p_no_hours_reason is null)
     or (p_minutes > 0 and p_no_hours_reason is not null) or length(p_no_hours_reason) > 500 or length(p_note) > 2000 then
    raise exception 'Vul geldige minuten in; nul uren vereist een reden' using errcode = '22023';
  end if;
  select * into v_old from public.hours_day_revisions where id = v_day.current_revision_id;
  if found and v_old.minutes = p_minutes and v_old.no_hours_reason is not distinct from p_no_hours_reason and v_old.note is not distinct from p_note then
    return public.hours_get_week(v_day.week_id);
  end if;
  insert into public.hours_day_revisions(organization_id, day_id, revision_number, minutes, no_hours_reason, note, source_references, created_by)
    values (v_day.organization_id, v_day.id, coalesce(v_old.revision_number, 0) + 1, p_minutes, p_no_hours_reason, p_note,
      '[{"kind":"manual","label":"Handmatige invoer"}]'::jsonb, auth.uid()) returning id into v_revision;
  update public.hours_days set current_revision_id = v_revision where id = v_day.id;
  return public.hours_get_week(v_day.week_id);
end $$;

create or replace function public.hours_confirm_day(p_day_id uuid, p_expected_revision_id uuid, p_decision text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_day public.hours_days%rowtype; v_last public.hours_day_confirmations%rowtype; begin
  v_day := private.hours_lock_day(p_day_id, false);
  if p_expected_revision_id is null or v_day.current_revision_id is distinct from p_expected_revision_id then raise exception 'Uren zijn gewijzigd of ontbreken; laad opnieuw' using errcode = '40001'; end if;
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

create or replace function public.hours_review_day(p_day_id uuid, p_expected_revision_id uuid, p_status text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_day public.hours_days%rowtype; v_last public.hours_day_reviews%rowtype; begin
  v_day := private.hours_lock_day(p_day_id, true);
  if p_expected_revision_id is null or v_day.current_revision_id is distinct from p_expected_revision_id then raise exception 'Uren zijn gewijzigd of ontbreken; laad opnieuw' using errcode = '40001'; end if;
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

-- Explicit, nonempty own-day selection. A stale/foreign day aborts the whole
-- transaction; omitted or still empty days are never implicitly confirmed.
create or replace function public.hours_confirm_days(p_week_id uuid, p_revisions jsonb, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_item record; v_day public.hours_days%rowtype; v_last public.hours_day_confirmations%rowtype; v_org uuid := public.get_user_org_id(); begin
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
    if v_day.current_revision_id is distinct from v_item.revision_id then raise exception 'Uren zijn gewijzigd; laad opnieuw' using errcode = '40001'; end if;
    select * into v_last from public.hours_day_confirmations where revision_id = v_item.revision_id order by created_at desc, id desc limit 1;
    if not found or v_last.decision <> 'confirmed' or v_last.note is distinct from p_note then
      insert into public.hours_day_confirmations(organization_id, day_id, revision_id, decision, note, created_by)
        values (v_day.organization_id, v_day.id, v_item.revision_id, 'confirmed', p_note, auth.uid());
    end if;
  end loop;
  return public.hours_get_week(p_week_id);
end $$;

-- SECURITY DEFINER RPCs require real profile context; no anon or service-key shortcut.
do $$ declare f regprocedure; begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('hours_get_company_settings','hours_set_company_settings','hours_get_week','hours_list_weeks','hours_create_week','hours_save_day','hours_confirm_day','hours_review_day','hours_confirm_days') loop
    execute format('revoke all on function %s from public, anon, service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

comment on table public.hours_day_reviews is 'Internal manual review of an exact revision. checked is not matrix validation, release or permission to export.';
comment on table public.hours_weeks is 'Immutable company-week and configuration snapshot. Isolated foundation; cannot release or export and never writes legacy timesheets.';
comment on table public.hours_company_settings is 'Opt-in pilot configuration. No messages are scheduled or sent by this foundation.';
notify pgrst, 'reload schema';
