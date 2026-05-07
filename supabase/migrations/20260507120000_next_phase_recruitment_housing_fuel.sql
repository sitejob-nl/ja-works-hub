-- Next phases: recruitment acceptance, housing cleanup/contracts, fuel period analysis.

BEGIN;

-- =====================================================================
-- Recruitment: normalized candidate data-quality workflow
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.candidate_data_quality_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  flag_type text NOT NULL CHECK (flag_type IN (
    'missing_phone',
    'missing_email',
    'old_cv',
    'cv_has_photo',
    'bounced_email',
    'carerix_document_missing_file'
  )),
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'ignored')),
  source text NOT NULL DEFAULT 'system',
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_candidate_quality_org_status_type
  ON public.candidate_data_quality_flags (organization_id, status, flag_type);

CREATE INDEX IF NOT EXISTS idx_candidate_quality_candidate_status
  ON public.candidate_data_quality_flags (candidate_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_candidate_quality_open_flag
  ON public.candidate_data_quality_flags (organization_id, candidate_id, flag_type)
  WHERE status = 'open';

ALTER TABLE public.candidate_data_quality_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select ON public.candidate_data_quality_flags;
CREATE POLICY tenant_select ON public.candidate_data_quality_flags
  FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id());

DROP POLICY IF EXISTS tenant_insert ON public.candidate_data_quality_flags;
CREATE POLICY tenant_insert ON public.candidate_data_quality_flags
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org_id());

DROP POLICY IF EXISTS tenant_update ON public.candidate_data_quality_flags;
CREATE POLICY tenant_update ON public.candidate_data_quality_flags
  FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id());

DROP POLICY IF EXISTS tenant_delete ON public.candidate_data_quality_flags;
CREATE POLICY tenant_delete ON public.candidate_data_quality_flags
  FOR DELETE TO authenticated
  USING (organization_id = get_user_org_id() AND get_user_role() = 'admin');

DROP TRIGGER IF EXISTS handle_candidate_quality_updated_at ON public.candidate_data_quality_flags;
CREATE TRIGGER handle_candidate_quality_updated_at
  BEFORE UPDATE ON public.candidate_data_quality_flags
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE OR REPLACE FUNCTION public.refresh_candidate_data_quality_flags(p_org_id uuid DEFAULT NULL)
RETURNS TABLE(inserted integer, resolved integer, open_total integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_org_id uuid;
  v_inserted integer := 0;
  v_resolved integer := 0;
BEGIN
  v_org_id := COALESCE(p_org_id, get_user_org_id());

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'organization_id ontbreekt';
  END IF;

  IF auth.role() <> 'service_role' AND v_org_id <> get_user_org_id() THEN
    RAISE EXCEPTION 'Niet toegestaan voor deze organisatie';
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

REVOKE ALL ON FUNCTION public.refresh_candidate_data_quality_flags(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_candidate_data_quality_flags(uuid) TO authenticated, service_role;

CREATE OR REPLACE VIEW public.v_carerix_document_validation
WITH (security_invoker = true)
AS
SELECT
  d.id AS document_id,
  d.organization_id,
  d.candidate_id,
  c.first_name,
  c.last_name,
  d.name,
  d.type,
  d.status,
  d.file_path,
  d.notes,
  d.created_at,
  em.external_id AS carerix_id,
  (
    d.name ILIKE '%cv%'
    OR d.name ILIKE '%curriculum%'
    OR d.name ILIKE '%resume%'
  ) AS is_cv,
  CASE
    WHEN d.file_path IS NOT NULL THEN 'downloaded'
    WHEN d.notes LIKE '[carerix-bytes-failed:%' THEN 'failed'
    ELSE 'pending'
  END AS download_status,
  CASE
    WHEN d.notes LIKE '[carerix-bytes-failed:%'
      THEN regexp_replace(split_part(d.notes, E'\n', 1), '^\\[carerix-bytes-failed:[^\\]]+\\]\\s*', '')
    ELSE NULL
  END AS failure_reason
FROM public.documents d
JOIN public.candidates c ON c.id = d.candidate_id
LEFT JOIN public.external_mappings em
  ON em.entity_id = d.id
  AND em.entity_type = 'document'
  AND em.external_system = 'carerix'
WHERE d.source = 'carerix';

-- =====================================================================
-- Housing: cleaning tasks + property contracts
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.housing_cleaning_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  unit_id uuid REFERENCES public.units(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  due_date date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done', 'cancelled')),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  assigned_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_housing_cleaning_org_status_due
  ON public.housing_cleaning_tasks (organization_id, status, due_date);

CREATE INDEX IF NOT EXISTS idx_housing_cleaning_property_status
  ON public.housing_cleaning_tasks (property_id, status);

ALTER TABLE public.housing_cleaning_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select ON public.housing_cleaning_tasks;
CREATE POLICY tenant_select ON public.housing_cleaning_tasks
  FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id());

DROP POLICY IF EXISTS tenant_insert ON public.housing_cleaning_tasks;
CREATE POLICY tenant_insert ON public.housing_cleaning_tasks
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org_id());

DROP POLICY IF EXISTS tenant_update ON public.housing_cleaning_tasks;
CREATE POLICY tenant_update ON public.housing_cleaning_tasks
  FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id());

