-- Security audit 2026-06-10 — RLS hardening (H5 + PII tenant_insert gates + voys_config)
--
-- Probleem: een reeks {public}-policies scopet alleen op organization_id zonder
-- is_internal_user()-gate, waardoor portal-rollen (medewerker / opdrachtgever) binnen
-- de eigen org meer konden dan bedoeld. is_internal_user() = get_user_role() IN
-- ('admin','intercedent','backoffice','finance') — portal-rollen vallen er buiten.
--
-- Veiligheid van deze wijziging is geverifieerd:
--   * documents/sick_reports/timesheets hebben aparte *_self_insert-policies → portal
--     self-upload/ziekmelding/uren blijven werken via die policies.
--   * candidates/placements/contracts/communications/candidate_profile_tokens worden
--     alléén vanuit interne-staf-schermen ge-insert (CandidateNew, PlacementSheet,
--     Planning, EmployeeContractsTab, communicatie-tabs, EmailInbox) — geen portal-pad.
--   * candidate-signup/onboarding draaien via service-role en bypassen RLS.
-- ALTER POLICY is atomair en reversibel (zet de oude expressie terug).

BEGIN;

-- ── H5: candidate_profile_tokens — voeg interne-rol-gate toe ──────────────────────
-- Voorheen kon een medewerker/opdrachtgever alle profieltokens van de org lezen en
-- nieuwe tokens minten, en zo via /profiel/:token PII van willekeurige collega-
-- kandidaten benaderen.
ALTER POLICY candidate_profile_tokens_select ON public.candidate_profile_tokens
  USING (organization_id = get_user_org_id() AND is_internal_user());
ALTER POLICY candidate_profile_tokens_insert ON public.candidate_profile_tokens
  WITH CHECK (organization_id = get_user_org_id() AND is_internal_user());
ALTER POLICY candidate_profile_tokens_update ON public.candidate_profile_tokens
  USING (organization_id = get_user_org_id() AND is_internal_user());

-- ── PII tenant_insert: alleen interne rollen mogen org-breed rijen aanmaken ───────
-- Self-insert paden (document_self_insert, sick_self_insert, timesheet_*_self_insert)
-- blijven intact; deze gate raakt alleen de org-brede tenant_insert.
ALTER POLICY tenant_insert ON public.candidates
  WITH CHECK (organization_id = get_user_org_id() AND is_internal_user());
ALTER POLICY tenant_insert ON public.documents
  WITH CHECK (organization_id = get_user_org_id() AND is_internal_user());
ALTER POLICY tenant_insert ON public.placements
  WITH CHECK (organization_id = get_user_org_id() AND is_internal_user());
ALTER POLICY tenant_insert ON public.contracts
  WITH CHECK (organization_id = get_user_org_id() AND is_internal_user());
ALTER POLICY tenant_insert ON public.timesheets
  WITH CHECK (organization_id = get_user_org_id() AND is_internal_user());
ALTER POLICY tenant_insert ON public.sick_reports
  WITH CHECK (organization_id = get_user_org_id() AND is_internal_user());
ALTER POLICY tenant_insert ON public.communications
  WITH CHECK (organization_id = get_user_org_id() AND is_internal_user());

-- ── voys_config: consistent maken met de andere integratie-config-tabellen ────────
-- exact/whatsapp/microsoft eisen is_internal_user(); carerix eist admin; delete overal
-- admin. Voorheen kon elke in-org rol (incl. medewerker) de PBX-config CRUD-en.
ALTER POLICY voys_config_select ON public.voys_config
  USING (organization_id = get_user_org_id() AND is_internal_user());
ALTER POLICY voys_config_insert ON public.voys_config
  WITH CHECK (organization_id = get_user_org_id() AND is_internal_user());
ALTER POLICY voys_config_update ON public.voys_config
  USING (organization_id = get_user_org_id() AND is_internal_user())
  WITH CHECK (organization_id = get_user_org_id() AND is_internal_user());
ALTER POLICY voys_config_delete ON public.voys_config
  USING (organization_id = get_user_org_id() AND get_user_role() = 'admin'::user_role);

COMMIT;
