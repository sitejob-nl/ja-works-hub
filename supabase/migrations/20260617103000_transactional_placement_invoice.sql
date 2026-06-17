-- Plaatsing en facturatie zijn samengestelde business-acties. Deze RPC's houden
-- de databasewijzigingen atomair en beperken uitvoering tot interne gebruikers.

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

  perform pg_advisory_xact_lock(hashtext(p_candidate_id::text)::bigint);

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

  update public.vacancies v
     set filled_count = coalesce(v.filled_count, 0) + 1,
         status = case
           when coalesce(v.filled_count, 0) + 1 >= coalesce(v.required_count, 1)
             then 'vervuld'::public.vacancy_status
           else v.status
         end
   where v.id = p_vacancy_id
     and v.organization_id = p_org_id;

  return query select v_placement_id, v_employee_id;
end;
$$;

revoke execute on function public.create_placement_transaction(
  uuid, uuid, uuid, uuid, uuid, text, date, date, numeric, numeric, numeric, uuid, boolean, boolean, text
) from public, anon;
grant execute on function public.create_placement_transaction(
  uuid, uuid, uuid, uuid, uuid, text, date, date, numeric, numeric, numeric, uuid, boolean, boolean, text
) to authenticated, service_role;

create or replace function public.create_invoice_transaction(
  p_org_id uuid,
  p_company_id uuid,
  p_period_start date,
  p_period_end date,
  p_reference text default null,
  p_subtotal numeric default 0,
  p_vat_rate numeric default 21,
  p_vat_amount numeric default 0,
  p_total numeric default 0,
  p_due_date date default null,
  p_lines jsonb default '[]'::jsonb
)
returns table(invoice_id uuid, invoice_number text)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_invoice_id uuid;
  v_invoice_number text;
  v_line jsonb;
  v_line_id uuid;
  v_placement_id uuid;
  v_employee_id uuid;
  v_requested_count integer;
  v_updated_count integer;
begin
  if auth.role() = 'service_role' then
    v_actor := null;
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

  if p_period_start is null or p_period_end is null then
    raise exception 'Invoice period is required';
  end if;

  if p_period_end < p_period_start then
    raise exception 'Invoice period end cannot be before start';
  end if;

  if jsonb_typeof(coalesce(p_lines, 'null'::jsonb)) <> 'array' then
    raise exception 'Invoice lines must be a JSON array';
  end if;

  if jsonb_array_length(p_lines) = 0 then
    raise exception 'At least one invoice line is required';
  end if;

  if not exists (
    select 1
      from public.companies c
     where c.id = p_company_id
       and c.organization_id = p_org_id
  ) then
    raise exception 'Company not found';
  end if;

  v_invoice_number := public.next_invoice_number(p_org_id);

  insert into public.invoices (
    organization_id,
    company_id,
    invoice_number,
    period_start,
    period_end,
    reference,
    subtotal,
    vat_rate,
    vat_amount,
    total,
    due_date,
    created_by
  )
  values (
    p_org_id,
    p_company_id,
    v_invoice_number,
    p_period_start,
    p_period_end,
    p_reference,
    coalesce(p_subtotal, 0),
    coalesce(p_vat_rate, 21),
    coalesce(p_vat_amount, 0),
    coalesce(p_total, 0),
    p_due_date,
    v_actor
  )
  returning id into v_invoice_id;

  for v_line in
    select value from jsonb_array_elements(p_lines)
  loop
    if nullif(trim(coalesce(v_line->>'description', '')), '') is null then
      raise exception 'Invoice line description is required';
    end if;

    if jsonb_typeof(coalesce(v_line->'timesheets', '[]'::jsonb)) <> 'array' then
      raise exception 'Timesheets must be a JSON array';
    end if;

    v_placement_id := nullif(v_line->>'placement_id', '')::uuid;
    v_employee_id := nullif(v_line->>'employee_id', '')::uuid;

    if v_placement_id is not null and not exists (
      select 1
        from public.placements p
       where p.id = v_placement_id
         and p.organization_id = p_org_id
         and p.company_id = p_company_id
    ) then
      raise exception 'Invoice line placement is invalid';
    end if;

    if v_employee_id is not null and not exists (
      select 1
        from public.employees e
       where e.id = v_employee_id
         and e.organization_id = p_org_id
    ) then
      raise exception 'Invoice line employee is invalid';
    end if;

    insert into public.invoice_lines (
      organization_id,
      invoice_id,
      placement_id,
      employee_id,
      description,
      hours,
      overtime_hours,
      hourly_rate,
      overtime_rate,
      travel_amount,
      allowances_amount,
      surcharge_amount,
      line_total,
      sort_order
    )
    values (
      p_org_id,
      v_invoice_id,
      v_placement_id,
      v_employee_id,
      trim(v_line->>'description'),
      coalesce(nullif(v_line->>'hours', '')::numeric, 0),
      coalesce(nullif(v_line->>'overtime_hours', '')::numeric, 0),
      coalesce(nullif(v_line->>'hourly_rate', '')::numeric, 0),
      coalesce(nullif(v_line->>'overtime_rate', '')::numeric, 0),
      coalesce(nullif(v_line->>'travel_amount', '')::numeric, 0),
      coalesce(nullif(v_line->>'allowances_amount', '')::numeric, 0),
      coalesce(nullif(v_line->>'surcharge_amount', '')::numeric, 0),
      coalesce(nullif(v_line->>'line_total', '')::numeric, 0),
      coalesce(nullif(v_line->>'sort_order', '')::integer, 0)
    )
    returning id into v_line_id;

    select count(*)
      into v_requested_count
      from (
        select distinct value::uuid as id
          from jsonb_array_elements_text(coalesce(v_line->'timesheets', '[]'::jsonb))
         where value <> ''
      ) requested;

    if v_requested_count > 0 then
      if v_placement_id is null then
        raise exception 'Timesheets can only be linked to placement invoice lines';
      end if;

      with requested as (
        select distinct value::uuid as id
          from jsonb_array_elements_text(coalesce(v_line->'timesheets', '[]'::jsonb))
         where value <> ''
      ),
      updated as (
        update public.timesheets t
           set invoice_line_id = v_line_id
          from requested r
         where t.id = r.id
           and t.organization_id = p_org_id
           and t.placement_id = v_placement_id
           and t.status = 'goedgekeurd'::public.timesheet_status
           and t.invoice_line_id is null
           and t.work_date >= p_period_start
           and t.work_date <= p_period_end
        returning t.id
      )
      select count(*) into v_updated_count from updated;

      if v_updated_count <> v_requested_count then
        raise exception 'One or more timesheets are no longer invoiceable';
      end if;
    end if;
  end loop;

  return query select v_invoice_id, v_invoice_number;
end;
$$;

revoke execute on function public.create_invoice_transaction(
  uuid, uuid, date, date, text, numeric, numeric, numeric, numeric, date, jsonb
) from public, anon;
grant execute on function public.create_invoice_transaction(
  uuid, uuid, date, date, text, numeric, numeric, numeric, numeric, date, jsonb
) to authenticated, service_role;
