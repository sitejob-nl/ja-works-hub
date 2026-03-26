-- Add "gereserveerd" status to unit_status enum
ALTER TYPE public.unit_status ADD VALUE IF NOT EXISTS 'gereserveerd' AFTER 'beschikbaar';

-- Add RDW-enrichment fields to vehicles table
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS color text,
  ADD COLUMN IF NOT EXISTS seats integer,
  ADD COLUMN IF NOT EXISTS weight integer,
  ADD COLUMN IF NOT EXISTS apk_expiry text,
  ADD COLUMN IF NOT EXISTS first_registration text;

-- Add weekly_cost to units (Jeroen uses weekly pricing, not monthly)
ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS weekly_cost numeric;

-- Comment for clarity
COMMENT ON COLUMN public.units.monthly_cost IS 'Maandelijkse kosten (legacy, gebruik weekly_cost)';
COMMENT ON COLUMN public.units.weekly_cost IS 'Weekprijs voor de kamer/unit';
