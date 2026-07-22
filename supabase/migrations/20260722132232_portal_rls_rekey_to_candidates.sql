-- Portaal-RLS hing aan de legacy tabel `employees`. Dat leverde twee problemen op.
--
-- 1. De stille no-op. get_employee_id() geeft employees.id, get_employee_candidate_id() geeft
--    candidates.id, en die zijn in geen enkele rij gelijk. Vergelijk je per ongeluk een
--    candidate_id-kolom met employees.id, dan geeft de policy nul rijen zonder fout — niet te
--    onderscheiden van "deze medewerker heeft nog geen data". Zo waren solliciteren en de
--    portaalnotificaties maandenlang kapot (hersteld in 20260722083651).
--
-- 2. Erger, en nog live: de meeste self-policies filterden op de kolom employee_id, terwijl de
--    huidige plaatsingsflow die kolom niet meer vult. Van de 665 plaatsingen hebben er 642
--    alleen candidate_id. `NULL IN (...)` is NULL, dus die rijen waren onzichtbaar in het
--    portaal. Bij de uitrol had elke echte medewerker een lege Plaatsingen-pagina gezien.
--
-- Alles hangt nu aan candidates.auth_user_id en filtert op candidate_id — de kolom die wél
-- overal gevuld is (geverifieerd: geen enkele rij heeft employee_id zonder candidate_id, en
-- alle bestaande portaalaccounts hebben candidates.auth_user_id gelijk aan
-- employees.auth_user_id). De employees-spiegel blijft bestaan voor de recruiter-UI, maar de
-- portaalbeveiliging is er niet langer van afhankelijk.

-- ---------------------------------------------------------------------------------
-- Helpers: lees de kandidaat rechtstreeks, zonder de omweg via employees.
-- ---------------------------------------------------------------------------------
create or replace function public.get_employee_candidate_id()
returns uuid
language sql
stable
security definer
set search_path to 'public', 'extensions', 'vault', 'pg_temp'
as $$
  select id from public.candidates where auth_user_id = auth.uid()
$$;

comment on function public.get_employee_candidate_id() is
  'candidates.id van de ingelogde portaalgebruiker. Leest candidates rechtstreeks; hangt bewust niet meer aan de legacy employees-spiegel.';

create or replace function public.get_portal_org_id()
returns uuid
language sql
stable
security definer
set search_path to 'public', 'extensions', 'vault', 'pg_temp'
as $$
  select organization_id from public.candidates where auth_user_id = auth.uid()
$$;

comment on function public.get_portal_org_id() is
  'organization_id van de ingelogde portaalgebruiker, gelezen van zijn eigen kandidaatrij.';

revoke all on function public.get_portal_org_id() from public;
revoke all on function public.get_portal_org_id() from anon;
grant execute on function public.get_portal_org_id() to authenticated;

comment on function public.get_employee_id() is
  'LET OP: geeft employees.id (legacy spiegel), NIET candidates.id. Geen enkele RLS-policy gebruikt dit nog; vergelijk het nooit met een candidate_id-kolom.';

-- ---------------------------------------------------------------------------------
-- candidates: eigen rij
-- ---------------------------------------------------------------------------------
drop policy if exists candidate_self_select on public.candidates;
create policy candidate_self_select on public.candidates
  for select to authenticated
  using (auth_user_id = (select auth.uid()));

