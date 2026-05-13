-- Open meeting follow-up: birthdays/loyalty, fiscal mileage warnings,
-- internal damage routing, and legal template readiness.

BEGIN;

-- ---------------------------------------------------------------------
-- Engagement / loyalty / reward shop MVP.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.loyalty_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  balance_points integer NOT NULL DEFAULT 0 CHECK (balance_points >= 0),
  lifetime_earned_points integer NOT NULL DEFAULT 0 CHECK (lifetime_earned_points >= 0),
  lifetime_spent_points integer NOT NULL DEFAULT 0 CHECK (lifetime_spent_points >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, candidate_id)
);

CREATE TABLE IF NOT EXISTS public.loyalty_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.loyalty_accounts(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  points integer NOT NULL CHECK (points <> 0),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('birthday_bonus', 'manual_adjustment', 'reward_redemption', 'import', 'system')),
  source_ref text,
  description text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_loyalty_transactions_unique_source_ref
  ON public.loyalty_transactions (organization_id, candidate_id, source, source_ref)
  WHERE source_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_loyalty_transactions_candidate_created
  ON public.loyalty_transactions (candidate_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.reward_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  points_cost integer NOT NULL CHECK (points_cost > 0),
  image_url text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reward_catalog_org_active_sort
  ON public.reward_catalog (organization_id, is_active, sort_order, name);

CREATE TABLE IF NOT EXISTS public.reward_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.loyalty_accounts(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  reward_id uuid NOT NULL REFERENCES public.reward_catalog(id) ON DELETE RESTRICT,
  points_cost integer NOT NULL CHECK (points_cost > 0),
  status text NOT NULL DEFAULT 'aangevraagd' CHECK (status IN ('aangevraagd', 'goedgekeurd', 'uitgegeven', 'geannuleerd')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  fulfilled_at timestamptz,
  handled_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reward_redemptions_org_status
  ON public.reward_redemptions (organization_id, status, requested_at DESC);

CREATE TABLE IF NOT EXISTS public.birthday_campaign_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  birthday_date date NOT NULL,
  email_template_id uuid REFERENCES public.email_templates(id) ON DELETE SET NULL,
  notification_id uuid REFERENCES public.employee_notifications(id) ON DELETE SET NULL,
  loyalty_transaction_id uuid REFERENCES public.loyalty_transactions(id) ON DELETE SET NULL,
  communication_id uuid REFERENCES public.communications(id) ON DELETE SET NULL,
  points_awarded integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'skipped', 'failed')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, candidate_id, birthday_date)
);

-- ---------------------------------------------------------------------
-- Fiscal mileage warning/review flow. No tax/payroll enforcement.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.fiscal_mileage_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  candidate_id uuid REFERENCES public.candidates(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  placement_id uuid REFERENCES public.placements(id) ON DELETE SET NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  actual_total_km numeric(10,2) NOT NULL DEFAULT 0,
  actual_private_km numeric(10,2) NOT NULL DEFAULT 0,
  actual_business_km numeric(10,2) NOT NULL DEFAULT 0,
  expected_business_km numeric(10,2),
  business_margin_pct numeric(5,2) NOT NULL DEFAULT 15,
  private_allowance_km numeric(10,2) NOT NULL DEFAULT 300,
  excess_km numeric(10,2) NOT NULL DEFAULT 0,
  reason text NOT NULL CHECK (reason IN ('business_above_margin', 'private_above_allowance', 'missing_expected_km', 'manual_review')),
  severity text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'urgent')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'verklaard', 'geaccepteerd', 'actie_nodig')),
  explanation text,
  source_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fiscal_mileage_reviews_org_period_status
  ON public.fiscal_mileage_reviews (organization_id, period_start DESC, period_end DESC, status);

CREATE INDEX IF NOT EXISTS idx_fiscal_mileage_reviews_candidate_period
  ON public.fiscal_mileage_reviews (candidate_id, period_start DESC)
  WHERE candidate_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- Damage routing and contact privacy.
