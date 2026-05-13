BEGIN;

DROP POLICY IF EXISTS portal_invites_insert ON public.portal_invites;
DROP POLICY IF EXISTS portal_invites_select ON public.portal_invites;
DROP POLICY IF EXISTS portal_invites_update ON public.portal_invites;

CREATE POLICY portal_invites_insert
ON public.portal_invites
FOR INSERT
TO authenticated
WITH CHECK (organization_id = get_user_org_id());

CREATE POLICY portal_invites_select
ON public.portal_invites
FOR SELECT
TO authenticated
USING (organization_id = get_user_org_id());

CREATE POLICY portal_invites_update
ON public.portal_invites
FOR UPDATE
TO authenticated
USING (organization_id = get_user_org_id());

DROP POLICY IF EXISTS tenant_crud ON public.client_portal_invites;

CREATE POLICY tenant_crud
ON public.client_portal_invites
FOR ALL
TO authenticated
USING (organization_id = get_user_org_id());

COMMIT;
