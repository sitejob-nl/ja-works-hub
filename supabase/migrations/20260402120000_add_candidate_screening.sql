ALTER TABLE public.candidates
ADD COLUMN IF NOT EXISTS screening_data jsonb,
ADD COLUMN IF NOT EXISTS screened_at timestamptz,
ADD COLUMN IF NOT EXISTS screened_by uuid REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS candidates_screened_at_idx ON public.candidates (screened_at) WHERE screened_at IS NOT NULL;
