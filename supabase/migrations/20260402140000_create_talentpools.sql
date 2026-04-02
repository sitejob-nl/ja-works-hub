-- Fase 5: Talentpools & Geavanceerd Zoeken

-- Talentpools tabel
CREATE TABLE talentpools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  description text,
  color text,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Leden (junction)
CREATE TABLE talentpool_members (
  talentpool_id uuid NOT NULL REFERENCES talentpools(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  added_by uuid REFERENCES profiles(id),
  added_at timestamptz DEFAULT now(),
  PRIMARY KEY (talentpool_id, candidate_id)
);

-- Indexen
CREATE INDEX talentpools_org_idx ON talentpools(organization_id);
CREATE INDEX talentpool_members_candidate_idx ON talentpool_members(candidate_id);

-- RLS: talentpools
ALTER TABLE talentpools ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_select" ON talentpools FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id());
CREATE POLICY "tenant_insert" ON talentpools FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org_id());
CREATE POLICY "tenant_update" ON talentpools FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id());
CREATE POLICY "tenant_delete" ON talentpools FOR DELETE TO authenticated
  USING (organization_id = get_user_org_id());

-- RLS: talentpool_members (via parent talentpool org check)
ALTER TABLE talentpool_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_select" ON talentpool_members FOR SELECT TO authenticated
  USING (talentpool_id IN (SELECT id FROM talentpools WHERE organization_id = get_user_org_id()));
CREATE POLICY "tenant_insert" ON talentpool_members FOR INSERT TO authenticated
  WITH CHECK (talentpool_id IN (SELECT id FROM talentpools WHERE organization_id = get_user_org_id()));
CREATE POLICY "tenant_delete" ON talentpool_members FOR DELETE TO authenticated
  USING (talentpool_id IN (SELECT id FROM talentpools WHERE organization_id = get_user_org_id()));

-- Updated_at trigger
CREATE TRIGGER set_talentpools_updated_at BEFORE UPDATE ON talentpools
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- Full-text search index op CV tekst (Dutch config)
CREATE INDEX candidates_cv_fts_idx ON candidates
  USING gin(to_tsvector('dutch', coalesce(cv_raw_text, '')));
