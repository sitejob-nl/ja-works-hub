-- Store PDOK coordinates alongside address fields so distance/travel features can reuse them.

ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS address_lat numeric,
  ADD COLUMN IF NOT EXISTS address_lng numeric;

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS address_lat numeric,
  ADD COLUMN IF NOT EXISTS address_lng numeric;

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS visit_address_lat numeric,
  ADD COLUMN IF NOT EXISTS visit_address_lng numeric,
  ADD COLUMN IF NOT EXISTS invoice_address_lat numeric,
  ADD COLUMN IF NOT EXISTS invoice_address_lng numeric;

UPDATE public.companies
SET
  visit_address_lat = COALESCE(visit_address_lat, address_lat),
  visit_address_lng = COALESCE(visit_address_lng, address_lng)
WHERE (visit_address_lat IS NULL OR visit_address_lng IS NULL)
  AND address_lat IS NOT NULL
  AND address_lng IS NOT NULL;

COMMENT ON COLUMN public.candidates.address_lat IS 'PDOK geocoded latitude';
COMMENT ON COLUMN public.candidates.address_lng IS 'PDOK geocoded longitude';
COMMENT ON COLUMN public.organizations.address_lat IS 'PDOK geocoded latitude';
COMMENT ON COLUMN public.organizations.address_lng IS 'PDOK geocoded longitude';
COMMENT ON COLUMN public.companies.visit_address_lat IS 'PDOK geocoded visit address latitude';
COMMENT ON COLUMN public.companies.visit_address_lng IS 'PDOK geocoded visit address longitude';
COMMENT ON COLUMN public.companies.invoice_address_lat IS 'PDOK geocoded invoice address latitude';
COMMENT ON COLUMN public.companies.invoice_address_lng IS 'PDOK geocoded invoice address longitude';
