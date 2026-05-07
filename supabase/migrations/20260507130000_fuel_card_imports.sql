-- Tracking-tabel voor Q8/CSV imports met file-hash voor duplicate-detectie.
-- ON DELETE op fuel_card_imports cascade via app-code (twee-staps delete:
-- eerst fuel_card_transactions, dan fuel_card_imports).

CREATE TABLE IF NOT EXISTS public.fuel_card_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  file_hash text NOT NULL,
  file_name text,
  transaction_count integer NOT NULL DEFAULT 0,
  total_liters numeric(10, 2) NOT NULL DEFAULT 0,
  total_amount_eur numeric(12, 2) NOT NULL DEFAULT 0,
  period_start date,
  period_end date,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, file_hash)
);

CREATE INDEX IF NOT EXISTS idx_fuel_card_imports_org_created
  ON public.fuel_card_imports (organization_id, created_at DESC);

ALTER TABLE public.fuel_card_imports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select ON public.fuel_card_imports;
CREATE POLICY tenant_select ON public.fuel_card_imports
  FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id());

DROP POLICY IF EXISTS tenant_insert ON public.fuel_card_imports;
CREATE POLICY tenant_insert ON public.fuel_card_imports
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org_id());

DROP POLICY IF EXISTS tenant_update ON public.fuel_card_imports;
CREATE POLICY tenant_update ON public.fuel_card_imports
  FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id());

DROP POLICY IF EXISTS tenant_delete ON public.fuel_card_imports;
CREATE POLICY tenant_delete ON public.fuel_card_imports
  FOR DELETE TO authenticated
  USING (organization_id = get_user_org_id() AND get_user_role() IN ('admin', 'finance', 'backoffice'));
