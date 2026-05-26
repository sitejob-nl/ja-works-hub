-- Repair Voys schema drift: remote migration history marks the original Voys
-- migration as applied, but some environments are missing the table.
CREATE TABLE IF NOT EXISTS voys_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  api_token text NOT NULL,
  client_uuid uuid,
  client_id text,
  user_uuid uuid,
  is_connected boolean DEFAULT false,
  connected_at timestamptz,
  last_sync_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (organization_id)
);

CREATE OR REPLACE FUNCTION encrypt_voys_token()
RETURNS trigger AS $$
BEGIN
  IF NEW.api_token IS NOT NULL AND NEW.api_token != '' THEN
    NEW.api_token := encrypt_sensitive(NEW.api_token);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS encrypt_voys_token_trigger ON voys_config;
CREATE TRIGGER encrypt_voys_token_trigger
  BEFORE INSERT OR UPDATE OF api_token ON voys_config
  FOR EACH ROW EXECUTE FUNCTION encrypt_voys_token();

CREATE OR REPLACE FUNCTION get_voys_token(p_org_id uuid)
RETURNS TABLE (
  api_token text,
  client_uuid uuid,
  client_id text,
  user_uuid uuid
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    decrypt_sensitive(vc.api_token) AS api_token,
    vc.client_uuid,
    vc.client_id,
    vc.user_uuid
  FROM voys_config vc
  WHERE vc.organization_id = p_org_id
    AND vc.is_connected = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER TABLE voys_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "voys_config_select" ON voys_config;
CREATE POLICY "voys_config_select" ON voys_config
  FOR SELECT USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "voys_config_insert" ON voys_config;
CREATE POLICY "voys_config_insert" ON voys_config
  FOR INSERT WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "voys_config_update" ON voys_config;
CREATE POLICY "voys_config_update" ON voys_config
  FOR UPDATE USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "voys_config_delete" ON voys_config;
CREATE POLICY "voys_config_delete" ON voys_config
  FOR DELETE USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

ALTER TABLE communications ADD COLUMN IF NOT EXISTS voys_call_id text;
ALTER TABLE communications ADD COLUMN IF NOT EXISTS call_summary text;

CREATE INDEX IF NOT EXISTS idx_communications_voys_call_id ON communications(voys_call_id) WHERE voys_call_id IS NOT NULL;
