-- Allow medewerker portal users to submit and read their own housing check-in
-- and maintenance complaints. Internal users remain covered by tenant_* policies.

begin;

drop policy if exists housing_inspections_self_select on public.housing_inspections;
create policy housing_inspections_self_select
  on public.housing_inspections
  for select
  to authenticated
  using (
    inspection_type in ('check_in'::public.inspection_type, 'klacht'::public.inspection_type)
    and exists (
      select 1
      from public.housing_assignments ha
      left join public.employees e on e.id = ha.employee_id
      left join public.candidates c on c.id = ha.candidate_id
      left join public.units u on u.id = ha.unit_id
      where ha.id = housing_inspections.housing_assignment_id
        and ha.organization_id = housing_inspections.organization_id
        and ha.status = 'ingecheckt'::public.housing_assignment_status
        and (e.auth_user_id = (select auth.uid()) or c.auth_user_id = (select auth.uid()))
        and (housing_inspections.unit_id is null or housing_inspections.unit_id = ha.unit_id)
        and (housing_inspections.property_id is null or housing_inspections.property_id = u.property_id)
    )
  );

drop policy if exists housing_inspections_self_insert on public.housing_inspections;
create policy housing_inspections_self_insert
  on public.housing_inspections
  for insert
  to authenticated
  with check (
    inspection_type in ('check_in'::public.inspection_type, 'klacht'::public.inspection_type)
    and exists (
      select 1
      from public.housing_assignments ha
      left join public.employees e on e.id = ha.employee_id
      left join public.candidates c on c.id = ha.candidate_id
      left join public.units u on u.id = ha.unit_id
      where ha.id = housing_inspections.housing_assignment_id
        and ha.organization_id = housing_inspections.organization_id
        and ha.status = 'ingecheckt'::public.housing_assignment_status
        and (e.auth_user_id = (select auth.uid()) or c.auth_user_id = (select auth.uid()))
        and (housing_inspections.unit_id is null or housing_inspections.unit_id = ha.unit_id)
        and (housing_inspections.property_id is null or housing_inspections.property_id = u.property_id)
    )
  );

commit;
