-- B6: client_portal_invites (and sibling portal_invites) tenant policies were
-- gated only on organization_id = get_user_org_id(), with NO is_internal_user()
-- check. opdrachtgever/medewerker users share the agency organization_id, so they
-- could SELECT every invite token in the org (cross-company account takeover) and
-- INSERT forged invites to self-escalate. Gate both tables to internal staff only,
-- mirroring 20260422130000_portal_role_gating.sql. Activation runs via service-role
-- edge functions (client-portal-activate / portal-activate), which bypass RLS, so
-- token-based activation is unaffected.

BEGIN;

-- ----- client_portal_invites (opdrachtgever invites) -------------------------
DROP POLICY IF EXISTS tenant_crud ON public.client_portal_invites;

CREATE POLICY tenant_crud
ON public.client_portal_invites
FOR ALL
TO authenticated
USING (
  organization_id = public.get_user_org_id()
  AND public.is_internal_user()
)
WITH CHECK (
  organization_id = public.get_user_org_id()
  AND public.is_internal_user()
);

-- ----- portal_invites (employee/medewerker invites) -- identical defect ------
DROP POLICY IF EXISTS portal_invites_insert ON public.portal_invites;
CREATE POLICY portal_invites_insert
ON public.portal_invites
FOR INSERT
TO authenticated
WITH CHECK (
  organization_id = public.get_user_org_id()
  AND public.is_internal_user()
);

DROP POLICY IF EXISTS portal_invites_select ON public.portal_invites;
CREATE POLICY portal_invites_select
ON public.portal_invites
FOR SELECT
TO authenticated
USING (
  organization_id = public.get_user_org_id()
  AND public.is_internal_user()
);

DROP POLICY IF EXISTS portal_invites_update ON public.portal_invites;
CREATE POLICY portal_invites_update
ON public.portal_invites
FOR UPDATE
TO authenticated
USING (
  organization_id = public.get_user_org_id()
  AND public.is_internal_user()
)
WITH CHECK (
  organization_id = public.get_user_org_id()
  AND public.is_internal_user()
);

COMMIT;
