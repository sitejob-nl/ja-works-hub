-- Word and e-mail files as a delivered source, and one receipt that keeps a
-- message together with what came attached to it.
--
-- The boundary is unchanged: a source, a page decision and a proposal are still
-- not hours. Both new readers are deterministic and run in the browser, exactly
-- like the spreadsheet reader; there is no model and no paid call on this route.
-- Only hours_apply_source_proposal writes a day revision, and it takes the
-- proposal literally. Nothing here touches timesheets, invoicing or communication.
--
-- A table is a Word file's page and the message body is an e-mail's page, so
-- every page rule from the earlier migrations applies unchanged to both.
begin;

-- Storage keeps enforcing the size limit and the declared media types.
update storage.buckets
  set allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/msword', 'message/rfc822']
  where id = 'hours-sources';

alter table public.hours_week_sources drop constraint if exists hours_week_sources_content_type_check;
alter table public.hours_week_sources add constraint hours_week_sources_content_type_check
  check (content_type in ('application/pdf', 'image/jpeg', 'image/png',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword', 'message/rfc822'));

-- An attachment names the message it arrived with. One delivered e-mail and its
-- attachments are one receipt: the reviewer sees which file came out of which
-- message instead of a flat list in which that connection is lost.
--
-- The composite foreign key ties the receipt to the same week and the same
-- organisation as the attachment, so that coherence is a fact of the schema and
-- not a rule a later caller can forget. Sources are append-only, so this is set
-- once, when the attachment is recorded.
alter table public.hours_week_sources
  add column if not exists received_with_source_id uuid;
alter table public.hours_week_sources drop constraint if exists hours_week_sources_receipt_fkey;
alter table public.hours_week_sources add constraint hours_week_sources_receipt_fkey
  foreign key (received_with_source_id, week_id, organization_id)
  references public.hours_week_sources(id, week_id, organization_id);
alter table public.hours_week_sources drop constraint if exists hours_week_sources_receipt_self_check;
alter table public.hours_week_sources add constraint hours_week_sources_receipt_self_check
  check (received_with_source_id is distinct from id);
create index if not exists hours_week_sources_receipt_idx
  on public.hours_week_sources(received_with_source_id) where received_with_source_id is not null;

create or replace function public.hours_add_week_source(p_week_id uuid, p_content_hash text,
  p_file_name text, p_content_type text, p_page_count integer default null,
  p_received_with uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_week public.hours_weeks%rowtype; v_path text; v_extension text; v_object record;
  v_receipt public.hours_week_sources%rowtype; v_id uuid; v_duplicate boolean := false;
begin
  v_week := private.hours_lock_week(p_week_id);
  p_content_hash := lower(btrim(coalesce(p_content_hash, '')));
  p_file_name := nullif(private.hours_source_trim(p_file_name), '');
  if p_content_hash !~ '^[0-9a-f]{64}$' or p_file_name is null or length(p_file_name) > 255
     or p_file_name ~ '[[:cntrl:]/\\]' then
    raise exception 'Ongeldige bronverwijzing of bestandsnaam' using errcode = '22023';
  end if;
  v_extension := case p_content_type
    when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg' when 'image/png' then 'png'
    when 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' then 'xlsx'
    when 'application/vnd.ms-excel' then 'xls'
    when 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' then 'docx'
    when 'application/msword' then 'doc'
    when 'message/rfc822' then 'eml' else null end;
  if v_extension is null then
    raise exception 'Alleen PDF, JPG, PNG, Excel, Word en e-mail worden als bron aanvaard' using errcode = '22023';
  end if;
  -- A photo is one page by definition and so is the body of one message. A PDF,
  -- workbook or Word file reports its own count, and a file the browser could
  -- not count stays honestly unknown.
  if p_content_type in ('image/jpeg', 'image/png', 'message/rfc822') then p_page_count := 1; end if;
  if p_page_count is not null and p_page_count not between 1 and 2000 then
    raise exception 'Het aantal pagina''s van deze bron is ongeldig' using errcode = '22023';
  end if;
  -- An attachment belongs to a message of this same week. One level deep only:
  -- an attachment of an attachment is a chain nobody can read back, and a
  -- message is the only thing that carries attachments at all.
  if p_received_with is not null then
    select * into v_receipt from public.hours_week_sources
      where id = p_received_with and organization_id = v_week.organization_id and week_id = p_week_id;
    if not found then
      raise exception 'Het bericht waar deze bijlage bij hoort staat niet bij deze urenweek' using errcode = '22023';
    end if;
    if v_receipt.content_type <> 'message/rfc822' or v_receipt.received_with_source_id is not null then
      raise exception 'Alleen een ontvangen e-mail kan bijlagen dragen' using errcode = '22023';
    end if;
  end if;
  v_path := v_week.organization_id::text || '/' || p_week_id::text || '/' || p_content_hash || '.' || v_extension;
  select (o.metadata->>'size')::bigint as byte_size, o.metadata->>'mimetype' as mimetype into v_object
    from storage.objects o where o.bucket_id = 'hours-sources' and o.name = v_path;
  if not found or v_object.byte_size is null or v_object.byte_size not between 1 and 26214400
     or v_object.mimetype is distinct from p_content_type then
    raise exception 'Het geüploade bestand is niet gevonden of komt niet overeen' using errcode = '22023';
  end if;
  insert into public.hours_week_sources(organization_id, week_id, company_id, storage_path, file_name,
    content_type, byte_size, content_hash, page_count, received_with_source_id, created_by)
    values (v_week.organization_id, p_week_id, v_week.company_id, v_path, p_file_name, p_content_type,
      v_object.byte_size, p_content_hash, p_page_count, p_received_with, auth.uid())
  on conflict (week_id, content_hash) do nothing returning id into v_id;
  if v_id is null then
    v_duplicate := true;
    select id into v_id from public.hours_week_sources where week_id = p_week_id and content_hash = p_content_hash;
  end if;
  return private.hours_week_sources_projection(p_week_id, v_week.organization_id)
    || jsonb_build_object('duplicate', v_duplicate, 'source_id', v_id);
end $$;

-- The projection now names the receipt an attachment arrived with, so the screen
-- can keep a message and its attachments together instead of listing them beside
-- each other as if they had nothing to do with one another.
create or replace function private.hours_week_sources_projection(p_week_id uuid, p_org uuid)
returns jsonb language sql stable set search_path = '' as $$
  -- One scan for all three counts. This projection is the return value of every
  -- write in the module, so it runs while those RPCs hold row locks; a fourth
  -- kind of doubt should add a filter, not a fourth index scan.
  with counts as (
    select count(*) as open_proposals,
      count(*) filter (where p.assignment_uncertain and p.assignment_confirmed_at is null) as undecided_assignments,
      count(*) filter (where p.uncertain_fields is not null and p.values_confirmed_at is null) as uncertain_values
    from public.hours_source_proposals p
    where p.week_id = p_week_id and p.organization_id = p_org and p.status = 'open')
  select jsonb_build_object('week_id', p_week_id,
    'open_proposals', (select open_proposals from counts),
    'undecided_assignments', (select undecided_assignments from counts),
    'uncertain_values', (select uncertain_values from counts),
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
      'received_with_source_id', s.received_with_source_id,
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

do $$ declare f text; begin
  foreach f in array array['public.hours_add_week_source(uuid, text, text, text, integer, uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- The previous five-parameter signature would stay callable beside the new one
-- and would silently drop the receipt, so it goes. A caller that names the five
-- older parameters still resolves here, because the sixth carries a default:
-- the migration can go live before the frontend does.
drop function if exists public.hours_add_week_source(uuid, text, text, text, integer);

commit;
