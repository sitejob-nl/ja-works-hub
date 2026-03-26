CREATE OR REPLACE FUNCTION public.get_exact_token(p_org_id uuid)
RETURNS TABLE(tenant_id text, decrypted_webhook_secret text, division int, base_url text, region text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'vault'
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    e.tenant_id,
    decrypt_sensitive(e.webhook_secret) as decrypted_webhook_secret,
    e.division,
    e.base_url,
    e.region
  FROM exact_config e
  WHERE e.organization_id = p_org_id AND e.is_active = true;
END;
$$;