-- A page decision may not contradict proposals that already stand.
--
-- hours_page_contradicts steers proposals that are made *after* a decision: an
-- unclear page, or a page on somebody else's name, forces the new proposal to
-- be uncertain. The decision itself had no matching guard, so a page carrying
-- one employee's certain proposals could still be recorded on a different name,
-- or be called unreadable, while those proposals stayed applicable as if
-- nothing had happened. A proposal's content is immutable, so they could never
-- be flagged afterwards either.
--
-- Same rule as everywhere else in this module: what already stands is not
-- silently overruled. Discard the proposals first, then record the decision.
begin;

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
  -- The mirror image of private.hours_page_contradicts, applied forwards: a
  -- proposal that already stands as certain may not be contradicted by a later
  -- decision. A proposal that is itself still undecided blocks nothing, because
  -- it already cannot be applied.
  if exists (select 1 from public.hours_source_proposals p
      join public.hours_days d on d.id = p.day_id and d.organization_id = p.organization_id
    where p.source_id = p_source_id and p.page_number = p_page_number
      and p.organization_id = v_source.organization_id and p.status <> 'discarded'
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

revoke all on function public.hours_set_source_page(uuid, integer, text, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.hours_set_source_page(uuid, integer, text, uuid, text) to authenticated;

commit;
