-- Meeting 29-06: intake-, proposal- en matchpipelinevelden.

ALTER TABLE public.candidates
  ADD COLUMN IF NOT EXISTS foreign_address_street text,
  ADD COLUMN IF NOT EXISTS foreign_address_postal text,
  ADD COLUMN IF NOT EXISTS foreign_address_city text,
  ADD COLUMN IF NOT EXISTS foreign_address_country text;

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS interview_proposed_at timestamptz,
  ADD COLUMN IF NOT EXISTS interview_proposed_note text,
  ADD COLUMN IF NOT EXISTS interview_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS interview_location text,
  ADD COLUMN IF NOT EXISTS interview_type text
    CHECK (
      interview_type IS NULL
      OR interview_type IN ('op_kantoor', 'facetime', 'telefonisch', 'anders')
    ),
  ADD COLUMN IF NOT EXISTS interview_confirmed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_matches_org_interview_proposed
  ON public.matches(organization_id, interview_proposed_at)
  WHERE interview_proposed_at IS NOT NULL;

ALTER TABLE public.communications
  ADD COLUMN IF NOT EXISTS match_id uuid REFERENCES public.matches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_communications_match_id
  ON public.communications(match_id)
  WHERE match_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_communications_org_match_sent
  ON public.communications(organization_id, match_id, sent_at DESC)
  WHERE match_id IS NOT NULL;

ALTER TABLE public.match_proposal_tokens
  ADD COLUMN IF NOT EXISTS content_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.candidate_profile_tokens
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS sent_channel text
    CHECK (
      sent_channel IS NULL
      OR sent_channel IN ('email', 'whatsapp', 'copy', 'other')
    ),
  ADD COLUMN IF NOT EXISTS sent_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

UPDATE public.organizations
SET settings = jsonb_set(
  coalesce(settings, '{}'::jsonb),
  '{match_pipeline_followup_days}',
  '3'::jsonb,
  true
)
WHERE coalesce(settings, '{}'::jsonb)->'match_pipeline_followup_days' IS NULL;

COMMENT ON COLUMN public.candidates.foreign_address_street IS
  'Buitenlands thuisadres naast het Nederlandse/verblijfsadres.';
COMMENT ON COLUMN public.matches.interview_proposed_at IS
  'Door opdrachtgever voorgestelde afspraakdatum; nog niet definitief.';
COMMENT ON COLUMN public.matches.interview_confirmed_at IS
  'Definitief door recruiter bevestigde afspraakdatum.';
COMMENT ON COLUMN public.communications.match_id IS
  'Optionele directe koppeling van proposal-/afspraakcommunicatie aan een match.';
COMMENT ON COLUMN public.match_proposal_tokens.content_snapshot IS
  'Bewerkbare voorstelinhoud zoals getoond op de publieke reactiepagina.';
