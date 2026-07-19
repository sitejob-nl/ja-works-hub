-- Plaatsingswizard: standalone plaatsingen (zonder vacature, bv. vanuit Planning of
-- de opdrachtgever-tab) lopen voortaan ook via create_placement_transaction, zodat
-- employee-record, kandidaat-status en compliance-velden overal consistent gezet
-- worden. p_vacancy_id mag daarom null zijn; vacature-checks en filled_count-update
-- gelden alleen wanneer er wél een vacature is. Een match zonder vacature kan niet.

create or replace function public.create_placement_transaction(
  p_org_id uuid,
  p_candidate_id uuid,
  p_company_id uuid,
  p_vacancy_id uuid,
  p_match_id uuid,
  p_function_name text,
  p_start_date date,
  p_end_date date default null,
  p_hourly_rate numeric default 0,
  p_client_hourly_rate numeric default null,
  p_overtime_rate numeric default null,
  p_created_by uuid default null,
  p_compliance_check_passed boolean default false,
  p_compliance_override boolean default false,
  p_compliance_override_reason text default null
)
returns table(placement_id uuid, employee_id uuid)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_vacancy public.vacancies%rowtype;
  v_candidate_id uuid;
  v_match_id uuid;
  v_employee_id uuid;
  v_placement_id uuid;
begin
  if auth.role() = 'service_role' then
    v_actor := p_created_by;
  elsif auth.role() = 'authenticated' then
    if not (
      public.is_superadmin()
      or (public.is_internal_user() and p_org_id = public.get_user_org_id())
    ) then
      raise exception 'Not authorized for this organization';
    end if;
    v_actor := auth.uid();
  else
    raise exception 'Not authenticated';
  end if;

  if nullif(trim(coalesce(p_function_name, '')), '') is null then
    raise exception 'Function name is required';
  end if;

  if p_start_date is null then
    raise exception 'Start date is required';
  end if;

  if p_hourly_rate is null or p_hourly_rate < 0 then
    raise exception 'Hourly rate must be zero or higher';
  end if;

  if p_end_date is not null and p_end_date < p_start_date then
    raise exception 'End date cannot be before start date';
  end if;

  if p_match_id is not null and p_vacancy_id is null then
    raise exception 'Match requires a vacancy';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_candidate_id::text)::bigint);

  if p_vacancy_id is not null then
    select *
      into v_vacancy
      from public.vacancies v
     where v.id = p_vacancy_id
       and v.organization_id = p_org_id
     for update;

    if not found then
      raise exception 'Vacancy not found';
    end if;

    if v_vacancy.company_id <> p_company_id then
      raise exception 'Vacancy does not belong to the selected company';
    end if;
  else
    perform 1
       from public.companies c
      where c.id = p_company_id
        and c.organization_id = p_org_id;

    if not found then
      raise exception 'Company not found';
    end if;
  end if;

  select c.id
    into v_candidate_id
    from public.candidates c
   where c.id = p_candidate_id
     and c.organization_id = p_org_id
   for update;

  if not found then
    raise exception 'Candidate not found';
  end if;

  if p_match_id is not null then
    select m.id
      into v_match_id
      from public.matches m
     where m.id = p_match_id
       and m.organization_id = p_org_id
       and m.vacancy_id = p_vacancy_id
       and m.candidate_id = p_candidate_id
     for update;

    if not found then
      raise exception 'Match not found for candidate and vacancy';
    end if;
  end if;

  select e.id
    into v_employee_id
    from public.employees e
   where e.organization_id = p_org_id
     and e.candidate_id = p_candidate_id
   order by e.created_at desc, e.id desc
   limit 1
   for update;

  if v_employee_id is null then
    insert into public.employees (
      organization_id,
      candidate_id,
      start_date,
      contract_type,
      status
    )
    values (
      p_org_id,
      p_candidate_id,
      p_start_date,
      null,
      'actief'::public.employee_status
    )
    returning id into v_employee_id;
  end if;

  update public.candidates c
     set status = 'geplaatst'::public.candidate_status,
         employee_status = 'actief'
   where c.id = p_candidate_id
     and c.organization_id = p_org_id;

  insert into public.placements (
    organization_id,
    candidate_id,
    employee_id,
    company_id,
    vacancy_id,
    match_id,
    function_name,
    start_date,
    end_date,
    hourly_rate,
    client_hourly_rate,
    overtime_rate,
    status,
    created_by,
    compliance_check_passed,
    compliance_check_at,
    compliance_override,
    compliance_override_by,
    compliance_override_reason
  )
  values (
    p_org_id,
    p_candidate_id,
    v_employee_id,
    p_company_id,
    p_vacancy_id,
    p_match_id,
    trim(p_function_name),
    p_start_date,
    p_end_date,
    p_hourly_rate,
    p_client_hourly_rate,
    p_overtime_rate,
    'actief'::public.placement_status,
    v_actor,
    p_compliance_check_passed,
    now(),
    p_compliance_override,
    case when p_compliance_override then v_actor else null end,
    p_compliance_override_reason
  )
  returning id into v_placement_id;

  if p_match_id is not null then
    update public.matches m
       set status = 'geplaatst'::public.match_status,
           status_changed_at = now()
     where m.id = p_match_id
       and m.organization_id = p_org_id;
  end if;

  if p_vacancy_id is not null then
    update public.vacancies v
       set filled_count = coalesce(v.filled_count, 0) + 1,
           status = case
             when coalesce(v.filled_count, 0) + 1 >= coalesce(v.required_count, 1)
               then 'vervuld'::public.vacancy_status
             else v.status
           end
     where v.id = p_vacancy_id
       and v.organization_id = p_org_id;
  end if;

  return query select v_placement_id, v_employee_id;
end;
$$;
