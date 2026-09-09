-- A personal client week page that needs no login.
--
-- The boundary is unchanged: what a client fills in is a *proposal*, never a day
-- revision. Only hours_apply_source_proposal writes a revision, it still takes
-- the proposal literally, and it still requires a named internal user. Nothing
-- here touches timesheets, invoicing or communication.
--
-- The link itself is the secret. The database keeps only its SHA-256, scoped to
-- exactly one client week, with a validity period and the ability to withdraw
-- it. There is no parameter anywhere below by which a client could name another
-- week: the week comes from the link, and every workday is checked against it.
--
-- The public functions are executable by service_role only. The edge function is
-- the single holder of that key, and it authorizes nothing itself: every rule
-- below is enforced here, where a mistake in a screen cannot get around it.
begin;

-- The link. Append-only like every other hours fact, except for withdrawing it
-- and for noting that it was opened.
create table if not exists public.hours_client_week_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  week_id uuid not null,
  company_id uuid not null references public.companies(id),
  -- Only the digest. The secret is handed out exactly once, when the link is
  -- issued, and exists nowhere in this database.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  label text not null check (length(label) between 1 and 200),
  expires_at timestamptz not null,
  last_opened_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id),
  revoke_note text check (length(revoke_note) <= 2000),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (week_id, organization_id) references public.hours_weeks(id, organization_id),
  unique (id, week_id, organization_id),
  check (expires_at > created_at),
  check ((revoked_at is null) = (revoked_by is null)),
  check (revoke_note is null or revoked_at is not null)
);

-- What the client said about this delivery: that more follows, or that this is
-- everything. Append-only, so a change of mind stays visible as a change of mind.
create table if not exists public.hours_client_week_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  week_id uuid not null,
  link_id uuid not null,
  kind text not null check (kind in ('later', 'complete')),
  note text check (length(note) <= 2000),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (link_id, week_id, organization_id)
    references public.hours_client_week_links(id, week_id, organization_id)
);

