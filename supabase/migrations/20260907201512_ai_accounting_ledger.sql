-- Atomic preflight reservations, immutable credit movements, additive monthly grants.
-- Existing balances remain unchanged; pre-migration discrepancies are documented.
BEGIN;

LOCK TABLE public.organization_credits, public.ai_usage_log IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE public.organization_credits
  ADD COLUMN IF NOT EXISTS reserved_cents integer NOT NULL DEFAULT 0 CHECK (reserved_cents >= 0),
  ADD COLUMN IF NOT EXISTS monthly_allowance_cents integer NOT NULL DEFAULT 0 CHECK (monthly_allowance_cents BETWEEN 0 AND 10000000),
  ADD COLUMN IF NOT EXISTS monthly_start_month date CHECK (monthly_start_month = date_trunc('month', monthly_start_month)::date);

CREATE TABLE IF NOT EXISTS public.ai_requests (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  candidate_id uuid REFERENCES public.candidates(id) ON DELETE SET NULL,
  feature text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  status text NOT NULL CHECK (status IN ('reserved', 'succeeded', 'failed', 'unknown', 'blocked')),
  reservation_cents integer NOT NULL CHECK (reservation_cents >= 0),
  requested_charged_cents integer CHECK (requested_charged_cents >= 0),
  charged_cents integer NOT NULL DEFAULT 0 CHECK (charged_cents >= 0),
  reservation_overrun_cents integer NOT NULL DEFAULT 0 CHECK (reservation_overrun_cents >= 0),
  input_tokens integer CHECK (input_tokens >= 0),
  output_tokens integer CHECK (output_tokens >= 0),
  thinking_tokens integer CHECK (thinking_tokens >= 0),
  provider_cost_usd numeric(20,10) CHECK (provider_cost_usd >= 0 AND provider_cost_usd::text NOT IN ('NaN', 'Infinity', '-Infinity')),
  provider_request_id text,
  error_code text,
  duration_ms integer CHECK (duration_ms >= 0),
  metadata jsonb NOT NULL DEFAULT '{}',
  settlement_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finalized_at timestamptz
);
CREATE INDEX IF NOT EXISTS ai_requests_org_created_idx ON public.ai_requests(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_requests_open_idx ON public.ai_requests(organization_id, created_at) WHERE status IN ('reserved', 'unknown');
CREATE INDEX IF NOT EXISTS ai_requests_user_idx ON public.ai_requests(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_requests_candidate_idx ON public.ai_requests(candidate_id) WHERE candidate_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.ai_credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Keep original organization identity even if an unused registration is rolled back.
  -- No organization FK: deleting an organization must never erase its journal.
  organization_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('opening', 'monthly_grant', 'manual_topup', 'usage_charge', 'legacy_charge')),
  amount_cents integer NOT NULL,
  balance_after_cents integer NOT NULL,
  request_id uuid REFERENCES public.ai_requests(id),
  topup_id uuid REFERENCES public.credit_topups(id),
  grant_month date,
  idempotency_key text NOT NULL,
  note text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, idempotency_key)
);
ALTER TABLE public.ai_credit_ledger DROP CONSTRAINT IF EXISTS ai_credit_ledger_organization_id_fkey;
CREATE UNIQUE INDEX IF NOT EXISTS ai_credit_ledger_month_once_idx ON public.ai_credit_ledger(organization_id, grant_month) WHERE kind = 'monthly_grant';
CREATE UNIQUE INDEX IF NOT EXISTS ai_credit_ledger_request_once_idx ON public.ai_credit_ledger(request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_credit_ledger_org_created_idx ON public.ai_credit_ledger(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_credit_ledger_topup_idx ON public.ai_credit_ledger(topup_id) WHERE topup_id IS NOT NULL;

ALTER TABLE public.ai_usage_log
  ADD COLUMN IF NOT EXISTS request_id uuid REFERENCES public.ai_requests(id),
  ADD COLUMN IF NOT EXISTS thinking_tokens integer,
  ADD COLUMN IF NOT EXISTS provider_cost_usd numeric(20,10),
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'legacy';
CREATE UNIQUE INDEX IF NOT EXISTS ai_usage_log_request_once_idx ON public.ai_usage_log(request_id) WHERE request_id IS NOT NULL;
-- Keep cloud/vps compatibility while storing the actual vendor on every new request.
ALTER TABLE public.ai_usage_log DROP CONSTRAINT IF EXISTS ai_usage_log_provider_check;
ALTER TABLE public.ai_usage_log ADD CONSTRAINT ai_usage_log_provider_check CHECK (provider IN ('vps', 'cloud', 'gemini', 'anthropic', 'openai', 'deepseek', 'lovable', 'exa'));
COMMENT ON COLUMN public.ai_usage_log.cost_cents IS 'Customer euro-credit charge. Not provider cost; see provider_cost_usd (NULL = unknown).';
COMMENT ON COLUMN public.ai_requests.provider_cost_usd IS 'Provider USD cost: provider-reported or estimated from actual usage and a recorded tariff; metadata.provider_cost_kind distinguishes these. NULL means unmeasured, never silently zero.';
COMMENT ON COLUMN public.ai_requests.thinking_tokens IS 'Thinking tokens already included in output_tokens when billed by the provider. Informational subset; do not add them twice.';
COMMENT ON COLUMN public.ai_requests.reservation_overrun_cents IS 'Requested customer charge above its own reservation, absorbed pending review. Never taken from another reservation or made into customer debt.';

ALTER TABLE public.ai_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_credit_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_requests_read ON public.ai_requests;
CREATE POLICY ai_requests_read ON public.ai_requests FOR SELECT TO authenticated USING (
  (SELECT public.is_superadmin()) OR (organization_id = (SELECT public.get_user_org_id()) AND (SELECT public.is_internal_user()))
);
DROP POLICY IF EXISTS ai_credit_ledger_read ON public.ai_credit_ledger;
CREATE POLICY ai_credit_ledger_read ON public.ai_credit_ledger FOR SELECT TO authenticated USING (
  (SELECT public.is_superadmin()) OR (organization_id = (SELECT public.get_user_org_id()) AND (SELECT public.is_internal_user()))
);
DROP POLICY IF EXISTS active_profile_required ON public.ai_requests;
CREATE POLICY active_profile_required ON public.ai_requests AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT private.is_active_user())) WITH CHECK ((SELECT private.is_active_user()));
DROP POLICY IF EXISTS active_profile_required ON public.ai_credit_ledger;
CREATE POLICY active_profile_required ON public.ai_credit_ledger AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT private.is_active_user())) WITH CHECK ((SELECT private.is_active_user()));
-- Exact live policy name verified before this replacement.
DROP POLICY IF EXISTS credits_select_own_or_super ON public.organization_credits;
CREATE POLICY credits_select_own_or_super ON public.organization_credits FOR SELECT TO authenticated USING (
  (SELECT public.is_superadmin()) OR (organization_id = (SELECT public.get_user_org_id()) AND (SELECT public.is_internal_user()))
);
REVOKE ALL ON public.ai_requests, public.ai_credit_ledger FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ai_requests, public.ai_credit_ledger TO authenticated, service_role;
-- All balance, reservation and journal mutations must go through their RPC transaction.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.ai_requests, public.ai_credit_ledger, public.organization_credits, public.credit_topups FROM service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.organization_credits, public.credit_topups, public.ai_usage_log FROM PUBLIC, anon, authenticated;
-- Retain legacy service INSERT only during the edge rollout; never permit rewriting settled usage.
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.ai_usage_log FROM service_role;

