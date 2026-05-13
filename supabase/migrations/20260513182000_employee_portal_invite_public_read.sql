BEGIN;

DROP POLICY IF EXISTS portal_invites_public_token_read ON public.portal_invites;

CREATE POLICY portal_invites_public_token_read
ON public.portal_invites
FOR SELECT
TO anon
USING (used_at IS NULL AND expires_at > now());

COMMIT;
