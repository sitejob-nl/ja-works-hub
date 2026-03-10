
CREATE POLICY "Public can validate portal invite by token"
ON public.portal_invites
FOR SELECT
TO anon
USING (used_at IS NULL AND expires_at > now());
