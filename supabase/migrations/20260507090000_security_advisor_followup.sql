-- ============================================================================
-- Security advisor follow-up (2026-05-07)
--
-- Addresses the live advisor findings that affect acceptatie/security:
-- - v_unit_occupancy should not run as a definer view
-- - sensitive SECURITY DEFINER RPCs should not be executable by anon/public
-- - token/decrypt RPCs should be service-role only where the frontend does not
--   call them directly
-- - campaign/candidate-sensitive RPCs must enforce org access inside the body
-- - client_errors inserts should be scoped to the current user/org
-- - storage logo writes should be scoped to the caller's organization folder
-- ============================================================================

BEGIN;

-- Make the housing occupancy view obey the caller's RLS context.
ALTER VIEW IF EXISTS public.v_unit_occupancy SET (security_invoker = true);

-- Add explicit tenant/role checks to Microsoft token retrieval. These RPCs are
-- used by edge functions with service_role; the browser should not receive raw
-- Microsoft access/refresh tokens.
CREATE OR REPLACE FUNCTION public.get_microsoft_token(p_org_id uuid)
RETURNS TABLE(
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  refreshing_at timestamptz,
  microsoft_email text,
  microsoft_tenant_id text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'extensions', 'vault', 'pg_temp'
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
    public.decrypt_sensitive(m.access_token),
    public.decrypt_sensitive(m.refresh_token),
    m.token_expires_at,
    m.refreshing_at,
    m.microsoft_email,
    m.microsoft_tenant_id
  FROM public.microsoft_config m
  WHERE m.organization_id = p_org_id
    AND m.user_id IS NULL
    AND m.is_active = true;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_microsoft_token(
  p_org_id uuid,
  p_user_id uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  refreshing_at timestamptz,
  microsoft_email text,
  microsoft_tenant_id text,
  is_personal boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'extensions', 'vault', 'pg_temp'
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    NULL;
  ELSIF auth.role() = 'authenticated' THEN
    IF NOT (public.is_superadmin() OR p_org_id = public.get_user_org_id()) THEN
      RAISE EXCEPTION 'Not authorized for this organization';
    END IF;
    IF p_user_id IS NOT NULL AND p_user_id <> auth.uid() AND NOT public.is_superadmin() THEN
      RAISE EXCEPTION 'Not authorized for this user';
    END IF;
  ELSE
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_user_id IS NOT NULL THEN
    RETURN QUERY
    SELECT
      public.decrypt_sensitive(m.access_token),
      public.decrypt_sensitive(m.refresh_token),
      m.token_expires_at,
      m.refreshing_at,
      m.microsoft_email,
      m.microsoft_tenant_id,
      true AS is_personal
    FROM public.microsoft_config m
    WHERE m.organization_id = p_org_id
      AND m.user_id = p_user_id
      AND m.is_active = true;

    IF FOUND THEN
      RETURN;
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    public.decrypt_sensitive(m.access_token),
    public.decrypt_sensitive(m.refresh_token),
    m.token_expires_at,
    m.refreshing_at,
    m.microsoft_email,
    m.microsoft_tenant_id,
    false AS is_personal
  FROM public.microsoft_config m
  WHERE m.organization_id = p_org_id
    AND m.user_id IS NULL
    AND m.is_active = true;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_campaign_candidates(
  p_org_id uuid,
  p_filter jsonb,
  p_channel communication_channel
)
RETURNS TABLE(
  candidate_id uuid,
  phone text,
  first_name text,
  last_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
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
    c.id,
    c.phone,
    c.first_name,
    c.last_name
  FROM public.candidates c
  LEFT JOIN public.communication_preferences cp
    ON cp.candidate_id = c.id
    AND cp.channel = p_channel
    AND cp.organization_id = p_org_id
  WHERE c.organization_id = p_org_id
    AND c.phone IS NOT NULL
    AND c.phone <> ''
    AND (cp.opted_out IS NULL OR cp.opted_out = false)
    AND (
      p_filter->>'talentpool_id' IS NULL
      OR c.id IN (
        SELECT tm.candidate_id
        FROM public.talentpool_members tm
        WHERE tm.talentpool_id = (p_filter->>'talentpool_id')::uuid
      )
    )
    AND (
      p_filter->>'status' IS NULL
      OR c.status::text = ANY (
        SELECT jsonb_array_elements_text(p_filter->'status')
      )
    )
    AND (
      p_filter->>'skills' IS NULL
      OR c.skills && ARRAY(
        SELECT jsonb_array_elements_text(p_filter->'skills')
      )::text[]
    )
    AND (
      p_filter->>'compliance_status' IS NULL
      OR c.compliance_status::text = ANY (
        SELECT jsonb_array_elements_text(p_filter->'compliance_status')
      )
    )
    AND (
      p_filter->>'city' IS NULL
      OR c.address_city ILIKE '%' || (p_filter->>'city') || '%'
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_candidate_decrypted(p_candidate_id uuid)
RETURNS TABLE(
  decrypted_bsn text,
  decrypted_iban text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'extensions', 'vault', 'pg_temp'
AS $$
BEGIN
  IF auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (
    public.is_superadmin()
    OR EXISTS (
      SELECT 1
      FROM public.candidates c
      WHERE c.id = p_candidate_id
        AND c.organization_id = public.get_user_org_id()
    )
  ) THEN
    RAISE EXCEPTION 'Geen toegang';
  END IF;

  RETURN QUERY
  SELECT
    public.decrypt_sensitive(c.bsn) AS decrypted_bsn,
    public.decrypt_sensitive(c.iban) AS decrypted_iban
  FROM public.candidates c
  WHERE c.id = p_candidate_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_sensitive_data()
RETURNS TABLE(
  decrypted_bsn text,
  decrypted_iban text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'extensions', 'vault', 'pg_temp'
AS $$
BEGIN
  IF auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
  SELECT
    public.decrypt_sensitive(c.bsn) AS decrypted_bsn,
    public.decrypt_sensitive(c.iban) AS decrypted_iban
  FROM public.candidates c
  JOIN public.employees e ON e.candidate_id = c.id
  WHERE e.auth_user_id = auth.uid();
END;
$$;

-- Lock down direct execution of raw encryption/decryption/token/credit RPCs.
REVOKE EXECUTE ON FUNCTION public.decrypt_sensitive(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.encrypt_sensitive(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_microsoft_token(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_microsoft_token(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_exact_token(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_whatsapp_token(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_carerix_token(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.consume_ai_credits(uuid, integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.decrypt_sensitive(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.encrypt_sensitive(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_microsoft_token(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_microsoft_token(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_exact_token(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_whatsapp_token(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_carerix_token(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_ai_credits(uuid, integer) TO service_role;

-- Browser-facing sensitive RPCs still need authenticated access, but not anon.
REVOKE EXECUTE ON FUNCTION public.get_campaign_candidates(uuid, jsonb, communication_channel) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_candidate_decrypted(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_my_sensitive_data() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.topup_ai_credits(uuid, integer, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_campaign_candidates(uuid, jsonb, communication_channel) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_candidate_decrypted(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_sensitive_data() TO authenticated;
GRANT EXECUTE ON FUNCTION public.topup_ai_credits(uuid, integer, text) TO authenticated, service_role;

-- Ensure helper functions used by RLS have a fixed search_path.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'set_updated_at',
        'handle_updated_at',
        'sync_candidate_id_from_employee',
        'get_employee_id',
        'is_employee_user',
        'is_internal_user',
        'is_superadmin',
        'get_user_org_id',
        'get_user_role',
        'encrypt_carerix_secret',
        'check_unit_capacity',
        'check_drivers_license',
        'check_rate_limit',
        'record_rate_limit'
      )
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %s SET search_path = public, extensions, vault, pg_temp',
      r.signature
    );
  END LOOP;
END;
$$;

-- Narrow client error intake to the signed-in user and their organization.
DROP POLICY IF EXISTS "anyone_insert_errors" ON public.client_errors;
DROP POLICY IF EXISTS client_errors_insert_own_org ON public.client_errors;
CREATE POLICY client_errors_insert_own_org
ON public.client_errors
FOR INSERT TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND (
    organization_id IS NULL
    OR organization_id = public.get_user_org_id()
    OR public.is_superadmin()
  )
);

-- Keep logos public-readable for branding URLs, but constrain mutations to the
-- caller's org folder: {organization_id}/logo.ext.
DROP POLICY IF EXISTS "Authenticated users can upload logos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update logos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete logos" ON storage.objects;
DROP POLICY IF EXISTS organization_logos_insert_own_org ON storage.objects;
DROP POLICY IF EXISTS organization_logos_update_own_org ON storage.objects;
DROP POLICY IF EXISTS organization_logos_delete_own_org ON storage.objects;

CREATE POLICY organization_logos_insert_own_org
ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'organization-logos'
  AND split_part(name, '/', 1) = public.get_user_org_id()::text
);

CREATE POLICY organization_logos_update_own_org
ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'organization-logos'
  AND split_part(name, '/', 1) = public.get_user_org_id()::text
)
WITH CHECK (
  bucket_id = 'organization-logos'
  AND split_part(name, '/', 1) = public.get_user_org_id()::text
);

CREATE POLICY organization_logos_delete_own_org
ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'organization-logos'
  AND split_part(name, '/', 1) = public.get_user_org_id()::text
);

COMMIT;
