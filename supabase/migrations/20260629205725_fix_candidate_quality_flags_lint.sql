-- Supabase db lint cannot resolve a CREATE TEMP TABLE AS relation inside this
-- SECURITY DEFINER function. Keep the detection query explicit in each statement.
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
  ),
  detected AS (
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
    WHERE c.organization_id = v_org_id
  )
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
  FROM detected d
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
  ),
  detected AS (
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
    WHERE c.organization_id = v_org_id
  )
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
      FROM detected d
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

REVOKE ALL ON FUNCTION public.refresh_candidate_data_quality_flags(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_candidate_data_quality_flags(uuid) TO authenticated, service_role;
