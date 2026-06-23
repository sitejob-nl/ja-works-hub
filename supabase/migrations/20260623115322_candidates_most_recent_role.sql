-- MG1 GAP2: temporele weging. Slanke afgeleide kolommen uit ai_analysis.werkhistorie[0]
-- (meest recente rol) zodat de matcher een RECENT relevante rol additief kan belonen.
-- Bewust géén fragiele datum-parsing: alleen het eindjaar (max 4-cijferig jaar in de
-- vrije-tekst periode, of het huidige jaar bij "heden"/"present").
ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS most_recent_role text,
  ADD COLUMN IF NOT EXISTS most_recent_role_year integer;

UPDATE public.candidates c
SET most_recent_role = NULLIF(btrim(c.ai_analysis->'werkhistorie'->'werkgevers'->0->>'functie'), ''),
    most_recent_role_year = CASE
      WHEN (c.ai_analysis->'werkhistorie'->'werkgevers'->0->>'periode') ~* '(heden|present|current|today|\ynow\y|\ynu\y)'
        THEN extract(year from now())::int
      ELSE (
        SELECT max((m)[1]::int)
        FROM regexp_matches(
          coalesce(c.ai_analysis->'werkhistorie'->'werkgevers'->0->>'periode', ''),
          '(?:19|20)\d{2}', 'g'
        ) AS m
      )
    END
WHERE jsonb_typeof(c.ai_analysis->'werkhistorie'->'werkgevers') = 'array'
  AND jsonb_array_length(c.ai_analysis->'werkhistorie'->'werkgevers') > 0
  AND c.most_recent_role IS NULL;
