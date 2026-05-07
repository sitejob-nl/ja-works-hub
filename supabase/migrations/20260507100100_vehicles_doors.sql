-- Aantal deuren per voertuig (RDW: aantal_deuren). Default NULL,
-- RDW-lookup in `rdw-lookup` edge function vult automatisch.

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS doors integer
  CHECK (doors IS NULL OR (doors BETWEEN 0 AND 12));

COMMENT ON COLUMN public.vehicles.doors IS 'Aantal deuren (RDW: aantal_deuren). Default NULL, RDW-lookup vult automatisch.';
