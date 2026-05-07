-- Add first_registration_nl column to vehicles
-- Datum eerste tenaamstelling in Nederland (RDW-veld
-- `datum_eerste_tenaamstelling_in_nederland`). Functioneel ~ aankoopdatum
-- door eerste eigenaar in NL.

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS first_registration_nl text;
