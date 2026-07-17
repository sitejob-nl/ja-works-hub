-- Wachtwoord-vergeten-flow: throttle-log voor het publieke password-reset endpoint.
-- Spiegelt match_response_attempts: service-role only (RLS aan zonder policies = deny-all;
-- de advisor-INFO rls_enabled_no_policy is verwacht en bewust).

CREATE TABLE IF NOT EXISTS public.password_reset_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_hash text,
  email_hash text,
  action text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.password_reset_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.password_reset_attempts FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_password_reset_attempts_ip_time
  ON public.password_reset_attempts (ip_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_password_reset_attempts_email_time
  ON public.password_reset_attempts (email_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_password_reset_attempts_time
  ON public.password_reset_attempts (created_at);

COMMENT ON TABLE public.password_reset_attempts IS
  'Throttle-log voor het publieke password-reset endpoint (gehashte IP + gehasht e-mailadres). Service-role only.';
