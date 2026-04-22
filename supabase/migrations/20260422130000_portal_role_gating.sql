-- ============================================================================
-- Portal role gating — block role='medewerker' (and opdrachtgever) from
-- accessing tenant-wide data they shouldn't see.
--
-- BEFORE:
--   Every tenant_select / org_isolation policy allowed any authenticated user
--   with organization_id = <org> to read ALL rows in that table, regardless
--   of their role. A 'medewerker' (portal user) or 'opdrachtgever' (client
--   portal user) could read colleagues' candidate records, documents,
--   timesheets, payslips, matches, vacancies, rates, etc.
--
-- AFTER:
--   - Internal roles (admin, intercedent, backoffice, finance) keep full
--     tenant-scoped access — nothing changes for them.
--   - 'medewerker' and 'opdrachtgever' are BLOCKED from tenant_* and
--     *_org_isolation policies. They get access exclusively through the
--     scoped _self_* and opdrachtgever_* policies that already exist.
--
-- NOT APPLIED YET — this file exists for pre-portal-sprint review.
--
-- Reviewed by: <REVIEWER>
-- Applied on production: <DATE>
-- ============================================================================


-- -------------------- Helper: is_internal_user() -----------------------------
CREATE OR REPLACE FUNCTION public.is_internal_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT COALESCE(
    public.get_user_role() IN ('admin','intercedent','backoffice','finance'),
    false
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_internal_user() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_internal_user() TO authenticated, service_role;


-- =============================================================================
-- GROUP A — tables using the `tenant_*` naming pattern
-- =============================================================================
--
-- For each of these tables we keep INSERT unchanged (those rely on other
-- checks, and medewerker users typically don't INSERT tenant-level data) and
-- we rewrite SELECT and UPDATE to require is_internal_user(). DELETE policies
-- already check for admin role, so they implicitly block medewerker.
--
-- If a table already gates DELETE on admin-only, we leave DELETE alone.
-- If DELETE is only org-scoped (no admin gate), we add is_internal_user().


-- ----- candidates
DROP POLICY IF EXISTS tenant_select ON public.candidates;
CREATE POLICY tenant_select ON public.candidates FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.candidates;
CREATE POLICY tenant_update ON public.candidates FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());


-- ----- employees (legacy table but still used by RLS helpers)
DROP POLICY IF EXISTS tenant_select ON public.employees;
CREATE POLICY tenant_select ON public.employees FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.employees;
CREATE POLICY tenant_update ON public.employees FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());


-- ----- documents
DROP POLICY IF EXISTS tenant_select ON public.documents;
CREATE POLICY tenant_select ON public.documents FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.documents;
CREATE POLICY tenant_update ON public.documents FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());


-- ----- contracts
DROP POLICY IF EXISTS tenant_select ON public.contracts;
CREATE POLICY tenant_select ON public.contracts FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.contracts;
CREATE POLICY tenant_update ON public.contracts FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());


-- ----- timesheets
DROP POLICY IF EXISTS tenant_select ON public.timesheets;
CREATE POLICY tenant_select ON public.timesheets FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.timesheets;
CREATE POLICY tenant_update ON public.timesheets FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());


-- ----- sick_reports
DROP POLICY IF EXISTS tenant_select ON public.sick_reports;
CREATE POLICY tenant_select ON public.sick_reports FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.sick_reports;
CREATE POLICY tenant_update ON public.sick_reports FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());


-- ----- placements
DROP POLICY IF EXISTS tenant_select ON public.placements;
CREATE POLICY tenant_select ON public.placements FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.placements;
CREATE POLICY tenant_update ON public.placements FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());


-- ----- matches
DROP POLICY IF EXISTS tenant_select ON public.matches;
CREATE POLICY tenant_select ON public.matches FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.matches;
CREATE POLICY tenant_update ON public.matches FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());