DROP POLICY IF EXISTS tenant_delete ON public.housing_cleaning_tasks;
CREATE POLICY tenant_delete ON public.housing_cleaning_tasks
  FOR DELETE TO authenticated
  USING (organization_id = get_user_org_id() AND get_user_role() = 'admin');

DROP TRIGGER IF EXISTS handle_housing_cleaning_tasks_updated_at ON public.housing_cleaning_tasks;
CREATE TRIGGER handle_housing_cleaning_tasks_updated_at
  BEFORE UPDATE ON public.housing_cleaning_tasks
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE TABLE IF NOT EXISTS public.property_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  file_path text NOT NULL,
  original_name text NOT NULL,
  start_date date,
  end_date date,
  notes text,
  uploaded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_property_contracts_property
  ON public.property_contracts (property_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_property_contracts_org_end_date
  ON public.property_contracts (organization_id, end_date)
  WHERE end_date IS NOT NULL;

ALTER TABLE public.property_contracts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select ON public.property_contracts;
CREATE POLICY tenant_select ON public.property_contracts
  FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id());

DROP POLICY IF EXISTS tenant_insert ON public.property_contracts;
CREATE POLICY tenant_insert ON public.property_contracts
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org_id());

DROP POLICY IF EXISTS tenant_update ON public.property_contracts;
CREATE POLICY tenant_update ON public.property_contracts
  FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id());

DROP POLICY IF EXISTS tenant_delete ON public.property_contracts;
CREATE POLICY tenant_delete ON public.property_contracts
  FOR DELETE TO authenticated
  USING (organization_id = get_user_org_id() AND get_user_role() = 'admin');

DROP TRIGGER IF EXISTS handle_property_contracts_updated_at ON public.property_contracts;
CREATE TRIGGER handle_property_contracts_updated_at
  BEFORE UPDATE ON public.property_contracts
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

INSERT INTO storage.buckets (id, name, public)
VALUES ('property-contracts', 'property-contracts', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Tenant upload property contracts" ON storage.objects;
CREATE POLICY "Tenant upload property contracts"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'property-contracts'
  AND (storage.foldername(name))[1] = (SELECT organization_id::text FROM public.profiles WHERE id = auth.uid())
);

DROP POLICY IF EXISTS "Tenant view property contracts" ON storage.objects;
CREATE POLICY "Tenant view property contracts"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'property-contracts'
  AND (storage.foldername(name))[1] = (SELECT organization_id::text FROM public.profiles WHERE id = auth.uid())
);

DROP POLICY IF EXISTS "Tenant update property contracts" ON storage.objects;
CREATE POLICY "Tenant update property contracts"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'property-contracts'
  AND (storage.foldername(name))[1] = (SELECT organization_id::text FROM public.profiles WHERE id = auth.uid())
);

DROP POLICY IF EXISTS "Tenant delete property contracts" ON storage.objects;
CREATE POLICY "Tenant delete property contracts"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'property-contracts'
  AND (storage.foldername(name))[1] = (SELECT organization_id::text FROM public.profiles WHERE id = auth.uid())
);

-- =====================================================================
-- Fuel card analysis: period-based runs
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.fuel_analysis_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  margin_pct numeric(5,2) NOT NULL DEFAULT 15 CHECK (margin_pct >= 0 AND margin_pct <= 100),
  q8_batch_id uuid,
  ontrack_import_batch_id uuid,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('draft', 'running', 'completed', 'failed', 'cancelled')),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS idx_fuel_analysis_runs_org_period
  ON public.fuel_analysis_runs (organization_id, period_start DESC, period_end DESC);

ALTER TABLE public.fuel_analysis_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select ON public.fuel_analysis_runs;
CREATE POLICY tenant_select ON public.fuel_analysis_runs
  FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id());

DROP POLICY IF EXISTS tenant_insert ON public.fuel_analysis_runs;
CREATE POLICY tenant_insert ON public.fuel_analysis_runs
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org_id());

