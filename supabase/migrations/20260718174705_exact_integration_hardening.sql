-- Exact Online — hardening naar aanleiding van de audit 2026-07-17
-- (docs/exact-online-audit-2026-07-17.md, bevindingen E2/E5/E9/E11/E12)
--
-- Additief en idempotent: geen bestaande kolom/policy wordt gewijzigd of gedropt.

-- ── E2/E5: ontdekte Exact-defaults per organisatie ───────────────────────────
-- Journal (verkoopdagboek), omzet-grootboekrekening, generiek artikel en de
-- BTW-code-map {"21": "6  ", ...} zijn administratie-specifiek. Ze worden één
-- keer ontdekt (of handmatig gezet in Instellingen) en daarna hergebruikt, zodat
-- niet elke factuur-sync opnieuw de hele catalogus hoeft op te halen.
ALTER TABLE public.exact_config ADD COLUMN IF NOT EXISTS default_journal text;
ALTER TABLE public.exact_config ADD COLUMN IF NOT EXISTS default_glaccount_id text;
ALTER TABLE public.exact_config ADD COLUMN IF NOT EXISTS default_item_id text;
ALTER TABLE public.exact_config ADD COLUMN IF NOT EXISTS default_vat_codes jsonb;
ALTER TABLE public.exact_config ADD COLUMN IF NOT EXISTS defaults_discovered_at timestamptz;

COMMENT ON COLUMN public.exact_config.default_vat_codes IS
  'Map van BTW-percentage (string) naar Exact VATCode, bv. {"0":"42 ","9":"1  ","21":"6  "}. Let op: Exact geeft codes met spatie-padding terug — die padding hoort behouden te blijven.';

-- ── E9: atomaire claim tegen dubbele factuur-sync ────────────────────────────
-- exact_sync_started_at wordt conditioneel gezet (claim); een claim ouder dan
-- 5 minuten wordt als verlaten beschouwd zodat een gecrashte run niet blokkeert.
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS exact_sync_started_at timestamptz;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS exact_synced_at timestamptz;

-- ── E12: audittrail van elke sync-actie richting/vanuit Exact ────────────────
CREATE TABLE IF NOT EXISTS public.exact_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  entity_type text NOT NULL,
  entity_id uuid,
  operation text NOT NULL,
  status text NOT NULL CHECK (status IN ('success', 'failed', 'skipped')),
  exact_id text,
  http_status integer,
  error_detail text,
  duration_ms integer,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exact_sync_log_org_created
  ON public.exact_sync_log (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_exact_sync_log_entity
  ON public.exact_sync_log (entity_type, entity_id);

ALTER TABLE public.exact_sync_log ENABLE ROW LEVEL SECURITY;

-- Alleen lezen voor interne gebruikers van de eigen org; schrijven doet de
-- service-role (die RLS omzeilt) vanuit de edge functions.
DROP POLICY IF EXISTS tenant_select ON public.exact_sync_log;
CREATE POLICY tenant_select ON public.exact_sync_log FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

-- ── E11: webhook-idempotentie ────────────────────────────────────────────────
-- Exact levert een notificatie tot 10× opnieuw wanneer een eerdere poging
-- faalde. event_id = "{division}:{topic}:{action}:{key}". Bewust GEEN permanente
-- dedup: een échte latere wijziging (bv. factuur wordt betaald) heeft hetzelfde
-- event_id en moet wél verwerkt worden. De edge function slaat alleen over als
-- hetzelfde event kort geleden al verwerkt is (retry-venster).
CREATE TABLE IF NOT EXISTS public.exact_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_id text NOT NULL,
  topic text,
  event_action text,
  exact_key text,
  processed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_exact_webhook_events_processed
  ON public.exact_webhook_events (organization_id, processed_at DESC);

ALTER TABLE public.exact_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_select ON public.exact_webhook_events;
CREATE POLICY tenant_select ON public.exact_webhook_events FOR SELECT TO authenticated
USING (organization_id = public.get_user_org_id() AND public.is_internal_user());