-- ----- vacancies
DROP POLICY IF EXISTS tenant_select ON public.vacancies;
CREATE POLICY tenant_select ON public.vacancies FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.vacancies;
CREATE POLICY tenant_update ON public.vacancies FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());


-- ----- communications
DROP POLICY IF EXISTS tenant_select ON public.communications;
CREATE POLICY tenant_select ON public.communications FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.communications;
CREATE POLICY tenant_update ON public.communications FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());


-- ----- housing_assignments
DROP POLICY IF EXISTS tenant_select ON public.housing_assignments;
CREATE POLICY tenant_select ON public.housing_assignments FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.housing_assignments;
CREATE POLICY tenant_update ON public.housing_assignments FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());


-- ----- vehicle_assignments
DROP POLICY IF EXISTS tenant_select ON public.vehicle_assignments;
CREATE POLICY tenant_select ON public.vehicle_assignments FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.vehicle_assignments;
CREATE POLICY tenant_update ON public.vehicle_assignments FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());


-- ----- regulation_acknowledgements
DROP POLICY IF EXISTS tenant_select ON public.regulation_acknowledgements;
CREATE POLICY tenant_select ON public.regulation_acknowledgements FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());


-- =============================================================================
-- GROUP B — business/operational tables (no _self_ policy needed for medewerker)
-- =============================================================================

-- ----- companies, company_contacts, company_sla, rate_agreements
DROP POLICY IF EXISTS tenant_select ON public.companies;
CREATE POLICY tenant_select ON public.companies FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.companies;
CREATE POLICY tenant_update ON public.companies FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_select ON public.company_contacts;
CREATE POLICY tenant_select ON public.company_contacts FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.company_contacts;
CREATE POLICY tenant_update ON public.company_contacts FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_select ON public.company_sla;
CREATE POLICY tenant_select ON public.company_sla FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.company_sla;
CREATE POLICY tenant_update ON public.company_sla FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_select ON public.rate_agreements;
CREATE POLICY tenant_select ON public.rate_agreements FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.rate_agreements;
CREATE POLICY tenant_update ON public.rate_agreements FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());


-- ----- invoicing chain
DROP POLICY IF EXISTS tenant_select ON public.invoices;
CREATE POLICY tenant_select ON public.invoices FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.invoices;
CREATE POLICY tenant_update ON public.invoices FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_select ON public.invoice_lines;
CREATE POLICY tenant_select ON public.invoice_lines FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.invoice_lines;
CREATE POLICY tenant_update ON public.invoice_lines FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_delete ON public.invoice_lines;
CREATE POLICY tenant_delete ON public.invoice_lines FOR DELETE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_select ON public.invoice_sequences;
CREATE POLICY tenant_select ON public.invoice_sequences FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.invoice_sequences;
CREATE POLICY tenant_update ON public.invoice_sequences FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());


-- ----- campaigns + comms config
DROP POLICY IF EXISTS tenant_select ON public.bulk_campaigns;
CREATE POLICY tenant_select ON public.bulk_campaigns FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.bulk_campaigns;
CREATE POLICY tenant_update ON public.bulk_campaigns FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_select ON public.campaign_recipients;
CREATE POLICY tenant_select ON public.campaign_recipients FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.campaign_recipients;
CREATE POLICY tenant_update ON public.campaign_recipients FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_select ON public.communication_preferences;
CREATE POLICY tenant_select ON public.communication_preferences FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.communication_preferences;
CREATE POLICY tenant_update ON public.communication_preferences FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_select_wa_tpl ON public.whatsapp_templates;
CREATE POLICY tenant_select_wa_tpl ON public.whatsapp_templates FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update_wa_tpl ON public.whatsapp_templates;
CREATE POLICY tenant_update_wa_tpl ON public.whatsapp_templates FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());