DROP POLICY IF EXISTS tenant_update ON public.fuel_analysis_runs;
CREATE POLICY tenant_update ON public.fuel_analysis_runs
  FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id());

DROP POLICY IF EXISTS tenant_delete ON public.fuel_analysis_runs;
CREATE POLICY tenant_delete ON public.fuel_analysis_runs
  FOR DELETE TO authenticated
  USING (organization_id = get_user_org_id() AND get_user_role() = 'admin');

DROP TRIGGER IF EXISTS handle_fuel_analysis_runs_updated_at ON public.fuel_analysis_runs;
CREATE TRIGGER handle_fuel_analysis_runs_updated_at
  BEFORE UPDATE ON public.fuel_analysis_runs
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE TABLE IF NOT EXISTS public.vehicle_period_mileage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.fuel_analysis_runs(id) ON DELETE CASCADE,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  license_plate_snapshot text,
  kilometers numeric(10,2) NOT NULL CHECK (kilometers >= 0),
  odometer_start integer,
  odometer_end integer,
  source text NOT NULL DEFAULT 'ontrack_csv' CHECK (source IN ('ontrack_csv', 'manual', 'api')),
  raw_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_period_mileage_run
  ON public.vehicle_period_mileage (run_id);

CREATE INDEX IF NOT EXISTS idx_vehicle_period_mileage_vehicle
  ON public.vehicle_period_mileage (vehicle_id, created_at DESC)
  WHERE vehicle_id IS NOT NULL;

ALTER TABLE public.vehicle_period_mileage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select ON public.vehicle_period_mileage;
CREATE POLICY tenant_select ON public.vehicle_period_mileage
  FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id());

DROP POLICY IF EXISTS tenant_insert ON public.vehicle_period_mileage;
CREATE POLICY tenant_insert ON public.vehicle_period_mileage
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org_id());

DROP POLICY IF EXISTS tenant_update ON public.vehicle_period_mileage;
CREATE POLICY tenant_update ON public.vehicle_period_mileage
  FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id());

DROP POLICY IF EXISTS tenant_delete ON public.vehicle_period_mileage;
CREATE POLICY tenant_delete ON public.vehicle_period_mileage
  FOR DELETE TO authenticated
  USING (organization_id = get_user_org_id() AND get_user_role() = 'admin');

CREATE TABLE IF NOT EXISTS public.fuel_analysis_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.fuel_analysis_runs(id) ON DELETE CASCADE,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  license_plate_snapshot text,
  actual_liters numeric(10,2) NOT NULL DEFAULT 0,
  actual_cost_eur numeric(12,2) NOT NULL DEFAULT 0,
  expected_liters numeric(10,2),
  delta_liters numeric(10,2),
  delta_pct numeric(8,2),
  margin_pct numeric(5,2) NOT NULL,
  status text NOT NULL CHECK (status IN ('ok', 'outside_margin', 'missing_norm', 'missing_km', 'unmatched_fuel', 'unmatched_mileage')),
  reviewed boolean NOT NULL DEFAULT false,
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fuel_analysis_results_run_status
  ON public.fuel_analysis_results (run_id, status);

CREATE INDEX IF NOT EXISTS idx_fuel_analysis_results_vehicle
  ON public.fuel_analysis_results (vehicle_id, created_at DESC)
  WHERE vehicle_id IS NOT NULL;

ALTER TABLE public.fuel_analysis_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select ON public.fuel_analysis_results;
CREATE POLICY tenant_select ON public.fuel_analysis_results
  FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id());

DROP POLICY IF EXISTS tenant_insert ON public.fuel_analysis_results;
CREATE POLICY tenant_insert ON public.fuel_analysis_results
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org_id());

DROP POLICY IF EXISTS tenant_update ON public.fuel_analysis_results;
CREATE POLICY tenant_update ON public.fuel_analysis_results
  FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id());

DROP POLICY IF EXISTS tenant_delete ON public.fuel_analysis_results;
CREATE POLICY tenant_delete ON public.fuel_analysis_results
  FOR DELETE TO authenticated
  USING (organization_id = get_user_org_id() AND get_user_role() = 'admin');

DROP TRIGGER IF EXISTS handle_fuel_analysis_results_updated_at ON public.fuel_analysis_results;
CREATE TRIGGER handle_fuel_analysis_results_updated_at
  BEFORE UPDATE ON public.fuel_analysis_results
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

UPDATE public.organizations
SET settings = jsonb_set(
  coalesce(settings, '{}'::jsonb),
  '{fuel_analysis_default_margin_pct}',
  '15'::jsonb,
  true
)
WHERE settings IS NULL
   OR settings->'fuel_analysis_default_margin_pct' IS NULL;

COMMIT;