drop policy if exists candidate_self_update on public.candidates;
create policy candidate_self_update on public.candidates
  for update to authenticated
  using (auth_user_id = (select auth.uid()))
  with check (auth_user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------
-- Documenten, communicatie, contracten
-- ---------------------------------------------------------------------------------
drop policy if exists document_self_select on public.documents;
create policy document_self_select on public.documents
  for select to authenticated
  using (candidate_id = (select public.get_employee_candidate_id()));

drop policy if exists document_self_insert on public.documents;
create policy document_self_insert on public.documents
  for insert to authenticated
  with check (
    candidate_id = (select public.get_employee_candidate_id())
    and organization_id = (select public.get_portal_org_id())
  );

drop policy if exists communication_self_select on public.communications;
create policy communication_self_select on public.communications
  for select to authenticated
  using (candidate_id = (select public.get_employee_candidate_id()));

drop policy if exists contract_self_select on public.contracts;
create policy contract_self_select on public.contracts
  for select to authenticated
  using (candidate_id = (select public.get_employee_candidate_id()));

-- ---------------------------------------------------------------------------------
-- Loon: loonstroken, jaaropgaven, urenbrieven
-- ---------------------------------------------------------------------------------
drop policy if exists payslips_employee_read on public.payslips;
create policy payslips_employee_read on public.payslips
  for select to authenticated
  using (
    candidate_id = (select public.get_employee_candidate_id())
    and status = 'definitief'
  );

drop policy if exists annual_statements_employee_read on public.annual_statements;
create policy annual_statements_employee_read on public.annual_statements
  for select to authenticated
  using (
    candidate_id = (select public.get_employee_candidate_id())
    and status = any (array['definitief', 'verzonden'])
  );

drop policy if exists hour_letters_employee_read on public.hour_letters;
create policy hour_letters_employee_read on public.hour_letters
  for select to authenticated
  using (candidate_id = (select public.get_employee_candidate_id()));

-- ---------------------------------------------------------------------------------
-- Plaatsingen — dit is de rij die 642 records onzichtbaar maakte
-- ---------------------------------------------------------------------------------
drop policy if exists placement_self_select on public.placements;
create policy placement_self_select on public.placements
  for select to authenticated
  using (candidate_id = (select public.get_employee_candidate_id()));

-- ---------------------------------------------------------------------------------
-- Uren — de oude employee_id-policies zijn overbodig naast de candidate-versies
-- uit 20260722083651 en worden hier opgeruimd.
-- ---------------------------------------------------------------------------------
drop policy if exists timesheet_self_select on public.timesheets;
drop policy if exists timesheet_self_update on public.timesheets;
drop policy if exists timesheet_self_insert on public.timesheets;

-- ---------------------------------------------------------------------------------
-- Huisvesting
-- ---------------------------------------------------------------------------------
drop policy if exists housing_self_select on public.housing_assignments;
create policy housing_self_select on public.housing_assignments
  for select to authenticated
  using (candidate_id = (select public.get_employee_candidate_id()));

drop policy if exists unit_self_select on public.units;
create policy unit_self_select on public.units
  for select to authenticated
  using (id in (
    select ha.unit_id from public.housing_assignments ha
    where ha.candidate_id = (select public.get_employee_candidate_id())
      and ha.status = 'ingecheckt'::housing_assignment_status
  ));

drop policy if exists property_self_select on public.properties;
create policy property_self_select on public.properties
  for select to authenticated
  using (id in (
    select u.property_id
    from public.units u
    join public.housing_assignments ha on ha.unit_id = u.id
    where ha.candidate_id = (select public.get_employee_candidate_id())
      and ha.status = 'ingecheckt'::housing_assignment_status
  ));

drop policy if exists housing_inspections_self_select on public.housing_inspections;
create policy housing_inspections_self_select on public.housing_inspections
  for select to authenticated
  using (
    inspection_type = any (array['check_in'::inspection_type, 'klacht'::inspection_type])
    and exists (
      select 1
      from public.housing_assignments ha
      left join public.units u on u.id = ha.unit_id
      where ha.id = housing_inspections.housing_assignment_id
        and ha.organization_id = housing_inspections.organization_id
        and ha.status = 'ingecheckt'::housing_assignment_status
        and ha.candidate_id = (select public.get_employee_candidate_id())
        and (housing_inspections.unit_id is null or housing_inspections.unit_id = ha.unit_id)
        and (housing_inspections.property_id is null or housing_inspections.property_id = u.property_id)
    )
  );

drop policy if exists housing_inspections_self_insert on public.housing_inspections;
create policy housing_inspections_self_insert on public.housing_inspections
  for insert to authenticated
  with check (
    inspection_type = any (array['check_in'::inspection_type, 'klacht'::inspection_type])
    and exists (
      select 1
      from public.housing_assignments ha
      left join public.units u on u.id = ha.unit_id
      where ha.id = housing_inspections.housing_assignment_id
        and ha.organization_id = housing_inspections.organization_id
        and ha.status = 'ingecheckt'::housing_assignment_status
        and ha.candidate_id = (select public.get_employee_candidate_id())
        and (housing_inspections.unit_id is null or housing_inspections.unit_id = ha.unit_id)
        and (housing_inspections.property_id is null or housing_inspections.property_id = u.property_id)
    )
  );

-- ---------------------------------------------------------------------------------
-- Vervoer
-- ---------------------------------------------------------------------------------
drop policy if exists vehicle_assignment_self_select on public.vehicle_assignments;
create policy vehicle_assignment_self_select on public.vehicle_assignments
  for select to authenticated
  using (candidate_id = (select public.get_employee_candidate_id()));

drop policy if exists vehicle_self_select on public.vehicles;
create policy vehicle_self_select on public.vehicles
  for select to authenticated
  using (id in (
    select va.vehicle_id from public.vehicle_assignments va
    where va.candidate_id = (select public.get_employee_candidate_id())
      and va.returned_date is null
  ));

drop policy if exists damage_self_select on public.vehicle_damage_reports;
create policy damage_self_select on public.vehicle_damage_reports
  for select to authenticated
  using (candidate_id = (select public.get_employee_candidate_id()));

drop policy if exists damage_self_insert on public.vehicle_damage_reports;
create policy damage_self_insert on public.vehicle_damage_reports
  for insert to authenticated
  with check (
    candidate_id = (select public.get_employee_candidate_id())
    and organization_id = (select public.get_portal_org_id())
  );

-- ---------------------------------------------------------------------------------
-- Ziekmelding, reglementen, kennisbank, onboarding
-- ---------------------------------------------------------------------------------
drop policy if exists sick_self_select on public.sick_reports;
create policy sick_self_select on public.sick_reports
  for select to authenticated
  using (candidate_id = (select public.get_employee_candidate_id()));

drop policy if exists sick_self_insert on public.sick_reports;
create policy sick_self_insert on public.sick_reports
  for insert to authenticated
  with check (
    candidate_id = (select public.get_employee_candidate_id())
    and organization_id = (select public.get_portal_org_id())
  );

drop policy if exists reg_ack_self_select on public.regulation_acknowledgements;
create policy reg_ack_self_select on public.regulation_acknowledgements
  for select to authenticated
  using (candidate_id = (select public.get_employee_candidate_id()));

drop policy if exists reg_ack_self_insert on public.regulation_acknowledgements;
create policy reg_ack_self_insert on public.regulation_acknowledgements
  for insert to authenticated
  with check (
    candidate_id = (select public.get_employee_candidate_id())
    and organization_id = (select public.get_portal_org_id())
  );

drop policy if exists regulation_employee_select on public.regulations;
create policy regulation_employee_select on public.regulations
  for select to authenticated
  using (
    is_active = true
    and organization_id = (select public.get_portal_org_id())
  );

drop policy if exists knowledge_base_employee_select on public.knowledge_base;
create policy knowledge_base_employee_select on public.knowledge_base
  for select to authenticated
  using (
    is_published = true
    and organization_id = (select public.get_portal_org_id())
  );

drop policy if exists onboarding_responses_self_select on public.onboarding_responses;
create policy onboarding_responses_self_select on public.onboarding_responses
  for select to authenticated
  using (candidate_id = (select public.get_employee_candidate_id()));
