-- Sprint 5 — AI CV / AVG-velden
-- C7: cv_has_photo flag (gedetecteerd tijdens PDF parse)
-- C8: cv_pseudonymized_at audit voor pseudonimisering vóór VPS-verzending
-- C6: backfill-tracking via index op (org, ai_status, cv_file_url)
--
-- Live toegepast via Supabase MCP als 20260425161003_meeting_jeroen_sprint5_ai_cv_avg.

BEGIN;

ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS cv_has_photo boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS cv_pseudonymized_at timestamptz,
  ADD COLUMN IF NOT EXISTS cv_pseudonymization_meta jsonb;

COMMENT ON COLUMN public.candidates.cv_has_photo IS
  'True als PDF-CV beelden bevat. Vereist menselijke review (foto kan in pseudonimisering glippen).';
COMMENT ON COLUMN public.candidates.cv_pseudonymized_at IS
  'Timestamp van laatste pseudonimisering vóór verzending naar VPS-LLM.';
COMMENT ON COLUMN public.candidates.cv_pseudonymization_meta IS
  'Aantal vervangingen per categorie (naam/email/telefoon/BSN) — voor audit.';

CREATE INDEX IF NOT EXISTS candidates_ai_backfill_idx
  ON public.candidates(organization_id, ai_status, cv_file_url)
  WHERE cv_file_url IS NOT NULL;

COMMIT;
