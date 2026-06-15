-- Performance: fix auth_rls_initplan on 57 RLS policies (architecture audit Pri 4)
--
-- STATUS: PROPOSED — NOT yet applied to production. Apply via
--   mcp__claude_ai_Supabase__apply_migration after review, then regenerate
--   src/integrations/supabase/types.ts (no type change expected) and run get_advisors.
--
-- What & why
-- ----------
-- The Supabase performance advisor flagged 57 policies (33 tables) with
-- `auth_rls_initplan`: they call session-scoped functions — auth.uid(),
-- get_user_org_id(), get_user_role(), is_internal_user(), is_superadmin() — directly
-- in USING / WITH CHECK, so Postgres re-evaluates them ONCE PER ROW. Wrapping each call
-- in `(select ...)` turns it into an InitPlan the planner runs ONCE PER QUERY. These
-- functions depend only on the auth session, not on the row, so the boolean result is
-- identical — RLS semantics are unchanged; only per-row CPU drops. This is the single
-- highest-leverage scalability fix and it matters regardless of table size.
--
-- Example (employees.employee_self_select):
--   BEFORE  USING (auth_user_id = auth.uid())
--   AFTER   USING (auth_user_id = (select auth.uid()))   -- evaluated once per query
--
-- How this was produced & verified
-- --------------------------------
-- Each statement was generated from the live pg_policies definition by wrapping the
-- session functions in (select ...), preserving everything else byte-for-byte, and
-- matching the clause to each policy's command (INSERT -> WITH CHECK only;
-- SELECT/DELETE/ALL -> USING; UPDATE -> only the clause(s) the policy already had).
-- The full set was dry-run on production inside BEGIN ... ROLLBACK: all 57 applied
-- with no error and the planner confirmed 57/57 wrapped; the transaction was rolled
-- back, leaving production unchanged. Re-running this migration is idempotent (each
-- ALTER POLICY sets the expression to the same wrapped form).
--
-- Reviewer note: only `auth_rls_initplan`-flagged policies (those with a literal
-- auth.*()/current_setting()) are touched. The separate `multiple_permissive_policies`
-- advisor (consolidating overlapping policies) is intentionally NOT addressed here.

