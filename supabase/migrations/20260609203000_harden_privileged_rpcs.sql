-- Harden remaining privileged browser-facing RPCs before team launch.
--
-- These functions intentionally remain SECURITY DEFINER because they bridge RLS
-- or encrypted data, but authenticated callers must still be narrowed to the
-- internal recruiter/backoffice surface or explicit employee self-service.

BEGIN;

CREATE SCHEMA IF NOT EXISTS extensions;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pg_trgm'
      AND n.nspname = 'public'
  ) THEN
    EXECUTE 'ALTER EXTENSION pg_trgm SET SCHEMA extensions';
  END IF;
END $$;

DROP POLICY IF EXISTS mail_account_secrets_no_client_access ON public.mail_account_secrets;
CREATE POLICY mail_account_secrets_no_client_access
  ON public.mail_account_secrets
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS outlook_oauth_states_no_client_access ON public.outlook_oauth_states;
CREATE POLICY outlook_oauth_states_no_client_access
  ON public.outlook_oauth_states
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.admin_adjust_loyalty_points(
  p_candidate_id uuid,
  p_points integer,
  p_description text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org uuid;
  v_role user_role;
  v_account_id uuid;
  v_tx_id uuid;
BEGIN
  v_org := public.get_user_org_id();
  v_role := public.get_user_role();

  IF v_role NOT IN ('admin'::user_role, 'backoffice'::user_role, 'finance'::user_role) THEN
    RAISE EXCEPTION 'Onvoldoende rechten';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.candidates c
    WHERE c.id = p_candidate_id
      AND c.organization_id = v_org
  ) THEN
    RAISE EXCEPTION 'Kandidaat valt buiten je organisatie of bestaat niet';
  END IF;

  IF p_points = 0 THEN
    RAISE EXCEPTION 'Puntenmutatie mag niet 0 zijn';
  END IF;

  INSERT INTO public.loyalty_accounts (organization_id, candidate_id)
  VALUES (v_org, p_candidate_id)
  ON CONFLICT (organization_id, candidate_id) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_account_id;

  IF p_points < 0 AND (
    SELECT balance_points FROM public.loyalty_accounts WHERE id = v_account_id
  ) + p_points < 0 THEN
    RAISE EXCEPTION 'Onvoldoende punten';
  END IF;

  INSERT INTO public.loyalty_transactions (
    organization_id, account_id, candidate_id, points, source, description, created_by
  ) VALUES (
    v_org,
    v_account_id,
    p_candidate_id,
    p_points,
    'manual_adjustment',
    coalesce(nullif(trim(p_description), ''), 'Handmatige correctie'),
    auth.uid()
  ) RETURNING id INTO v_tx_id;

  UPDATE public.loyalty_accounts
  SET balance_points = balance_points + p_points,
      lifetime_earned_points = lifetime_earned_points + greatest(p_points, 0),
      lifetime_spent_points = lifetime_spent_points + greatest(-p_points, 0),
      updated_at = now()
  WHERE id = v_account_id;

  RETURN v_tx_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.find_duplicate_candidates()