-- ----- HR back-office + support tables
DROP POLICY IF EXISTS tenant_select ON public.audit_log;
CREATE POLICY tenant_select ON public.audit_log FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.audit_log;
CREATE POLICY tenant_update ON public.audit_log FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_select ON public.recruiter_tasks;
CREATE POLICY tenant_select ON public.recruiter_tasks FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.recruiter_tasks;
CREATE POLICY tenant_update ON public.recruiter_tasks FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_select ON public.knowledge_base;
CREATE POLICY tenant_select ON public.knowledge_base FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.knowledge_base;
CREATE POLICY tenant_update ON public.knowledge_base FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_select ON public.people_search_results;
CREATE POLICY tenant_select ON public.people_search_results FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.people_search_results;
CREATE POLICY tenant_update ON public.people_search_results FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_select ON public.talentpools;
CREATE POLICY tenant_select ON public.talentpools FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.talentpools;
CREATE POLICY tenant_update ON public.talentpools FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());


-- ----- property / fleet
DROP POLICY IF EXISTS tenant_select ON public.properties;
CREATE POLICY tenant_select ON public.properties FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.properties;
CREATE POLICY tenant_update ON public.properties FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_select ON public.units;
CREATE POLICY tenant_select ON public.units FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.units;
CREATE POLICY tenant_update ON public.units FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_select ON public.housing_inspections;
CREATE POLICY tenant_select ON public.housing_inspections FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.housing_inspections;
CREATE POLICY tenant_update ON public.housing_inspections FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_select ON public.key_registrations;
CREATE POLICY tenant_select ON public.key_registrations FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.key_registrations;
CREATE POLICY tenant_update ON public.key_registrations FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_select ON public.vehicles;
CREATE POLICY tenant_select ON public.vehicles FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.vehicles;
CREATE POLICY tenant_update ON public.vehicles FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_select ON public.vehicle_fines;
CREATE POLICY tenant_select ON public.vehicle_fines FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.vehicle_fines;
CREATE POLICY tenant_update ON public.vehicle_fines FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_select ON public.mileage_entries;
CREATE POLICY tenant_select ON public.mileage_entries FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.mileage_entries;
CREATE POLICY tenant_update ON public.mileage_entries FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());


-- ----- config & template tables (medewerker never needs these)
DROP POLICY IF EXISTS tenant_select ON public.contract_templates;
CREATE POLICY tenant_select ON public.contract_templates FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.contract_templates;
CREATE POLICY tenant_update ON public.contract_templates FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_select ON public.email_templates;
CREATE POLICY tenant_select ON public.email_templates FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.email_templates;
CREATE POLICY tenant_update ON public.email_templates FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_select ON public.regulations;
CREATE POLICY tenant_select ON public.regulations FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.regulations;
CREATE POLICY tenant_update ON public.regulations FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_select ON public.compliance_rules;
CREATE POLICY tenant_select ON public.compliance_rules FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.compliance_rules;
CREATE POLICY tenant_update ON public.compliance_rules FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_select ON public.exact_config;
CREATE POLICY tenant_select ON public.exact_config FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.exact_config;
CREATE POLICY tenant_update ON public.exact_config FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_select ON public.exact_glaccount_mappings;
CREATE POLICY tenant_select ON public.exact_glaccount_mappings FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.exact_glaccount_mappings;
CREATE POLICY tenant_update ON public.exact_glaccount_mappings FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_delete ON public.exact_glaccount_mappings;
CREATE POLICY tenant_delete ON public.exact_glaccount_mappings FOR DELETE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_select ON public.whatsapp_config;
CREATE POLICY tenant_select ON public.whatsapp_config FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.whatsapp_config;
CREATE POLICY tenant_update ON public.whatsapp_config FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_select ON public.external_mappings;
CREATE POLICY tenant_select ON public.external_mappings FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.external_mappings;
CREATE POLICY tenant_update ON public.external_mappings FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_select ON public.custom_fields;
CREATE POLICY tenant_select ON public.custom_fields FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.custom_fields;
CREATE POLICY tenant_update ON public.custom_fields FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_select ON public.custom_field_values;
CREATE POLICY tenant_select ON public.custom_field_values FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.custom_field_values;
CREATE POLICY tenant_update ON public.custom_field_values FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_delete ON public.custom_field_values;
CREATE POLICY tenant_delete ON public.custom_field_values FOR DELETE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_select ON public.job_feed_configs;
CREATE POLICY tenant_select ON public.job_feed_configs FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.job_feed_configs;
CREATE POLICY tenant_update ON public.job_feed_configs FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_select ON public.job_listings;
CREATE POLICY tenant_select ON public.job_listings FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.job_listings;
CREATE POLICY tenant_update ON public.job_listings FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_select ON public.job_import_logs;
CREATE POLICY tenant_select ON public.job_import_logs FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_select ON public.onboarding_tokens;
CREATE POLICY tenant_select ON public.onboarding_tokens FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.onboarding_tokens;
CREATE POLICY tenant_update ON public.onboarding_tokens FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_select ON public.rate_limit_tracking;
CREATE POLICY tenant_select ON public.rate_limit_tracking FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.rate_limit_tracking;
CREATE POLICY tenant_update ON public.rate_limit_tracking FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_select ON public.termination_reasons;
CREATE POLICY tenant_select ON public.termination_reasons FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS tenant_update ON public.termination_reasons;
CREATE POLICY tenant_update ON public.termination_reasons FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());


