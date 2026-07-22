-- Fase A (medewerkersportaal): vacaturemarkt leesbaar maken + de candidate_id/employees.id-
-- verwarring rechtzetten die meerdere portaal-policies stil uitschakelde.
--
-- 1. /portaal/vacatures was leeg: vacancies.tenant_select en matches.tenant_select gaten op
--    has_role_permission(), en die geeft per definitie false voor de rol 'medewerker'
--    (harde rollenlijst in de functie).
-- 2. Structureel: get_employee_id() geeft employees.id terug, get_employee_candidate_id()
--    geeft candidates.id. Waar een candidate_id-kolom tegen get_employee_id() werd vergeleken
--    was de policy een stille no-op — geen enkele employees-rij heeft id = candidate_id.

-- --- 1a. Open vacatures zichtbaar voor eigen medewerkers ---------------------------------
drop policy if exists vacancies_employee_read_open on public.vacancies;
create policy vacancies_employee_read_open on public.vacancies
  for select to authenticated
  using (
    organization_id = (select public.get_user_org_id())
    and status = 'open'
    and (select public.is_employee_user())
  );

-- --- 1b. Eigen matches zichtbaar (voedt de "al gesolliciteerd"-status) -------------------
drop policy if exists matches_employee_self_select on public.matches;
create policy matches_employee_self_select on public.matches
  for select to authenticated
  using (
    organization_id = (select public.get_user_org_id())
    and candidate_id = (select public.get_employee_candidate_id())
  );

-- --- 1c. Bedrijfsnaam bij open vacatures (besluit A2, optie a: smal en omkeerbaar) -------
-- Alleen bedrijven die op dit moment een open vacature hebben; geen org-brede companies-read.
drop policy if exists companies_employee_read_open_vacancies on public.companies;
create policy companies_employee_read_open_vacancies on public.companies
  for select to authenticated
  using (
    organization_id = (select public.get_user_org_id())
    and (select public.is_employee_user())
    and id in (
      select v.company_id
      from public.vacancies v
      where v.organization_id = (select public.get_user_org_id())
        and v.status = 'open'
        and v.company_id is not null
    )
  );

-- --- 2. get_employee_id() -> get_employee_candidate_id() waar candidate_id wordt vergeleken

-- Solliciteren vanuit het portaal (was geblokkeerd: candidates.id != employees.id).
drop policy if exists matches_employee_self_apply on public.matches;
create policy matches_employee_self_apply on public.matches
  for insert to authenticated
  with check (
    organization_id = (select public.get_user_org_id())
    and candidate_id = (select public.get_employee_candidate_id())
  );

-- Portaal-notificaties (waren onzichtbaar om dezelfde reden).
drop policy if exists employee_notifications_self_read on public.employee_notifications;
create policy employee_notifications_self_read on public.employee_notifications
  for select to authenticated
  using (
    organization_id = (select public.get_user_org_id())
    and candidate_id = (select public.get_employee_candidate_id())
  );

-- Timesheets: de employee_id-tak werkte al, de candidate_id-tak was dood. Beide kloppen nu.
drop policy if exists timesheet_employee_self_select on public.timesheets;
create policy timesheet_employee_self_select on public.timesheets
  for select to authenticated
  using (
    organization_id = (select public.get_user_org_id())
    and (
      candidate_id = (select public.get_employee_candidate_id())
      or employee_id = (select public.get_employee_id())
    )
  );

drop policy if exists timesheet_employee_self_update on public.timesheets;
create policy timesheet_employee_self_update on public.timesheets
  for update to authenticated
  using (
    organization_id = (select public.get_user_org_id())
    and (
      candidate_id = (select public.get_employee_candidate_id())
      or employee_id = (select public.get_employee_id())
    )
  )
  with check (
    organization_id = (select public.get_user_org_id())
    and (
      candidate_id = (select public.get_employee_candidate_id())
      or employee_id = (select public.get_employee_id())
    )
  );

drop policy if exists timesheet_employee_self_insert on public.timesheets;
create policy timesheet_employee_self_insert on public.timesheets
  for insert to authenticated
  with check (
    organization_id = (select public.get_user_org_id())
    and (
      candidate_id = (select public.get_employee_candidate_id())
      or employee_id = (select public.get_employee_id())
    )
    and source = 'handmatig'::timesheet_source
    and employee_confirmed = true
    and exists (
      select 1
      from public.placements p
      where p.id = timesheets.placement_id
        and p.candidate_id = timesheets.candidate_id
        and p.organization_id = timesheets.organization_id
    )
  );