RETURNS TABLE (
  group_key text,
  match_reason text,
  candidate_id uuid,
  first_name text,
  last_name text,
  email text,
  phone text,
  date_of_birth date,
  status text,
  created_at timestamptz,
  has_employee boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH me AS (
    SELECT organization_id
    FROM public.profiles
    WHERE id = auth.uid()
      AND (public.is_superadmin() OR public.is_internal_user())
  ),
  base AS (
    SELECT c.id, c.first_name, c.last_name, c.email, c.phone, c.date_of_birth,
           c.status::text AS status, c.created_at,
           nullif(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), '') AS phone_digits,
           lower(nullif(trim(c.last_name), '')) AS lname
    FROM public.candidates c
    WHERE c.organization_id = (SELECT organization_id FROM me)
  ),
  phone_groups AS (
    SELECT 'phone:' || right(phone_digits, 9) AS group_key,
           'Zelfde telefoonnummer' AS match_reason,
           id
    FROM base
    WHERE length(phone_digits) >= 9
      AND right(phone_digits, 9) IN (
        SELECT right(phone_digits, 9)
        FROM base
        WHERE length(phone_digits) >= 9
        GROUP BY right(phone_digits, 9)
        HAVING count(*) > 1
      )
  ),
  dob_groups AS (
    SELECT 'dob:' || date_of_birth::text || ':' || lname AS group_key,
           'Zelfde geboortedatum + achternaam' AS match_reason,
           id
    FROM base
    WHERE date_of_birth IS NOT NULL
      AND lname IS NOT NULL
      AND (date_of_birth, lname) IN (
        SELECT date_of_birth, lname
        FROM base
        WHERE date_of_birth IS NOT NULL
          AND lname IS NOT NULL
        GROUP BY date_of_birth, lname
        HAVING count(*) > 1
      )
  ),
  grouped AS (
    SELECT * FROM phone_groups
    UNION ALL
    SELECT * FROM dob_groups
  )
  SELECT g.group_key, g.match_reason, b.id AS candidate_id,
         b.first_name, b.last_name, b.email, b.phone, b.date_of_birth,
         b.status, b.created_at,
         exists (SELECT 1 FROM public.employees e WHERE e.candidate_id = b.id) AS has_employee
  FROM grouped g
  JOIN base b ON b.id = g.id
  ORDER BY g.group_key, b.created_at;
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
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    NULL;
  ELSIF auth.role() = 'authenticated' THEN
    IF NOT (
      public.is_superadmin()
      OR (public.is_internal_user() AND p_org_id = public.get_user_org_id())
    ) THEN
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
SET search_path = public, extensions, vault, pg_temp
AS $$
BEGIN
  IF auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT (
    public.is_superadmin()
    OR (
      public.is_internal_user()
      AND EXISTS (
        SELECT 1
        FROM public.candidates c
        WHERE c.id = p_candidate_id
          AND c.organization_id = public.get_user_org_id()
      )
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

CREATE OR REPLACE FUNCTION public.get_termination_analytics(
  p_org_id uuid,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  result jsonb;
BEGIN
  IF auth.role() = 'service_role' THEN
    NULL;
  ELSIF auth.role() = 'authenticated' THEN
    IF NOT (
      public.is_superadmin()
      OR (public.is_internal_user() AND p_org_id = public.get_user_org_id())
    ) THEN
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

CREATE OR REPLACE FUNCTION public.next_invoice_number(org_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  seq record;
  year_suffix text;
  num text;
BEGIN
  IF auth.role() = 'service_role' THEN
    NULL;
  ELSIF auth.role() = 'authenticated' THEN
    IF NOT (
      public.is_superadmin()
      OR (public.is_internal_user() AND org_id = public.get_user_org_id())
    ) THEN
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

CREATE OR REPLACE FUNCTION public.peek_credit_balance(p_org_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_balance integer;
BEGIN
  IF auth.role() = 'service_role' THEN
    NULL;
  ELSIF auth.role() = 'authenticated' THEN
    IF NOT (
      public.is_superadmin()
      OR (public.is_internal_user() AND p_org_id = public.get_user_org_id())
    ) THEN
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

CREATE OR REPLACE FUNCTION public.refresh_candidate_data_quality_flags(p_org_id uuid DEFAULT NULL)
RETURNS TABLE(inserted integer, resolved integer, open_total integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id uuid;
  v_inserted integer := 0;
  v_resolved integer := 0;
BEGIN
  v_org_id := COALESCE(p_org_id, public.get_user_org_id());

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'organization_id ontbreekt';
  END IF;

  IF auth.role() = 'service_role' THEN
    NULL;
  ELSIF auth.role() = 'authenticated' THEN
    IF NOT (
      public.is_superadmin()
      OR (public.is_internal_user() AND v_org_id = public.get_user_org_id())
    ) THEN
      RAISE EXCEPTION 'Niet toegestaan voor deze organisatie';
    END IF;
  ELSE
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  CREATE TEMP TABLE tmp_candidate_quality_detected ON COMMIT DROP AS
  WITH latest_cv AS (
    SELECT
      d.candidate_id,
      max(d.created_at) AS latest_cv_at
    FROM public.documents d
    WHERE d.organization_id = v_org_id
      AND (
        d.name ILIKE '%cv%'
        OR d.name ILIKE '%curriculum%'
        OR d.name ILIKE '%resume%'
      )
    GROUP BY d.candidate_id
  ),
  carerix_missing AS (
    SELECT
      d.candidate_id,
      count(*)::integer AS missing_count
    FROM public.documents d
    WHERE d.organization_id = v_org_id
      AND d.source = 'carerix'
      AND d.file_path IS NULL
    GROUP BY d.candidate_id
  ),
  bounced AS (
    SELECT DISTINCT c.candidate_id
    FROM public.communications c
    WHERE c.organization_id = v_org_id
      AND c.channel = 'email'
      AND c.candidate_id IS NOT NULL
      AND (
        coalesce(c.subject, '') || ' ' || coalesce(c.body, '')
      ) ~* '(bounce|undeliverable|delivery failed|niet bezorgd|onbestelbaar)'
  )
  SELECT
    c.organization_id,
    c.id AS candidate_id,
    'missing_phone'::text AS flag_type,
    'high'::text AS severity,
    jsonb_build_object('field', 'phone') AS details
  FROM public.candidates c
  WHERE c.organization_id = v_org_id
    AND (c.phone IS NULL OR btrim(c.phone) = '')

  UNION ALL
  SELECT
    c.organization_id,
    c.id,
    'missing_email',
    'high',
    jsonb_build_object('field', 'email')
  FROM public.candidates c
  WHERE c.organization_id = v_org_id
    AND (c.email IS NULL OR btrim(c.email) = '')

  UNION ALL
  SELECT
    c.organization_id,
    c.id,
    'old_cv',
    'medium',
    jsonb_build_object('latest_cv_at', latest_cv.latest_cv_at)
  FROM public.candidates c
  JOIN latest_cv ON latest_cv.candidate_id = c.id
  WHERE c.organization_id = v_org_id
    AND latest_cv.latest_cv_at < now() - interval '365 days'

  UNION ALL
  SELECT
    c.organization_id,
    c.id,
    'cv_has_photo',
    'medium',
    jsonb_build_object('cv_has_photo', true)
  FROM public.candidates c
  WHERE c.organization_id = v_org_id
    AND c.cv_has_photo IS TRUE

  UNION ALL
  SELECT
    c.organization_id,
    c.id,
    'bounced_email',
    'high',
    jsonb_build_object('reason', 'Laatste e-mailcommunicatie lijkt gebounced')
  FROM public.candidates c
  JOIN bounced b ON b.candidate_id = c.id
  WHERE c.organization_id = v_org_id

  UNION ALL
  SELECT
    c.organization_id,
    c.id,
    'carerix_document_missing_file',
    'high',
    jsonb_build_object('missing_documents', cm.missing_count)
  FROM public.candidates c
  JOIN carerix_missing cm ON cm.candidate_id = c.id
  WHERE c.organization_id = v_org_id;

  INSERT INTO public.candidate_data_quality_flags (
    organization_id,
    candidate_id,
    flag_type,
    severity,
    status,
    source,
    details
  )
  SELECT
    d.organization_id,
    d.candidate_id,
    d.flag_type,
    d.severity,
    'open',
    'system',
    d.details
  FROM tmp_candidate_quality_detected d
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.candidate_data_quality_flags f
    WHERE f.organization_id = d.organization_id
      AND f.candidate_id = d.candidate_id
      AND f.flag_type = d.flag_type
      AND f.status = 'ignored'
  )
  ON CONFLICT (organization_id, candidate_id, flag_type) WHERE status = 'open'
  DO UPDATE SET
    severity = EXCLUDED.severity,
    details = EXCLUDED.details,
    updated_at = now();

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  UPDATE public.candidate_data_quality_flags f
  SET
    status = 'resolved',
    resolved_at = now(),
    updated_at = now()
  WHERE f.organization_id = v_org_id
    AND f.status = 'open'
    AND f.source = 'system'
    AND NOT EXISTS (
      SELECT 1
      FROM tmp_candidate_quality_detected d
      WHERE d.organization_id = f.organization_id
        AND d.candidate_id = f.candidate_id
        AND d.flag_type = f.flag_type
    );

  GET DIAGNOSTICS v_resolved = ROW_COUNT;

  RETURN QUERY
  SELECT
    v_inserted,
    v_resolved,
    (
      SELECT count(*)::integer
      FROM public.candidate_data_quality_flags f
      WHERE f.organization_id = v_org_id
        AND f.status = 'open'
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.merge_candidate_records(
  p_survivor uuid,
  p_loser uuid,
  p_actor uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_survivor public.candidates%rowtype;
  v_loser    public.candidates%rowtype;
  v_handled  text[] := array[
    'candidate_skills','matches','match_distance_cache','communication_preferences',
    'talentpool_members','campaign_recipients','birthday_campaign_logs',
    'candidate_data_quality_flags','loyalty_accounts','loyalty_transactions',
    'reward_redemptions','employees'
  ];
  v_skip_cols text[] := array[
    'id','organization_id','created_at','updated_at','first_name','last_name',
    'status','compliance_status','has_dutch_address','bsn','iban','skills',
    'auth_user_id','portal_enabled','portal_activated_at','portal_last_login',
    'portal_language','employee_number','employee_status',
    'cv_file_url','cv_raw_text','cv_has_photo','cv_pseudonymized_at','cv_pseudonymization_meta',
    'ai_analysis','ai_analyzed_at','ai_function_group','ai_classification','ai_reliability_score',
    'ai_interview_questions','ai_risk_factors','ai_summary','ai_status','ai_stability',
    'ai_red_flags','ai_positive_signals','ai_target_functions','ai_languages'
  ];
  v_tbl       text;
  v_set       text;
  v_loser_emp uuid;
  v_surv_emp  uuid;
  v_actor     uuid;
BEGIN
  SELECT * INTO v_survivor FROM public.candidates WHERE id = p_survivor;
  IF NOT FOUND THEN RAISE EXCEPTION 'merge_candidate_records: survivor % not found', p_survivor; END IF;
  SELECT * INTO v_loser FROM public.candidates WHERE id = p_loser;
  IF NOT FOUND THEN RAISE EXCEPTION 'merge_candidate_records: loser % not found', p_loser; END IF;
  IF p_survivor = p_loser THEN
    RAISE EXCEPTION 'merge_candidate_records: survivor and loser are identical (%)', p_survivor;
  END IF;
  IF v_survivor.organization_id <> v_loser.organization_id THEN
    RAISE EXCEPTION 'merge_candidate_records: cannot merge across organizations (% vs %)',
      v_survivor.organization_id, v_loser.organization_id;
  END IF;

  IF auth.role() = 'service_role' THEN
    v_actor := p_actor;
  ELSIF auth.role() = 'authenticated' THEN
    IF NOT (
      public.is_superadmin()
      OR (
        public.is_internal_user()
        AND v_survivor.organization_id = public.get_user_org_id()
      )
    ) THEN
      RAISE EXCEPTION 'merge_candidate_records: not authorized';
    END IF;
    v_actor := auth.uid();
  ELSE
    RAISE EXCEPTION 'merge_candidate_records: not authenticated';
  END IF;

  SELECT id INTO v_loser_emp FROM public.employees WHERE candidate_id = p_loser;
  SELECT id INTO v_surv_emp  FROM public.employees WHERE candidate_id = p_survivor;
  IF v_loser_emp IS NOT NULL AND v_surv_emp IS NOT NULL THEN
    RAISE EXCEPTION 'merge_candidate_records: both candidates have an employees (payroll) record (% and %); merge these manually', v_surv_emp, v_loser_emp;
  END IF;
  IF EXISTS (SELECT 1 FROM public.loyalty_accounts     WHERE candidate_id = p_survivor)
     AND EXISTS (SELECT 1 FROM public.loyalty_accounts WHERE candidate_id = p_loser) THEN
    RAISE EXCEPTION 'merge_candidate_records: both candidates have a loyalty account; merge the points ledger manually';
  END IF;
  IF EXISTS (SELECT 1 FROM public.loyalty_transactions     WHERE candidate_id = p_survivor)
     AND EXISTS (SELECT 1 FROM public.loyalty_transactions WHERE candidate_id = p_loser) THEN
    RAISE EXCEPTION 'merge_candidate_records: both candidates have loyalty transactions; merge the points ledger manually';
  END IF;

  DELETE FROM public.candidate_skills WHERE candidate_id = p_loser;

  DELETE FROM public.matches l
    WHERE l.candidate_id = p_loser
      AND EXISTS (SELECT 1 FROM public.matches s
                  WHERE s.candidate_id = p_survivor AND s.vacancy_id = l.vacancy_id);
  UPDATE public.matches SET candidate_id = p_survivor WHERE candidate_id = p_loser;

  DELETE FROM public.match_distance_cache l
    WHERE l.candidate_id = p_loser
      AND EXISTS (SELECT 1 FROM public.match_distance_cache s
                  WHERE s.candidate_id = p_survivor
                    AND s.vacancy_id = l.vacancy_id AND s.provider = l.provider);
  UPDATE public.match_distance_cache SET candidate_id = p_survivor WHERE candidate_id = p_loser;

  DELETE FROM public.communication_preferences l
    WHERE l.candidate_id = p_loser
      AND EXISTS (SELECT 1 FROM public.communication_preferences s
                  WHERE s.candidate_id = p_survivor
                    AND s.channel = l.channel AND s.organization_id = l.organization_id);
  UPDATE public.communication_preferences SET candidate_id = p_survivor WHERE candidate_id = p_loser;

  DELETE FROM public.talentpool_members l
    WHERE l.candidate_id = p_loser
      AND EXISTS (SELECT 1 FROM public.talentpool_members s
                  WHERE s.candidate_id = p_survivor AND s.talentpool_id = l.talentpool_id);
  UPDATE public.talentpool_members SET candidate_id = p_survivor WHERE candidate_id = p_loser;

  DELETE FROM public.campaign_recipients l
    WHERE l.candidate_id = p_loser
      AND EXISTS (SELECT 1 FROM public.campaign_recipients s
                  WHERE s.candidate_id = p_survivor AND s.campaign_id = l.campaign_id);
  UPDATE public.campaign_recipients SET candidate_id = p_survivor WHERE candidate_id = p_loser;

  DELETE FROM public.birthday_campaign_logs l
    WHERE l.candidate_id = p_loser
      AND EXISTS (SELECT 1 FROM public.birthday_campaign_logs s
                  WHERE s.candidate_id = p_survivor
                    AND s.organization_id = l.organization_id AND s.birthday_date = l.birthday_date);
  UPDATE public.birthday_campaign_logs SET candidate_id = p_survivor WHERE candidate_id = p_loser;

  DELETE FROM public.candidate_data_quality_flags l
    WHERE l.candidate_id = p_loser
      AND EXISTS (SELECT 1 FROM public.candidate_data_quality_flags s
                  WHERE s.candidate_id = p_survivor
                    AND s.organization_id = l.organization_id AND s.flag_type = l.flag_type);
  UPDATE public.candidate_data_quality_flags SET candidate_id = p_survivor WHERE candidate_id = p_loser;

  UPDATE public.loyalty_accounts     SET candidate_id = p_survivor WHERE candidate_id = p_loser;
  UPDATE public.loyalty_transactions SET candidate_id = p_survivor WHERE candidate_id = p_loser;
  UPDATE public.reward_redemptions   SET candidate_id = p_survivor WHERE candidate_id = p_loser;

  IF v_loser_emp IS NOT NULL THEN
    UPDATE public.employees SET candidate_id = p_survivor WHERE id = v_loser_emp;
  END IF;

  FOR v_tbl IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND NOT c.relispartition
      AND a.attname = 'candidate_id'
      AND NOT a.attisdropped
      AND c.relname <> ALL (v_handled)
  LOOP
    EXECUTE format('UPDATE public.%I SET candidate_id = $1 WHERE candidate_id = $2', v_tbl)
      USING p_survivor, p_loser;
  END LOOP;

  DELETE FROM public.external_mappings l
    WHERE l.entity_type = 'candidate' AND l.entity_id = p_loser
      AND EXISTS (SELECT 1 FROM public.external_mappings s
                  WHERE s.entity_type = 'candidate' AND s.entity_id = p_survivor
                    AND s.organization_id = l.organization_id
                    AND s.external_system = l.external_system);
  UPDATE public.external_mappings SET entity_id = p_survivor
    WHERE entity_type = 'candidate' AND entity_id = p_loser;

  UPDATE public.notes SET related_entity_id = p_survivor
    WHERE related_entity_type = 'candidate' AND related_entity_id = p_loser;

  DELETE FROM public.custom_field_values l
    WHERE l.entity_id = p_loser
      AND EXISTS (SELECT 1 FROM public.custom_field_values s
                  WHERE s.entity_id = p_survivor AND s.custom_field_id = l.custom_field_id);
  UPDATE public.custom_field_values SET entity_id = p_survivor WHERE entity_id = p_loser;

  UPDATE public.candidate_employment
     SET is_current = false
   WHERE candidate_id = p_survivor AND is_current = true
     AND id <> (
       SELECT id FROM public.candidate_employment
        WHERE candidate_id = p_survivor AND is_current = true
        ORDER BY start_date DESC NULLS LAST, created_at DESC, id DESC
        LIMIT 1
     );

  SELECT string_agg(format('%1$I = coalesce(s.%1$I, l.%1$I)', column_name), ', ')
    INTO v_set
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'candidates'
    AND column_name <> ALL (v_skip_cols);

  IF v_set IS NOT NULL THEN
    EXECUTE format(
      'UPDATE public.candidates s SET %s FROM public.candidates l WHERE s.id = $1 AND l.id = $2',
      v_set
    ) USING p_survivor, p_loser;
  END IF;

  UPDATE public.candidates s SET
    cv_file_url = l.cv_file_url, cv_raw_text = l.cv_raw_text, cv_has_photo = l.cv_has_photo,
    cv_pseudonymized_at = l.cv_pseudonymized_at, cv_pseudonymization_meta = l.cv_pseudonymization_meta,
    ai_analysis = l.ai_analysis, ai_analyzed_at = l.ai_analyzed_at, ai_function_group = l.ai_function_group,
    ai_classification = l.ai_classification, ai_reliability_score = l.ai_reliability_score,
    ai_interview_questions = l.ai_interview_questions, ai_risk_factors = l.ai_risk_factors,
    ai_summary = l.ai_summary, ai_status = l.ai_status, ai_stability = l.ai_stability,
    ai_red_flags = l.ai_red_flags, ai_positive_signals = l.ai_positive_signals,
    ai_target_functions = l.ai_target_functions, ai_languages = l.ai_languages
  FROM public.candidates l
  WHERE s.id = p_survivor AND l.id = p_loser
    AND s.cv_file_url IS NULL AND l.cv_file_url IS NOT NULL;

  INSERT INTO public.audit_log (organization_id, user_id, action, table_name, record_id, old_values, new_values, reason)
  VALUES (
    v_survivor.organization_id,
    v_actor,
    'delete',
    'candidates',
    p_loser,
    to_jsonb(v_loser) - 'bsn' - 'iban',
    jsonb_build_object('merged_into', p_survivor),
    format('candidate merge: %s merged into %s', p_loser, p_survivor)
  );

  DELETE FROM public.candidates WHERE id = p_loser;

  RETURN jsonb_build_object(
    'survivor', p_survivor,
    'loser', p_loser,
    'organization_id', v_survivor.organization_id,
    'merged', true
  );
END;
$$;

COMMIT;
