-- Pages inside an uploaded source, and assignment that can stay openly undecided.
-- One delivered file can carry several employees. A proposal now says which page
-- it came from, and a proposal whose employee is not certain blocks applying
-- until an internal user confirms it. Nothing here writes hours: only
-- hours_apply_source_proposal still creates a day revision, and it still takes
-- the proposal literally.
begin;

-- How many pages the delivery had. Null means unknown: an older source, or a
-- file the browser could not count. A photo is always exactly one page.
alter table public.hours_week_sources add column if not exists page_count integer;
do $$ begin
  alter table public.hours_week_sources add constraint hours_week_sources_page_count_check
    check (page_count is null or page_count between 1 and 2000);
exception when duplicate_object then null; end $$;

alter table public.hours_source_proposals add column if not exists page_number integer;
alter table public.hours_source_proposals add column if not exists assignment_uncertain boolean not null default false;
alter table public.hours_source_proposals add column if not exists assignment_confirmed_by uuid references public.profiles(id);
alter table public.hours_source_proposals add column if not exists assignment_confirmed_at timestamptz;
-- The confirmation note explains a decision about the proposal; it deliberately
-- stays out of note, which is proposed content and is applied verbatim.
alter table public.hours_source_proposals add column if not exists assignment_note text;
do $$ begin
  alter table public.hours_source_proposals add constraint hours_source_proposals_assignment_note_check
    check (length(assignment_note) <= 2000 and (assignment_note is null or assignment_confirmed_at is not null));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.hours_source_proposals add constraint hours_source_proposals_page_number_check
    check (page_number is null or page_number between 1 and 2000);
exception when duplicate_object then null; end $$;
-- Confirming only ever resolves a doubt that was recorded up front, and it
-- always names the person who resolved it.
do $$ begin
  alter table public.hours_source_proposals add constraint hours_source_proposals_assignment_check
    check ((assignment_confirmed_at is null) = (assignment_confirmed_by is null)
       and (assignment_confirmed_at is null or assignment_uncertain));
exception when duplicate_object then null; end $$;

-- What an internal user decided about one page of one delivered file. Append-only
-- like every other hours fact: a wrong decision is superseded, never rewritten,
-- so it always stays visible who said a page belonged to one person.
create table if not exists public.hours_source_pages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  week_id uuid not null,
  source_id uuid not null,
  page_number integer not null check (page_number between 1 and 2000),
  assignment text not null check (assignment in ('single', 'multiple', 'unclear')),
  member_id uuid,
  note text check (length(note) <= 2000),
  status text not null default 'active' check (status in ('active', 'withdrawn')),
  withdrawn_by uuid references public.profiles(id),
  withdrawn_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (source_id, week_id, organization_id) references public.hours_week_sources(id, week_id, organization_id),
  foreign key (member_id, week_id, organization_id) references public.hours_week_members(id, week_id, organization_id),
  check ((assignment = 'single' and member_id is not null)
      or (assignment <> 'single' and member_id is null)),
  check ((status = 'active' and withdrawn_at is null and withdrawn_by is null)
      or (status = 'withdrawn' and withdrawn_at is not null and withdrawn_by is not null))
);

create unique index if not exists hours_source_pages_active_idx
  on public.hours_source_pages(source_id, page_number) where status = 'active';
create index if not exists hours_source_pages_org_idx on public.hours_source_pages(organization_id);
create index if not exists hours_source_pages_week_idx on public.hours_source_pages(week_id, organization_id);
create index if not exists hours_source_pages_source_idx on public.hours_source_pages(source_id, week_id, organization_id);
create index if not exists hours_source_pages_member_idx on public.hours_source_pages(member_id, week_id, organization_id);
create index if not exists hours_source_pages_actor_idx on public.hours_source_pages(created_by);
create index if not exists hours_source_pages_withdrawer_idx on public.hours_source_pages(withdrawn_by);

do $$ begin
  execute 'alter table public.hours_source_pages enable row level security';
  execute 'revoke all on public.hours_source_pages from public, anon, authenticated, service_role';
  execute 'grant select on public.hours_source_pages to authenticated';
  execute 'drop policy if exists hours_internal_read on public.hours_source_pages';
  execute 'create policy hours_internal_read on public.hours_source_pages for select to authenticated using (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user()) and ((select public.has_role_permission(''finance.view'')) or (select public.has_role_permission(''finance.manage''))))';
  execute 'drop policy if exists hours_workflow_module_required on public.hours_source_pages';
  execute 'create policy hours_workflow_module_required on public.hours_source_pages as restrictive for select to authenticated using ((select private.hours_module_enabled()))';
