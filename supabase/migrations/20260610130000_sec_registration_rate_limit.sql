-- Security audit 2026-06-10 — H6: rate-limiting voor anonieme self-registration.
-- register-organization had geen enige throttle; een aanvaller kon scriptmatig
-- onbeperkt orgs + auth-users aanmaken, elk met €50 AI-credits op de gedeelde
-- ANTHROPIC_API_KEY. Deze tabel houdt registratiepogingen bij (gehashte IP) zodat
-- de edge function per-IP en globaal kan throttelen.

CREATE TABLE IF NOT EXISTS public.registration_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_hash text,
  email text,
  succeeded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Alleen de service-role (edge function) raakt deze tabel aan. RLS aan + geen
-- policies = deny-all voor anon/authenticated; REVOKE als defense-in-depth.
ALTER TABLE public.registration_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.registration_attempts FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_registration_attempts_ip_time
  ON public.registration_attempts (ip_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_registration_attempts_time
  ON public.registration_attempts (created_at);

COMMENT ON TABLE public.registration_attempts IS
  'Throttle-log voor register-organization (gehashte IP). Service-role only.';
