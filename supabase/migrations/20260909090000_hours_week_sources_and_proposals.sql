-- Internal intake for the hours workflow: keep an uploaded original privately,
-- record a reviewable entry proposal, and apply it as an explicit new day revision.
-- A source or proposal is never payable time on its own: only applying writes a
-- revision, and nothing here touches timesheets, invoicing or communication.
begin;

-- Private evidence bucket. Storage itself enforces the size limit and the
-- declared media types; the internal reviewer always sees the actual bytes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hours-sources', 'hours-sources', false, 26214400,
        array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.hours_week_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  week_id uuid not null,
  company_id uuid not null references public.companies(id),
  storage_path text not null unique,
  file_name text not null check (length(file_name) between 1 and 255),
  content_type text not null check (content_type in ('application/pdf', 'image/jpeg', 'image/png')),
  byte_size bigint not null check (byte_size between 1 and 26214400),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (week_id, organization_id) references public.hours_weeks(id, organization_id),
  unique (week_id, content_hash),
  unique (id, week_id, organization_id)
);

-- A proposal is an immutable suggestion. Its content never changes: adjusting it
-- means discarding it and recording a new one, so the audit trail shows who
-- proposed what and who decided. Only the resolution columns move once.
create table if not exists public.hours_source_proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  week_id uuid not null,
  source_id uuid not null,
  day_id uuid not null,
  status text not null default 'open' check (status in ('open', 'applied', 'discarded')),
  minutes integer not null check (minutes between 0 and 1440),
  no_hours_reason text,
  note text,
  source_input jsonb,
  page_label text check (page_label is null or length(page_label) between 1 and 200),
  applied_revision_id uuid,
  applied_created_revision boolean,
  resolution_note text check (length(resolution_note) <= 2000),
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (source_id, week_id, organization_id) references public.hours_week_sources(id, week_id, organization_id),
  foreign key (day_id, organization_id) references public.hours_days(id, organization_id),
  foreign key (applied_revision_id, day_id, organization_id) references public.hours_day_revisions(id, day_id, organization_id),
  check ((minutes = 0 and nullif(btrim(no_hours_reason), '') is not null)
      or (minutes > 0 and no_hours_reason is null)),
  check (length(no_hours_reason) <= 500 and length(note) <= 2000),
  check ((status = 'open' and resolved_at is null and resolved_by is null
          and applied_revision_id is null and applied_created_revision is null)
      or (status = 'discarded' and resolved_at is not null and resolved_by is not null
          and applied_revision_id is null and applied_created_revision is null)
      or (status = 'applied' and resolved_at is not null and resolved_by is not null
          and applied_revision_id is not null and applied_created_revision is not null))
);

create index if not exists hours_sources_org_idx on public.hours_week_sources(organization_id);
create index if not exists hours_sources_week_org_idx on public.hours_week_sources(week_id, organization_id);
create index if not exists hours_sources_company_idx on public.hours_week_sources(company_id);
create index if not exists hours_sources_actor_idx on public.hours_week_sources(created_by);
create index if not exists hours_proposals_org_idx on public.hours_source_proposals(organization_id);
create index if not exists hours_proposals_week_idx on public.hours_source_proposals(week_id, organization_id);
create index if not exists hours_proposals_source_idx on public.hours_source_proposals(source_id, week_id, organization_id);
create index if not exists hours_proposals_day_idx on public.hours_source_proposals(day_id, organization_id);
create index if not exists hours_proposals_revision_idx on public.hours_source_proposals(applied_revision_id, day_id, organization_id);
create index if not exists hours_proposals_actor_idx on public.hours_source_proposals(created_by);
create index if not exists hours_proposals_resolver_idx on public.hours_source_proposals(resolved_by);
create index if not exists hours_proposals_open_idx on public.hours_source_proposals(week_id) where status = 'open';

