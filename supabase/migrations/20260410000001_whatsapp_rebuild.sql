-- WhatsApp rebuild migration
-- 1. New columns on communications
-- 2. Indexes on whatsapp_config for O(1) webhook lookup
-- 3. Unique constraint on communications.whatsapp_message_id (replaces non-unique index)
-- 4. whatsapp_templates table with RLS
-- 5. Retry/pause columns on campaign tables
-- 6. Enable realtime on communications

-- ============================================================
-- 1. communications: message_type and media_id columns
-- ============================================================
ALTER TABLE public.communications ADD COLUMN IF NOT EXISTS message_type text DEFAULT 'text';
ALTER TABLE public.communications ADD COLUMN IF NOT EXISTS media_id text;

-- ============================================================
-- 2. whatsapp_config: indexes for webhook lookup
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_whatsapp_config_tenant_id
  ON public.whatsapp_config(tenant_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_config_waba_id
  ON public.whatsapp_config(waba_id);

-- ============================================================
-- 3. communications.whatsapp_message_id: replace non-unique index
--    with a unique constraint (partial: WHERE NOT NULL)
-- ============================================================
DROP INDEX IF EXISTS public.idx_communications_whatsapp_msg_id;

-- Add unique constraint only where whatsapp_message_id IS NOT NULL
-- Using a unique index with WHERE clause (partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS uq_communications_whatsapp_message_id
  ON public.communications(whatsapp_message_id)
  WHERE whatsapp_message_id IS NOT NULL;

-- ============================================================
-- 4. whatsapp_templates table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.whatsapp_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  template_name text NOT NULL,
  language text NOT NULL DEFAULT 'nl',
  category text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  components jsonb,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, template_name, language)
);

ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_select" ON public.whatsapp_templates
  FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id());

CREATE POLICY "tenant_insert" ON public.whatsapp_templates
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org_id());

CREATE POLICY "tenant_update" ON public.whatsapp_templates
  FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id());

CREATE POLICY "tenant_delete" ON public.whatsapp_templates
  FOR DELETE TO authenticated
  USING (organization_id = get_user_org_id());

-- ============================================================
-- 5. campaign_recipients: retry columns
-- ============================================================
ALTER TABLE public.campaign_recipients ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.campaign_recipients ADD COLUMN IF NOT EXISTS next_retry_at timestamptz;

-- ============================================================
-- 6. bulk_campaigns: pause/cancel timestamps
-- ============================================================
ALTER TABLE public.bulk_campaigns ADD COLUMN IF NOT EXISTS paused_at timestamptz;
ALTER TABLE public.bulk_campaigns ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

-- ============================================================
-- 7. Enable realtime on communications table
-- ============================================================
ALTER TABLE public.communications REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'communications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.communications;
  END IF;
END
$$;
