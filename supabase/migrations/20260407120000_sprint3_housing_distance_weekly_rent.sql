-- Sprint 3: Huisvesting - afstand-tot-werk, auto-toewijzing, wekelijkse huur
-- Adds geocoding columns, payment frequency support, and updates v_unit_occupancy view

-- 1. Add geocoding columns to properties
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS address_lat numeric;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS address_lng numeric;

-- 2. Add geocoding columns to companies
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS address_lat numeric;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS address_lng numeric;

-- 3. Add payment_frequency and deduction_amount to housing_assignments
ALTER TABLE public.housing_assignments ADD COLUMN IF NOT EXISTS payment_frequency text
  DEFAULT 'wekelijks'
  CHECK (payment_frequency IN ('wekelijks', 'maandelijks'));

ALTER TABLE public.housing_assignments ADD COLUMN IF NOT EXISTS deduction_amount numeric;

-- Backfill deduction_amount from monthly_deduction for existing rows
UPDATE public.housing_assignments
SET deduction_amount = monthly_deduction,
    payment_frequency = 'maandelijks'
WHERE monthly_deduction IS NOT NULL
  AND deduction_amount IS NULL;

-- 4. Drop and recreate v_unit_occupancy view with additional columns
DROP VIEW IF EXISTS public.v_unit_occupancy;

CREATE VIEW public.v_unit_occupancy AS
SELECT
  u.id AS unit_id,
  u.name AS unit_name,
  p.name AS property_name,
  p.address_city,
  p.address_postal,
  p.address_lat,
  p.address_lng,
  u.organization_id,
  u.capacity,
  u.weekly_cost,
  u.monthly_cost,
  u.status,
  COALESCE(
    (SELECT COUNT(*)
     FROM public.housing_assignments ha
     WHERE ha.unit_id = u.id AND ha.status = 'ingecheckt'),
    0
  )::integer AS current_occupancy,
  GREATEST(
    u.capacity - COALESCE(
      (SELECT COUNT(*)
       FROM public.housing_assignments ha
       WHERE ha.unit_id = u.id AND ha.status = 'ingecheckt'),
      0
    ),
    0
  )::integer AS available_spots
FROM public.units u
JOIN public.properties p ON p.id = u.property_id;

COMMENT ON COLUMN public.properties.address_lat IS 'PDOK geocoded latitude';
COMMENT ON COLUMN public.properties.address_lng IS 'PDOK geocoded longitude';
COMMENT ON COLUMN public.companies.address_lat IS 'PDOK geocoded latitude';
COMMENT ON COLUMN public.companies.address_lng IS 'PDOK geocoded longitude';
COMMENT ON COLUMN public.housing_assignments.payment_frequency IS 'wekelijks of maandelijks';
COMMENT ON COLUMN public.housing_assignments.deduction_amount IS 'Inhoudingsbedrag (week of maand, afhankelijk van payment_frequency)';
