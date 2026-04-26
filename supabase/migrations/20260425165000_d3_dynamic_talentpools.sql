-- D3 — Talentpools auto-vulling per skill/functie
-- Maakt onderscheid tussen statische (handmatig) en dynamische (filter-gestuurd) pools.
-- Dynamische pools worden periodiek geverversd via edge function refresh-talentpool-members.
--
-- Live toegepast via Supabase MCP als 20260425164207_meeting_jeroen_d3_dynamic_talentpools.

BEGIN;

ALTER TABLE public.talentpools
  ADD COLUMN IF NOT EXISTS is_dynamic boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS refresh_frequency text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS last_refreshed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_refresh_meta jsonb;

ALTER TABLE public.talentpools
  ADD CONSTRAINT talentpools_refresh_frequency_check
  CHECK (refresh_frequency IN ('manual', 'daily', 'weekly'));

COMMENT ON COLUMN public.talentpools.is_dynamic IS
  'True = pool wordt automatisch gevuld op basis van filter_criteria. False = handmatig beheerd.';
COMMENT ON COLUMN public.talentpools.refresh_frequency IS
  'manual = alleen via knop, daily = elke nacht, weekly = wekelijks. Geldt alleen als is_dynamic = true.';
COMMENT ON COLUMN public.talentpools.last_refreshed_at IS
  'Tijdstip van laatste auto-fill van deze pool.';
COMMENT ON COLUMN public.talentpools.last_refresh_meta IS
  'Aantallen toegevoegd/verwijderd/totaal bij laatste refresh.';

ALTER TABLE public.talentpool_members
  ADD COLUMN IF NOT EXISTS added_by_filter boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.talentpool_members.added_by_filter IS
  'True als lid auto-toegevoegd door filter-refresh. False = handmatig (blijft bij refresh behouden).';

CREATE INDEX IF NOT EXISTS talentpools_dynamic_refresh_idx
  ON public.talentpools(refresh_frequency, last_refreshed_at)
  WHERE is_dynamic = true;

COMMIT;