CREATE OR REPLACE FUNCTION public.ai_credit_ledger_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'AI credit ledger entries are immutable; add an explicit correction instead';
END;
$$;
DROP TRIGGER IF EXISTS ai_credit_ledger_immutable ON public.ai_credit_ledger;
CREATE TRIGGER ai_credit_ledger_immutable BEFORE UPDATE OR DELETE ON public.ai_credit_ledger
  FOR EACH ROW EXECUTE FUNCTION public.ai_credit_ledger_immutable();

INSERT INTO public.ai_credit_ledger(organization_id, kind, amount_cents, balance_after_cents, idempotency_key, note, metadata)
SELECT oc.organization_id, 'opening', oc.balance_cents, oc.balance_cents, 'opening',
  'Historical balance preserved at accounting cutover; no retrospective usage or credit correction.',
  jsonb_build_object('lifetime_topped_up_cents', oc.lifetime_topped_up_cents,
    'historical_logged_cost_cents', COALESCE(u.logged_cents, 0),
    'historical_unexplained_cents', oc.lifetime_topped_up_cents::bigint - oc.balance_cents - COALESCE(u.logged_cents, 0),
    'cutover_at', now())
FROM public.organization_credits oc
LEFT JOIN (SELECT organization_id, sum(cost_cents)::bigint logged_cents FROM public.ai_usage_log GROUP BY organization_id) u USING (organization_id)
ON CONFLICT (organization_id, idempotency_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.ai_credit_opening_entry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.ai_credit_ledger(organization_id, kind, amount_cents, balance_after_cents, idempotency_key, metadata)
  VALUES (NEW.organization_id, 'opening', NEW.balance_cents, NEW.balance_cents, 'opening',
    jsonb_build_object('lifetime_topped_up_cents', NEW.lifetime_topped_up_cents, 'historical_logged_cost_cents', 0,
      'historical_unexplained_cents', NEW.lifetime_topped_up_cents - NEW.balance_cents, 'cutover_at', now()))
  ON CONFLICT (organization_id, idempotency_key) DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS ai_credit_opening_entry ON public.organization_credits;
CREATE TRIGGER ai_credit_opening_entry AFTER INSERT ON public.organization_credits
  FOR EACH ROW EXECUTE FUNCTION public.ai_credit_opening_entry();

CREATE OR REPLACE FUNCTION public.grant_monthly_ai_credits(p_as_of timestamptz DEFAULT now(), p_org_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_month date;
  v_due_month date;
  v_org public.organization_credits%ROWTYPE;
  v_count integer := 0;
  v_total bigint := 0;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_as_of IS NULL OR NOT isfinite(p_as_of) OR p_as_of > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'Cannot grant future monthly credits';
  END IF;
  v_month := date_trunc('month', p_as_of AT TIME ZONE 'Europe/Amsterdam')::date;
  FOR v_org IN SELECT * FROM public.organization_credits
    WHERE monthly_allowance_cents > 0 AND monthly_start_month <= v_month
      AND (p_org_id IS NULL OR organization_id = p_org_id)
    ORDER BY organization_id FOR UPDATE
  LOOP
    -- Safety cap: preserve due months and report errors rather than silently skip older debt.
    IF v_org.monthly_start_month < v_month - interval '10 years' THEN
      RAISE EXCEPTION 'Monthly catch-up exceeds 10 years for organization %', v_org.organization_id;
    END IF;
    FOR v_due_month IN SELECT generate_series(v_org.monthly_start_month::timestamp, v_month::timestamp, interval '1 month')::date
    LOOP
      IF NOT EXISTS(SELECT 1 FROM public.ai_credit_ledger
        WHERE organization_id = v_org.organization_id AND kind = 'monthly_grant' AND grant_month = v_due_month) THEN
        UPDATE public.organization_credits SET balance_cents = balance_cents + v_org.monthly_allowance_cents,
          lifetime_topped_up_cents = lifetime_topped_up_cents + v_org.monthly_allowance_cents, updated_at = now()
          WHERE organization_id = v_org.organization_id RETURNING * INTO v_org;
        INSERT INTO public.ai_credit_ledger(organization_id, kind, amount_cents, balance_after_cents, grant_month, idempotency_key, note)
          VALUES(v_org.organization_id, 'monthly_grant', v_org.monthly_allowance_cents, v_org.balance_cents, v_due_month,
            'monthly:' || to_char(v_due_month, 'YYYY-MM'), 'Monthly allowance, additive; unused credits roll over.');
        v_count := v_count + 1;
        v_total := v_total + v_org.monthly_allowance_cents;
      END IF;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('grants_created', v_count, 'amount_cents', v_total, 'through_month', v_month);
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_ai_usage(
  p_request_id uuid, p_org_id uuid, p_user_id uuid, p_feature text, p_provider text, p_model text,
  p_reserved_cents integer, p_candidate_id uuid DEFAULT NULL, p_metadata jsonb DEFAULT '{}'
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_org public.organization_credits%ROWTYPE;
  v_request public.ai_requests%ROWTYPE;
  v_existing boolean := false;
  v_ok boolean;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501'; END IF;
  IF p_request_id IS NULL OR p_org_id IS NULL OR p_reserved_cents IS NULL OR p_reserved_cents < 0 OR p_reserved_cents > 10000000
    OR COALESCE(trim(p_feature), '') = '' OR COALESCE(trim(p_model), '') = ''
    OR p_provider NOT IN ('vps', 'cloud', 'gemini', 'anthropic', 'openai', 'deepseek', 'lovable', 'exa') OR p_provider IS NULL
    OR jsonb_typeof(COALESCE(p_metadata, '{}')) <> 'object' THEN RAISE EXCEPTION 'Invalid AI reservation'; END IF;
  IF p_candidate_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.candidates WHERE id = p_candidate_id AND organization_id = p_org_id) THEN
    RAISE EXCEPTION 'Candidate does not belong to organization';
  END IF;
  INSERT INTO public.organization_credits(organization_id, balance_cents, lifetime_topped_up_cents)
    VALUES(p_org_id, 0, 0) ON CONFLICT (organization_id) DO NOTHING;
  PERFORM public.grant_monthly_ai_credits(now(), p_org_id);
  SELECT * INTO v_org FROM public.organization_credits WHERE organization_id = p_org_id FOR UPDATE;
  SELECT * INTO v_request FROM public.ai_requests WHERE id = p_request_id;
  IF FOUND THEN
    v_existing := true;
    IF v_request.organization_id <> p_org_id OR v_request.user_id IS DISTINCT FROM p_user_id OR v_request.feature <> p_feature
      OR v_request.provider <> p_provider OR v_request.model <> p_model OR v_request.reservation_cents <> p_reserved_cents
      OR v_request.candidate_id IS DISTINCT FROM p_candidate_id THEN RAISE EXCEPTION 'Request ID already used for a different AI reservation'; END IF;
  ELSE
    v_ok := v_org.balance_cents - v_org.reserved_cents >= p_reserved_cents;
    INSERT INTO public.ai_requests(id, organization_id, user_id, candidate_id, feature, provider, model, status, reservation_cents, metadata, error_code)
      VALUES(p_request_id, p_org_id, p_user_id, p_candidate_id, p_feature, p_provider, p_model,
        CASE WHEN v_ok THEN 'reserved' ELSE 'blocked' END, p_reserved_cents, COALESCE(p_metadata, '{}'), CASE WHEN v_ok THEN NULL ELSE 'insufficient_credits' END)
      RETURNING * INTO v_request;
    IF v_ok THEN
      UPDATE public.organization_credits SET reserved_cents = reserved_cents + p_reserved_cents, updated_at = now()
        WHERE organization_id = p_org_id RETURNING * INTO v_org;
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', v_request.status = 'reserved' AND NOT v_existing, 'request_id', v_request.id,
    'status', v_request.status, 'reservation_cents', v_request.reservation_cents, 'balance_cents', v_org.balance_cents,
    'reserved_cents', v_org.reserved_cents, 'available_cents', v_org.balance_cents - v_org.reserved_cents, 'already_exists', v_existing);
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_ai_usage(
  p_request_id uuid, p_status text, p_input_tokens integer DEFAULT NULL, p_output_tokens integer DEFAULT NULL,
  p_thinking_tokens integer DEFAULT NULL, p_provider_cost_usd numeric DEFAULT NULL, p_charged_cents integer DEFAULT NULL,
  p_provider_request_id text DEFAULT NULL, p_error_code text DEFAULT NULL, p_duration_ms integer DEFAULT NULL, p_metadata jsonb DEFAULT '{}'
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_org public.organization_credits%ROWTYPE;
  v_request public.ai_requests%ROWTYPE;
  v_org_id uuid;
  v_payload jsonb;
  v_charge integer;
  v_existing boolean := false;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('succeeded', 'failed', 'unknown') OR p_input_tokens < 0 OR p_output_tokens < 0
    OR p_thinking_tokens < 0 OR p_provider_cost_usd < 0 OR p_charged_cents < 0 OR p_duration_ms < 0
    OR p_provider_cost_usd::text IN ('NaN', 'Infinity', '-Infinity')
    OR jsonb_typeof(COALESCE(p_metadata, '{}')) <> 'object' THEN RAISE EXCEPTION 'Invalid AI settlement'; END IF;
  IF p_status IN ('succeeded', 'failed') AND p_charged_cents IS NULL THEN
    RAISE EXCEPTION 'A final outcome requires an explicit customer charge, including zero';
  END IF;
  SELECT organization_id INTO v_org_id FROM public.ai_requests WHERE id = p_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'AI reservation not found'; END IF;
  -- Same lock order for reserve, settle, grants and manual corrections: organization first.
  SELECT * INTO v_org FROM public.organization_credits WHERE organization_id = v_org_id FOR UPDATE;
  SELECT * INTO v_request FROM public.ai_requests WHERE id = p_request_id FOR UPDATE;
  v_payload := jsonb_build_object('status', p_status, 'input_tokens', p_input_tokens, 'output_tokens', p_output_tokens,
    'thinking_tokens', p_thinking_tokens, 'provider_cost_usd', p_provider_cost_usd, 'charged_cents', p_charged_cents,
    'provider_request_id', p_provider_request_id, 'error_code', p_error_code, 'duration_ms', p_duration_ms, 'metadata', COALESCE(p_metadata, '{}'));
  IF v_request.status IN ('succeeded', 'failed', 'blocked') THEN
    IF v_request.settlement_payload IS DISTINCT FROM v_payload THEN RAISE EXCEPTION 'AI request already finalized with a different outcome'; END IF;
    v_existing := true;
  ELSIF p_status = 'unknown' THEN
    -- An uncertain provider outcome is a visible outstanding liability, not a free retry.
    UPDATE public.ai_requests SET status = 'unknown', input_tokens = p_input_tokens, output_tokens = p_output_tokens,
      thinking_tokens = p_thinking_tokens, provider_cost_usd = p_provider_cost_usd, requested_charged_cents = p_charged_cents,
      provider_request_id = p_provider_request_id, error_code = COALESCE(p_error_code, 'provider_outcome_unknown'),
      duration_ms = p_duration_ms, metadata = metadata || COALESCE(p_metadata, '{}'), updated_at = now()
      WHERE id = p_request_id RETURNING * INTO v_request;
  ELSE
    v_charge := LEAST(p_charged_cents, v_request.reservation_cents);
    IF v_org.reserved_cents < v_request.reservation_cents THEN RAISE EXCEPTION 'Reservation reconciliation failed'; END IF;
    UPDATE public.organization_credits SET balance_cents = balance_cents - v_charge,
      reserved_cents = reserved_cents - v_request.reservation_cents, updated_at = now()
      WHERE organization_id = v_org_id RETURNING * INTO v_org;
    UPDATE public.ai_requests SET status = p_status, input_tokens = p_input_tokens, output_tokens = p_output_tokens,
      thinking_tokens = p_thinking_tokens, provider_cost_usd = p_provider_cost_usd, charged_cents = v_charge,
      requested_charged_cents = p_charged_cents, reservation_overrun_cents = GREATEST(0, p_charged_cents - reservation_cents),
      provider_request_id = p_provider_request_id, error_code = p_error_code, duration_ms = p_duration_ms,
      metadata = metadata || COALESCE(p_metadata, '{}'), settlement_payload = v_payload, updated_at = now(), finalized_at = now()
      WHERE id = p_request_id RETURNING * INTO v_request;
    INSERT INTO public.ai_usage_log(organization_id, user_id, feature, provider, model, input_tokens, output_tokens,
      cost_cents, candidate_id, duration_ms, request_id, thinking_tokens, provider_cost_usd, status)
      VALUES(v_request.organization_id, v_request.user_id, v_request.feature, v_request.provider, v_request.model,
        p_input_tokens, p_output_tokens, v_charge, v_request.candidate_id, p_duration_ms, p_request_id, p_thinking_tokens, p_provider_cost_usd, p_status);
    -- Include zero charges: one request has exactly one auditable accounting outcome.
    INSERT INTO public.ai_credit_ledger(organization_id, kind, amount_cents, balance_after_cents, request_id, idempotency_key, metadata)
      VALUES(v_org_id, 'usage_charge', -v_charge, v_org.balance_cents, p_request_id, 'request:' || p_request_id::text,
        jsonb_build_object('requested_charged_cents', p_charged_cents, 'reservation_overrun_cents', v_request.reservation_overrun_cents));
  END IF;
  RETURN jsonb_build_object('ok', true, 'request_id', p_request_id, 'status', v_request.status,
    'charged_cents', v_request.charged_cents, 'balance_cents', v_org.balance_cents, 'reserved_cents', v_org.reserved_cents,
    'available_cents', v_org.balance_cents - v_org.reserved_cents, 'already_finalized', v_existing,
    'reservation_overrun_cents', v_request.reservation_overrun_cents);
END;
$$;

-- Compatibility for functions still running during the staged edge-function rollout.
-- Their debits are explicit legacy movements and cannot consume funds reserved by the new path.
CREATE OR REPLACE FUNCTION public.consume_ai_credits(p_org_id uuid, p_amount_cents integer)
RETURNS TABLE(ok boolean, new_balance_cents integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_org public.organization_credits%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501'; END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN RAISE EXCEPTION 'amount_cents must be positive'; END IF;
  INSERT INTO public.organization_credits(organization_id, balance_cents, lifetime_topped_up_cents)
    VALUES(p_org_id, 0, 0) ON CONFLICT (organization_id) DO NOTHING;
  SELECT * INTO v_org FROM public.organization_credits WHERE organization_id = p_org_id FOR UPDATE;
  IF v_org.balance_cents - v_org.reserved_cents < p_amount_cents THEN RETURN QUERY SELECT false, v_org.balance_cents; RETURN; END IF;
  UPDATE public.organization_credits SET balance_cents = balance_cents - p_amount_cents, updated_at = now()
    WHERE organization_id = p_org_id RETURNING * INTO v_org;
  INSERT INTO public.ai_credit_ledger(organization_id, kind, amount_cents, balance_after_cents, idempotency_key, note)
    VALUES(p_org_id, 'legacy_charge', -p_amount_cents, v_org.balance_cents, 'legacy:' || gen_random_uuid()::text,
      'Compatibility debit: legacy caller does not supply a provider request ID.');
  RETURN QUERY SELECT true, v_org.balance_cents;
END;
$$;

CREATE OR REPLACE FUNCTION public.topup_ai_credits_once(p_org_id uuid, p_amount_cents integer, p_note text, p_request_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_org public.organization_credits%ROWTYPE;
  v_entry public.ai_credit_ledger%ROWTYPE;
  v_topup_id uuid;
BEGIN
  IF NOT COALESCE(public.is_superadmin() AND private.is_active_user(), false) THEN RAISE EXCEPTION 'Only active superadmins may top up credits' USING ERRCODE = '42501'; END IF;
  IF p_amount_cents IS NULL OR p_amount_cents = 0 OR abs(p_amount_cents::bigint) > 10000000 OR p_request_id IS NULL THEN
    RAISE EXCEPTION 'Invalid credit top-up';
  END IF;
  INSERT INTO public.organization_credits(organization_id, balance_cents, lifetime_topped_up_cents)
    VALUES(p_org_id, 0, 0) ON CONFLICT (organization_id) DO NOTHING;
  SELECT * INTO v_org FROM public.organization_credits WHERE organization_id = p_org_id FOR UPDATE;
  SELECT * INTO v_entry FROM public.ai_credit_ledger WHERE organization_id = p_org_id AND idempotency_key = 'topup:' || p_request_id::text;
  IF FOUND THEN
    IF v_entry.amount_cents <> p_amount_cents OR v_entry.note IS DISTINCT FROM p_note THEN RAISE EXCEPTION 'Top-up ID already used with different details'; END IF;
    RETURN v_org.balance_cents;
  END IF;
  IF v_org.balance_cents + p_amount_cents < v_org.reserved_cents THEN RAISE EXCEPTION 'Correction would consume reserved credits or create debt'; END IF;
  UPDATE public.organization_credits SET balance_cents = balance_cents + p_amount_cents,
    lifetime_topped_up_cents = lifetime_topped_up_cents + GREATEST(p_amount_cents, 0), updated_at = now()
    WHERE organization_id = p_org_id RETURNING * INTO v_org;
  INSERT INTO public.credit_topups(organization_id, amount_cents, superadmin_id, note)
    VALUES(p_org_id, p_amount_cents, auth.uid(), p_note) RETURNING id INTO v_topup_id;
  INSERT INTO public.ai_credit_ledger(organization_id, kind, amount_cents, balance_after_cents, topup_id, idempotency_key, note)
    VALUES(p_org_id, 'manual_topup', p_amount_cents, v_org.balance_cents, v_topup_id, 'topup:' || p_request_id::text, p_note);
  RETURN v_org.balance_cents;
END;
$$;

CREATE OR REPLACE FUNCTION public.topup_ai_credits(p_org_id uuid, p_amount_cents integer, p_note text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN public.topup_ai_credits_once(p_org_id, p_amount_cents, p_note, gen_random_uuid());
END;
$$;

CREATE OR REPLACE FUNCTION public.set_monthly_ai_allowance(p_org_id uuid, p_amount_cents integer, p_start_month date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND NOT COALESCE(public.is_superadmin() AND private.is_active_user(), false) THEN
    RAISE EXCEPTION 'Only superadmins may configure the monthly allowance' USING ERRCODE = '42501';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents NOT BETWEEN 0 AND 10000000
    OR (p_amount_cents > 0 AND p_start_month IS NULL)
    OR p_start_month IS DISTINCT FROM date_trunc('month', p_start_month)::date
    OR p_start_month < (date_trunc('month', now() AT TIME ZONE 'Europe/Amsterdam') - interval '10 years')::date THEN
    RAISE EXCEPTION 'Invalid monthly allowance or first month';
  END IF;
  UPDATE public.organization_credits SET monthly_allowance_cents = p_amount_cents, monthly_start_month = p_start_month, updated_at = now()
    WHERE organization_id = p_org_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Organization credit account not found'; END IF;
  RETURN jsonb_build_object('monthly_allowance_cents', p_amount_cents, 'monthly_start_month', p_start_month);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_ai_credit_summary(p_org_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_org public.organization_credits%ROWTYPE;
  v_month date := date_trunc('month', now() AT TIME ZONE 'Europe/Amsterdam')::date;
  v_month_at timestamptz;
  v_next_month date;
  v_month_cost bigint;
  v_provider_cost numeric;
  v_unknown_cost bigint;
  v_open bigint;
  v_stale bigint;
  v_reserved bigint;
  v_overrun bigint;
  v_ledger_balance bigint;
  v_historical bigint;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND NOT COALESCE(public.is_superadmin() AND private.is_active_user(), false)
    AND NOT COALESCE((public.is_internal_user() AND p_org_id = public.get_user_org_id() AND private.is_active_user()), false) THEN
    RAISE EXCEPTION 'No access to organization AI accounting' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_org FROM public.organization_credits WHERE organization_id = p_org_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Organization credit account not found'; END IF;
  v_month_at := v_month::timestamp AT TIME ZONE 'Europe/Amsterdam';
  SELECT COALESCE(sum(cost_cents), 0), sum(provider_cost_usd), count(*) FILTER(WHERE provider_cost_usd IS NULL)
    INTO v_month_cost, v_provider_cost, v_unknown_cost FROM public.ai_usage_log WHERE organization_id = p_org_id AND created_at >= v_month_at;
  SELECT count(*) FILTER(WHERE status IN ('reserved', 'unknown')),
    count(*) FILTER(WHERE status IN ('reserved', 'unknown') AND created_at < now() - interval '15 minutes'),
    COALESCE(sum(reservation_cents) FILTER(WHERE status IN ('reserved', 'unknown')), 0), COALESCE(sum(reservation_overrun_cents), 0)
    INTO v_open, v_stale, v_reserved, v_overrun FROM public.ai_requests WHERE organization_id = p_org_id;
  SELECT COALESCE(sum(amount_cents), 0), COALESCE(max((metadata->>'historical_unexplained_cents')::bigint) FILTER(WHERE kind = 'opening'), 0)
    INTO v_ledger_balance, v_historical FROM public.ai_credit_ledger WHERE organization_id = p_org_id;
  IF v_org.monthly_allowance_cents > 0 AND v_org.monthly_start_month IS NOT NULL THEN
    SELECT min(m.month_date) INTO v_next_month FROM (
      SELECT generate_series(v_org.monthly_start_month::timestamp, (GREATEST(v_month, v_org.monthly_start_month) + interval '1 month')::timestamp, interval '1 month')::date month_date
    ) m WHERE NOT EXISTS(SELECT 1 FROM public.ai_credit_ledger l WHERE l.organization_id = p_org_id AND l.kind = 'monthly_grant' AND l.grant_month = m.month_date);
  END IF;
  RETURN jsonb_build_object('balance_cents', v_org.balance_cents, 'reserved_cents', v_org.reserved_cents,
    'available_cents', v_org.balance_cents - v_org.reserved_cents, 'monthly_allowance_cents', v_org.monthly_allowance_cents,
    'monthly_start_month', v_org.monthly_start_month, 'next_grant_at', v_next_month::timestamp AT TIME ZONE 'Europe/Amsterdam',
    'month_start', v_month, 'month_charged_cents', v_month_cost, 'month_provider_cost_usd', v_provider_cost,
    'month_provider_cost_unknown_count', v_unknown_cost, 'unresolved_requests', v_open, 'stale_requests', v_stale,
    'unreviewed_overrun_cents', v_overrun, 'ledger_difference_cents', v_org.balance_cents - v_ledger_balance,
    'reservation_difference_cents', v_org.reserved_cents - v_reserved, 'historical_unexplained_cents', v_historical);
END;
$$;

REVOKE ALL ON FUNCTION public.ai_credit_ledger_immutable(), public.ai_credit_opening_entry() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reserve_ai_usage(uuid, uuid, uuid, text, text, text, integer, uuid, jsonb),
  public.finalize_ai_usage(uuid, text, integer, integer, integer, numeric, integer, text, text, integer, jsonb),
  public.grant_monthly_ai_credits(timestamptz, uuid), public.consume_ai_credits(uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_ai_usage(uuid, uuid, uuid, text, text, text, integer, uuid, jsonb),
  public.finalize_ai_usage(uuid, text, integer, integer, integer, numeric, integer, text, text, integer, jsonb),
  public.grant_monthly_ai_credits(timestamptz, uuid), public.consume_ai_credits(uuid, integer) TO service_role;
REVOKE ALL ON FUNCTION public.topup_ai_credits_once(uuid, integer, text, uuid), public.topup_ai_credits(uuid, integer, text),
  public.set_monthly_ai_allowance(uuid, integer, date), public.get_ai_credit_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.topup_ai_credits_once(uuid, integer, text, uuid), public.topup_ai_credits(uuid, integer, text),
  public.set_monthly_ai_allowance(uuid, integer, date), public.get_ai_credit_summary(uuid) TO authenticated, service_role;

-- Hourly retry/catch-up, month boundaries calculated inside the RPC in Europe/Amsterdam.
-- Direct SQL cron requires no HTTP endpoint or stored API secret.
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('ai-monthly-credit-grants', '5 * * * *', 'SELECT public.grant_monthly_ai_credits();');
  END IF;
END;
$$;

COMMIT;
