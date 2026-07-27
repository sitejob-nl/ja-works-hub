-- Financiële zichtbaarheid gelijktrekken met de 'finance.view'-rechtensleutel.
--
-- Aanleiding: loonstroken, jaaropgaven, inhoudingen en tariefafspraken stonden
-- alleen op is_internal_user(), waardoor élke interne rol (ook intercedent) ze
-- via de API kon lezen terwijl /uren, /facturatie en /omzet wél op finance.view
-- zitten. Daarnaast stonden de tankpas-transacties op {public} met alleen een
-- org-check: portaalrollen (medewerker/opdrachtgever) konden ze lezen én
-- schrijven.
--
-- has_role_permission() geeft true voor admin, respecteert de per-org matrix in
-- organizations.settings.role_permissions en de per-gebruiker overrides, en
-- faalt gesloten voor facility en de portaalrollen.
--
-- Portaalpolicies (payslips_employee_read / annual_statements_employee_read)
-- blijven ongemoeid: een medewerker houdt toegang tot zijn eigen loonstrook.

-- ── Loonstroken ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS payslips_internal_select ON public.payslips;
CREATE POLICY payslips_internal_select ON public.payslips
  FOR SELECT TO authenticated
  USING (
    organization_id = (SELECT public.get_user_org_id())
    AND (SELECT public.is_internal_user())
    AND (SELECT public.has_role_permission('finance.view'))
  );

DROP POLICY IF EXISTS payslips_internal_insert ON public.payslips;
CREATE POLICY payslips_internal_insert ON public.payslips
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = (SELECT public.get_user_org_id())
    AND (SELECT public.is_internal_user())
    AND (SELECT public.has_role_permission('finance.view'))
  );

DROP POLICY IF EXISTS payslips_internal_update ON public.payslips;
CREATE POLICY payslips_internal_update ON public.payslips
  FOR UPDATE TO authenticated
  USING (
    organization_id = (SELECT public.get_user_org_id())
    AND (SELECT public.is_internal_user())
    AND (SELECT public.has_role_permission('finance.view'))
  )
  WITH CHECK (
    organization_id = (SELECT public.get_user_org_id())
    AND (SELECT public.is_internal_user())
    AND (SELECT public.has_role_permission('finance.view'))
  );

DROP POLICY IF EXISTS payslips_internal_delete ON public.payslips;
CREATE POLICY payslips_internal_delete ON public.payslips
  FOR DELETE TO authenticated
  USING (
    organization_id = (SELECT public.get_user_org_id())
    AND (SELECT public.is_internal_user())
    AND (SELECT public.has_role_permission('finance.view'))
  );

-- ── Jaaropgaven ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS annual_statements_internal_select ON public.annual_statements;
CREATE POLICY annual_statements_internal_select ON public.annual_statements
  FOR SELECT TO authenticated
  USING (
    organization_id = (SELECT public.get_user_org_id())
    AND (SELECT public.is_internal_user())
    AND (SELECT public.has_role_permission('finance.view'))
  );

DROP POLICY IF EXISTS annual_statements_internal_insert ON public.annual_statements;
CREATE POLICY annual_statements_internal_insert ON public.annual_statements
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = (SELECT public.get_user_org_id())
    AND (SELECT public.is_internal_user())
    AND (SELECT public.has_role_permission('finance.view'))
  );

DROP POLICY IF EXISTS annual_statements_internal_update ON public.annual_statements;
CREATE POLICY annual_statements_internal_update ON public.annual_statements
  FOR UPDATE TO authenticated
  USING (
    organization_id = (SELECT public.get_user_org_id())
    AND (SELECT public.is_internal_user())
    AND (SELECT public.has_role_permission('finance.view'))
  )
  WITH CHECK (
    organization_id = (SELECT public.get_user_org_id())
    AND (SELECT public.is_internal_user())
    AND (SELECT public.has_role_permission('finance.view'))
  );

