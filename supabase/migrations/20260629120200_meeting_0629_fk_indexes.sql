-- Meeting 29-06 follow-up: index nullable profile FKs added for afspraak/profiellink metadata.

CREATE INDEX IF NOT EXISTS idx_matches_interview_confirmed_by
  ON public.matches(interview_confirmed_by)
  WHERE interview_confirmed_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_candidate_profile_tokens_sent_by
  ON public.candidate_profile_tokens(sent_by)
  WHERE sent_by IS NOT NULL;
