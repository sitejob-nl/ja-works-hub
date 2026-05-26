-- Loyalty tables store candidate_id, while get_employee_id() returns employees.id.
-- Use a dedicated helper for self-service portal policies and reward redemption.
CREATE OR REPLACE FUNCTION public.get_employee_candidate_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, extensions, vault, pg_temp
AS $$
  SELECT candidate_id FROM employees WHERE auth_user_id = auth.uid()
$$;

REVOKE EXECUTE ON FUNCTION public.get_employee_candidate_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_employee_candidate_id() TO authenticated, service_role;

DROP POLICY IF EXISTS loyalty_accounts_select ON public.loyalty_accounts;
CREATE POLICY loyalty_accounts_select ON public.loyalty_accounts FOR SELECT TO authenticated
  USING (
    organization_id = get_user_org_id()
    AND (
      get_user_role() IN ('admin'::user_role, 'intercedent'::user_role, 'backoffice'::user_role, 'finance'::user_role)
      OR candidate_id = get_employee_candidate_id()
    )
  );

DROP POLICY IF EXISTS loyalty_transactions_select ON public.loyalty_transactions;
CREATE POLICY loyalty_transactions_select ON public.loyalty_transactions FOR SELECT TO authenticated
  USING (
    organization_id = get_user_org_id()
    AND (
      get_user_role() IN ('admin'::user_role, 'intercedent'::user_role, 'backoffice'::user_role, 'finance'::user_role)
      OR candidate_id = get_employee_candidate_id()
    )
  );

DROP POLICY IF EXISTS reward_redemptions_select ON public.reward_redemptions;
CREATE POLICY reward_redemptions_select ON public.reward_redemptions FOR SELECT TO authenticated
  USING (
    organization_id = get_user_org_id()
    AND (
      get_user_role() IN ('admin'::user_role, 'intercedent'::user_role, 'backoffice'::user_role, 'finance'::user_role)
      OR candidate_id = get_employee_candidate_id()
    )
  );

CREATE OR REPLACE FUNCTION public.redeem_reward(p_reward_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_candidate uuid;
  v_account_id uuid;
  v_reward record;
  v_redemption_id uuid;
BEGIN
  v_org := get_user_org_id();
  v_candidate := get_employee_candidate_id();

  IF v_candidate IS NULL THEN
    RAISE EXCEPTION 'Geen medewerker gevonden';
  END IF;

  SELECT * INTO v_reward
  FROM public.reward_catalog
  WHERE id = p_reward_id
    AND organization_id = v_org
    AND is_active = true;

  IF v_reward.id IS NULL THEN
    RAISE EXCEPTION 'Reward niet beschikbaar';
  END IF;

  INSERT INTO public.loyalty_accounts (organization_id, candidate_id)
  VALUES (v_org, v_candidate)
  ON CONFLICT (organization_id, candidate_id) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_account_id;

  IF (SELECT balance_points FROM public.loyalty_accounts WHERE id = v_account_id) < v_reward.points_cost THEN
    RAISE EXCEPTION 'Onvoldoende punten';
  END IF;

  INSERT INTO public.reward_redemptions (
    organization_id, account_id, candidate_id, reward_id, points_cost
  ) VALUES (
    v_org, v_account_id, v_candidate, v_reward.id, v_reward.points_cost
  ) RETURNING id INTO v_redemption_id;

  INSERT INTO public.loyalty_transactions (
    organization_id, account_id, candidate_id, points, source, source_ref, description
  ) VALUES (
    v_org, v_account_id, v_candidate, -v_reward.points_cost, 'reward_redemption', v_redemption_id::text, 'Reward aangevraagd: ' || v_reward.name
  );

  UPDATE public.loyalty_accounts
  SET balance_points = balance_points - v_reward.points_cost,
      lifetime_spent_points = lifetime_spent_points + v_reward.points_cost,
      updated_at = now()
  WHERE id = v_account_id;

  RETURN v_redemption_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.redeem_reward(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_reward(uuid) TO authenticated;
