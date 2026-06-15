-- ============================================================================
-- B8 — Gate housing INSERT policies on is_internal_user()
--
-- The portal_role_gating migration (20260422130000) rewrote SELECT/UPDATE on
-- properties / units / housing_assignments / housing_inspections /
-- key_registrations to require is_internal_user(), and DELETE was already
-- admin-gated, but it intentionally left INSERT as the legacy Lovable
-- org-only "tenant_insert" (roles=public, with_check = organization_id =
-- get_user_org_id()). Because get_user_org_id() resolves an org for
-- medewerker / opdrachtgever portal users too, those non-internal users can
-- INSERT housing rows in their own org.
--
-- This mirrors the canonical internal-table INSERT pattern already used by
-- candidates, documents, placements, timesheets, property_owners, etc.:
--   WITH CHECK ((organization_id = get_user_org_id()) AND is_internal_user())
-- and aligns the policy role to TO authenticated (matching the rewritten
-- tenant_select / tenant_update on these same tables).
--
-- Non-destructive: no data is altered. Idempotent.
-- ============================================================================

BEGIN;

-- ----- properties
DROP POLICY IF EXISTS tenant_insert ON public.properties;
CREATE POLICY tenant_insert ON public.properties
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());

-- ----- units
DROP POLICY IF EXISTS tenant_insert ON public.units;
CREATE POLICY tenant_insert ON public.units
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());

-- ----- housing_assignments
DROP POLICY IF EXISTS tenant_insert ON public.housing_assignments;
CREATE POLICY tenant_insert ON public.housing_assignments
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());

-- ----- housing_inspections
DROP POLICY IF EXISTS tenant_insert ON public.housing_inspections;
CREATE POLICY tenant_insert ON public.housing_inspections
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());

-- ----- key_registrations
DROP POLICY IF EXISTS tenant_insert ON public.key_registrations;
CREATE POLICY tenant_insert ON public.key_registrations
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());

COMMIT;
