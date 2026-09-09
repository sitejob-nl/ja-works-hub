-- Two remaining ways for a page decision to leave something behind.
--
-- 1. The contradiction guard matches on the page number, so an open proposal
--    that names no page was invisible to it: propose without a page, then judge
--    that page unclear or hand it to somebody else, and the proposal stayed
--    certain and applicable. Judging a source by page is exactly the moment its
--    page-less proposals become an unspoken exception, so the first decision now
--    requires them to be resolved first — the mirror of the rule that a judged
--    source demands a page on every new proposal.
-- 2. A take-over entry with an explicit "source_input": null passed jsonb 'null'
--    into the validator and failed the whole take-over, while the exported entry
--    type says that field may be null.
begin;

create or replace function public.hours_set_source_page(p_source_id uuid, p_page_number integer,
  p_assignment text, p_member_id uuid default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_source public.hours_week_sources%rowtype; v_members integer; begin
  v_source := private.hours_lock_source(p_source_id);
  if p_assignment is null or p_assignment not in ('single', 'multiple', 'unclear')
     or p_page_number is null or p_page_number not between 1 and 2000
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
    -- Applied proposals count as evidence here: they show just as well that this
    -- page carried more than one person.
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
  -- Judging a source by page turns its page-less proposals into an exception no
  -- decision can reach, so they have to be resolved before the first decision.
  if exists (select 1 from public.hours_source_proposals p
      where p.source_id = p_source_id and p.organization_id = v_source.organization_id
        and p.status = 'open' and p.page_number is null) then
    raise exception 'Deze bron heeft nog voorstellen zonder pagina; verwerp die eerst of leg ze met een pagina opnieuw vast'
      using errcode = '22023';
  end if;
  -- The mirror image of private.hours_page_contradicts, applied forwards. Only
  -- open proposals count: an applied one is history that cannot be discarded, so
  -- treating it as standing would lock the decision forever.
  if exists (select 1 from public.hours_source_proposals p
      join public.hours_days d on d.id = p.day_id and d.organization_id = p.organization_id
    where p.source_id = p_source_id and p.page_number = p_page_number
      and p.organization_id = v_source.organization_id and p.status = 'open'
      and not (p.assignment_uncertain and p.assignment_confirmed_at is null)
      and (p_assignment = 'unclear'
           or (p_assignment = 'single' and d.member_id is distinct from p_member_id))) then
    raise exception 'Deze pagina heeft al voorstellen die dit besluit tegenspreken; verwerp die eerst'
      using errcode = '22023';
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

create or replace function public.hours_create_page_proposals(p_source_id uuid, p_page_number integer,
  p_entries jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_source public.hours_week_sources%rowtype; v_page public.hours_source_pages%rowtype;
  v_entry jsonb; v_day public.hours_days%rowtype; v_minutes integer; v_reason text; v_note text;
  v_label text; v_input jsonb; v_ids uuid[];
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
    -- An explicit JSON null means "no source details", not the jsonb value 'null'.
    v_input := nullif(v_entry->'source_input', 'null'::jsonb);
    if v_minutes is null or v_minutes not between 0 and 1440 or (v_minutes = 0 and v_reason is null)
       or (v_minutes > 0 and v_reason is not null) or length(v_reason) > 500 or length(v_note) > 2000
       or length(v_label) > 200 then
      raise exception 'Vul geldige minuten in; nul uren vereist een reden' using errcode = '22023';
    end if;
    perform private.hours_validate_source_input(v_input);
    insert into public.hours_source_proposals(organization_id, week_id, source_id, day_id, minutes,
      no_hours_reason, note, source_input, page_label, page_number, assignment_uncertain, created_by)
      values (v_source.organization_id, v_source.week_id, p_source_id, v_day.id, v_minutes, v_reason,
        v_note, v_input, v_label, p_page_number, false, auth.uid());
  end loop;
  return private.hours_week_sources_projection(v_source.week_id, v_source.organization_id);
end $$;

do $$ declare f text; begin
  foreach f in array array['public.hours_set_source_page(uuid, integer, text, uuid, text)',
    'public.hours_create_page_proposals(uuid, integer, jsonb)'] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;