end $$;

create or replace function private.hours_source_page_guard()
returns trigger language plpgsql set search_path = '' as $$ begin
  if tg_op = 'DELETE' then
    raise exception 'Paginatoewijzingen zijn onveranderlijk' using errcode = '42501';
  end if;
  if old.status <> 'active' or new.status <> 'withdrawn'
     or (new.id, new.organization_id, new.week_id, new.source_id, new.page_number, new.assignment,
         new.member_id, new.note, new.created_by, new.created_at)
        is distinct from
        (old.id, old.organization_id, old.week_id, old.source_id, old.page_number, old.assignment,
         old.member_id, old.note, old.created_by, old.created_at) then
    raise exception 'Paginatoewijzingen zijn onveranderlijk' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.hours_source_page_guard() from public, anon, authenticated, service_role;
drop trigger if exists hours_source_page_guard on public.hours_source_pages;
create trigger hours_source_page_guard before update or delete on public.hours_source_pages
  for each row execute function private.hours_source_page_guard();

create or replace function private.hours_week_sources_projection(p_week_id uuid, p_org uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('week_id', p_week_id,
    -- Open points on the week, counted by the server so a screen never has to
    -- add up only what happens to be on it.
    'open_proposals', (select count(*) from public.hours_source_proposals p
      where p.week_id = p_week_id and p.organization_id = p_org and p.status = 'open'),
    'undecided_assignments', (select count(*) from public.hours_source_proposals p
      where p.week_id = p_week_id and p.organization_id = p_org and p.status = 'open'
        and p.assignment_uncertain and p.assignment_confirmed_at is null),
    'can_manage', public.is_internal_user() and public.has_role_permission('finance.manage')
      and exists (select 1 from public.hours_weeks w
        join public.hours_company_settings c on c.company_id = w.company_id and c.organization_id = w.organization_id
        where w.id = p_week_id and w.organization_id = p_org and c.enabled),
    'sources', coalesce((select jsonb_agg(jsonb_build_object(
      'id', s.id, 'file_name', s.file_name, 'content_type', s.content_type, 'byte_size', s.byte_size,
      'content_hash', s.content_hash, 'storage_path', s.storage_path, 'created_at', s.created_at,
      'page_count', s.page_count,
      'pages', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', g.id, 'page_number', g.page_number, 'assignment', g.assignment, 'member_id', g.member_id,
        'candidate_name', gm.candidate_name, 'note', g.note, 'created_at', g.created_at)
        order by g.page_number), '[]'::jsonb)
        from public.hours_source_pages g
        left join public.hours_week_members gm on gm.id = g.member_id
        where g.source_id = s.id and g.organization_id = p_org and g.status = 'active'),
      'proposals', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'day_id', p.day_id, 'member_id', d.member_id, 'work_date', d.work_date,
        'candidate_name', m.candidate_name, 'status', p.status, 'minutes', p.minutes,
        'no_hours_reason', p.no_hours_reason, 'note', p.note, 'source_input', p.source_input,
        'page_label', p.page_label, 'page_number', p.page_number,
        'assignment_uncertain', p.assignment_uncertain,
        'assignment_confirmed_at', p.assignment_confirmed_at, 'assignment_note', p.assignment_note,
        'applied_revision_id', p.applied_revision_id,
        'applied_created_revision', p.applied_created_revision, 'resolution_note', p.resolution_note,
        'resolved_at', p.resolved_at, 'created_at', p.created_at) order by p.created_at, p.id), '[]'::jsonb)
        from public.hours_source_proposals p
        join public.hours_days d on d.id = p.day_id and d.organization_id = p.organization_id
        join public.hours_week_members m on m.id = d.member_id
        where p.source_id = s.id and p.organization_id = p_org)
      ) order by s.created_at, s.id) from public.hours_week_sources s
      where s.week_id = p_week_id and s.organization_id = p_org), '[]'::jsonb));
$$;
revoke all on function private.hours_week_sources_projection(uuid, uuid) from public, anon, authenticated, service_role;