-- =============================================================================
-- GROUP C — tables with `*_org_isolation` ALL policy (HR-financial data)
-- =============================================================================
--
-- payslips / annual_statements / hour_letters already have `_employee_read`
-- policies scoped to auth.uid() via employees. The `_org_isolation` ALL policy
-- is the leak. Replace it with an internal-only SELECT/INSERT/UPDATE/DELETE
-- policy set, so medewerker role hits ONLY the `_employee_read` path.

DROP POLICY IF EXISTS payslips_org_isolation ON public.payslips;
CREATE POLICY payslips_internal_select ON public.payslips FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());
CREATE POLICY payslips_internal_insert ON public.payslips FOR INSERT TO authenticated
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());
CREATE POLICY payslips_internal_update ON public.payslips FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());
CREATE POLICY payslips_internal_delete ON public.payslips FOR DELETE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS annual_statements_org_isolation ON public.annual_statements;
CREATE POLICY annual_statements_internal_select ON public.annual_statements FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());
CREATE POLICY annual_statements_internal_insert ON public.annual_statements FOR INSERT TO authenticated
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());
CREATE POLICY annual_statements_internal_update ON public.annual_statements FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());
CREATE POLICY annual_statements_internal_delete ON public.annual_statements FOR DELETE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS hour_letters_org_isolation ON public.hour_letters;
CREATE POLICY hour_letters_internal_select ON public.hour_letters FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());
CREATE POLICY hour_letters_internal_insert ON public.hour_letters FOR INSERT TO authenticated
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());
CREATE POLICY hour_letters_internal_update ON public.hour_letters FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());
CREATE POLICY hour_letters_internal_delete ON public.hour_letters FOR DELETE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

-- employee_deductions / _reservations / _subsidies / _notifications — same pattern.
-- Medewerker would need scoped access to their own reservations/subsidies/notifications
-- once the portal is live — add `_self_select` policies at that point. For now,
-- the internal-only policy is correct (client isn't using the portal yet).

DROP POLICY IF EXISTS employee_deductions_org_isolation ON public.employee_deductions;
CREATE POLICY employee_deductions_internal_all ON public.employee_deductions FOR ALL TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS employee_reservations_org_isolation ON public.employee_reservations;
CREATE POLICY employee_reservations_internal_all ON public.employee_reservations FOR ALL TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS employee_subsidies_org_isolation ON public.employee_subsidies;
CREATE POLICY employee_subsidies_internal_all ON public.employee_subsidies FOR ALL TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS employee_notifications_org_isolation ON public.employee_notifications;
CREATE POLICY employee_notifications_internal_all ON public.employee_notifications FOR ALL TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());
-- Add `employee_notifications_self_read` when the portal surfaces notifications:
--   FOR SELECT USING (candidate_id IN (SELECT id FROM candidates WHERE auth_user_id = auth.uid()))


