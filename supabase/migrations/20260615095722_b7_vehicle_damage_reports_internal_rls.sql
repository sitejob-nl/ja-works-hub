-- ============================================================================
-- B7 — Gate vehicle_damage_reports generic policies on is_internal_user()
--
-- The 4 generic policies (select/update/insert/delete) were applied to PUBLIC
-- with only an org-scope check and NO role gate, so any portal user
-- (medewerker / opdrachtgever) sharing the agency org could read, modify and
-- delete EVERY colleague's damage report (intra-tenant PII leak + tampering).
--
-- Fix: rewrite the 4 generic policies to require is_internal_user() (mirroring
-- the already-deployed sibling fleet tables and the portal_role_gating pattern),
-- scoped TO authenticated. The portal worker's own-report path is preserved by
-- the separate damage_self_select / damage_self_insert policies, which are NOT
-- touched here.
--
-- Non-destructive: no data is altered. Idempotent.
-- ============================================================================

BEGIN;

DROP POLICY IF EXISTS vehicle_damage_reports_select_policy ON public.vehicle_damage_reports;
CREATE POLICY vehicle_damage_reports_select_policy ON public.vehicle_damage_reports
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS vehicle_damage_reports_insert_policy ON public.vehicle_damage_reports;
CREATE POLICY vehicle_damage_reports_insert_policy ON public.vehicle_damage_reports
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS vehicle_damage_reports_update_policy ON public.vehicle_damage_reports;
CREATE POLICY vehicle_damage_reports_update_policy ON public.vehicle_damage_reports
  FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
  WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());

DROP POLICY IF EXISTS vehicle_damage_reports_delete_policy ON public.vehicle_damage_reports;
CREATE POLICY vehicle_damage_reports_delete_policy ON public.vehicle_damage_reports
  FOR DELETE TO authenticated
  USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

-- NOTE: damage_self_select / damage_self_insert (the portal worker's own-report
-- read+create path) are intentionally left unchanged.

COMMIT;
