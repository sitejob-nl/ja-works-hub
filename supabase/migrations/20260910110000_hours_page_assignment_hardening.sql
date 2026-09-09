-- Four ways around the page-assignment invariant, closed.
--
-- 1. The contradiction guard counted applied proposals as standing, but an
--    applied proposal can never be discarded. A page whose proposal turned out
--    to be about the wrong person could therefore never be corrected, and the
--    error told the user to do something impossible. Only an open proposal can
--    still be applied, so only an open proposal needs protecting.
-- 2. The forced uncertainty hangs on the page number, which was optional. On a
--    source whose pages have been judged, leaving it blank produced a certain,
--    immediately applicable proposal from a page nobody could read.
-- 3. Confirming never re-read the page decision. Decide unclear, propose for A,
--    re-decide the page onto B, confirm, apply: the same contradiction, only in
--    a different order.
-- 4. With an unknown page count the upper bound compared a value to itself, so
--    an absurd page number reached the table CHECK and surfaced a raw Postgres
--    error instead of a readable refusal.
begin;

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
     and (p_page_number not between 1 and 2000
          or p_page_number > coalesce(v_source.page_count, p_page_number)) then
    raise exception 'Deze bron heeft die pagina niet' using errcode = '22023';
  end if;
  -- Once the pages of a source have been judged, a proposal must say which page
  -- it came from; otherwise the decision on that page cannot steer it at all.
  if p_page_number is null and exists (select 1 from public.hours_source_pages g
      where g.source_id = p_source_id and g.organization_id = v_day.organization_id and g.status = 'active') then
    raise exception 'Deze bron is per pagina beoordeeld; geef aan uit welke pagina dit voorstel komt'
      using errcode = '22023';
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

create or replace function public.hours_confirm_proposal_assignment(p_proposal_id uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_proposal public.hours_source_proposals%rowtype; v_day public.hours_days%rowtype; begin
  v_proposal := private.hours_lock_open_proposal(p_proposal_id);
  v_day := private.hours_lock_day(v_proposal.day_id, true);
  if not v_proposal.assignment_uncertain then
    raise exception 'De toewijzing van dit voorstel stond al vast' using errcode = '22023';
  end if;
  if v_proposal.assignment_confirmed_at is not null then
    raise exception 'De toewijzing van dit voorstel is al bevestigd' using errcode = '22023';
  end if;
  -- An unreadable page is exactly what confirming is for. A page that explicitly
  -- names somebody else is not: settling the doubt in the other direction would
  -- reintroduce the contradiction that recording the decision forbids.
  if exists (select 1 from public.hours_source_pages g
      where g.source_id = v_proposal.source_id and g.page_number = v_proposal.page_number
        and g.organization_id = v_proposal.organization_id and g.status = 'active'
        and g.assignment = 'single' and g.member_id is distinct from v_day.member_id) then
    raise exception 'Deze pagina staat op naam van een andere medewerker; verwerp dit voorstel of pas de paginatoewijzing aan'
      using errcode = '22023';
  end if;
  p_note := nullif(private.hours_source_trim(p_note), '');
  if length(p_note) > 2000 then raise exception 'Toelichting is te lang' using errcode = '22023'; end if;
  update public.hours_source_proposals
    set assignment_confirmed_by = auth.uid(), assignment_confirmed_at = clock_timestamp(),
        assignment_note = p_note
    where id = p_proposal_id;
  return private.hours_week_sources_projection(v_proposal.week_id, v_proposal.organization_id);
end $$;

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

do $$ declare f text; begin
  foreach f in array array['public.hours_create_source_proposal(uuid, uuid, integer, text, text, jsonb, text, integer, boolean)',
    'public.hours_confirm_proposal_assignment(uuid, text)',
    'public.hours_set_source_page(uuid, integer, text, uuid, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;