-- ---------------------------------------------------------------------
ALTER TABLE public.vehicle_damage_reports
  ADD COLUMN IF NOT EXISTS contact_route text NOT NULL DEFAULT 'internal_fleet',
  ADD COLUMN IF NOT EXISTS route_status text NOT NULL DEFAULT 'pending_internal',
  ADD COLUMN IF NOT EXISTS urgency text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS internal_contact_email text,
  ADD COLUMN IF NOT EXISTS external_contact_email text,
  ADD COLUMN IF NOT EXISTS contact_phone_shared boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vehicle_damage_reports_contact_route_check'
      AND conrelid = 'public.vehicle_damage_reports'::regclass
  ) THEN
    ALTER TABLE public.vehicle_damage_reports
      ADD CONSTRAINT vehicle_damage_reports_contact_route_check
      CHECK (contact_route IN ('internal_fleet', 'external_garage', 'category_based'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vehicle_damage_reports_route_status_check'
      AND conrelid = 'public.vehicle_damage_reports'::regclass
  ) THEN
    ALTER TABLE public.vehicle_damage_reports
      ADD CONSTRAINT vehicle_damage_reports_route_status_check
      CHECK (route_status IN ('pending_internal', 'internal_notified', 'forwarded_external', 'closed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vehicle_damage_reports_urgency_check'
      AND conrelid = 'public.vehicle_damage_reports'::regclass
  ) THEN
    ALTER TABLE public.vehicle_damage_reports
      ADD CONSTRAINT vehicle_damage_reports_urgency_check
      CHECK (urgency IN ('normal', 'urgent'));
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- Legal template readiness.
-- ---------------------------------------------------------------------
ALTER TABLE public.contract_templates
  ADD COLUMN IF NOT EXISTS template_type text NOT NULL DEFAULT 'employment_contract',
  ADD COLUMN IF NOT EXISTS template_status text NOT NULL DEFAULT 'concept',
  ADD COLUMN IF NOT EXISTS is_placeholder boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.contract_templates
  DROP CONSTRAINT IF EXISTS contract_templates_template_type_check;

ALTER TABLE public.contract_templates
  ADD CONSTRAINT contract_templates_template_type_check
  CHECK (template_type IN (
    'employment_contract',
    'placement_confirmation',
    'placement_confirmation_client',
    'placement_confirmation_employee',
    'general_terms',
    'housing_inhuur',
    'housing_onderhuur',
    'house_rules',
    'vehicle_agreement'
  ));

ALTER TABLE public.contract_templates
  DROP CONSTRAINT IF EXISTS contract_templates_template_status_check;

ALTER TABLE public.contract_templates
  ADD CONSTRAINT contract_templates_template_status_check
  CHECK (template_status IN ('concept', 'klaar_voor_review', 'actief'));

UPDATE public.contract_templates
SET template_status = 'actief'
WHERE is_active = true
  AND is_placeholder = false
  AND template_status = 'concept';

UPDATE public.contract_templates
SET is_active = false
WHERE is_placeholder = true;

CREATE INDEX IF NOT EXISTS idx_contract_templates_org_type_status
  ON public.contract_templates (organization_id, template_type, template_status, is_active);

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS template_version_id uuid REFERENCES public.contract_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS template_version_name text,
  ADD COLUMN IF NOT EXISTS template_version_status text,
  ADD COLUMN IF NOT EXISTS legal_document_type text;

-- ---------------------------------------------------------------------
-- Default organization settings.
-- ---------------------------------------------------------------------
UPDATE public.organizations
SET settings = coalesce(settings, '{}'::jsonb)
  || jsonb_build_object(
    'engagement_settings',
    coalesce(
      settings->'engagement_settings',
      jsonb_build_object(
        'birthday_enabled', true,
        'birthday_send_time', '07:00',
        'birthday_bonus_points', 120,
        'birthday_email_enabled', true,
        'birthday_push_enabled', true,
        'birthday_email_template_id', null,
        'birthday_subject', 'Gefeliciteerd {{voornaam}}!',
        'birthday_message', 'Van harte gefeliciteerd met je verjaardag. We hebben {{punten}} punten voor je klaargezet in je portaal.'
      )
    ),
    'fiscal_mileage_policy',
    coalesce(
      settings->'fiscal_mileage_policy',
      jsonb_build_object(
        'analysis_enabled', true,
        'business_margin_pct', 15,
        'monthly_private_allowance_km', 300,
        'warning_text', 'Deze analyse is alleen een signaal en geen fiscale conclusie.'
      )
    ),
    'damage_contact_settings',
    coalesce(
      settings->'damage_contact_settings',
      jsonb_build_object(
        'contact_route', 'internal_fleet',
        'internal_email', null,
        'show_driver_contact_to_roles', jsonb_build_array('admin', 'backoffice'),
        'share_driver_phone_externally', false
      )
    )
  );

-- ---------------------------------------------------------------------
-- RLS policies.
-- ---------------------------------------------------------------------
ALTER TABLE public.loyalty_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reward_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reward_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.birthday_campaign_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscal_mileage_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS loyalty_accounts_select ON public.loyalty_accounts;
CREATE POLICY loyalty_accounts_select ON public.loyalty_accounts FOR SELECT TO authenticated
  USING (
    organization_id = get_user_org_id()
    AND (
      get_user_role() IN ('admin'::user_role, 'intercedent'::user_role, 'backoffice'::user_role, 'finance'::user_role)
      OR candidate_id = get_employee_id()
    )
  );

DROP POLICY IF EXISTS loyalty_accounts_internal_write ON public.loyalty_accounts;
CREATE POLICY loyalty_accounts_internal_write ON public.loyalty_accounts FOR ALL TO authenticated
  USING (organization_id = get_user_org_id() AND get_user_role() IN ('admin'::user_role, 'backoffice'::user_role, 'finance'::user_role))
  WITH CHECK (organization_id = get_user_org_id() AND get_user_role() IN ('admin'::user_role, 'backoffice'::user_role, 'finance'::user_role));

DROP POLICY IF EXISTS loyalty_transactions_select ON public.loyalty_transactions;
CREATE POLICY loyalty_transactions_select ON public.loyalty_transactions FOR SELECT TO authenticated
  USING (
    organization_id = get_user_org_id()
    AND (
      get_user_role() IN ('admin'::user_role, 'intercedent'::user_role, 'backoffice'::user_role, 'finance'::user_role)
      OR candidate_id = get_employee_id()
    )
  );

DROP POLICY IF EXISTS loyalty_transactions_internal_write ON public.loyalty_transactions;
CREATE POLICY loyalty_transactions_internal_write ON public.loyalty_transactions FOR ALL TO authenticated
  USING (organization_id = get_user_org_id() AND get_user_role() IN ('admin'::user_role, 'backoffice'::user_role, 'finance'::user_role))
  WITH CHECK (organization_id = get_user_org_id() AND get_user_role() IN ('admin'::user_role, 'backoffice'::user_role, 'finance'::user_role));

DROP POLICY IF EXISTS reward_catalog_select ON public.reward_catalog;
CREATE POLICY reward_catalog_select ON public.reward_catalog FOR SELECT TO authenticated
  USING (
    organization_id = get_user_org_id()
    AND (
      get_user_role() IN ('admin'::user_role, 'intercedent'::user_role, 'backoffice'::user_role, 'finance'::user_role)
      OR is_active = true
    )
  );

DROP POLICY IF EXISTS reward_catalog_internal_write ON public.reward_catalog;
CREATE POLICY reward_catalog_internal_write ON public.reward_catalog FOR ALL TO authenticated
  USING (organization_id = get_user_org_id() AND get_user_role() IN ('admin'::user_role, 'backoffice'::user_role, 'finance'::user_role))
  WITH CHECK (organization_id = get_user_org_id() AND get_user_role() IN ('admin'::user_role, 'backoffice'::user_role, 'finance'::user_role));

DROP POLICY IF EXISTS reward_redemptions_select ON public.reward_redemptions;
CREATE POLICY reward_redemptions_select ON public.reward_redemptions FOR SELECT TO authenticated
  USING (
    organization_id = get_user_org_id()
    AND (
      get_user_role() IN ('admin'::user_role, 'intercedent'::user_role, 'backoffice'::user_role, 'finance'::user_role)
      OR candidate_id = get_employee_id()
    )
  );

DROP POLICY IF EXISTS reward_redemptions_internal_update ON public.reward_redemptions;
CREATE POLICY reward_redemptions_internal_update ON public.reward_redemptions FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id() AND get_user_role() IN ('admin'::user_role, 'backoffice'::user_role, 'finance'::user_role))
  WITH CHECK (organization_id = get_user_org_id() AND get_user_role() IN ('admin'::user_role, 'backoffice'::user_role, 'finance'::user_role));

DROP POLICY IF EXISTS birthday_campaign_logs_internal_select ON public.birthday_campaign_logs;
CREATE POLICY birthday_campaign_logs_internal_select ON public.birthday_campaign_logs FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id() AND get_user_role() IN ('admin'::user_role, 'intercedent'::user_role, 'backoffice'::user_role, 'finance'::user_role));

