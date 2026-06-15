-- ============================================================================
-- H4 — AVG art. 17 (recht op verwijdering / vergetelheid)
--
-- There was NO path to erase/anonymise a candidate (FKs block hard delete, and
-- there was no RPC/edge/UI). This adds an admin-gated, audit-logged anonymise
-- primitive that scrubs the direct identifiers + free-text/document PII while
-- keeping the row (and fiscally-required children such as payslips / annual
-- statements / employment) intact for the legal retention obligation.
--
-- SAFE TO APPLY: creating the function + columns is non-destructive. The function
-- is destructive only when CALLED, which requires an admin in the same org and a
-- confirmation in the UI.
-- ============================================================================

BEGIN;

ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS anonymized_at timestamptz,
  ADD COLUMN IF NOT EXISTS anonymization_reason text;

CREATE OR REPLACE FUNCTION public.anonymize_candidate(p_candidate_id uuid, p_reason text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org        uuid;
  v_caller_org uuid := public.get_user_org_id();
  v_is_admin   boolean := (public.get_user_role() = 'admin') OR public.is_superadmin();
BEGIN
  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Onvoldoende rechten voor anonimisering' USING ERRCODE = '42501';
  END IF;

  SELECT organization_id INTO v_org FROM public.candidates WHERE id = p_candidate_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Kandidaat niet gevonden';
  END IF;
  IF v_org <> v_caller_org AND NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'Kandidaat hoort niet bij jouw organisatie' USING ERRCODE = '42501';
  END IF;

  -- Scrub direct identifiers on the candidate (row kept for FK integrity +
  -- fiscally-required history; the encrypted bsn/iban are cleared too).
  UPDATE public.candidates SET
    first_name = 'Verwijderd',
    last_name  = 'Kandidaat',
    email = NULL, phone = NULL, phone_nl = NULL,
    date_of_birth = NULL, nationality = NULL,
    bsn = NULL, iban = NULL,
    address_street = NULL, address_postal = NULL, address_city = NULL,
    address_lat = NULL, address_lng = NULL,
    emergency_contact_name = NULL, emergency_contact_phone = NULL,
    cv_raw_text = NULL, cv_file_url = NULL, profile_photo_url = NULL,
    notes = NULL, ai_analysis = NULL,
    anonymized_at = now(),
    anonymization_reason = p_reason
  WHERE id = p_candidate_id;

  -- Remove free-text / document PII children. Financially-required rows
  -- (payslips, annual_statements, employment) are intentionally NOT removed.
  DELETE FROM public.documents WHERE candidate_id = p_candidate_id;
  DELETE FROM public.notes WHERE candidate_id = p_candidate_id;
  DELETE FROM public.candidate_profile_tokens WHERE candidate_id = p_candidate_id;
  UPDATE public.communications SET body = '[geanonimiseerd]', subject = '[geanonimiseerd]'
    WHERE candidate_id = p_candidate_id;
  UPDATE public.sick_reports SET notes = NULL WHERE candidate_id = p_candidate_id;

  -- Verantwoordingsplicht: log the erasure.
  INSERT INTO public.audit_log (organization_id, action, table_name, record_id, reason, user_id)
  VALUES (v_org, 'delete', 'candidates', p_candidate_id,
          COALESCE(p_reason, 'AVG art.17 anonimisering'), auth.uid());
END;
$$;

REVOKE ALL ON FUNCTION public.anonymize_candidate(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.anonymize_candidate(uuid, text) TO authenticated;

COMMIT;
