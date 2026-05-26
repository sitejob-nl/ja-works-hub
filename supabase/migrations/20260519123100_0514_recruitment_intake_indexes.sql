-- Indexen en bronlabel voor publieke recruitment-intake.
CREATE INDEX IF NOT EXISTS idx_candidates_status_lead
  ON public.candidates (organization_id, created_at DESC)
  WHERE status = 'lead';

CREATE INDEX IF NOT EXISTS idx_candidate_signup_links_slug_active
  ON public.candidate_signup_links (slug)
  WHERE is_active = true;

ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_source_check;
ALTER TABLE public.documents
  ADD CONSTRAINT documents_source_check
  CHECK (source = ANY (ARRAY['upload', 'whatsapp', 'portaal', 'systeem', 'carerix', 'public_signup']));