DROP POLICY IF EXISTS fiscal_mileage_reviews_internal_all ON public.fiscal_mileage_reviews;
CREATE POLICY fiscal_mileage_reviews_internal_all ON public.fiscal_mileage_reviews FOR ALL TO authenticated
  USING (organization_id = get_user_org_id() AND get_user_role() IN ('admin'::user_role, 'backoffice'::user_role, 'finance'::user_role))
  WITH CHECK (organization_id = get_user_org_id() AND get_user_role() IN ('admin'::user_role, 'backoffice'::user_role, 'finance'::user_role));

DROP POLICY IF EXISTS employee_notifications_self_read ON public.employee_notifications;
CREATE POLICY employee_notifications_self_read ON public.employee_notifications FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id() AND candidate_id = get_employee_id());

-- ---------------------------------------------------------------------
-- Loyalty RPCs.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_adjust_loyalty_points(
  p_candidate_id uuid,
  p_points integer,
  p_description text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_role user_role;
  v_account_id uuid;
  v_tx_id uuid;
BEGIN
  v_org := get_user_org_id();
  v_role := get_user_role();

  IF v_role NOT IN ('admin'::user_role, 'backoffice'::user_role, 'finance'::user_role) THEN
    RAISE EXCEPTION 'Onvoldoende rechten';
  END IF;

  IF p_points = 0 THEN
    RAISE EXCEPTION 'Puntenmutatie mag niet 0 zijn';
  END IF;

  INSERT INTO public.loyalty_accounts (organization_id, candidate_id)
  VALUES (v_org, p_candidate_id)
  ON CONFLICT (organization_id, candidate_id) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_account_id;

  IF p_points < 0 AND (
    SELECT balance_points FROM public.loyalty_accounts WHERE id = v_account_id
  ) + p_points < 0 THEN
    RAISE EXCEPTION 'Onvoldoende punten';
  END IF;

  INSERT INTO public.loyalty_transactions (
    organization_id, account_id, candidate_id, points, source, description, created_by
  ) VALUES (
    v_org, v_account_id, p_candidate_id, p_points, 'manual_adjustment', coalesce(nullif(trim(p_description), ''), 'Handmatige correctie'), auth.uid()
  ) RETURNING id INTO v_tx_id;

  UPDATE public.loyalty_accounts
  SET balance_points = balance_points + p_points,
      lifetime_earned_points = lifetime_earned_points + greatest(p_points, 0),
      lifetime_spent_points = lifetime_spent_points + greatest(-p_points, 0),
      updated_at = now()
  WHERE id = v_account_id;

  RETURN v_tx_id;
END;
$$;

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
  v_candidate := get_employee_id();

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

REVOKE EXECUTE ON FUNCTION public.admin_adjust_loyalty_points(uuid, integer, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.redeem_reward(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_adjust_loyalty_points(uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_reward(uuid) TO authenticated;

DROP TRIGGER IF EXISTS handle_loyalty_accounts_updated_at ON public.loyalty_accounts;
CREATE TRIGGER handle_loyalty_accounts_updated_at
  BEFORE UPDATE ON public.loyalty_accounts
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

DROP TRIGGER IF EXISTS handle_reward_catalog_updated_at ON public.reward_catalog;
CREATE TRIGGER handle_reward_catalog_updated_at
  BEFORE UPDATE ON public.reward_catalog
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

DROP TRIGGER IF EXISTS handle_reward_redemptions_updated_at ON public.reward_redemptions;
CREATE TRIGGER handle_reward_redemptions_updated_at
  BEFORE UPDATE ON public.reward_redemptions
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

DROP TRIGGER IF EXISTS handle_fiscal_mileage_reviews_updated_at ON public.fiscal_mileage_reviews;
CREATE TRIGGER handle_fiscal_mileage_reviews_updated_at
  BEFORE UPDATE ON public.fiscal_mileage_reviews
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- Hourly birthday campaign trigger. The edge function filters per
-- organization by local Europe/Amsterdam `birthday_send_time` and remains
-- idempotent through birthday_campaign_logs.
SELECT cron.schedule(
  'birthday-loyalty-daily',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://noaupcteygfvlyymqtew.supabase.co/functions/v1/birthday-loyalty-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', current_setting('app.cron_secret', true)
    ),
    body := jsonb_build_object('mode', 'cron')
  ) AS request_id;
  $$
);

COMMIT;