ALTER POLICY annual_statements_employee_read ON public.annual_statements USING (((employee_id IN ( SELECT employees.id FROM employees WHERE (employees.auth_user_id = (select auth.uid())))) AND (status = ANY (ARRAY['definitief'::text, 'verzonden'::text]))));
ALTER POLICY candidate_employment_insert ON public.candidate_employment WITH CHECK ((organization_id IN ( SELECT profiles.organization_id FROM profiles WHERE (profiles.id = (select auth.uid())))));
ALTER POLICY candidate_self_select ON public.candidates USING ((id IN ( SELECT employees.candidate_id FROM employees WHERE (employees.auth_user_id = (select auth.uid())))));
ALTER POLICY candidate_self_update ON public.candidates USING ((id IN ( SELECT employees.candidate_id FROM employees WHERE (employees.auth_user_id = (select auth.uid())))));
ALTER POLICY opdrachtgever_select_candidates ON public.candidates USING ((((select get_user_role()) = 'opdrachtgever'::user_role) AND (organization_id = (select get_user_org_id())) AND (id IN ( SELECT pl.candidate_id FROM placements pl WHERE (pl.company_id IN ( SELECT cc.company_id FROM company_contacts cc WHERE (cc.auth_user_id = (select auth.uid()))))))));
ALTER POLICY client_errors_insert_own_org ON public.client_errors WITH CHECK (((user_id = (select auth.uid())) AND ((organization_id IS NULL) OR (organization_id = (select get_user_org_id())) OR (select is_superadmin()))));
ALTER POLICY communication_self_select ON public.communications USING ((candidate_id IN ( SELECT employees.candidate_id FROM employees WHERE (employees.auth_user_id = (select auth.uid())))));
ALTER POLICY company_contact_client_portal_self_select ON public.company_contacts USING (((auth_user_id = (select auth.uid())) AND (organization_id = (select get_user_org_id()))));
ALTER POLICY company_contact_client_portal_self_update ON public.company_contacts USING (((auth_user_id = (select auth.uid())) AND (organization_id = (select get_user_org_id())))) WITH CHECK (((auth_user_id = (select auth.uid())) AND (organization_id = (select get_user_org_id()))));
ALTER POLICY opdrachtgever_select_own ON public.company_contacts USING ((((select get_user_role()) = 'opdrachtgever'::user_role) AND (auth_user_id = (select auth.uid()))));
ALTER POLICY company_functions_org_isolation ON public.company_functions USING ((organization_id IN ( SELECT profiles.organization_id FROM profiles WHERE (profiles.id = (select auth.uid())))));
ALTER POLICY contract_self_select ON public.contracts USING ((employee_id IN ( SELECT employees.id FROM employees WHERE (employees.auth_user_id = (select auth.uid())))));
ALTER POLICY document_self_insert ON public.documents WITH CHECK (((candidate_id IN ( SELECT employees.candidate_id FROM employees WHERE (employees.auth_user_id = (select auth.uid())))) AND (organization_id IN ( SELECT employees.organization_id FROM employees WHERE (employees.auth_user_id = (select auth.uid()))))));
ALTER POLICY document_self_select ON public.documents USING ((candidate_id IN ( SELECT employees.candidate_id FROM employees WHERE (employees.auth_user_id = (select auth.uid())))));
ALTER POLICY employee_self_select ON public.employees USING ((auth_user_id = (select auth.uid())));
ALTER POLICY employee_self_update ON public.employees USING ((auth_user_id = (select auth.uid())));
ALTER POLICY fuel_card_transactions_delete_policy ON public.fuel_card_transactions USING ((organization_id = ( SELECT profiles.organization_id FROM profiles WHERE (profiles.id = (select auth.uid())))));
ALTER POLICY fuel_card_transactions_insert_policy ON public.fuel_card_transactions WITH CHECK ((organization_id = ( SELECT profiles.organization_id FROM profiles WHERE (profiles.id = (select auth.uid())))));
ALTER POLICY fuel_card_transactions_select_policy ON public.fuel_card_transactions USING ((organization_id = ( SELECT profiles.organization_id FROM profiles WHERE (profiles.id = (select auth.uid())))));
ALTER POLICY fuel_card_transactions_update_policy ON public.fuel_card_transactions USING ((organization_id = ( SELECT profiles.organization_id FROM profiles WHERE (profiles.id = (select auth.uid())))));
ALTER POLICY hour_letters_employee_read ON public.hour_letters USING ((employee_id IN ( SELECT employees.id FROM employees WHERE (employees.auth_user_id = (select auth.uid())))));
ALTER POLICY housing_self_select ON public.housing_assignments USING ((employee_id IN ( SELECT employees.id FROM employees WHERE (employees.auth_user_id = (select auth.uid())))));
ALTER POLICY knowledge_base_employee_select ON public.knowledge_base USING (((is_published = true) AND (organization_id IN ( SELECT employees.organization_id FROM employees WHERE (employees.auth_user_id = (select auth.uid()))))));
ALTER POLICY "Org members can manage proposal tokens" ON public.match_proposal_tokens USING ((organization_id IN ( SELECT profiles.organization_id FROM profiles WHERE (profiles.id = (select auth.uid())))));
ALTER POLICY tenant_select ON public.microsoft_config USING (((organization_id = (select get_user_org_id())) AND ((user_id IS NULL) OR (user_id = (select auth.uid())))));
ALTER POLICY tenant_update ON public.microsoft_config USING (((organization_id = (select get_user_org_id())) AND ((user_id IS NULL) OR (user_id = (select auth.uid())))));
ALTER POLICY notes_delete ON public.notes USING (((organization_id = (select get_user_org_id())) AND (select is_internal_user()) AND (created_by = (select auth.uid()))));
ALTER POLICY notes_insert ON public.notes WITH CHECK ((organization_id IN ( SELECT profiles.organization_id FROM profiles WHERE (profiles.id = (select auth.uid())))));
ALTER POLICY notes_update ON public.notes USING (((organization_id = (select get_user_org_id())) AND (select is_internal_user()) AND (created_by = (select auth.uid())))) WITH CHECK (((organization_id = (select get_user_org_id())) AND (select is_internal_user()) AND (created_by = (select auth.uid()))));
ALTER POLICY onboarding_responses_self_select ON public.onboarding_responses USING ((employee_id IN ( SELECT employees.id FROM employees WHERE (employees.auth_user_id = (select auth.uid())))));
ALTER POLICY payslips_employee_read ON public.payslips USING (((employee_id IN ( SELECT employees.id FROM employees WHERE (employees.auth_user_id = (select auth.uid())))) AND (status = 'definitief'::text)));
ALTER POLICY placement_allowances_org_isolation ON public.placement_allowances USING ((organization_id IN ( SELECT profiles.organization_id FROM profiles WHERE (profiles.id = (select auth.uid())))));
ALTER POLICY placement_hour_types_org_isolation ON public.placement_hour_types USING ((organization_id IN ( SELECT profiles.organization_id FROM profiles WHERE (profiles.id = (select auth.uid())))));
ALTER POLICY placement_travel_types_org_isolation ON public.placement_travel_types USING ((organization_id IN ( SELECT profiles.organization_id FROM profiles WHERE (profiles.id = (select auth.uid())))));
ALTER POLICY opdrachtgever_select_placements ON public.placements USING ((((select get_user_role()) = 'opdrachtgever'::user_role) AND (organization_id = (select get_user_org_id())) AND (company_id IN ( SELECT cc.company_id FROM company_contacts cc WHERE (cc.auth_user_id = (select auth.uid()))))));
ALTER POLICY placement_self_select ON public.placements USING ((employee_id IN ( SELECT employees.id FROM employees WHERE (employees.auth_user_id = (select auth.uid())))));
ALTER POLICY profiles_update ON public.profiles USING (((id = (select auth.uid())) OR ((organization_id = (select get_user_org_id())) AND ((select get_user_role()) = 'admin'::user_role)))) WITH CHECK (((id = (select auth.uid())) OR ((organization_id = (select get_user_org_id())) AND ((select get_user_role()) = 'admin'::user_role))));
ALTER POLICY property_self_select ON public.properties USING ((id IN ( SELECT u.property_id FROM ((units u JOIN housing_assignments ha ON ((ha.unit_id = u.id))) JOIN employees e ON ((e.id = ha.employee_id))) WHERE ((e.auth_user_id = (select auth.uid())) AND (ha.status = 'ingecheckt'::housing_assignment_status)))));
ALTER POLICY reg_ack_self_insert ON public.regulation_acknowledgements WITH CHECK (((employee_id IN ( SELECT employees.id FROM employees WHERE (employees.auth_user_id = (select auth.uid())))) AND (organization_id IN ( SELECT employees.organization_id FROM employees WHERE (employees.auth_user_id = (select auth.uid()))))));
ALTER POLICY reg_ack_self_select ON public.regulation_acknowledgements USING ((employee_id IN ( SELECT employees.id FROM employees WHERE (employees.auth_user_id = (select auth.uid())))));
ALTER POLICY regulation_employee_select ON public.regulations USING (((is_active = true) AND (organization_id IN ( SELECT employees.organization_id FROM employees WHERE (employees.auth_user_id = (select auth.uid()))))));
ALTER POLICY sick_self_insert ON public.sick_reports WITH CHECK (((employee_id IN ( SELECT employees.id FROM employees WHERE (employees.auth_user_id = (select auth.uid())))) AND (organization_id IN ( SELECT employees.organization_id FROM employees WHERE (employees.auth_user_id = (select auth.uid()))))));
ALTER POLICY sick_self_select ON public.sick_reports USING ((employee_id IN ( SELECT employees.id FROM employees WHERE (employees.auth_user_id = (select auth.uid())))));
ALTER POLICY opdrachtgever_select_timesheets ON public.timesheets USING ((((select get_user_role()) = 'opdrachtgever'::user_role) AND (organization_id = (select get_user_org_id())) AND (placement_id IN ( SELECT p.id FROM placements p WHERE (p.company_id IN ( SELECT cc.company_id FROM company_contacts cc WHERE (cc.auth_user_id = (select auth.uid()))))))));
ALTER POLICY opdrachtgever_update_timesheets ON public.timesheets USING ((((select get_user_role()) = 'opdrachtgever'::user_role) AND (organization_id = (select get_user_org_id())) AND (placement_id IN ( SELECT p.id FROM placements p WHERE (p.company_id IN ( SELECT cc.company_id FROM company_contacts cc WHERE (cc.auth_user_id = (select auth.uid()))))))));
ALTER POLICY timesheet_self_insert ON public.timesheets WITH CHECK (((employee_id IN ( SELECT employees.id FROM employees WHERE (employees.auth_user_id = (select auth.uid())))) AND (organization_id IN ( SELECT employees.organization_id FROM employees WHERE (employees.auth_user_id = (select auth.uid()))))));
ALTER POLICY timesheet_self_select ON public.timesheets USING ((employee_id IN ( SELECT employees.id FROM employees WHERE (employees.auth_user_id = (select auth.uid())))));
ALTER POLICY timesheet_self_update ON public.timesheets USING ((employee_id IN ( SELECT employees.id FROM employees WHERE (employees.auth_user_id = (select auth.uid())))));
ALTER POLICY unit_self_select ON public.units USING ((id IN ( SELECT ha.unit_id FROM (housing_assignments ha JOIN employees e ON ((e.id = ha.employee_id))) WHERE ((e.auth_user_id = (select auth.uid())) AND (ha.status = 'ingecheckt'::housing_assignment_status)))));
ALTER POLICY vehicle_assignment_self_select ON public.vehicle_assignments USING ((employee_id IN ( SELECT employees.id FROM employees WHERE (employees.auth_user_id = (select auth.uid())))));
ALTER POLICY damage_self_insert ON public.vehicle_damage_reports WITH CHECK (((employee_id IN ( SELECT employees.id FROM employees WHERE (employees.auth_user_id = (select auth.uid())))) AND (organization_id IN ( SELECT employees.organization_id FROM employees WHERE (employees.auth_user_id = (select auth.uid()))))));
ALTER POLICY damage_self_select ON public.vehicle_damage_reports USING ((employee_id IN ( SELECT employees.id FROM employees WHERE (employees.auth_user_id = (select auth.uid())))));
ALTER POLICY vehicle_damage_reports_delete_policy ON public.vehicle_damage_reports USING ((organization_id = ( SELECT profiles.organization_id FROM profiles WHERE (profiles.id = (select auth.uid())))));
ALTER POLICY vehicle_damage_reports_insert_policy ON public.vehicle_damage_reports WITH CHECK ((organization_id = ( SELECT profiles.organization_id FROM profiles WHERE (profiles.id = (select auth.uid())))));
ALTER POLICY vehicle_damage_reports_select_policy ON public.vehicle_damage_reports USING ((organization_id = ( SELECT profiles.organization_id FROM profiles WHERE (profiles.id = (select auth.uid())))));
ALTER POLICY vehicle_damage_reports_update_policy ON public.vehicle_damage_reports USING ((organization_id = ( SELECT profiles.organization_id FROM profiles WHERE (profiles.id = (select auth.uid())))));
ALTER POLICY vehicle_self_select ON public.vehicles USING ((id IN ( SELECT va.vehicle_id FROM (vehicle_assignments va JOIN employees e ON ((e.id = va.employee_id))) WHERE ((e.auth_user_id = (select auth.uid())) AND (va.returned_date IS NULL)))));
