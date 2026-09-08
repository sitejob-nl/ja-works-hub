-- Excel and table files as a delivered source, and one handling that records a
-- whole reading as proposals.
--
-- The boundary is unchanged: a source, a page decision and a proposal are still
-- not hours. A reader produces proposals with a page reference and, where it is
-- unsure who a row is about, an uncertain assignment; only
-- hours_apply_source_proposal writes a day revision, and it takes the proposal
-- literally. Nothing here touches timesheets, invoicing or communication.
--
-- A worksheet is this format's page, so every page rule from the previous two
-- migrations applies unchanged to a spreadsheet.
begin;

-- Storage keeps enforcing the size limit and the declared media types.
update storage.buckets
  set allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel']
  where id = 'hours-sources';

alter table public.hours_week_sources drop constraint if exists hours_week_sources_content_type_check;
alter table public.hours_week_sources add constraint hours_week_sources_content_type_check
  check (content_type in ('application/pdf', 'image/jpeg', 'image/png',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel'));

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
  v_extension := case p_content_type
    when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg' when 'image/png' then 'png'
    when 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' then 'xlsx'
    when 'application/vnd.ms-excel' then 'xls' else null end;
  if v_extension is null then
    raise exception 'Alleen PDF, JPG, PNG en Excel worden als bron aanvaard' using errcode = '22023';
  end if;
  -- A photo is one page by definition. A PDF or workbook reports its own count,
  -- and a file the browser could not count stays honestly unknown.
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

-- One reading of one delivered file, recorded as proposals in a single handling.
-- All or nothing: a reading that is refused halfway would leave exactly the half
-- set of proposals the specification forbids. Every rule that governs a single
-- proposal governs each entry here, unchanged.
create or replace function public.hours_create_source_proposals(p_source_id uuid, p_entries jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_source public.hours_week_sources%rowtype; v_entry jsonb; v_day public.hours_days%rowtype;
  v_minutes integer; v_reason text; v_note text; v_label text; v_input jsonb;
  v_page integer; v_uncertain boolean; v_judged boolean; v_ids uuid[];
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
    v_uncertain := coalesce((v_entry->>'assignment_uncertain')::boolean, false)
      or private.hours_page_contradicts(p_source_id, v_page, v_day.member_id);
    insert into public.hours_source_proposals(organization_id, week_id, source_id, day_id, minutes,
      no_hours_reason, note, source_input, page_label, page_number, assignment_uncertain, created_by)
      values (v_source.organization_id, v_source.week_id, p_source_id, v_day.id, v_minutes, v_reason,
        v_note, v_input, v_label, v_page, v_uncertain, auth.uid());
  end loop;
  return private.hours_week_sources_projection(v_source.week_id, v_source.organization_id);
end $$;

do $$ declare f text; begin
  foreach f in array array['public.hours_add_week_source(uuid, text, text, text, integer)',
    'public.hours_create_source_proposals(uuid, jsonb)'] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;
