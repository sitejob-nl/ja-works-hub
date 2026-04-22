-- ============================================================================
-- Pre-handover security hardening (2026-04-22)
--
-- SEC-1  profiles: block non-superadmin from changing organization_id / role / id
--        (WITH CHECK alone is not enough because get_user_org_id() reads NEW state)
-- SEC-2  get_exact/whatsapp/carerix_token: enforce caller-identity inside body
--        and REVOKE EXECUTE from anon
-- SEC-4  match_proposal_tokens: drop the "Anyone can read by token" policy
--        that allowed anonymous enumeration
--
-- Reviewed by: <REVIEWER>
-- Applied on production: <DATE>
-- ============================================================================


-- -------------------- SEC-1: profiles immutable fields -----------------------
CREATE OR REPLACE FUNCTION public.enforce_profile_immutable_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  IF OLD.id IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION 'profiles.id is immutable';
  END IF;

  IF OLD.organization_id IS DISTINCT FROM NEW.organization_id
     AND NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'profiles.organization_id can only be changed by a superadmin';
  END IF;

  IF OLD.role IS DISTINCT FROM NEW.role
     AND NOT public.is_superadmin()
     AND public.get_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'Only admins can change profile roles';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_enforce_immutable ON public.profiles;
CREATE TRIGGER profiles_enforce_immutable
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.enforce_profile_immutable_fields();

-- Tighten the UPDATE policy: self OR admin-in-same-org, and add WITH CHECK
DROP POLICY IF EXISTS profiles_update ON public.profiles;
CREATE POLICY profiles_update ON public.profiles
FOR UPDATE TO authenticated
USING (
  id = auth.uid()
  OR (organization_id = public.get_user_org_id() AND public.get_user_role() = 'admin')
)
WITH CHECK (
  id = auth.uid()
  OR (organization_id = public.get_user_org_id() AND public.get_user_role() = 'admin')
);


-- -------------------- SEC-2: token RPCs require caller to match org ----------
CREATE OR REPLACE FUNCTION public.get_exact_token(p_org_id uuid)
RETURNS TABLE(
  tenant_id text,
  decrypted_webhook_secret text,
  division integer,
  base_url text,
  region text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'extensions', 'vault'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (public.is_superadmin() OR p_org_id = public.get_user_org_id()) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;

  RETURN QUERY
  SELECT
    e.tenant_id,
    decrypt_sensitive(e.webhook_secret) AS decrypted_webhook_secret,
    e.division,
    e.base_url,
    e.region
  FROM public.exact_config e
  WHERE e.organization_id = p_org_id AND e.is_active = true;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_whatsapp_token(p_org_id uuid)
RETURNS TABLE(
  decrypted_access_token text,
  decrypted_webhook_secret text,
  phone_number_id text,
  waba_id text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'extensions'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (public.is_superadmin() OR p_org_id = public.get_user_org_id()) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;

  RETURN QUERY
  SELECT
    decrypt_sensitive(w.access_token),
    decrypt_sensitive(w.webhook_secret),
    w.phone_number_id,
    w.waba_id
  FROM public.whatsapp_config w
  WHERE w.organization_id = p_org_id AND w.is_active = true;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_carerix_token(p_org_id uuid)
RETURNS TABLE(
  client_id text,
  decrypted_client_secret text,
  token_endpoint text,
  instance_url text,
  scope text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'extensions', 'vault'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT (public.is_superadmin() OR p_org_id = public.get_user_org_id()) THEN
    RAISE EXCEPTION 'Not authorized for this organization';
  END IF;

  RETURN QUERY
  SELECT
    c.client_id,
    decrypt_sensitive(c.client_secret) AS decrypted_client_secret,
    c.token_endpoint,
    c.instance_url,
    c.scope
  FROM public.carerix_config c
  WHERE c.organization_id = p_org_id AND c.is_connected = true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_exact_token(uuid)    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_whatsapp_token(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_carerix_token(uuid)  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_exact_token(uuid)    TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.get_whatsapp_token(uuid) TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.get_carerix_token(uuid)  TO authenticated, service_role;


-- -------------------- SEC-4: kill public-enumerable match tokens -------------
DROP POLICY IF EXISTS "Anyone can read by token" ON public.match_proposal_tokens;
-- The existing "Org members can manage proposal tokens" policy remains — in-org
-- users keep full CRUD. Public token validation must flow through an edge
-- function using service_role (candidate-profile / match-proposal endpoints
-- already do).