DROP POLICY IF EXISTS annual_statements_internal_delete ON public.annual_statements;
CREATE POLICY annual_statements_internal_delete ON public.annual_statements
  FOR DELETE TO authenticated
  USING (
    organization_id = (SELECT public.get_user_org_id())
    AND (SELECT public.is_internal_user())
    AND (SELECT public.has_role_permission('finance.view'))
  );

-- ── Inhoudingen ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS employee_deductions_internal_all ON public.employee_deductions;
CREATE POLICY employee_deductions_internal_all ON public.employee_deductions
  FOR ALL TO authenticated
  USING (
    organization_id = (SELECT public.get_user_org_id())
    AND (SELECT public.is_internal_user())
    AND (SELECT public.has_role_permission('finance.view'))
  )
  WITH CHECK (
    organization_id = (SELECT public.get_user_org_id())
    AND (SELECT public.is_internal_user())
    AND (SELECT public.has_role_permission('finance.view'))
  );

-- ── Tariefafspraken ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS tenant_select ON public.rate_agreements;
CREATE POLICY tenant_select ON public.rate_agreements
  FOR SELECT TO authenticated
  USING (
    organization_id = (SELECT public.get_user_org_id())
    AND (SELECT public.is_internal_user())
    AND (SELECT public.has_role_permission('finance.view'))
  );

DROP POLICY IF EXISTS tenant_insert ON public.rate_agreements;
CREATE POLICY tenant_insert ON public.rate_agreements
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = (SELECT public.get_user_org_id())
    AND (SELECT public.is_internal_user())
    AND (SELECT public.has_role_permission('finance.view'))
  );

DROP POLICY IF EXISTS tenant_update ON public.rate_agreements;
CREATE POLICY tenant_update ON public.rate_agreements
  FOR UPDATE TO authenticated
  USING (
    organization_id = (SELECT public.get_user_org_id())
    AND (SELECT public.is_internal_user())
    AND (SELECT public.has_role_permission('finance.view'))
  )
  WITH CHECK (
    organization_id = (SELECT public.get_user_org_id())
    AND (SELECT public.is_internal_user())
    AND (SELECT public.has_role_permission('finance.view'))
  );

-- ── Tankpastransacties ─────────────────────────────────────────────────────
-- Deze stonden op {public} met enkel een org-check: elke ingelogde gebruiker met
-- een profiel in de org (dus ook medewerker- en opdrachtgeverportaal) kon ze
-- lezen, muteren en verwijderen. Gate op is_internal_user(): de kosten per
-- voertuig horen bij het wagenparkbeheer (Transport / voertuigdetail), dus
-- bewust géén finance.view — anders verliest de intercedent het tankpas-tabblad
-- op het voertuig. De analysepagina's blijven op finance.view via de route.
DROP POLICY IF EXISTS fuel_card_transactions_select_policy ON public.fuel_card_transactions;
CREATE POLICY fuel_card_transactions_select_policy ON public.fuel_card_transactions
  FOR SELECT TO authenticated
  USING (
    organization_id = (SELECT public.get_user_org_id())
    AND (SELECT public.is_internal_user())
  );

DROP POLICY IF EXISTS fuel_card_transactions_insert_policy ON public.fuel_card_transactions;
CREATE POLICY fuel_card_transactions_insert_policy ON public.fuel_card_transactions
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = (SELECT public.get_user_org_id())
    AND (SELECT public.is_internal_user())
  );

DROP POLICY IF EXISTS fuel_card_transactions_update_policy ON public.fuel_card_transactions;
CREATE POLICY fuel_card_transactions_update_policy ON public.fuel_card_transactions
  FOR UPDATE TO authenticated
  USING (
    organization_id = (SELECT public.get_user_org_id())
    AND (SELECT public.is_internal_user())
  )
  WITH CHECK (
    organization_id = (SELECT public.get_user_org_id())
    AND (SELECT public.is_internal_user())
  );

DROP POLICY IF EXISTS fuel_card_transactions_delete_policy ON public.fuel_card_transactions;
CREATE POLICY fuel_card_transactions_delete_policy ON public.fuel_card_transactions
  FOR DELETE TO authenticated
  USING (
    organization_id = (SELECT public.get_user_org_id())
    AND (SELECT public.is_internal_user())
  );
