ALTER TABLE public.candidates
ADD COLUMN IF NOT EXISTS screening_data jsonb DEFAULT '{}',
ADD COLUMN IF NOT EXISTS screened_at timestamptz,
ADD COLUMN IF NOT EXISTS screened_by uuid;
