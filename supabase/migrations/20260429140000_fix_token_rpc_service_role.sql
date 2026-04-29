-- Fix: token-RPCs (carerix/exact/whatsapp) blokkeerden ook service_role-aanroepen
-- omdat ze `auth.uid() IS NULL` gebruikten als anon-check. Edge functions roepen
-- deze RPCs aan met de service-role admin client (waar auth.uid() altijd null is) →
-- elke sync/test faalt met "Not authenticated".
--
-- Verfijning: `auth.role()` herkent service_role expliciet, waardoor de bedoelde
-- bescherming (anon weren + cross-org-toegang voorkomen) intact blijft maar
-- service_role wel mag. Authenticated users blijven org-gebonden.
--
-- Aanpassing alleen op de auth-check; SELECT-bodies + filters blijven identiek
-- aan 20260422120000_pre_handover_security_hardening.sql.

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
  IF auth.role() = 'service_role' THEN
    NULL;
  ELSIF auth.role() = 'authenticated' THEN
    IF NOT (public.is_superadmin() OR p_org_id = public.get_user_org_id()) THEN
      RAISE EXCEPTION 'Not authorized for this organization';
    END IF;
  ELSE
    RAISE EXCEPTION 'Not authenticated';
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
  IF auth.role() = 'service_role' THEN
    NULL;
  ELSIF auth.role() = 'authenticated' THEN
    IF NOT (public.is_superadmin() OR p_org_id = public.get_user_org_id()) THEN
      RAISE EXCEPTION 'Not authorized for this organization';
    END IF;
  ELSE
    RAISE EXCEPTION 'Not authenticated';
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
  IF auth.role() = 'service_role' THEN
    NULL;
  ELSIF auth.role() = 'authenticated' THEN
    IF NOT (public.is_superadmin() OR p_org_id = public.get_user_org_id()) THEN
      RAISE EXCEPTION 'Not authorized for this organization';
    END IF;
  ELSE
    RAISE EXCEPTION 'Not authenticated';
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
