-- Tracer bullet (meeting 17-06): voorstel -> publieke reactie -> plaatsing.
-- 1) matches krijgt de datums die de opdrachtgever op de reactiepagina kiest.
-- 2) match verwijderen mag door alle interne gebruikers (was admin-only) — de
--    recruiter (intercedent) maakt matches en moet ze ook kunnen verwijderen.
-- 3) rate-limit-log voor het publieke match-response endpoint (gehashte IP),
--    spiegel van registration_attempts (migr. 20260610130000).
--
-- NB: er bestaat AL een UNIQUE index matches_vacancy_id_candidate_id_key op
-- (vacancy_id, candidate_id) -> dubbele matches zijn DB-zijdig al geblokkeerd;
-- geen extra unique index nodig (de UI vangt 23505 netjes af).

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS interview_date     timestamptz,   -- "op gesprek" datum/tijd
  ADD COLUMN IF NOT EXISTS desired_start_date date;          -- "direct starten" startdatum

-- DELETE verbreden van admin-only naar alle interne gebruikers.
DROP POLICY IF EXISTS tenant_delete ON public.matches;
CREATE POLICY tenant_delete ON public.matches
  FOR DELETE TO authenticated
  USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

-- Throttle-log voor het publieke match-response endpoint. Service-role only.
CREATE TABLE IF NOT EXISTS public.match_response_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_hash text,
  token text,
  action text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.match_response_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.match_response_attempts FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_match_response_attempts_ip_time
  ON public.match_response_attempts (ip_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_match_response_attempts_time
  ON public.match_response_attempts (created_at);

COMMENT ON TABLE public.match_response_attempts IS
  'Throttle-log voor het publieke match-response endpoint (gehashte IP). Service-role only.';
