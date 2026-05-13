-- Activation pages inspect invites via Edge Functions with service-role lookup.
-- Do not expose active invitation rows directly to anon REST clients.

DROP POLICY IF EXISTS portal_invites_public_token_read ON public.portal_invites;
DROP POLICY IF EXISTS public_token_read ON public.client_portal_invites;