-- Access log for the public endpoint, so token guessing runs into a wall. It
-- holds no hours and no tenant, exactly like match_response_attempts, and the
-- edge function writes it *before* it resolves a token: an exception inside the
-- database would roll back a throttle counter written in the same transaction.
create table if not exists public.hours_client_link_attempts (
  id uuid primary key default gen_random_uuid(),
  ip_hash text not null check (length(ip_hash) between 1 and 128),
  token_prefix text check (length(token_prefix) <= 16),
  action text not null check (length(action) between 1 and 32),
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists hours_client_links_org_idx on public.hours_client_week_links(organization_id);
create index if not exists hours_client_links_week_idx on public.hours_client_week_links(week_id, organization_id);
create index if not exists hours_client_links_company_idx on public.hours_client_week_links(company_id);
create index if not exists hours_client_links_actor_idx on public.hours_client_week_links(created_by);
create index if not exists hours_client_links_revoker_idx on public.hours_client_week_links(revoked_by);
create index if not exists hours_client_reports_org_idx on public.hours_client_week_reports(organization_id);
create index if not exists hours_client_reports_week_idx on public.hours_client_week_reports(week_id, organization_id);
create index if not exists hours_client_reports_link_idx
  on public.hours_client_week_reports(link_id, created_at desc, id desc);
create index if not exists hours_client_attempts_window_idx
  on public.hours_client_link_attempts(created_at desc);
create index if not exists hours_client_attempts_ip_idx
  on public.hours_client_link_attempts(ip_hash, created_at desc);

-- Same posture as the sixteen hours tables before them: the backend owns every
-- write, internal reads need finance rights, and the SaaS switch gates direct
-- reads too.
do $$ declare t text; begin
  foreach t in array array['hours_client_week_links', 'hours_client_week_reports'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists hours_internal_read on public.%I', t);
    execute format('create policy hours_internal_read on public.%I for select to authenticated using (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user()) and ((select public.has_role_permission(''finance.view'')) or (select public.has_role_permission(''finance.manage''))))', t);
    execute format('drop policy if exists hours_workflow_module_required on public.%I', t);
    execute format('create policy hours_workflow_module_required on public.%I as restrictive for select to authenticated using ((select private.hours_module_enabled()))', t);
  end loop;
end $$;

-- The attempt log is reachable only by the edge function's key. RLS is on with
-- no policy at all, so anon and authenticated see a hard denial.
alter table public.hours_client_link_attempts enable row level security;
revoke all on public.hours_client_link_attempts from public, anon, authenticated, service_role;
grant select, insert, delete on public.hours_client_link_attempts to service_role;

-- A wrong link is withdrawn, never rewritten, so it stays visible who handed out
-- access to which week.
create or replace function private.hours_client_link_guard()
returns trigger language plpgsql set search_path = '' as $$ begin
  if tg_op = 'DELETE' then
    raise exception 'Klantweeklinks zijn onveranderlijk' using errcode = '42501';
  end if;
  if (new.id, new.organization_id, new.week_id, new.company_id, new.token_hash, new.label,
      new.expires_at, new.created_by, new.created_at)
     is distinct from
     (old.id, old.organization_id, old.week_id, old.company_id, old.token_hash, old.label,
      old.expires_at, old.created_by, old.created_at) then
    raise exception 'Klantweeklinks zijn onveranderlijk' using errcode = '42501';
  end if;
  -- Withdrawing happens once and is never undone.
  if old.revoked_at is not null
     and (new.revoked_at, new.revoked_by, new.revoke_note)
         is distinct from (old.revoked_at, old.revoked_by, old.revoke_note) then
    raise exception 'Deze klantweeklink is al ingetrokken' using errcode = '42501';
  end if;
  if new.revoked_at is null and old.revoked_at is not null then
    raise exception 'Een ingetrokken klantweeklink kan niet terugkomen' using errcode = '42501';
  end if;
  -- Opening only ever moves forward.
  if new.last_opened_at is distinct from old.last_opened_at
     and (new.last_opened_at is null or new.last_opened_at < coalesce(old.last_opened_at, new.last_opened_at)) then
    raise exception 'Klantweeklinks zijn onveranderlijk' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.hours_client_link_guard() from public, anon, authenticated, service_role;
drop trigger if exists hours_client_link_guard on public.hours_client_week_links;
create trigger hours_client_link_guard before update or delete on public.hours_client_week_links
  for each row execute function private.hours_client_link_guard();

drop trigger if exists hours_history_immutable on public.hours_client_week_reports;
create trigger hours_history_immutable before update or delete on public.hours_client_week_reports
  for each row execute function private.hours_history_immutable();

-- A delivered file and a proposal can now come from the client instead of from
-- an internal user. Nobody internal proposed it, and the administration says so
-- rather than crediting the person who handed out the link.
alter table public.hours_week_sources add column if not exists client_link_id uuid
  references public.hours_client_week_links(id);
alter table public.hours_week_sources alter column created_by drop not null;
alter table public.hours_source_proposals add column if not exists client_link_id uuid
  references public.hours_client_week_links(id);
alter table public.hours_source_proposals alter column created_by drop not null;
-- Form input is not a delivered file; it has no source to point at.
alter table public.hours_source_proposals alter column source_id drop not null;

create index if not exists hours_sources_client_link_idx on public.hours_week_sources(client_link_id);
create index if not exists hours_proposals_client_link_idx on public.hours_source_proposals(client_link_id);
-- One standing delivery per workday per link: a later save replaces the earlier
-- one, and the database makes that a fact rather than a habit of the writer.
create unique index if not exists hours_proposals_open_client_day_idx
  on public.hours_source_proposals(client_link_id, day_id)
  where status = 'open' and client_link_id is not null;

do $$ begin
  alter table public.hours_week_sources add constraint hours_week_sources_author_check
    check ((client_link_id is null) = (created_by is not null));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.hours_source_proposals add constraint hours_source_proposals_author_check
    check ((client_link_id is null and source_id is not null and created_by is not null)
        or (client_link_id is not null and source_id is null and created_by is null));
exception when duplicate_object then null; end $$;

-- The resolution rule, with exactly one addition: a client replacing its own
-- earlier delivery resolves it without an internal actor, because there is none.
-- Applying still demands one, which is the invariant that matters.
do $$ declare c record; begin
  for c in select conname from pg_constraint
    where conrelid = 'public.hours_source_proposals'::regclass and contype = 'c'
      and conname <> 'hours_source_proposals_resolution_check'
      and pg_get_constraintdef(oid) like '%applied_created_revision%'
  loop execute format('alter table public.hours_source_proposals drop constraint %I', c.conname); end loop;
end $$;
alter table public.hours_source_proposals drop constraint if exists hours_source_proposals_resolution_check;
alter table public.hours_source_proposals add constraint hours_source_proposals_resolution_check
  check ((status = 'open' and resolved_at is null and resolved_by is null
          and applied_revision_id is null and applied_created_revision is null)
      or (status = 'discarded' and resolved_at is not null
          and (resolved_by is not null or client_link_id is not null)
          and applied_revision_id is null and applied_created_revision is null)
      or (status = 'applied' and resolved_at is not null and resolved_by is not null
          and applied_revision_id is not null and applied_created_revision is not null));

-- The proposal's content still never changes; client_link_id joins the tuple
-- that may not move, so a delivery can never be re-attributed afterwards.
create or replace function private.hours_proposal_guard()
returns trigger language plpgsql set search_path = '' as $$ begin
  if tg_op = 'DELETE' then
    raise exception 'Urenvoorstellen zijn onveranderlijk' using errcode = '42501';
  end if;
  if (new.id, new.organization_id, new.week_id, new.source_id, new.day_id, new.minutes,
      new.no_hours_reason, new.note, new.source_input, new.page_label, new.page_number,
      new.assignment_uncertain, new.client_link_id, new.created_by, new.created_at)
     is distinct from
     (old.id, old.organization_id, old.week_id, old.source_id, old.day_id, old.minutes,
      old.no_hours_reason, old.note, old.source_input, old.page_label, old.page_number,
      old.assignment_uncertain, old.client_link_id, old.created_by, old.created_at) then
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

-- --------------------------------------------------------------------------
-- Internal side: issuing and withdrawing a link.
-- --------------------------------------------------------------------------

-- How much of the week this link has delivered, counted by the server so a
-- screen never has to add up only what happens to be on it.
create or replace function private.hours_client_link_progress(p_link public.hours_client_week_links)
returns jsonb language sql stable set search_path = '' as $$
  with expected as (
    select count(*)::integer as total from public.hours_days d
    where d.week_id = p_link.week_id and d.organization_id = p_link.organization_id
  ), provided as (
    select count(distinct p.day_id)::integer as total from public.hours_source_proposals p
    where p.client_link_id = p_link.id and p.status <> 'discarded'
  )
  select jsonb_build_object('expected_days', expected.total, 'provided_days', provided.total,
    'outstanding_days', greatest(expected.total - provided.total, 0),
    -- The client may say it is done; the days decide whether it is.
    'complete', expected.total > 0 and provided.total >= expected.total)
  from expected, provided;
$$;
revoke all on function private.hours_client_link_progress(public.hours_client_week_links)
  from public, anon, authenticated, service_role;

create or replace function private.hours_client_link_report(p_link_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('kind', r.kind, 'note', r.note, 'created_at', r.created_at)
  from public.hours_client_week_reports r where r.link_id = p_link_id
  order by r.created_at desc, r.id desc limit 1;
$$;
revoke all on function private.hours_client_link_report(uuid) from public, anon, authenticated, service_role;

-- One place decides how a media type is stored, so the path a client is handed
-- and the path its registration looks up can never drift apart.
create or replace function private.hours_source_extension(p_content_type text)
returns text language sql immutable set search_path = '' as $$
  select case p_content_type
    when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg' when 'image/png' then 'png'
    when 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' then 'xlsx'
    when 'application/vnd.ms-excel' then 'xls' else null end;
$$;
revoke all on function private.hours_source_extension(text) from public, anon, authenticated, service_role;

-- The released intake now reads its extension from that same helper, so the
-- comment above is a fact rather than an intention. Behaviour is unchanged.
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
  v_extension := private.hours_source_extension(p_content_type);
  if v_extension is null then
    raise exception 'Alleen PDF, JPG, PNG en Excel worden als bron aanvaard' using errcode = '22023';
  end if;
  if p_content_type in ('image/jpeg', 'image/png') then p_page_count := 1; end if;
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

-- The released projection, with the client links added. The token digest is
-- deliberately absent: nothing in a screen ever needs it.
create or replace function private.hours_week_sources_projection(p_week_id uuid, p_org uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('week_id', p_week_id,
    'open_proposals', (select count(*) from public.hours_source_proposals p
      where p.week_id = p_week_id and p.organization_id = p_org and p.status = 'open'),
    'undecided_assignments', (select count(*) from public.hours_source_proposals p
      where p.week_id = p_week_id and p.organization_id = p_org and p.status = 'open'
        and p.assignment_uncertain and p.assignment_confirmed_at is null),
    'can_manage', public.is_internal_user() and public.has_role_permission('finance.manage')
      and exists (select 1 from public.hours_weeks w
        join public.hours_company_settings c on c.company_id = w.company_id and c.organization_id = w.organization_id
        where w.id = p_week_id and w.organization_id = p_org and c.enabled),
    'client_links', coalesce((select jsonb_agg(jsonb_build_object(
      'id', l.id, 'label', l.label, 'created_at', l.created_at, 'expires_at', l.expires_at,
      'last_opened_at', l.last_opened_at, 'revoked_at', l.revoked_at, 'revoke_note', l.revoke_note,
      'report', private.hours_client_link_report(l.id),
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

-- The server generates the secret and hands it back exactly once. Two random
-- UUIDs give 244 bits of entropy from pg_catalog alone, so this depends on no
-- extension and on nothing the browser chose.
create or replace function public.hours_issue_client_week_link(p_week_id uuid, p_label text,
  p_valid_days integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_week public.hours_weeks%rowtype; v_secret text; v_id uuid; begin
  v_week := private.hours_lock_week(p_week_id);
  p_label := nullif(private.hours_source_trim(p_label), '');
  if p_label is null or length(p_label) > 200 then
    raise exception 'Geef een herkenbare naam aan deze link' using errcode = '22023';
  end if;
  if p_valid_days is null or p_valid_days < 1 or p_valid_days > 180 then
    raise exception 'Kies een geldigheidsduur van één tot honderdtachtig dagen' using errcode = '22023';
  end if;
  v_secret := replace(pg_catalog.gen_random_uuid()::text, '-', '')
           || replace(pg_catalog.gen_random_uuid()::text, '-', '');
  insert into public.hours_client_week_links(organization_id, week_id, company_id, token_hash, label,
    expires_at, created_by)
    values (v_week.organization_id, p_week_id, v_week.company_id,
      encode(pg_catalog.sha256(convert_to(v_secret, 'UTF8')), 'hex'), p_label,
      clock_timestamp() + make_interval(days => p_valid_days), auth.uid())
    returning id into v_id;
  return private.hours_week_sources_projection(p_week_id, v_week.organization_id)
    || jsonb_build_object('secret', v_secret, 'link_id', v_id);
end $$;

create or replace function public.hours_revoke_client_week_link(p_link_id uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := private.hours_require_internal(true); v_link public.hours_client_week_links%rowtype;
  v_week_id uuid;
begin
  -- Week first, then the link row. Every client write reaches this same row
  -- through its foreign key *after* taking the week, so locking the link first
  -- would deadlock against a client saving or uploading at that very moment.
  select week_id into v_week_id from public.hours_client_week_links
    where id = p_link_id and organization_id = v_org;
  if not found then raise exception 'Deze klantweeklink is niet beschikbaar' using errcode = '42501'; end if;
  perform private.hours_lock_week(v_week_id);
  select * into v_link from public.hours_client_week_links
    where id = p_link_id and organization_id = v_org for update;
  if not found then raise exception 'Deze klantweeklink is niet beschikbaar' using errcode = '42501'; end if;
  if v_link.revoked_at is not null then
    raise exception 'Deze klantweeklink is al ingetrokken' using errcode = '22023';
  end if;
  p_note := nullif(private.hours_source_trim(p_note), '');
  if length(p_note) > 2000 then raise exception 'Toelichting is te lang' using errcode = '22023'; end if;
  update public.hours_client_week_links set revoked_at = clock_timestamp(), revoked_by = auth.uid(),
    revoke_note = p_note where id = p_link_id;
  return private.hours_week_sources_projection(v_link.week_id, v_org);
end $$;

-- --------------------------------------------------------------------------
-- Public side: reached only through the trusted edge function.
-- --------------------------------------------------------------------------

-- Resolving a token is where every refusal lives. There is no session here, so
-- the SaaS module is checked against the link's organization instead of against
-- a profile: an old link may never outlive a switched-off module.
create or replace function private.hours_client_link_resolve(p_token_hash text, p_write boolean)
returns public.hours_client_week_links language plpgsql volatile security definer set search_path = '' as $$
declare v_link public.hours_client_week_links%rowtype; begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Alleen de vertrouwde klantpagina kan deze gegevens lezen' using errcode = '42501';
  end if;
  -- PT404 says "this link does not open", and nothing else does. 42501 stays
  -- what it is everywhere in this module: a refusal about the request, such as
  -- a workday outside this link's week. Sharing one code between the two would
  -- make a stale workday replace the whole page and discard what was typed.
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Deze link werkt niet' using errcode = 'PT404';
  end if;
  select * into v_link from public.hours_client_week_links where token_hash = p_token_hash;
  if not found then raise exception 'Deze link werkt niet' using errcode = 'PT404'; end if;
  if not exists (select 1 from public.organization_modules m
      where m.organization_id = v_link.organization_id and m.module_name = 'uren-workflow'
        and m.enabled is true) then
    raise exception 'De urenmodule is niet beschikbaar voor dit bedrijf' using errcode = 'PT404';
  end if;
  -- The PTxxx convention this module already uses for conflicts: PostgREST turns
  -- these into the matching HTTP status, so the page can say what is wrong
  -- without parsing a sentence. Someone without a token gets PT404 either way,
  -- so the distinction leaks nothing.
  if v_link.revoked_at is not null then
    raise exception 'Deze link is ingetrokken' using errcode = 'PT403';
  end if;
  if v_link.expires_at <= clock_timestamp() then
    raise exception 'Deze link is verlopen' using errcode = 'PT410';
  end if;
  if not exists (select 1 from public.hours_weeks w
      join public.hours_company_settings c on c.company_id = w.company_id and c.organization_id = w.organization_id
      where w.id = v_link.week_id and w.organization_id = v_link.organization_id and c.enabled) then
    raise exception 'Nieuwe urenwerkwijze staat uit voor deze opdrachtgever' using errcode = '22023';
  end if;
  if p_write then
    perform 1 from public.hours_weeks where id = v_link.week_id
      and organization_id = v_link.organization_id for update;
  end if;
  return v_link;
end $$;
revoke all on function private.hours_client_link_resolve(text, boolean)
  from public, anon, authenticated, service_role;

-- The week comes from the link, so a workday of another client simply is not
-- found. This is the constructional reason a token of client A cannot open B.
create or replace function private.hours_lock_client_day(p_day_id uuid,
  p_link public.hours_client_week_links)
returns public.hours_days language plpgsql security definer set search_path = '' as $$
declare v_day public.hours_days%rowtype; begin
  select * into v_day from public.hours_days
    where id = p_day_id and organization_id = p_link.organization_id and week_id = p_link.week_id
    for update;
  if not found then
    raise exception 'Deze werkdag hoort niet bij deze urenweek' using errcode = '42501';
  end if;
  return v_day;
end $$;
revoke all on function private.hours_lock_client_day(uuid, public.hours_client_week_links)
  from public, anon, authenticated, service_role;

-- What the client is shown: the expected employees and days of one week, and its
-- own delivery. No day revision, no internal note, no review, no classification.
create or replace function private.hours_client_week_projection(p_link public.hours_client_week_links)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'week', (select jsonb_build_object('id', w.id, 'company_name', w.company_name,
      'week_start', w.week_start, 'submission_deadline_at', w.submission_deadline_at)
      from public.hours_weeks w where w.id = p_link.week_id),
    'label', p_link.label, 'expires_at', p_link.expires_at,
    'report', private.hours_client_link_report(p_link.id),
    'members', coalesce((select jsonb_agg(jsonb_build_object(
      'id', m.id, 'candidate_name', m.candidate_name,
      'days', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'work_date', d.work_date,
        'delivered', (select jsonb_build_object('minutes', p.minutes,
            'no_hours_reason', p.no_hours_reason, 'note', p.note, 'status', p.status,
            'created_at', p.created_at)
          from public.hours_source_proposals p
          where p.day_id = d.id and p.client_link_id = p_link.id and p.status <> 'discarded'
          order by p.created_at desc, p.id desc limit 1))
        order by d.work_date), '[]'::jsonb)
        from public.hours_days d where d.member_id = m.id))
      order by m.candidate_name, m.id)
      from public.hours_week_members m where m.week_id = p_link.week_id
        and m.organization_id = p_link.organization_id), '[]'::jsonb))
  || private.hours_client_link_progress(p_link);
$$;
revoke all on function private.hours_client_week_projection(public.hours_client_week_links)
  from public, anon, authenticated, service_role;

create or replace function public.hours_client_week_view(p_token_hash text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_link public.hours_client_week_links%rowtype; begin
  v_link := private.hours_client_link_resolve(p_token_hash, false);
  update public.hours_client_week_links set last_opened_at = clock_timestamp() where id = v_link.id;
  return private.hours_client_week_projection(v_link);
end $$;

-- One delivery by the client, recorded as proposals in a single transaction.
-- All or nothing: a delivery refused halfway would leave exactly the half set
-- the specification forbids. A blank field is not in here at all, so a day
-- nobody filled in stays unknown instead of quietly becoming zero.
create or replace function public.hours_client_week_save(p_token_hash text, p_entries jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_link public.hours_client_week_links%rowtype; v_entry jsonb; v_day public.hours_days%rowtype;
  v_minutes integer; v_reason text; v_note text; v_ids uuid[];
  v_existing public.hours_source_proposals%rowtype;
begin
  -- Deliberately without the week lock: the released order is proposal, then
  -- week, then day (see the intake contract). Taking the week here and the
  -- proposals afterwards would invert that against hours_apply_source_proposal
  -- and hours_discard_source_proposal, and a client saving while the office
  -- applies the very same day would deadlock.
  v_link := private.hours_client_link_resolve(p_token_hash, false);
  if jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries) = 0
     or jsonb_array_length(p_entries) > 500 then
    raise exception 'Geef één tot vijfhonderd dagen op' using errcode = '22023';
  end if;
  select array_agg((value->>'day_id')::uuid order by value->>'day_id')
    into v_ids from jsonb_array_elements(p_entries) as value;
  if array_length(v_ids, 1) is distinct from (select count(distinct id) from unnest(v_ids) as id) then
    raise exception 'Elke werkdag mag maar één keer in deze aanlevering staan' using errcode = '22023';
  end if;
  -- 1. The proposals this delivery can touch, in a fixed order over their ids.
  perform p.id from public.hours_source_proposals p
    where p.client_link_id = v_link.id and p.day_id = any(v_ids)
      and p.status in ('open', 'applied') order by p.id for update;
  -- 2. Then the week, and 3. the days, matching every other hours writer.
  perform 1 from public.hours_weeks where id = v_link.week_id
    and organization_id = v_link.organization_id for update;
  foreach v_entry in array (select array_agg(value order by value->>'day_id')
                            from jsonb_array_elements(p_entries) as value) loop
    v_day := private.hours_lock_client_day((v_entry->>'day_id')::uuid, v_link);
    v_minutes := (v_entry->>'minutes')::integer;
    v_reason := nullif(private.hours_source_trim(v_entry->>'no_hours_reason'), '');
    v_note := nullif(private.hours_source_trim(v_entry->>'note'), '');
    if v_minutes is null or v_minutes not between 0 and 1440 or (v_minutes = 0 and v_reason is null)
       or (v_minutes > 0 and v_reason is not null) or length(v_reason) > 500 or length(v_note) > 2000 then
      raise exception 'Vul geldige uren in; geen uren vereist een reden' using errcode = '22023';
    end if;
    -- The client's own standing word about this day: the open delivery if there
    -- is one, otherwise the one the office already applied. Pressing save again
    -- without changing anything may not put a settled day back on the desk.
    select * into v_existing from public.hours_source_proposals
      where day_id = v_day.id and client_link_id = v_link.id and status in ('open', 'applied')
      order by (status = 'open') desc, created_at desc, id desc limit 1;
    if found and (v_existing.minutes, v_existing.no_hours_reason, v_existing.note)
       is not distinct from (v_minutes, v_reason, v_note) then
      continue;
    end if;
    -- Correcting means withdrawing the earlier delivery and recording a new one,
    -- exactly as everywhere else in this module. It can only ever reach this
    -- link's own standing delivery for this very day.
    update public.hours_source_proposals set status = 'discarded',
      resolution_note = 'Vervangen door een latere aanlevering van de opdrachtgever',
      resolved_at = clock_timestamp()
      where day_id = v_day.id and client_link_id = v_link.id and status = 'open';
    insert into public.hours_source_proposals(organization_id, week_id, day_id, minutes,
      no_hours_reason, note, client_link_id)
      values (v_link.organization_id, v_link.week_id, v_day.id, v_minutes, v_reason, v_note, v_link.id);
  end loop;
  return private.hours_client_week_projection(v_link);
end $$;

-- A delivered file is evidence, not hours. It becomes a source with the client
-- as its origin and produces no proposals: reading it stays a separate, reviewed
-- act by an internal user, on exactly the same boundary as before.
create or replace function public.hours_client_week_add_source(p_token_hash text, p_content_hash text,
  p_file_name text, p_content_type text, p_page_count integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_link public.hours_client_week_links%rowtype; v_path text; v_extension text; v_object record;
  v_id uuid; v_duplicate boolean := false;
begin
  v_link := private.hours_client_link_resolve(p_token_hash, true);
  p_content_hash := lower(btrim(coalesce(p_content_hash, '')));
  p_file_name := nullif(private.hours_source_trim(p_file_name), '');
  if p_content_hash !~ '^[0-9a-f]{64}$' or p_file_name is null or length(p_file_name) > 255
     or p_file_name ~ '[[:cntrl:]/\\]' then
    raise exception 'Ongeldige bronverwijzing of bestandsnaam' using errcode = '22023';
  end if;
  v_extension := private.hours_source_extension(p_content_type);
  if v_extension is null then
    raise exception 'Alleen PDF, JPG, PNG en Excel worden als bron aanvaard' using errcode = '22023';
  end if;
  if p_content_type in ('image/jpeg', 'image/png') then p_page_count := 1; end if;
  if p_page_count is not null and p_page_count not between 1 and 2000 then
    raise exception 'Het aantal pagina''s van deze bron is ongeldig' using errcode = '22023';
  end if;
  v_path := v_link.organization_id::text || '/' || v_link.week_id::text || '/' || p_content_hash
         || '.' || v_extension;
  select (o.metadata->>'size')::bigint as byte_size, o.metadata->>'mimetype' as mimetype into v_object
    from storage.objects o where o.bucket_id = 'hours-sources' and o.name = v_path;
  if not found or v_object.byte_size is null or v_object.byte_size not between 1 and 26214400
     or v_object.mimetype is distinct from p_content_type then
    raise exception 'Het geüploade bestand is niet gevonden of komt niet overeen' using errcode = '22023';
  end if;
  insert into public.hours_week_sources(organization_id, week_id, company_id, storage_path, file_name,
    content_type, byte_size, content_hash, page_count, client_link_id)
    values (v_link.organization_id, v_link.week_id, v_link.company_id, v_path, p_file_name,
      p_content_type, v_object.byte_size, p_content_hash, p_page_count, v_link.id)
  on conflict (week_id, content_hash) do nothing returning id into v_id;
  if v_id is null then
    v_duplicate := true;
    select id into v_id from public.hours_week_sources
      where week_id = v_link.week_id and content_hash = p_content_hash;
  end if;
  return private.hours_client_week_projection(v_link)
    || jsonb_build_object('duplicate', v_duplicate, 'source_id', v_id);
end $$;

-- Where a client may upload. The path is derived from the link, never from the
-- request, so a client can only ever write inside its own organization and week.
-- Handing out this path is not access: the bucket has no policy for anon, and
-- the edge function signs a one-off upload for exactly this object.
create or replace function public.hours_client_week_upload_path(p_token_hash text, p_content_hash text,
  p_content_type text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_link public.hours_client_week_links%rowtype; v_extension text; begin
  v_link := private.hours_client_link_resolve(p_token_hash, false);
  p_content_hash := lower(btrim(coalesce(p_content_hash, '')));
  v_extension := private.hours_source_extension(p_content_type);
  if p_content_hash !~ '^[0-9a-f]{64}$' or v_extension is null then
    raise exception 'Alleen PDF, JPG, PNG en Excel worden als bron aanvaard' using errcode = '22023';
  end if;
  return jsonb_build_object('path', v_link.organization_id::text || '/' || v_link.week_id::text
    || '/' || p_content_hash || '.' || v_extension);
end $$;

create or replace function public.hours_client_week_report(p_token_hash text, p_kind text,
  p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_link public.hours_client_week_links%rowtype; begin
  v_link := private.hours_client_link_resolve(p_token_hash, true);
  if p_kind is null or p_kind not in ('later', 'complete') then
    raise exception 'Onbekende melding over deze aanlevering' using errcode = '22023';
  end if;
  p_note := nullif(private.hours_source_trim(p_note), '');
  if length(p_note) > 2000 then raise exception 'Toelichting is te lang' using errcode = '22023'; end if;
  insert into public.hours_client_week_reports(organization_id, week_id, link_id, kind, note)
    values (v_link.organization_id, v_link.week_id, v_link.id, p_kind, p_note);
  return private.hours_client_week_projection(v_link);
end $$;

-- Applying still takes the proposal literally and still names the internal user
-- who decided. Only the provenance grows a third kind: the client delivered it.
-- The employee sees the client's own name, never the internal link label.
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
  foreach f in array array['public.hours_issue_client_week_link(uuid, text, integer)',
    'public.hours_revoke_client_week_link(uuid, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array['public.hours_client_week_view(text)',
    'public.hours_client_week_save(text, jsonb)',
    'public.hours_client_week_add_source(text, text, text, text, integer)',
    'public.hours_client_week_upload_path(text, text, text)',
    'public.hours_client_week_report(text, text, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

comment on table public.hours_client_week_links is 'Personal link to exactly one client week. Only the SHA-256 of the secret is stored; the secret is handed out once at issue time. Withdrawing is one-way and never deletes what was already delivered.';
comment on table public.hours_client_week_reports is 'What the client said about its delivery: that more follows, or that this is everything. Append-only; the server still counts the days.';
comment on table public.hours_client_link_attempts is 'Throttle log for the public client week endpoint. Service-role only, holds no hours and no tenant.';

notify pgrst, 'reload schema';

commit;
