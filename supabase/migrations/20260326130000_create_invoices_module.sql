-- Invoice status enum
CREATE TYPE public.invoice_status AS ENUM ('concept', 'definitief', 'verzonden', 'betaald', 'gecrediteerd');

-- Invoices (facturen naar opdrachtgevers)
CREATE TABLE public.invoices (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE RESTRICT,
  invoice_number text NOT NULL,
  status public.invoice_status NOT NULL DEFAULT 'concept',
  period_start date NOT NULL,
  period_end date NOT NULL,
  invoice_date date NOT NULL DEFAULT CURRENT_DATE,
  due_date date,
  subtotal numeric NOT NULL DEFAULT 0,
  vat_rate numeric NOT NULL DEFAULT 21,
  vat_amount numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  paid_amount numeric NOT NULL DEFAULT 0,
  paid_at timestamptz,
  reference text,
  notes text,
  pdf_url text,
  exact_invoice_id text,
  created_by uuid REFERENCES auth.users(id),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, invoice_number)
);

-- Invoice lines (factuurregels per plaatsing/medewerker)
CREATE TABLE public.invoice_lines (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  placement_id uuid REFERENCES public.placements(id) ON DELETE SET NULL,
  employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  description text NOT NULL,
  hours numeric NOT NULL DEFAULT 0,
  overtime_hours numeric NOT NULL DEFAULT 0,
  hourly_rate numeric NOT NULL DEFAULT 0,
  overtime_rate numeric NOT NULL DEFAULT 0,
  travel_amount numeric NOT NULL DEFAULT 0,
  allowances_amount numeric NOT NULL DEFAULT 0,
  surcharge_amount numeric NOT NULL DEFAULT 0,
  line_total numeric NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.timesheets
  ADD COLUMN IF NOT EXISTS invoice_line_id uuid REFERENCES public.invoice_lines(id) ON DELETE SET NULL;

CREATE TABLE public.invoice_sequences (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  prefix text NOT NULL DEFAULT 'JW',
  next_number integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.next_invoice_number(org_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE seq record; year_suffix text; num text;
BEGIN
  year_suffix := to_char(now(), 'YYYY');
  INSERT INTO public.invoice_sequences (organization_id) VALUES (org_id) ON CONFLICT (organization_id) DO NOTHING;
  UPDATE public.invoice_sequences SET next_number = next_number + 1, updated_at = now()
    WHERE organization_id = org_id RETURNING * INTO seq;
  num := lpad((seq.next_number - 1)::text, 4, '0');
  RETURN seq.prefix || '-' || year_suffix || '-' || num;
END; $$;

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_select" ON public.invoices FOR SELECT TO authenticated USING (organization_id = get_user_org_id());
CREATE POLICY "tenant_insert" ON public.invoices FOR INSERT TO authenticated WITH CHECK (organization_id = get_user_org_id());
CREATE POLICY "tenant_update" ON public.invoices FOR UPDATE TO authenticated USING (organization_id = get_user_org_id());
CREATE POLICY "tenant_delete" ON public.invoices FOR DELETE TO authenticated USING (organization_id = get_user_org_id() AND get_user_role() = 'admin');

CREATE POLICY "tenant_select" ON public.invoice_lines FOR SELECT TO authenticated USING (organization_id = get_user_org_id());
CREATE POLICY "tenant_insert" ON public.invoice_lines FOR INSERT TO authenticated WITH CHECK (organization_id = get_user_org_id());
CREATE POLICY "tenant_update" ON public.invoice_lines FOR UPDATE TO authenticated USING (organization_id = get_user_org_id());
CREATE POLICY "tenant_delete" ON public.invoice_lines FOR DELETE TO authenticated USING (organization_id = get_user_org_id());

CREATE POLICY "tenant_select" ON public.invoice_sequences FOR SELECT TO authenticated USING (organization_id = get_user_org_id());
CREATE POLICY "tenant_insert" ON public.invoice_sequences FOR INSERT TO authenticated WITH CHECK (organization_id = get_user_org_id());
CREATE POLICY "tenant_update" ON public.invoice_sequences FOR UPDATE TO authenticated USING (organization_id = get_user_org_id());