-- Same posture as the other thirteen hours tables: the backend owns every write,
-- internal reads need finance rights, and the SaaS switch gates direct reads too.
do $$ declare t text; begin
  foreach t in array array['hours_week_sources', 'hours_source_proposals'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists hours_internal_read on public.%I', t);
    execute format('create policy hours_internal_read on public.%I for select to authenticated using (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user()) and ((select public.has_role_permission(''finance.view'')) or (select public.has_role_permission(''finance.manage''))))', t);
    execute format('drop policy if exists hours_workflow_module_required on public.%I', t);
    execute format('create policy hours_workflow_module_required on public.%I as restrictive for select to authenticated using ((select private.hours_module_enabled()))', t);
    execute format('drop trigger if exists hours_history_immutable on public.%I', t);
  end loop;
end $$;

-- Uploaded originals are append-only evidence.
create trigger hours_history_immutable before update or delete on public.hours_week_sources
  for each row execute function private.hours_history_immutable();

-- A proposal resolves exactly once; its proposed content stays untouched.
create or replace function private.hours_proposal_guard()
returns trigger language plpgsql set search_path = '' as $$ begin
  if tg_op = 'DELETE' then
    raise exception 'Urenvoorstellen zijn onveranderlijk' using errcode = '42501';
  end if;
  if old.status <> 'open' or new.status not in ('applied', 'discarded') then
    raise exception 'Urenvoorstellen zijn onveranderlijk' using errcode = '42501';
  end if;
  if (new.id, new.organization_id, new.week_id, new.source_id, new.day_id, new.minutes,
      new.no_hours_reason, new.note, new.source_input, new.page_label, new.created_by, new.created_at)
     is distinct from
     (old.id, old.organization_id, old.week_id, old.source_id, old.day_id, old.minutes,
      old.no_hours_reason, old.note, old.source_input, old.page_label, old.created_by, old.created_at) then
    raise exception 'Urenvoorstellen zijn onveranderlijk' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.hours_proposal_guard() from public, anon, authenticated, service_role;
drop trigger if exists hours_proposal_guard on public.hours_source_proposals;
create trigger hours_proposal_guard before update or delete on public.hours_source_proposals
  for each row execute function private.hours_proposal_guard();

-- Storage RLS needs a boolean the caller may evaluate. It answers only about the
-- caller's own active profile and a path they already supplied, and it never
-- returns data. Reading needs finance.view, writing finance.manage, and the SaaS
-- module must be on. There is no update or delete policy: originals stay put.
create or replace function private.hours_source_object_allowed(p_name text, p_write boolean)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid; v_week uuid; begin
  if auth.uid() is null or p_name is null then return false; end if;
  select organization_id into v_org from public.profiles where id = auth.uid() and is_active is true;
  if v_org is null then return false; end if;
  if split_part(p_name, '/', 1) is distinct from v_org::text then return false; end if;
  if split_part(p_name, '/', 2) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  v_week := split_part(p_name, '/', 2)::uuid;
  if not private.hours_module_enabled() then return false; end if;
  if public.is_internal_user() is not true then return false; end if;
  if not (public.has_role_permission('finance.manage')
          or (not p_write and public.has_role_permission('finance.view'))) then return false; end if;
  return exists (select 1 from public.hours_weeks w where w.id = v_week and w.organization_id = v_org);
end $$;
revoke all on function private.hours_source_object_allowed(text, boolean) from public, anon, authenticated, service_role;
grant execute on function private.hours_source_object_allowed(text, boolean) to authenticated;

drop policy if exists hours_sources_object_select on storage.objects;
create policy hours_sources_object_select on storage.objects for select to authenticated
using (bucket_id = 'hours-sources' and (select private.hours_source_object_allowed(name, false)));

drop policy if exists hours_sources_object_insert on storage.objects;
create policy hours_sources_object_insert on storage.objects for insert to authenticated
with check (bucket_id = 'hours-sources' and (select private.hours_source_object_allowed(name, true)));

create or replace function private.hours_lock_week(p_week_id uuid)
returns public.hours_weeks language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.hours_require_internal(true); v_week public.hours_weeks%rowtype; begin
  select * into v_week from public.hours_weeks where id = p_week_id and organization_id = v_org for update;
  if not found then raise exception 'Geen toegang tot deze urenweek' using errcode = '42501'; end if;
  if not exists (select 1 from public.hours_company_settings s
                 where s.company_id = v_week.company_id and s.organization_id = v_org and s.enabled) then
    raise exception 'Nieuwe urenwerkwijze staat uit voor deze opdrachtgever' using errcode = '22023';
  end if;
  return v_week;
end $$;
revoke all on function private.hours_lock_week(uuid) from public, anon, authenticated, service_role;

-- One place decides whether saved facts differ, so an applied proposal follows
-- exactly the same revision, no-op and compare-and-swap rules as manual entry.
create or replace function private.hours_write_day_revision(p_day public.hours_days, p_minutes integer,
  p_no_hours_reason text, p_note text, p_source_input jsonb, p_source_references jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_old public.hours_day_revisions%rowtype; v_revision uuid; begin
  if p_minutes is null or p_minutes not between 0 and 1440 or (p_minutes = 0 and p_no_hours_reason is null)
     or (p_minutes > 0 and p_no_hours_reason is not null) or length(p_no_hours_reason) > 500 or length(p_note) > 2000 then
    raise exception 'Vul geldige minuten in; nul uren vereist een reden' using errcode = '22023';
  end if;
  perform private.hours_validate_source_input(p_source_input);
  select * into v_old from public.hours_day_revisions where id = p_day.current_revision_id;
  if found and (v_old.minutes, v_old.no_hours_reason, v_old.note, v_old.source_input)
     is not distinct from (p_minutes, p_no_hours_reason, p_note, p_source_input) then
    return null;
  end if;
  insert into public.hours_day_revisions(organization_id, day_id, revision_number, minutes, no_hours_reason,
    note, source_references, source_input, created_by)
    values (p_day.organization_id, p_day.id, coalesce(v_old.revision_number, 0) + 1, p_minutes, p_no_hours_reason,
      p_note, p_source_references, p_source_input, auth.uid()) returning id into v_revision;
  update public.hours_days set current_revision_id = v_revision where id = p_day.id;
  return v_revision;
end $$;
revoke all on function private.hours_write_day_revision(public.hours_days, integer, text, text, jsonb, jsonb)
  from public, anon, authenticated, service_role;

-- Unchanged behaviour; the manual path now shares the revision writer above.
create or replace function public.hours_save_day_source(p_day_id uuid, p_expected_revision_id uuid, p_minutes integer,
  p_no_hours_reason text, p_note text, p_source_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_day public.hours_days%rowtype; begin
  v_day := private.hours_lock_day(p_day_id, true);
  if v_day.current_revision_id is distinct from p_expected_revision_id then raise exception 'Uren zijn gewijzigd; laad opnieuw' using errcode = 'PT409'; end if;
  p_no_hours_reason := nullif(private.hours_source_trim(p_no_hours_reason), ''); p_note := nullif(private.hours_source_trim(p_note), '');
  perform private.hours_write_day_revision(v_day, p_minutes, p_no_hours_reason, p_note, p_source_input,
    '[{"kind":"manual","label":"Handmatige invoer"}]'::jsonb);
  return public.hours_get_week(v_day.week_id);
end $$;

create or replace function private.hours_week_sources_projection(p_week_id uuid, p_org uuid)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('week_id', p_week_id,
    'can_manage', public.is_internal_user() and public.has_role_permission('finance.manage')
      and exists (select 1 from public.hours_weeks w
        join public.hours_company_settings c on c.company_id = w.company_id and c.organization_id = w.organization_id
        where w.id = p_week_id and w.organization_id = p_org and c.enabled),
    'sources', coalesce((select jsonb_agg(jsonb_build_object(
      'id', s.id, 'file_name', s.file_name, 'content_type', s.content_type, 'byte_size', s.byte_size,
      'content_hash', s.content_hash, 'storage_path', s.storage_path, 'created_at', s.created_at,
      'proposals', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'day_id', p.day_id, 'member_id', d.member_id, 'work_date', d.work_date,
        'candidate_name', m.candidate_name, 'status', p.status, 'minutes', p.minutes,
        'no_hours_reason', p.no_hours_reason, 'note', p.note, 'source_input', p.source_input,
        'page_label', p.page_label, 'applied_revision_id', p.applied_revision_id,
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

create or replace function public.hours_get_week_sources(p_week_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.hours_require_internal(false); begin
  if not exists (select 1 from public.hours_weeks where id = p_week_id and organization_id = v_org) then
    raise exception 'Geen toegang tot deze urenweek' using errcode = '42501';
  end if;
  return private.hours_week_sources_projection(p_week_id, v_org);
end $$;

-- The browser uploads to a path derived from the organization, the week and the
-- content digest, then registers it. Size and media type are read back from
-- Storage, so the row always describes an object that really exists.
create or replace function public.hours_add_week_source(p_week_id uuid, p_content_hash text,
  p_file_name text, p_content_type text)
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
  v_path := v_week.organization_id::text || '/' || p_week_id::text || '/' || p_content_hash || '.' || v_extension;
  select (o.metadata->>'size')::bigint as byte_size, o.metadata->>'mimetype' as mimetype into v_object
    from storage.objects o where o.bucket_id = 'hours-sources' and o.name = v_path;
  if not found or v_object.byte_size is null or v_object.byte_size not between 1 and 26214400
     or v_object.mimetype is distinct from p_content_type then
    raise exception 'Het geüploade bestand is niet gevonden of komt niet overeen' using errcode = '22023';
  end if;
  insert into public.hours_week_sources(organization_id, week_id, company_id, storage_path, file_name,
    content_type, byte_size, content_hash, created_by)
    values (v_week.organization_id, p_week_id, v_week.company_id, v_path, p_file_name, p_content_type,
      v_object.byte_size, p_content_hash, auth.uid())
  on conflict (week_id, content_hash) do nothing returning id into v_id;
  if v_id is null then
    v_duplicate := true;
    select id into v_id from public.hours_week_sources where week_id = p_week_id and content_hash = p_content_hash;
  end if;
  return private.hours_week_sources_projection(p_week_id, v_week.organization_id)
    || jsonb_build_object('duplicate', v_duplicate, 'source_id', v_id);
end $$;

create or replace function public.hours_create_source_proposal(p_source_id uuid, p_day_id uuid, p_minutes integer,
  p_no_hours_reason text, p_note text, p_source_input jsonb, p_page_label text)
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
  perform private.hours_validate_source_input(p_source_input);
  insert into public.hours_source_proposals(organization_id, week_id, source_id, day_id, minutes,
    no_hours_reason, note, source_input, page_label, created_by)
    values (v_day.organization_id, v_day.week_id, p_source_id, p_day_id, p_minutes, p_no_hours_reason,
      p_note, p_source_input, p_page_label, auth.uid());
  return private.hours_week_sources_projection(v_day.week_id, v_day.organization_id);
end $$;

create or replace function private.hours_lock_open_proposal(p_proposal_id uuid)
returns public.hours_source_proposals language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.hours_require_internal(true); v_proposal public.hours_source_proposals%rowtype; begin
  select * into v_proposal from public.hours_source_proposals
    where id = p_proposal_id and organization_id = v_org for update;
  if not found then raise exception 'Voorstel niet beschikbaar' using errcode = '42501'; end if;
  if v_proposal.status <> 'open' then
    raise exception 'Dit voorstel is al verwerkt' using errcode = '22023';
  end if;
  return v_proposal;
end $$;
revoke all on function private.hours_lock_open_proposal(uuid) from public, anon, authenticated, service_role;

create or replace function public.hours_discard_source_proposal(p_proposal_id uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_proposal public.hours_source_proposals%rowtype; begin
  v_proposal := private.hours_lock_open_proposal(p_proposal_id);
  perform private.hours_lock_day(v_proposal.day_id, true);
  p_note := nullif(private.hours_source_trim(p_note), '');
  if length(p_note) > 2000 then raise exception 'Toelichting is te lang' using errcode = '22023'; end if;
  update public.hours_source_proposals set status = 'discarded', resolution_note = p_note,
    resolved_by = auth.uid(), resolved_at = clock_timestamp() where id = p_proposal_id;
  return private.hours_week_sources_projection(v_proposal.week_id, v_proposal.organization_id);
end $$;

-- Applying takes the proposal literally. Adjusting means discarding it and
-- recording a new proposal, so the applied revision is always exactly what a
-- named person reviewed. A proposal that matches the current revision resolves
-- without a new version, keeping the existing employee response valid.
create or replace function public.hours_apply_source_proposal(p_proposal_id uuid, p_expected_revision_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_proposal public.hours_source_proposals%rowtype; v_day public.hours_days%rowtype;
  v_source public.hours_week_sources%rowtype; v_revision uuid; v_created boolean;
begin
  v_proposal := private.hours_lock_open_proposal(p_proposal_id);
  v_day := private.hours_lock_day(v_proposal.day_id, true);
  if v_day.current_revision_id is distinct from p_expected_revision_id then
    raise exception 'Uren zijn gewijzigd; laad opnieuw' using errcode = 'PT409';
  end if;
  select * into v_source from public.hours_week_sources where id = v_proposal.source_id;
  v_revision := private.hours_write_day_revision(v_day, v_proposal.minutes, v_proposal.no_hours_reason,
    v_proposal.note, v_proposal.source_input,
    jsonb_build_array(jsonb_build_object('kind', 'upload', 'label', v_source.file_name,
      'reference', v_proposal.page_label)));
  v_created := v_revision is not null;
  update public.hours_source_proposals set status = 'applied',
    applied_revision_id = coalesce(v_revision, v_day.current_revision_id), applied_created_revision = v_created,
    resolved_by = auth.uid(), resolved_at = clock_timestamp() where id = p_proposal_id;
  return public.hours_get_week(v_day.week_id) || jsonb_build_object('applied_created_revision', v_created,
    'sources', private.hours_week_sources_projection(v_day.week_id, v_day.organization_id));
end $$;

do $$ declare f text; begin
  foreach f in array array['public.hours_get_week_sources(uuid)',
    'public.hours_add_week_source(uuid, text, text, text)',
    'public.hours_create_source_proposal(uuid, uuid, integer, text, text, jsonb, text)',
    'public.hours_discard_source_proposal(uuid, text)',
    'public.hours_apply_source_proposal(uuid, uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;
