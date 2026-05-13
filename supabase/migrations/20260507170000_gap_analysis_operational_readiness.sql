-- Operational readiness gaps from the 2026-05-07 VDS/JA Werkt review.
-- Adds small, backwards-compatible fields for configurable analysis,
-- incident evidence, contract classification, and signing proof.

BEGIN;

-- ---------------------------------------------------------------------
-- Fuel card analysis defaults stored in organization settings.
-- Existing per-organization values are preserved.
-- ---------------------------------------------------------------------
UPDATE public.organizations
SET settings = coalesce(settings, '{}'::jsonb)
  || jsonb_build_object(
    'fuel_analysis_conditions',
    coalesce(
      settings->'fuel_analysis_conditions',
      jsonb_build_object(
        'multiple_same_day_enabled', true,
        'tank_capacity_enabled', true,
        'tank_capacity_margin_pct', 10,
        'consumption_enabled', true,
        'consumption_margin_pct', 50,
        'mileage_jump_enabled', true,
        'mileage_jump_max_km', 300
      )
    )
  )
WHERE settings->'fuel_analysis_conditions' IS NULL;

UPDATE public.organizations
SET settings = coalesce(settings, '{}'::jsonb)
  || jsonb_build_object(
    'carerix_acceptance_expected_counts',
    coalesce(
      settings->'carerix_acceptance_expected_counts',
      jsonb_build_object('placements', 578, 'vacancies', 139)
    )
  )
WHERE settings->'carerix_acceptance_expected_counts' IS NULL;

-- ---------------------------------------------------------------------
-- Housing contracts: distinguish inhuur from onderhuur.
-- ---------------------------------------------------------------------
ALTER TABLE public.property_contracts
  ADD COLUMN IF NOT EXISTS contract_type text NOT NULL DEFAULT 'inhuur';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'property_contracts_contract_type_check'
      AND conrelid = 'public.property_contracts'::regclass
  ) THEN
    ALTER TABLE public.property_contracts
      ADD CONSTRAINT property_contracts_contract_type_check
      CHECK (contract_type IN ('inhuur', 'onderhuur'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_property_contracts_org_type_end_date
  ON public.property_contracts (organization_id, contract_type, end_date)
  WHERE end_date IS NOT NULL;

-- ---------------------------------------------------------------------
-- Fleet incidents: attach source evidence to fines and completion proof
-- to cleaning tasks.
-- ---------------------------------------------------------------------
ALTER TABLE public.vehicle_fines
  ADD COLUMN IF NOT EXISTS photos text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.housing_cleaning_tasks
  ADD COLUMN IF NOT EXISTS completion_photos text[] NOT NULL DEFAULT '{}'::text[];

-- ---------------------------------------------------------------------
-- Contract templates and signing proof.
-- ---------------------------------------------------------------------
ALTER TABLE public.contract_templates
  ADD COLUMN IF NOT EXISTS template_type text NOT NULL DEFAULT 'employment_contract';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contract_templates_template_type_check'
      AND conrelid = 'public.contract_templates'::regclass
  ) THEN
    ALTER TABLE public.contract_templates
      ADD CONSTRAINT contract_templates_template_type_check
      CHECK (template_type IN (
        'employment_contract',
        'placement_confirmation',
        'general_terms',
        'housing_inhuur',
        'housing_onderhuur',
        'house_rules',
        'vehicle_agreement'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contract_templates_org_type_active
  ON public.contract_templates (organization_id, template_type, is_active);

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS signed_by_name text,
  ADD COLUMN IF NOT EXISTS signed_ip text,
  ADD COLUMN IF NOT EXISTS signature_request_id uuid,
  ADD COLUMN IF NOT EXISTS signature_evidence jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_contracts_signature_request_id
  ON public.contracts (signature_request_id)
  WHERE signature_request_id IS NOT NULL;

COMMIT;
