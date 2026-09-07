-- Correct monthly allowances to a monthly spending cap: no rollover or catch-up.
-- Preserve the prior migration and all historical journal entries unchanged.
BEGIN;
LOCK TABLE public.organization_credits, public.ai_requests, public.ai_usage_log IN SHARE ROW EXCLUSIVE MODE;

ALTER TABLE public.organization_credits
  ADD COLUMN IF NOT EXISTS credit_mode text NOT NULL DEFAULT 'prepaid' CHECK (credit_mode IN ('prepaid', 'monthly')),
  ADD COLUMN IF NOT EXISTS budget_month date,
  ADD COLUMN IF NOT EXISTS budget_limit_cents integer CHECK (budget_limit_cents >= 0),
  ADD COLUMN IF NOT EXISTS budget_revision integer NOT NULL DEFAULT 0 CHECK (budget_revision >= 0),
  ADD COLUMN IF NOT EXISTS last_budget_reset_at timestamptz;
UPDATE public.organization_credits SET credit_mode = 'monthly' WHERE monthly_allowance_cents > 0 AND credit_mode = 'prepaid';

ALTER TABLE public.ai_requests ADD COLUMN IF NOT EXISTS budget_month date;
UPDATE public.ai_requests SET budget_month = date_trunc('month', created_at AT TIME ZONE 'Europe/Amsterdam')::date WHERE budget_month IS NULL;
ALTER TABLE public.ai_requests ALTER COLUMN budget_month SET NOT NULL;
ALTER TABLE public.ai_requests ALTER COLUMN budget_month SET DEFAULT (date_trunc('month', now() AT TIME ZONE 'Europe/Amsterdam')::date);
ALTER TABLE public.ai_usage_log ADD COLUMN IF NOT EXISTS budget_month date;
COMMENT ON COLUMN public.ai_requests.budget_month IS 'Month the provider attempt was authorized, in Europe/Amsterdam. Late settlement remains attributable to this month.';
COMMENT ON COLUMN public.ai_usage_log.budget_month IS 'Authorization month for new requests. Legacy NULL rows use their created_at month in Europe/Amsterdam.';
COMMENT ON COLUMN public.organization_credits.balance_cents IS 'Gross credit balance, including pending holds from previous budget periods. Available = balance_cents - reserved_cents; old holds never become new-month funds.';
COMMENT ON COLUMN public.organization_credits.credit_mode IS 'prepaid preserves existing non-monthly behavior; monthly enforces a calendar-month cap. Zero in monthly mode means paused, not prepaid.';
CREATE INDEX IF NOT EXISTS ai_requests_org_budget_month_idx ON public.ai_requests(organization_id, budget_month);
CREATE INDEX IF NOT EXISTS ai_usage_log_org_budget_month_idx ON public.ai_usage_log(organization_id, budget_month);
ALTER TABLE public.ai_credit_ledger DROP CONSTRAINT IF EXISTS ai_credit_ledger_kind_check;
ALTER TABLE public.ai_credit_ledger ADD CONSTRAINT ai_credit_ledger_kind_check CHECK (kind IN ('opening', 'monthly_grant', 'manual_topup', 'usage_charge', 'legacy_charge', 'monthly_reset', 'reservation_expiry'));
-- An old-period request can have one charge and one expiry, never two charges.
DROP INDEX IF EXISTS public.ai_credit_ledger_request_once_idx;
CREATE UNIQUE INDEX ai_credit_ledger_request_once_idx ON public.ai_credit_ledger(request_id) WHERE request_id IS NOT NULL AND kind = 'usage_charge';
CREATE UNIQUE INDEX IF NOT EXISTS ai_credit_ledger_expiry_once_idx ON public.ai_credit_ledger(request_id) WHERE request_id IS NOT NULL AND kind = 'reservation_expiry';
CREATE INDEX IF NOT EXISTS ai_credit_ledger_request_idx ON public.ai_credit_ledger(request_id) WHERE request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION private.refresh_ai_monthly_budget(p_org_id uuid, p_as_of timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_org public.organization_credits%ROWTYPE;
  v_month date;
  v_limit integer;
  v_spent bigint;
  v_current_holds bigint;
  v_old_holds bigint;
  v_target integer;
  v_delta integer;
  v_granted integer := 0;
  v_new_period boolean;
BEGIN
  IF p_as_of IS NULL OR NOT isfinite(p_as_of) OR p_as_of > now() + interval '5 minutes' THEN RAISE EXCEPTION 'Cannot reset a future monthly budget'; END IF;
  v_month := date_trunc('month', p_as_of AT TIME ZONE 'Europe/Amsterdam')::date;
  IF v_month > date_trunc('month', now() AT TIME ZONE 'Europe/Amsterdam')::date THEN RAISE EXCEPTION 'Cannot reset a future budget month'; END IF;
  SELECT * INTO v_org FROM public.organization_credits WHERE organization_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Organization credit account not found'; END IF;
  IF v_org.credit_mode <> 'monthly' OR v_org.budget_month > v_month THEN
    RETURN jsonb_build_object('reset_created', false, 'amount_cents', 0);
  END IF;
  v_limit := CASE WHEN v_org.monthly_start_month <= v_month THEN v_org.monthly_allowance_cents ELSE 0 END;
  IF v_org.budget_month = v_month AND v_org.budget_limit_cents = v_limit THEN
    RETURN jsonb_build_object('reset_created', false, 'amount_cents', 0);
  END IF;
  SELECT COALESCE(sum(cost_cents), 0) INTO v_spent FROM public.ai_usage_log
    WHERE organization_id = p_org_id AND COALESCE(budget_month, date_trunc('month', created_at AT TIME ZONE 'Europe/Amsterdam')::date) = v_month;
  SELECT COALESCE(sum(reservation_cents) FILTER (WHERE budget_month = v_month), 0),
    COALESCE(sum(reservation_cents) FILTER (WHERE budget_month <> v_month), 0)
    INTO v_current_holds, v_old_holds FROM public.ai_requests
    WHERE organization_id = p_org_id AND status IN ('reserved', 'unknown');
  IF v_current_holds + v_old_holds <> v_org.reserved_cents THEN RAISE EXCEPTION 'Reservation reconciliation failed'; END IF;
  IF v_current_holds > GREATEST(0, v_limit - v_spent) THEN
    RAISE EXCEPTION 'Monthly limit is below already authorized current-month spending; resolve open requests first';
  END IF;
  v_target := GREATEST(0, v_limit - v_spent) + v_old_holds;
  v_delta := v_target - v_org.balance_cents;
  v_new_period := v_org.budget_month IS DISTINCT FROM v_month;
  IF v_new_period AND NOT EXISTS(SELECT 1 FROM public.ai_credit_ledger
    WHERE organization_id = p_org_id AND grant_month = v_month AND kind IN ('monthly_grant', 'monthly_reset')) THEN
    v_granted := v_limit;
  END IF;
  UPDATE public.organization_credits SET balance_cents = v_target, budget_month = v_month,
    budget_limit_cents = v_limit, budget_revision = budget_revision + 1,
    lifetime_topped_up_cents = lifetime_topped_up_cents + v_granted,
    last_budget_reset_at = now(), updated_at = now()
    WHERE organization_id = p_org_id RETURNING * INTO v_org;
  INSERT INTO public.ai_credit_ledger(organization_id, kind, amount_cents, balance_after_cents, grant_month, idempotency_key, note, metadata)
    VALUES(p_org_id, 'monthly_reset', v_delta, v_target, v_month,
      'monthly-reset:' || v_month::text || ':' || v_org.budget_revision::text,
      'Monthly spending cap; unused free balance expires. No rollover or historical catch-up.',
      jsonb_build_object('budget_month', v_month, 'budget_limit_cents', v_limit, 'month_charged_cents', v_spent,
        'previous_period_reserved_cents', v_old_holds, 'current_month_reserved_cents', v_current_holds,
        'new_period', v_new_period, 'budget_revision', v_org.budget_revision));
  RETURN jsonb_build_object('reset_created', true, 'amount_cents', v_delta, 'budget_month', v_month);
END;
$$;
REVOKE ALL ON FUNCTION private.refresh_ai_monthly_budget(uuid, timestamptz) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.grant_monthly_ai_credits(p_as_of timestamptz DEFAULT now(), p_org_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_org_id uuid; v_result jsonb; v_count integer := 0; v_total bigint := 0; v_month date;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    RAISE EXCEPTION 'Service role required' USING ERRCODE = '42501';
  END IF;
  IF p_as_of IS NULL OR NOT isfinite(p_as_of) OR p_as_of > now() + interval '5 minutes' THEN RAISE EXCEPTION 'Cannot reset a future monthly budget'; END IF;
  v_month := date_trunc('month', p_as_of AT TIME ZONE 'Europe/Amsterdam')::date;
  IF v_month > date_trunc('month', now() AT TIME ZONE 'Europe/Amsterdam')::date THEN RAISE EXCEPTION 'Cannot reset a future budget month'; END IF;
  FOR v_org_id IN SELECT organization_id FROM public.organization_credits
    WHERE credit_mode = 'monthly' AND (p_org_id IS NULL OR organization_id = p_org_id) ORDER BY organization_id
  LOOP
    v_result := private.refresh_ai_monthly_budget(v_org_id, p_as_of);
    IF (v_result->>'reset_created')::boolean THEN v_count := v_count + 1; END IF;
    v_total := v_total + (v_result->>'amount_cents')::bigint;
  END LOOP;
  RETURN jsonb_build_object('grants_created', v_count, 'resets_created', v_count, 'amount_cents', v_total, 'through_month', v_month);
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
  PERFORM private.refresh_ai_monthly_budget(p_org_id, now());
  SELECT * INTO v_org FROM public.organization_credits WHERE organization_id = p_org_id FOR UPDATE;
  SELECT * INTO v_request FROM public.ai_requests WHERE id = p_request_id;
  IF FOUND THEN
    v_existing := true;
    IF v_request.organization_id <> p_org_id OR v_request.user_id IS DISTINCT FROM p_user_id OR v_request.feature <> p_feature
      OR v_request.provider <> p_provider OR v_request.model <> p_model OR v_request.reservation_cents <> p_reserved_cents
      OR v_request.candidate_id IS DISTINCT FROM p_candidate_id THEN RAISE EXCEPTION 'Request ID already used for a different AI reservation'; END IF;
  ELSE
    v_ok := v_org.balance_cents - v_org.reserved_cents >= p_reserved_cents
      AND (v_org.credit_mode <> 'monthly' OR v_org.budget_limit_cents > 0);
    INSERT INTO public.ai_requests(id, organization_id, user_id, candidate_id, feature, provider, model, status, reservation_cents, metadata, error_code, budget_month)
      VALUES(p_request_id, p_org_id, p_user_id, p_candidate_id, p_feature, p_provider, p_model,
        CASE WHEN v_ok THEN 'reserved' ELSE 'blocked' END, p_reserved_cents, COALESCE(p_metadata, '{}'), CASE WHEN v_ok THEN NULL ELSE 'insufficient_credits' END, date_trunc('month', now() AT TIME ZONE 'Europe/Amsterdam')::date)
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
  v_expiry integer := 0;
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
  PERFORM private.refresh_ai_monthly_budget(v_org_id, now());
  -- Same lock order for reserve, settle, resets and manual corrections: organization first.
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
    v_expiry := CASE WHEN v_org.credit_mode = 'monthly' AND v_request.budget_month < v_org.budget_month
      THEN v_request.reservation_cents - v_charge ELSE 0 END;
    IF v_org.reserved_cents < v_request.reservation_cents THEN RAISE EXCEPTION 'Reservation reconciliation failed'; END IF;
    UPDATE public.organization_credits SET balance_cents = balance_cents - v_charge - v_expiry,
      reserved_cents = reserved_cents - v_request.reservation_cents, updated_at = now()
      WHERE organization_id = v_org_id RETURNING * INTO v_org;
    UPDATE public.ai_requests SET status = p_status, input_tokens = p_input_tokens, output_tokens = p_output_tokens,
      thinking_tokens = p_thinking_tokens, provider_cost_usd = p_provider_cost_usd, charged_cents = v_charge,
      requested_charged_cents = p_charged_cents, reservation_overrun_cents = GREATEST(0, p_charged_cents - reservation_cents),
      provider_request_id = p_provider_request_id, error_code = p_error_code, duration_ms = p_duration_ms,
      metadata = metadata || COALESCE(p_metadata, '{}'), settlement_payload = v_payload, updated_at = now(), finalized_at = now()
      WHERE id = p_request_id RETURNING * INTO v_request;
    INSERT INTO public.ai_usage_log(organization_id, user_id, feature, provider, model, input_tokens, output_tokens,
      cost_cents, candidate_id, duration_ms, request_id, thinking_tokens, provider_cost_usd, status, budget_month)
      VALUES(v_request.organization_id, v_request.user_id, v_request.feature, v_request.provider, v_request.model,
        p_input_tokens, p_output_tokens, v_charge, v_request.candidate_id, p_duration_ms, p_request_id, p_thinking_tokens, p_provider_cost_usd, p_status, v_request.budget_month);
    -- Include zero charges: one request has exactly one auditable accounting outcome.
    INSERT INTO public.ai_credit_ledger(organization_id, kind, amount_cents, balance_after_cents, request_id, idempotency_key, metadata)
      VALUES(v_org_id, 'usage_charge', -v_charge, v_org.balance_cents + v_expiry, p_request_id, 'request:' || p_request_id::text,
        jsonb_build_object('requested_charged_cents', p_charged_cents, 'reservation_overrun_cents', v_request.reservation_overrun_cents));
    IF v_expiry > 0 THEN
      INSERT INTO public.ai_credit_ledger(organization_id, kind, amount_cents, balance_after_cents, request_id, idempotency_key, note, metadata)
        VALUES(v_org_id, 'reservation_expiry', -v_expiry, v_org.balance_cents, p_request_id, 'expiry:' || p_request_id::text,
          'Unused reservation from an earlier month expires; it does not replenish the current budget.',
          jsonb_build_object('budget_month', v_request.budget_month, 'current_budget_month', v_org.budget_month));
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'request_id', p_request_id, 'status', v_request.status,
    'charged_cents', v_request.charged_cents, 'balance_cents', v_org.balance_cents, 'reserved_cents', v_org.reserved_cents,
    'available_cents', v_org.balance_cents - v_org.reserved_cents, 'already_finalized', v_existing,
    'reservation_overrun_cents', v_request.reservation_overrun_cents);
END;
$$;

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
  IF v_org.credit_mode = 'monthly' THEN RETURN QUERY SELECT false, v_org.balance_cents; RETURN; END IF;
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
  IF v_org.credit_mode = 'monthly' THEN RAISE EXCEPTION 'Manual top-ups are disabled for monthly budgets; update the monthly limit instead'; END IF;
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


CREATE OR REPLACE FUNCTION public.set_monthly_ai_allowance(p_org_id uuid, p_amount_cents integer, p_start_month date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND NOT COALESCE(public.is_superadmin() AND private.is_active_user(), false) THEN
    RAISE EXCEPTION 'Only superadmins may configure the monthly budget' USING ERRCODE = '42501';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents NOT BETWEEN 0 AND 10000000
    OR (p_amount_cents > 0 AND p_start_month IS NULL)
    OR p_start_month IS DISTINCT FROM date_trunc('month', p_start_month)::date THEN
    RAISE EXCEPTION 'Invalid monthly budget or first month';
  END IF;
  UPDATE public.organization_credits SET monthly_allowance_cents = p_amount_cents, monthly_start_month = p_start_month,
    credit_mode = 'monthly', updated_at = now() WHERE organization_id = p_org_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Organization credit account not found'; END IF;
  PERFORM private.refresh_ai_monthly_budget(p_org_id, now());
  RETURN jsonb_build_object('monthly_allowance_cents', p_amount_cents, 'monthly_start_month', p_start_month, 'budget_mode', 'monthly');
END;
$$;

CREATE OR REPLACE FUNCTION public.get_ai_credit_summary(p_org_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_org public.organization_credits%ROWTYPE;
  v_month date := date_trunc('month', now() AT TIME ZONE 'Europe/Amsterdam')::date;
  v_month_cost bigint;
  v_provider_cost numeric;
  v_unknown_cost bigint;
  v_open bigint;
  v_stale bigint;
  v_reserved bigint;
  v_old_reserved bigint;
  v_overrun bigint;
  v_ledger_balance bigint;
  v_historical bigint;
  v_next_month date;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND NOT COALESCE(public.is_superadmin() AND private.is_active_user(), false)
    AND NOT COALESCE((public.is_internal_user() AND p_org_id = public.get_user_org_id() AND private.is_active_user()), false) THEN
    RAISE EXCEPTION 'No access to organization AI accounting' USING ERRCODE = '42501';
  END IF;
  PERFORM private.refresh_ai_monthly_budget(p_org_id, now());
  SELECT * INTO v_org FROM public.organization_credits WHERE organization_id = p_org_id;
  SELECT COALESCE(sum(cost_cents), 0), sum(provider_cost_usd), count(*) FILTER(WHERE provider_cost_usd IS NULL)
    INTO v_month_cost, v_provider_cost, v_unknown_cost FROM public.ai_usage_log WHERE organization_id = p_org_id
      AND COALESCE(budget_month, date_trunc('month', created_at AT TIME ZONE 'Europe/Amsterdam')::date) = v_month;
  SELECT count(*) FILTER(WHERE status IN ('reserved', 'unknown')),
    count(*) FILTER(WHERE status IN ('reserved', 'unknown') AND created_at < now() - interval '15 minutes'),
    COALESCE(sum(reservation_cents) FILTER(WHERE status IN ('reserved', 'unknown')), 0),
    COALESCE(sum(reservation_cents) FILTER(WHERE status IN ('reserved', 'unknown') AND budget_month < v_month), 0),
    COALESCE(sum(reservation_overrun_cents), 0)
    INTO v_open, v_stale, v_reserved, v_old_reserved, v_overrun FROM public.ai_requests WHERE organization_id = p_org_id;
  SELECT COALESCE(sum(amount_cents), 0), COALESCE(max((metadata->>'historical_unexplained_cents')::bigint) FILTER(WHERE kind = 'opening'), 0)
    INTO v_ledger_balance, v_historical FROM public.ai_credit_ledger WHERE organization_id = p_org_id;
  IF v_org.credit_mode = 'monthly' AND v_org.monthly_allowance_cents > 0 AND v_org.monthly_start_month IS NOT NULL THEN
    v_next_month := GREATEST(v_org.monthly_start_month, (v_month + interval '1 month')::date);
  END IF;
  RETURN jsonb_build_object('balance_cents', v_org.balance_cents, 'reserved_cents', v_org.reserved_cents,
    'available_cents', v_org.balance_cents - v_org.reserved_cents, 'monthly_allowance_cents', v_org.monthly_allowance_cents,
    'monthly_start_month', v_org.monthly_start_month, 'next_grant_at', v_next_month::timestamp AT TIME ZONE 'Europe/Amsterdam',
    'month_start', v_month, 'month_charged_cents', v_month_cost, 'month_provider_cost_usd', v_provider_cost,
    'month_provider_cost_unknown_count', v_unknown_cost, 'unresolved_requests', v_open, 'stale_requests', v_stale,
    'unreviewed_overrun_cents', v_overrun, 'ledger_difference_cents', v_org.balance_cents - v_ledger_balance,
    'reservation_difference_cents', v_org.reserved_cents - v_reserved, 'historical_unexplained_cents', v_historical,
    'budget_mode', v_org.credit_mode, 'budget_month', v_org.budget_month,
    'monthly_budget_cents', COALESCE(v_org.budget_limit_cents, 0),
    'month_remaining_cents', CASE WHEN v_org.credit_mode = 'monthly' THEN GREATEST(0, v_org.budget_limit_cents - v_month_cost) ELSE v_org.balance_cents END,
    'previous_period_reserved_cents', CASE WHEN v_org.credit_mode = 'monthly' THEN v_old_reserved ELSE 0 END,
    'previous_month_reserved_cents', CASE WHEN v_org.credit_mode = 'monthly' THEN v_old_reserved ELSE 0 END,
    'current_month_reserved_cents', CASE WHEN v_org.credit_mode = 'monthly' THEN v_reserved - v_old_reserved ELSE v_reserved END,
    'month_reset_at', v_org.last_budget_reset_at);
END;
$$;

-- Existing public RPC signatures and privileges are unchanged; the private refresh
-- is callable only from these already-authorized SECURITY DEFINER entry points.
COMMENT ON FUNCTION public.grant_monthly_ai_credits(timestamptz, uuid) IS 'Compatibility RPC name: reset the current calendar-month cap once; never add rollover or catch-up allowances.';
COMMENT ON FUNCTION public.get_ai_credit_summary(uuid) IS 'Authorized accounting read that first synchronizes the current monthly budget atomically; intentionally VOLATILE.';
COMMIT;
