ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_matches_assigned_to
  ON public.matches (assigned_to);

COMMENT ON COLUMN public.matches.assigned_to IS
  'Recruiter/interne gebruiker die operationeel eigenaar is van de matchopvolging.';
