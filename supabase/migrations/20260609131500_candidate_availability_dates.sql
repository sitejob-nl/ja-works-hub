ALTER TABLE public.candidates
ADD COLUMN IF NOT EXISTS screening_data jsonb,
ADD COLUMN IF NOT EXISTS screened_at timestamptz,
ADD COLUMN IF NOT EXISTS screened_by uuid REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS available_from date,
ADD COLUMN IF NOT EXISTS available_until date,
ADD COLUMN IF NOT EXISTS arrival_date date;

COMMENT ON COLUMN public.candidates.screening_data IS 'Structured recruiter screening-callflow state. Kept as JSONB for v1 call notes and decisions.';
COMMENT ON COLUMN public.candidates.available_from IS 'First date the candidate can start work. Source of truth for matching availability.';
COMMENT ON COLUMN public.candidates.available_until IS 'Last known date the candidate remains available, if temporary.';
COMMENT ON COLUMN public.candidates.arrival_date IS 'Expected arrival or check-in date for candidates travelling to the Netherlands.';

CREATE OR REPLACE FUNCTION pg_temp.try_parse_iso_date(value text)
RETURNS date
LANGUAGE plpgsql
AS $$
BEGIN
  IF value IS NULL OR btrim(value) !~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' THEN
    RETURN NULL;
  END IF;

  RETURN btrim(value)::date;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

WITH extracted AS (
  SELECT
    id,
    pg_temp.try_parse_iso_date(COALESCE(
      screening_data #>> '{availability,available_from}',
      (regexp_match(availability_notes, E'(^|\\n)\\s*Beschikbaar vanaf:\\s*([0-9]{4}-[0-9]{2}-[0-9]{2})', 'i'))[2]
    )) AS available_from_value,
    pg_temp.try_parse_iso_date(COALESCE(
      screening_data #>> '{availability,available_until}',
      (regexp_match(availability_notes, E'(^|\\n)\\s*Beschikbaar tot:\\s*([0-9]{4}-[0-9]{2}-[0-9]{2})', 'i'))[2]
    )) AS available_until_value,
    pg_temp.try_parse_iso_date(COALESCE(
      screening_data #>> '{availability,arrival_date}',
      (regexp_match(availability_notes, E'(^|\\n)\\s*Aankomst/check-in:\\s*([0-9]{4}-[0-9]{2}-[0-9]{2})', 'i'))[2]
    )) AS arrival_date_value
  FROM public.candidates
)
UPDATE public.candidates AS candidates
SET
  available_from = COALESCE(candidates.available_from, extracted.available_from_value),
  available_until = COALESCE(candidates.available_until, extracted.available_until_value),
  arrival_date = COALESCE(candidates.arrival_date, extracted.arrival_date_value)
FROM extracted
WHERE candidates.id = extracted.id
  AND (
    (candidates.available_from IS NULL AND extracted.available_from_value IS NOT NULL)
    OR (candidates.available_until IS NULL AND extracted.available_until_value IS NOT NULL)
    OR (candidates.arrival_date IS NULL AND extracted.arrival_date_value IS NOT NULL)
  );

UPDATE public.candidates
SET screening_data = COALESCE(screening_data, '{}'::jsonb)
  || jsonb_build_object(
    'availability',
    COALESCE(screening_data->'availability', '{}'::jsonb)
      || jsonb_strip_nulls(jsonb_build_object(
        'available_from', to_char(available_from, 'YYYY-MM-DD'),
        'available_until', to_char(available_until, 'YYYY-MM-DD'),
        'arrival_date', to_char(arrival_date, 'YYYY-MM-DD')
      ))
  )
WHERE available_from IS NOT NULL
  OR available_until IS NOT NULL
  OR arrival_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS candidates_screened_at_idx
ON public.candidates (screened_at)
WHERE screened_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS candidates_availability_window_idx
ON public.candidates (organization_id, available_from, available_until)
WHERE available_from IS NOT NULL OR available_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS candidates_arrival_date_idx
ON public.candidates (organization_id, arrival_date)
WHERE arrival_date IS NOT NULL;
