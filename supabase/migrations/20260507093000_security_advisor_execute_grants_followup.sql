-- ============================================================================
-- Security advisor execute-grants follow-up (2026-05-07)
--
-- Tightens the next layer of live advisor findings after the first hardening
-- migration. This keeps authenticated access where browser/RLS flows depend on
-- it, but removes anonymous execution from helper and superadmin RPCs. Trigger
-- functions are removed from direct browser execution entirely.
-- ============================================================================

-- Trigger/internal functions should not be directly callable via REST RPC.
REVOKE EXECUTE ON FUNCTION public.create_org_credits_row() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.encrypt_candidate_sensitive() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.encrypt_carerix_secret() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.encrypt_exact_sensitive() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.encrypt_whatsapp_sensitive() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_profile_immutable_fields() FROM PUBLIC, anon, authenticated;

-- Helper functions are needed by authenticated RLS/browser flows, but not anon.
REVOKE EXECUTE ON FUNCTION public.get_employee_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_org_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_role() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_employee_user() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_internal_user() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_superadmin() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_employee_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_org_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_employee_user() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_internal_user() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_superadmin() TO authenticated, service_role;

-- Browser-facing RPCs keep authenticated access, but enforce tenant checks in
-- the function body.
CREATE OR REPLACE FUNCTION public.next_invoice_number(org_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  seq record;
  year_suffix text;
  num text;
BEGIN
  IF auth.role() = 'service_role' THEN
    NULL;
  ELSIF auth.role() = 'authenticated' THEN
    IF NOT (public.is_superadmin() OR org_id = public.get_user_org_id()) THEN
      RAISE EXCEPTION 'Not authorized for this organization';
    END IF;
  ELSE
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  year_suffix := to_char(now(), 'YYYY');

  INSERT INTO public.invoice_sequences (organization_id)
  VALUES (org_id)
  ON CONFLICT (organization_id) DO NOTHING;

  UPDATE public.invoice_sequences
  SET next_number = next_number + 1,
      updated_at = now()
  WHERE organization_id = org_id
  RETURNING * INTO seq;

  num := lpad((seq.next_number - 1)::text, 4, '0');
  RETURN seq.prefix || '-' || year_suffix || '-' || num;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_termination_analytics(
  p_org_id uuid,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  result jsonb;
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

  SELECT jsonb_build_object(
    'by_terminated_by', (
      SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      FROM (
        SELECT terminated_by, COUNT(*) AS count
        FROM public.placements
        WHERE organization_id = p_org_id
          AND status = 'voortijdig_beeindigd'
          AND (p_from IS NULL OR terminated_at >= p_from)
          AND terminated_at <= p_to
        GROUP BY terminated_by
        ORDER BY count DESC
      ) t
    ),
    'top_reasons', (
      SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      FROM (
        SELECT termination_reason AS reason, terminated_by, COUNT(*) AS count
        FROM public.placements
        WHERE organization_id = p_org_id
          AND status = 'voortijdig_beeindigd'
          AND termination_reason IS NOT NULL
          AND (p_from IS NULL OR terminated_at >= p_from)
          AND terminated_at <= p_to
        GROUP BY termination_reason, terminated_by
        ORDER BY count DESC
        LIMIT 10
      ) t
    ),
    'by_company', (
      SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      FROM (
        SELECT c.id AS company_id,
               c.name AS company_name,
               COUNT(*) FILTER (WHERE p.status = 'voortijdig_beeindigd') AS terminated_count,
               COUNT(*) AS total_count
        FROM public.placements p
        JOIN public.companies c ON c.id = p.company_id
        WHERE p.organization_id = p_org_id
          AND (p_from IS NULL OR p.start_date >= p_from::date)
          AND p.start_date <= p_to::date
        GROUP BY c.id, c.name
        HAVING COUNT(*) FILTER (WHERE p.status = 'voortijdig_beeindigd') > 0
        ORDER BY terminated_count DESC
      ) t
    ),
    'repeaters', (
      SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      FROM (
        SELECT p.candidate_id,
               ca.first_name,
               ca.last_name,
               COUNT(*) AS termination_count,
               array_agg(DISTINCT p.termination_reason) FILTER (WHERE p.termination_reason IS NOT NULL) AS reasons
        FROM public.placements p
        JOIN public.candidates ca ON ca.id = p.candidate_id
        WHERE p.organization_id = p_org_id
          AND p.status = 'voortijdig_beeindigd'
          AND (p_from IS NULL OR p.terminated_at >= p_from)
          AND p.terminated_at <= p_to
        GROUP BY p.candidate_id, ca.first_name, ca.last_name
        HAVING COUNT(*) >= 2
        ORDER BY termination_count DESC
      ) t
    ),
    'monthly_trend', (
      SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      FROM (
        SELECT to_char(terminated_at, 'YYYY-MM') AS month,
               terminated_by,
               COUNT(*) AS count
        FROM public.placements
        WHERE organization_id = p_org_id
          AND status = 'voortijdig_beeindigd'
          AND (p_from IS NULL OR terminated_at >= p_from)
          AND terminated_at <= p_to
        GROUP BY to_char(terminated_at, 'YYYY-MM'), terminated_by
        ORDER BY month
      ) t
    )
  ) INTO result;

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.peek_credit_balance(p_org_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
AS $$
DECLARE
  v_balance integer;
BEGIN
  IF auth.role() = 'service_role' THEN
    NULL;
  ELSIF auth.role() = 'authenticated' THEN
    IF NOT (public.is_superadmin() OR p_org_id = public.get_user_org_id()) THEN
      RAISE EXCEPTION 'Geen toegang tot credit-saldo van deze organisatie';
    END IF;
  ELSE
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT balance_cents INTO v_balance
  FROM public.organization_credits
  WHERE organization_id = p_org_id;

  RETURN COALESCE(v_balance, 0);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.next_invoice_number(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_termination_analytics(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.peek_credit_balance(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.next_invoice_number(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_termination_analytics(uuid, timestamptz, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.peek_credit_balance(uuid) TO authenticated, service_role;

-- Superadmin RPCs remain callable by authenticated users because the functions
-- self-check `is_superadmin()`, but anon has no reason to execute them.
REVOKE EXECUTE ON FUNCTION public.sa_get_organizations() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sa_get_profiles() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sa_get_org_stats(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sa_get_audit_log(integer, integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sa_update_org_active(uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sa_update_org_plan(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.topup_ai_credits(uuid, integer, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.sa_get_organizations() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sa_get_profiles() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sa_get_org_stats(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sa_get_audit_log(integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sa_update_org_active(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sa_update_org_plan(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.topup_ai_credits(uuid, integer, text) TO authenticated, service_role;

-- Public buckets can still serve public object URLs without a broad SELECT
-- policy that allows listing the whole bucket.
DROP POLICY IF EXISTS "Public read access for logos" ON storage.objects;
