
-- Table to store WhatsApp integration config per organization
CREATE TABLE public.whatsapp_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tenant_id text,
  webhook_secret text,
  phone_number_id text,
  access_token text,
  display_phone text,
  waba_id text,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id)
);

ALTER TABLE public.whatsapp_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_select" ON public.whatsapp_config FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id());

CREATE POLICY "tenant_insert" ON public.whatsapp_config FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org_id());

CREATE POLICY "tenant_update" ON public.whatsapp_config FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id());

CREATE POLICY "tenant_delete" ON public.whatsapp_config FOR DELETE TO authenticated
  USING (organization_id = get_user_org_id() AND get_user_role() = 'admin');

-- Add whatsapp_message_id to communications for deduplication
ALTER TABLE public.communications ADD COLUMN IF NOT EXISTS whatsapp_message_id text;
ALTER TABLE public.communications ADD COLUMN IF NOT EXISTS whatsapp_status text;

CREATE INDEX IF NOT EXISTS idx_communications_whatsapp_msg_id ON public.communications(whatsapp_message_id) WHERE whatsapp_message_id IS NOT NULL;
