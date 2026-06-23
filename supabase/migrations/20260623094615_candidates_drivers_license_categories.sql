-- MG1 GAP3: rijbewijsklassen (B/BE/C/CE/D/...) als first-class kolom op kandidaten.
-- Afgeleid uit de AI-analyse (ai_analysis.mobiliteit.rijbewijs_types), gespiegeld zoals
-- ai_function_group/ai_target_functions. De matcher leest deze kolom (geen zware ai_analysis-fetch
-- over de hele pool) om een C/CE/D-rijbewijs als chauffeurs-functiesignaal mee te wegen.
ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS drivers_license_categories text[] NOT NULL DEFAULT '{}';

-- Backfill uit bestaande AI-analyses (genormaliseerd: trim + uppercase, dedup).
UPDATE public.candidates c
SET drivers_license_categories = COALESCE((
  SELECT array_agg(DISTINCT upper(btrim(t)) ORDER BY upper(btrim(t)))
  FROM jsonb_array_elements_text(c.ai_analysis->'mobiliteit'->'rijbewijs_types') AS t
  WHERE btrim(t) <> ''
), '{}')
WHERE jsonb_typeof(c.ai_analysis->'mobiliteit'->'rijbewijs_types') = 'array'
  AND jsonb_array_length(c.ai_analysis->'mobiliteit'->'rijbewijs_types') > 0
  AND c.drivers_license_categories = '{}';