-- ----- candidate_employment: contains contract/salary/pension details
DROP POLICY IF EXISTS candidate_employment_select ON public.candidate_employment;
CREATE POLICY candidate_employment_select ON public.candidate_employment FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS candidate_employment_update ON public.candidate_employment;
CREATE POLICY candidate_employment_update ON public.candidate_employment FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS candidate_employment_delete ON public.candidate_employment;
CREATE POLICY candidate_employment_delete ON public.candidate_employment FOR DELETE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());


-- ----- notes (intercedent comments — medewerker absolutely must not see)
DROP POLICY IF EXISTS notes_select ON public.notes;
CREATE POLICY notes_select ON public.notes FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS notes_update ON public.notes;
CREATE POLICY notes_update ON public.notes FOR UPDATE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user() AND created_by = auth.uid())
WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user() AND created_by = auth.uid());

DROP POLICY IF EXISTS notes_delete ON public.notes;
CREATE POLICY notes_delete ON public.notes FOR DELETE TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user() AND created_by = auth.uid());


-- =============================================================================
-- NOT TOUCHED (intentional)
-- =============================================================================
--  * organizations.org_select — medewerker needs to read their own org for
--    branding (logo, name, portal colours). The existing `id = get_user_org_id()`
--    is sufficient.
--  * superadmins — locked down at its own layer.
--  * subscription_plans — public-read is acceptable (plan names + modules).
--  * portal_invites / client_portal_invites — handled via edge function +
--    will be fixed as part of PortalActivate rewrite.
--  * candidates.candidate_self_select / candidate_self_update — already
--    correctly scoped to employees.auth_user_id. Leave alone.
--  * documents.document_self_select / timesheets.timesheet_self_* /
--    sick_reports.sick_report_self_* / contracts.contract_self_* — all OK.
--  * talentpool_members (no org_id column — parent-scoped correctly).
--  * opdrachtgever_* policies — already scoped per-company, not org-wide.
--  * microsoft_config tenant_select — already scoped to user_id per-user.
--    If a medewerker ever gets a microsoft_config row, that's a separate bug.
--
-- =============================================================================
-- FOLLOW-UP before applying
-- =============================================================================
--  1. Verify the portal UI (/portaal/*) does NOT break. Specifically test:
--       - PortalDashboard               -> candidate_self_select
--       - PortalTimesheets              -> timesheet_self_select
--       - PortalDocuments               -> document_self_select
--       - PortalPayslips                -> payslips_employee_read
--       - PortalAnnualStatements        -> annual_statements_employee_read
--       - PortalHourLetters             -> hour_letters_employee_read
--       - PortalSickReport              -> sick_report_self_select
--       - PortalPlacements              -> placement_self_select  (ensure exists!)
--       - PortalHousing                 -> housing_assignment_self_select (ensure exists!)
--       - PortalVehicle                 -> vehicle_assignment_self_select (ensure exists!)
--     If _self_ policies are missing for any of these tables, add them in the
--     same migration before flipping this on — otherwise medewerker can't even
--     see their own data.
--
--  2. Make sure the `opdrachtgever_*` policies still cover what client-portal
--     users legitimately need (they might previously have leaned on
--     tenant_select too).
--
--  3. Double-check the PortalContext fetch path in src/contexts/PortalContext.tsx
--     — it loads candidates by `auth_user_id`. The current candidate_self_select
--     policy goes via employees.auth_user_id, not candidates.auth_user_id. Either
--     add a second self-policy (id = auth_user_id) on candidates, or make sure
--     every portal user has their employees.auth_user_id mirrored.
