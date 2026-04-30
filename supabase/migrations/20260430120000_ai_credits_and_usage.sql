-- AI CV-analyse: provider-switch (VPS ↔ Cloud) + per-org credit-limiet
--
-- Dit voegt drie tabellen toe:
--   - organization_credits: 1-op-1 met organizations, balance + pricing
--   - ai_usage_log:         append-only audit van elke analyse (vps + cloud)
--   - credit_topups:        wie heeft wanneer hoeveel saldo bijgeschreven
--
-- En drie SECURITY DEFINER RPCs:
--   - peek_credit_balance(org)        — read-only
--   - consume_ai_credits(org, cents)  — atomic decrement met SELECT FOR UPDATE
--   - topup_ai_credits(org, cents, n) — superadmin-only, schrijft in topups + balance

BEGIN;

-- =========================================================================
-- organization_credits
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.organization_credits (
  organization_id uuid PRIMARY KEY
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  balance_cents integer NOT NULL DEFAULT 5000,
  lifetime_topped_up_cents integer NOT NULL DEFAULT 5000,
  pricing_input_cents_per_mtok integer NOT NULL DEFAULT 270,
  pricing_output_cents_per_mtok integer NOT NULL DEFAULT 1350,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.organization_credits IS
  'Per-organisatie credit-saldo voor betaalde AI-features (Cloud-CV-analyse). €50 starter.';
COMMENT ON COLUMN public.organization_credits.balance_cents IS
  'Resterend saldo in eurocenten. 5000 = €50,00.';
COMMENT ON COLUMN public.organization_credits.lifetime_topped_up_cents IS
  'Totaal ooit toegekend (inclusief starter-bonus). Voor reporting.';
COMMENT ON COLUMN public.organization_credits.pricing_input_cents_per_mtok IS
  'Prijs per 1M input-tokens in eurocenten. Default Haiku 4.5 met ~2.5x marge.';
COMMENT ON COLUMN public.organization_credits.pricing_output_cents_per_mtok IS
  'Prijs per 1M output-tokens in eurocenten. Default Haiku 4.5 met ~2.5x marge.';

ALTER TABLE public.organization_credits ENABLE ROW LEVEL SECURITY;

-- SELECT: org-admin van eigen org + superadmins
CREATE POLICY "credits_select_own_or_super" ON public.organization_credits
  FOR SELECT TO authenticated
  USING (
    public.is_superadmin()
    OR (organization_id = public.get_user_org_id() AND public.get_user_role() = 'admin')
  );

-- INSERT/UPDATE/DELETE: nooit direct, alleen via SECURITY DEFINER RPCs
-- (geen policies = geblokkeerd)

-- =========================================================================
-- ai_usage_log
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.ai_usage_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  feature text NOT NULL DEFAULT 'cv_analysis',
  provider text NOT NULL CHECK (provider IN ('vps', 'cloud')),
  model text,
  input_tokens integer,
  output_tokens integer,
  cost_cents integer NOT NULL DEFAULT 0,
  candidate_id uuid REFERENCES public.candidates(id) ON DELETE SET NULL,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ai_usage_log IS
  'Append-only audit van AI-analyses. VPS-rijen hebben cost_cents=0, Cloud-rijen hebben werkelijke kosten.';

CREATE INDEX IF NOT EXISTS ai_usage_log_org_created_idx
  ON public.ai_usage_log(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_log_candidate_idx
  ON public.ai_usage_log(candidate_id) WHERE candidate_id IS NOT NULL;

ALTER TABLE public.ai_usage_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "usage_select_own_or_super" ON public.ai_usage_log
  FOR SELECT TO authenticated
  USING (
    public.is_superadmin()
    OR organization_id = public.get_user_org_id()
  );

-- INSERT alleen via service-role (edge functions). Geen authenticated INSERT-policy.

-- =========================================================================
-- credit_topups
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.credit_topups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL CHECK (amount_cents <> 0),
  superadmin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.credit_topups IS
  'Audit van credit-bijschrijvingen door superadmins. Negatieve bedragen toegestaan voor correcties.';

CREATE INDEX IF NOT EXISTS credit_topups_org_created_idx
  ON public.credit_topups(organization_id, created_at DESC);

ALTER TABLE public.credit_topups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "topups_select_own_or_super" ON public.credit_topups
  FOR SELECT TO authenticated
  USING (
    public.is_superadmin()
    OR organization_id = public.get_user_org_id()
  );

-- =========================================================================
-- Trigger: bij INSERT van een nieuwe organisatie automatisch credits-rij
-- =========================================================================
CREATE OR REPLACE FUNCTION public.create_org_credits_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.organization_credits (organization_id)
  VALUES (NEW.id)
  ON CONFLICT (organization_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organizations_create_credits ON public.organizations;
CREATE TRIGGER organizations_create_credits
  AFTER INSERT ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.create_org_credits_row();

-- Backfill bestaande organisaties (€50 starter elk)
INSERT INTO public.organization_credits (organization_id)
SELECT id FROM public.organizations
ON CONFLICT (organization_id) DO NOTHING;

-- =========================================================================
-- RPC: peek_credit_balance
-- =========================================================================
CREATE OR REPLACE FUNCTION public.peek_credit_balance(p_org_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance integer;
BEGIN
  IF NOT (public.is_superadmin() OR p_org_id = public.get_user_org_id()) THEN
    RAISE EXCEPTION 'Geen toegang tot credit-saldo van deze organisatie';
  END IF;

  SELECT balance_cents INTO v_balance
  FROM public.organization_credits
  WHERE organization_id = p_org_id;

  RETURN COALESCE(v_balance, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.peek_credit_balance(uuid) TO authenticated;

-- =========================================================================
-- RPC: consume_ai_credits — atomic decrement met SELECT FOR UPDATE
-- =========================================================================
-- Returnt new_balance_cents (niet balance_cents) om naam-collision met de tabelkolom
-- in het UPDATE-statement te vermijden.
CREATE OR REPLACE FUNCTION public.consume_ai_credits(
  p_org_id uuid,
  p_amount_cents integer
)
RETURNS TABLE(ok boolean, new_balance_cents integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance integer;
BEGIN
  IF p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'amount_cents moet > 0 zijn';
  END IF;

  -- Lock de rij om race-condities tussen parallelle calls te voorkomen
  SELECT oc.balance_cents INTO v_balance
  FROM public.organization_credits oc
  WHERE oc.organization_id = p_org_id
  FOR UPDATE;

  IF v_balance IS NULL THEN
    -- Geen credits-rij: maak aan met 0 saldo en weiger
    INSERT INTO public.organization_credits (organization_id, balance_cents, lifetime_topped_up_cents)
    VALUES (p_org_id, 0, 0)
    ON CONFLICT (organization_id) DO NOTHING;
    RETURN QUERY SELECT false, 0;
    RETURN;
  END IF;

  IF v_balance < p_amount_cents THEN
    RETURN QUERY SELECT false, v_balance;
    RETURN;
  END IF;

  UPDATE public.organization_credits AS oc
  SET balance_cents = oc.balance_cents - p_amount_cents,
      updated_at = now()
  WHERE oc.organization_id = p_org_id;

  RETURN QUERY SELECT true, v_balance - p_amount_cents;
END;
$$;

-- Alleen service-role mag credits afschrijven (edge functions). Geen GRANT aan authenticated.
REVOKE ALL ON FUNCTION public.consume_ai_credits(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_ai_credits(uuid, integer) TO service_role;

-- =========================================================================
-- RPC: topup_ai_credits — superadmin-only
-- =========================================================================
CREATE OR REPLACE FUNCTION public.topup_ai_credits(
  p_org_id uuid,
  p_amount_cents integer,
  p_note text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_balance integer;
BEGIN
  IF NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'Alleen superadmins kunnen saldo bijschrijven';
  END IF;

  IF p_amount_cents = 0 THEN
    RAISE EXCEPTION 'amount_cents mag niet 0 zijn';
  END IF;

  -- Zorg dat er een credits-rij is (defensief — trigger maakt die normaal aan)
  INSERT INTO public.organization_credits (organization_id)
  VALUES (p_org_id)
  ON CONFLICT (organization_id) DO NOTHING;

  UPDATE public.organization_credits
  SET balance_cents = balance_cents + p_amount_cents,
      lifetime_topped_up_cents = CASE
        WHEN p_amount_cents > 0 THEN lifetime_topped_up_cents + p_amount_cents
        ELSE lifetime_topped_up_cents
      END,
      updated_at = now()
  WHERE organization_id = p_org_id
  RETURNING balance_cents INTO v_new_balance;

  INSERT INTO public.credit_topups (organization_id, amount_cents, superadmin_id, note)
  VALUES (p_org_id, p_amount_cents, auth.uid(), p_note);

  RETURN v_new_balance;
END;
$$;

GRANT EXECUTE ON FUNCTION public.topup_ai_credits(uuid, integer, text) TO authenticated;

COMMIT;