-- The browser counts the pages of a PDF before uploading. That number is a fact
-- about the delivery, not a trust boundary: the reviewer always sees the actual
-- bytes before a proposal is applied. A photo is one page by definition.
drop function if exists public.hours_add_week_source(uuid, text, text, text);
create or replace function public.hours_add_week_source(p_week_id uuid, p_content_hash text,
  p_file_name text, p_content_type text, p_page_count integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_week public.hours_weeks%rowtype; v_path text; v_extension text; v_object record;
  v_id uuid; v_duplicate boolean := false;
begin
  v_week := private.hours_lock_week(p_week_id);
  p_content_hash := lower(btrim(coalesce(p_content_hash, '')));
  p_file_name := nullif(private.hours_source_trim(p_file_name), '');
  if p_content_hash !~ '^[0-9a-f]{64}$' or p_file_name is null or length(p_file_name) > 255
     or p_file_name ~ '[[:cntrl:]/\\]' then
    raise exception 'Ongeldige bronverwijzing of bestandsnaam' using errcode = '22023';
  end if;
  v_extension := case p_content_type when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png' else null end;
  if v_extension is null then
    raise exception 'Alleen PDF, JPG en PNG worden als bron aanvaard' using errcode = '22023';
  end if;
  if p_content_type <> 'application/pdf' then p_page_count := 1; end if;
  if p_page_count is not null and p_page_count not between 1 and 2000 then
    raise exception 'Het aantal pagina''s van deze bron is ongeldig' using errcode = '22023';
  end if;
  v_path := v_week.organization_id::text || '/' || p_week_id::text || '/' || p_content_hash || '.' || v_extension;
  select (o.metadata->>'size')::bigint as byte_size, o.metadata->>'mimetype' as mimetype into v_object
    from storage.objects o where o.bucket_id = 'hours-sources' and o.name = v_path;
  if not found or v_object.byte_size is null or v_object.byte_size not between 1 and 26214400
     or v_object.mimetype is distinct from p_content_type then
    raise exception 'Het geüploade bestand is niet gevonden of komt niet overeen' using errcode = '22023';
  end if;
  insert into public.hours_week_sources(organization_id, week_id, company_id, storage_path, file_name,
    content_type, byte_size, content_hash, page_count, created_by)
    values (v_week.organization_id, p_week_id, v_week.company_id, v_path, p_file_name, p_content_type,
      v_object.byte_size, p_content_hash, p_page_count, auth.uid())
  on conflict (week_id, content_hash) do nothing returning id into v_id;
  if v_id is null then
    v_duplicate := true;
    select id into v_id from public.hours_week_sources where week_id = p_week_id and content_hash = p_content_hash;
  end if;
  return private.hours_week_sources_projection(p_week_id, v_week.organization_id)
    || jsonb_build_object('duplicate', v_duplicate, 'source_id', v_id);
end $$;

drop function if exists public.hours_create_source_proposal(uuid, uuid, integer, text, text, jsonb, text);
drop function if exists public.hours_create_source_proposal(uuid, uuid, integer, text, text, jsonb, text, integer);
create or replace function public.hours_create_source_proposal(p_source_id uuid, p_day_id uuid, p_minutes integer,
  p_no_hours_reason text, p_note text, p_source_input jsonb, p_page_label text,
  p_page_number integer default null, p_assignment_uncertain boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_day public.hours_days%rowtype; v_source public.hours_week_sources%rowtype; begin
  v_day := private.hours_lock_day(p_day_id, true);
  select * into v_source from public.hours_week_sources
    where id = p_source_id and organization_id = v_day.organization_id and week_id = v_day.week_id;
  if not found then raise exception 'De bron hoort niet bij deze urenweek' using errcode = '42501'; end if;
  p_no_hours_reason := nullif(private.hours_source_trim(p_no_hours_reason), '');
  p_note := nullif(private.hours_source_trim(p_note), '');
  p_page_label := nullif(private.hours_source_trim(p_page_label), '');
  if p_minutes is null or p_minutes not between 0 and 1440 or (p_minutes = 0 and p_no_hours_reason is null)
     or (p_minutes > 0 and p_no_hours_reason is not null) or length(p_no_hours_reason) > 500
     or length(p_note) > 2000 or length(p_page_label) > 200 then
    raise exception 'Vul geldige minuten in; nul uren vereist een reden' using errcode = '22023';
  end if;
  if p_page_number is not null
     and (p_page_number < 1 or p_page_number > coalesce(v_source.page_count, p_page_number)) then
    raise exception 'Deze bron heeft die pagina niet' using errcode = '22023';
  end if;
  perform private.hours_validate_source_input(p_source_input);
  p_assignment_uncertain := coalesce(p_assignment_uncertain, false)
    or private.hours_page_contradicts(p_source_id, p_page_number, v_day.member_id);
  insert into public.hours_source_proposals(organization_id, week_id, source_id, day_id, minutes,
    no_hours_reason, note, source_input, page_label, page_number, assignment_uncertain, created_by)
    values (v_day.organization_id, v_day.week_id, p_source_id, p_day_id, p_minutes, p_no_hours_reason,
      p_note, p_source_input, p_page_label, p_page_number, p_assignment_uncertain, auth.uid());
  return private.hours_week_sources_projection(v_day.week_id, v_day.organization_id);
end $$;

-- The proposal's content still never changes. Only two things may move, each
-- exactly once: the recorded doubt about who this is, and the resolution.
create or replace function private.hours_proposal_guard()
returns trigger language plpgsql set search_path = '' as $$ begin
  if tg_op = 'DELETE' then
    raise exception 'Urenvoorstellen zijn onveranderlijk' using errcode = '42501';
  end if;
  if (new.id, new.organization_id, new.week_id, new.source_id, new.day_id, new.minutes,
      new.no_hours_reason, new.note, new.source_input, new.page_label, new.page_number,
      new.assignment_uncertain, new.created_by, new.created_at)
     is distinct from
     (old.id, old.organization_id, old.week_id, old.source_id, old.day_id, old.minutes,
      old.no_hours_reason, old.note, old.source_input, old.page_label, old.page_number,
      old.assignment_uncertain, old.created_by, old.created_at) then
    raise exception 'Urenvoorstellen zijn onveranderlijk' using errcode = '42501';
  end if;
  if old.status = 'open' and new.status = 'open' then
    if old.assignment_confirmed_at is not null or new.assignment_confirmed_at is null
       or new.assignment_confirmed_by is null or old.assignment_note is not null
       or (new.applied_revision_id, new.applied_created_revision, new.resolved_by, new.resolved_at,
           new.resolution_note)
          is distinct from (old.applied_revision_id, old.applied_created_revision, old.resolved_by,
           old.resolved_at, old.resolution_note) then
      raise exception 'Urenvoorstellen zijn onveranderlijk' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.status <> 'open' or new.status not in ('applied', 'discarded')
     or (new.assignment_confirmed_by, new.assignment_confirmed_at, new.assignment_note)
        is distinct from (old.assignment_confirmed_by, old.assignment_confirmed_at, old.assignment_note) then
    raise exception 'Urenvoorstellen zijn onveranderlijk' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.hours_proposal_guard() from public, anon, authenticated, service_role;

-- Confirming settles who this proposal is about. It decides nothing else: the
-- proposal stays open and applying remains a separate, deliberate act.
create or replace function public.hours_confirm_proposal_assignment(p_proposal_id uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_proposal public.hours_source_proposals%rowtype; begin
  v_proposal := private.hours_lock_open_proposal(p_proposal_id);
  perform private.hours_lock_day(v_proposal.day_id, true);
  if not v_proposal.assignment_uncertain then
    raise exception 'De toewijzing van dit voorstel stond al vast' using errcode = '22023';
  end if;
  if v_proposal.assignment_confirmed_at is not null then
    raise exception 'De toewijzing van dit voorstel is al bevestigd' using errcode = '22023';
  end if;
  p_note := nullif(private.hours_source_trim(p_note), '');
  if length(p_note) > 2000 then raise exception 'Toelichting is te lang' using errcode = '22023'; end if;
  update public.hours_source_proposals
    set assignment_confirmed_by = auth.uid(), assignment_confirmed_at = clock_timestamp(),
        assignment_note = p_note
    where id = p_proposal_id;
  return private.hours_week_sources_projection(v_proposal.week_id, v_proposal.organization_id);
end $$;

-- An undecided assignment is a real blockade: nobody may turn a guess about who
-- worked into payable time.
create or replace function public.hours_apply_source_proposal(p_proposal_id uuid, p_expected_revision_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_proposal public.hours_source_proposals%rowtype; v_day public.hours_days%rowtype;
  v_source public.hours_week_sources%rowtype; v_revision uuid; v_created boolean;
begin
  v_proposal := private.hours_lock_open_proposal(p_proposal_id);
  if v_proposal.assignment_uncertain and v_proposal.assignment_confirmed_at is null then
    raise exception 'Bevestig eerst om welke medewerker dit voorstel gaat' using errcode = '22023';
  end if;
  v_day := private.hours_lock_day(v_proposal.day_id, true);
  if v_day.current_revision_id is distinct from p_expected_revision_id then
    raise exception 'Uren zijn gewijzigd; laad opnieuw' using errcode = 'PT409';
  end if;
  select * into v_source from public.hours_week_sources where id = v_proposal.source_id;
  v_revision := private.hours_write_day_revision(v_day, v_proposal.minutes, v_proposal.no_hours_reason,
    v_proposal.note, v_proposal.source_input,
    jsonb_build_array(jsonb_build_object('kind', 'upload', 'label', v_source.file_name,
      'reference', coalesce(nullif(concat_ws(' · ',
        case when v_proposal.page_number is not null then 'pagina ' || v_proposal.page_number end,
        v_proposal.page_label), ''), null))));
  v_created := v_revision is not null;
  update public.hours_source_proposals set status = 'applied',
    applied_revision_id = coalesce(v_revision, v_day.current_revision_id), applied_created_revision = v_created,
    resolved_by = auth.uid(), resolved_at = clock_timestamp() where id = p_proposal_id;
  return public.hours_get_week(v_day.week_id) || jsonb_build_object('applied_created_revision', v_created,
    'sources', private.hours_week_sources_projection(v_day.week_id, v_day.organization_id));
end $$;

-- A page whose owner nobody could read, or that was decided to belong to
-- someone else, can never quietly produce a certain assignment.
create or replace function private.hours_page_contradicts(p_source_id uuid, p_page_number integer, p_member_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from public.hours_source_pages g
    where g.source_id = p_source_id and g.page_number = p_page_number and g.status = 'active'
      and (g.assignment = 'unclear' or (g.assignment = 'single' and g.member_id is distinct from p_member_id)));
$$;
revoke all on function private.hours_page_contradicts(uuid, integer, uuid) from public, anon, authenticated, service_role;

create or replace function private.hours_lock_source(p_source_id uuid)
returns public.hours_week_sources language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.hours_require_internal(true); v_source public.hours_week_sources%rowtype; begin
  select * into v_source from public.hours_week_sources where id = p_source_id and organization_id = v_org;
  if not found then raise exception 'Bron niet beschikbaar' using errcode = '42501'; end if;
  perform private.hours_lock_week(v_source.week_id);
  return v_source;
end $$;
revoke all on function private.hours_lock_source(uuid) from public, anon, authenticated, service_role;

-- Recording who a page belongs to. Saying "one employee" is refused as soon as
-- the page demonstrably carries more than one: a delivery with several notes on
-- it may never end up on a single name by one careless click.
create or replace function public.hours_set_source_page(p_source_id uuid, p_page_number integer,
  p_assignment text, p_member_id uuid default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_source public.hours_week_sources%rowtype; v_members integer; begin
  v_source := private.hours_lock_source(p_source_id);
  if p_assignment is null or p_assignment not in ('single', 'multiple', 'unclear')
     or p_page_number is null or p_page_number < 1
     or p_page_number > coalesce(v_source.page_count, p_page_number) then
    raise exception 'Ongeldige paginatoewijzing' using errcode = '22023';
  end if;
  p_note := nullif(private.hours_source_trim(p_note), '');
  if length(p_note) > 2000 then raise exception 'Toelichting is te lang' using errcode = '22023'; end if;
  if p_assignment = 'single' then
    if p_member_id is null or not exists (select 1 from public.hours_week_members m
        where m.id = p_member_id and m.week_id = v_source.week_id
          and m.organization_id = v_source.organization_id) then
      raise exception 'Kies een medewerker uit deze week' using errcode = '22023';
    end if;
    select count(distinct d.member_id) into v_members from public.hours_source_proposals p
      join public.hours_days d on d.id = p.day_id and d.organization_id = p.organization_id
      where p.source_id = p_source_id and p.page_number = p_page_number
        and p.organization_id = v_source.organization_id and p.status <> 'discarded';
    if v_members > 1 then
      raise exception 'Deze pagina heeft al voorstellen voor meerdere medewerkers en kan niet op één naam staan'
        using errcode = '22023';
    end if;
  else
    p_member_id := null;
  end if;
  update public.hours_source_pages set status = 'withdrawn', withdrawn_by = auth.uid(),
    withdrawn_at = clock_timestamp()
    where source_id = p_source_id and page_number = p_page_number and status = 'active';
  insert into public.hours_source_pages(organization_id, week_id, source_id, page_number, assignment,
    member_id, note, created_by)
    values (v_source.organization_id, v_source.week_id, p_source_id, p_page_number, p_assignment,
      p_member_id, p_note, auth.uid());
  return private.hours_week_sources_projection(v_source.week_id, v_source.organization_id);
end $$;

-- Taking over a whole page in one act. Only possible for a page that is on one
-- name, and only for days of that very employee: the shortcut can never reach
-- another person. It still produces proposals, never hours.
create or replace function public.hours_create_page_proposals(p_source_id uuid, p_page_number integer,
  p_entries jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_source public.hours_week_sources%rowtype; v_page public.hours_source_pages%rowtype;
  v_entry jsonb; v_day public.hours_days%rowtype; v_minutes integer; v_reason text; v_note text;
  v_label text; v_ids uuid[];
begin
  v_source := private.hours_lock_source(p_source_id);
  select * into v_page from public.hours_source_pages
    where source_id = p_source_id and page_number = p_page_number and status = 'active';
  if not found or v_page.assignment <> 'single' then
    raise exception 'Leg eerst vast dat deze pagina bij één medewerker hoort' using errcode = '22023';
  end if;
  if jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries) = 0
     or jsonb_array_length(p_entries) > 31 then
    raise exception 'Geef één tot eenendertig dagen op' using errcode = '22023';
  end if;
  select array_agg(value->>'day_id' order by value->>'day_id')
    into v_ids from jsonb_array_elements(p_entries) as value;
  if array_length(v_ids, 1) is distinct from
     (select count(distinct id) from unnest(v_ids) as id) then
    raise exception 'Elke werkdag mag maar één keer in de overname staan' using errcode = '22023';
  end if;
  -- A fixed lock order over the days keeps this next to the existing day writers.
  foreach v_entry in array (select array_agg(value order by value->>'day_id')
                            from jsonb_array_elements(p_entries) as value) loop
    v_day := private.hours_lock_day((v_entry->>'day_id')::uuid, true);
    if v_day.member_id is distinct from v_page.member_id then
      raise exception 'Deze pagina staat op naam van één medewerker; kies alleen dagen van die medewerker'
        using errcode = '22023';
    end if;
    v_minutes := (v_entry->>'minutes')::integer;
    v_reason := nullif(private.hours_source_trim(v_entry->>'no_hours_reason'), '');
    v_note := nullif(private.hours_source_trim(v_entry->>'note'), '');
    v_label := nullif(private.hours_source_trim(v_entry->>'page_label'), '');
    if v_minutes is null or v_minutes not between 0 and 1440 or (v_minutes = 0 and v_reason is null)
       or (v_minutes > 0 and v_reason is not null) or length(v_reason) > 500 or length(v_note) > 2000
       or length(v_label) > 200 then
      raise exception 'Vul geldige minuten in; nul uren vereist een reden' using errcode = '22023';
    end if;
    perform private.hours_validate_source_input(v_entry->'source_input');
    insert into public.hours_source_proposals(organization_id, week_id, source_id, day_id, minutes,
      no_hours_reason, note, source_input, page_label, page_number, assignment_uncertain, created_by)
      values (v_source.organization_id, v_source.week_id, p_source_id, v_day.id, v_minutes, v_reason,
        v_note, v_entry->'source_input', v_label, p_page_number, false, auth.uid());
  end loop;
  return private.hours_week_sources_projection(v_source.week_id, v_source.organization_id);
end $$;

do $$ declare f text; begin
  foreach f in array array['public.hours_add_week_source(uuid, text, text, text, integer)',
    'public.hours_create_source_proposal(uuid, uuid, integer, text, text, jsonb, text, integer, boolean)',
    'public.hours_confirm_proposal_assignment(uuid, text)',
    'public.hours_set_source_page(uuid, integer, text, uuid, text)',
    'public.hours_create_page_proposals(uuid, integer, jsonb)'] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;
