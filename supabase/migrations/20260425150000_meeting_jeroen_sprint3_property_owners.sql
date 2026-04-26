-- Meeting Jeroen Sprint 3 — C2: Owners als aparte master-data
-- Vervangt losse owner_name/email/phone/contact_person/notes velden op properties
-- door FK naar nieuwe property_owners tabel.
--
-- Live toegepast via Supabase MCP als 20260425152021_meeting_jeroen_sprint3_property_owners.

BEGIN;

-- =================================================================
-- 1. Nieuwe tabel property_owners
-- =================================================================
CREATE TABLE public.property_owners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  contact_person text,
  email text,
  phone text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Per organisatie unieke naam (case-insensitive)
CREATE UNIQUE INDEX property_owners_org_name_unique
  ON public.property_owners(organization_id, lower(name));

CREATE INDEX property_owners_organization_idx
  ON public.property_owners(organization_id);

CREATE TRIGGER property_owners_updated_at
  BEFORE UPDATE ON public.property_owners
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.property_owners IS
  'Master-data voor verhuurder/eigenaar. Eén rij per unieke owner per organisatie; properties verwijzen via owner_id.';

-- =================================================================
-- 2. RLS — zelfde pattern als properties (org-scoped + internal user)
-- =================================================================
ALTER TABLE public.property_owners ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_select ON public.property_owners FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

CREATE POLICY tenant_insert ON public.property_owners FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());

CREATE POLICY tenant_update ON public.property_owners FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_org_id() AND public.is_internal_user())
  WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user());

CREATE POLICY tenant_delete ON public.property_owners FOR DELETE TO authenticated
  USING (organization_id = public.get_user_org_id() AND public.is_internal_user());

-- =================================================================
-- 3. FK kolom op properties
-- =================================================================
ALTER TABLE public.properties
  ADD COLUMN owner_id uuid REFERENCES public.property_owners(id) ON DELETE SET NULL;

CREATE INDEX properties_owner_id_idx ON public.properties(owner_id);

-- =================================================================
-- 4. Backfill — voor elke unieke (org, owner_name) maak rij + link
-- =================================================================
WITH unique_owners AS (
  SELECT
    organization_id,
    btrim(owner_name) AS name,
    (array_agg(owner_contact_person) FILTER (WHERE owner_contact_person IS NOT NULL))[1] AS contact_person,
    (array_agg(owner_email) FILTER (WHERE owner_email IS NOT NULL))[1] AS email,
    (array_agg(owner_phone) FILTER (WHERE owner_phone IS NOT NULL))[1] AS phone,
    string_agg(DISTINCT owner_notes, E'\n---\n') FILTER (WHERE owner_notes IS NOT NULL) AS notes
  FROM public.properties
  WHERE owner_name IS NOT NULL AND btrim(owner_name) <> ''
  GROUP BY organization_id, btrim(owner_name)
)
INSERT INTO public.property_owners (organization_id, name, contact_person, email, phone, notes)
SELECT organization_id, name, contact_person, email, phone, notes
FROM unique_owners;

UPDATE public.properties p
SET owner_id = po.id
FROM public.property_owners po
WHERE po.organization_id = p.organization_id
  AND lower(po.name) = lower(btrim(p.owner_name))
  AND p.owner_name IS NOT NULL
  AND btrim(p.owner_name) <> '';

-- =================================================================
-- 5. Drop oude losse owner_*-velden
-- =================================================================
ALTER TABLE public.properties
  DROP COLUMN owner_name,
  DROP COLUMN owner_email,
  DROP COLUMN owner_phone,
  DROP COLUMN owner_contact_person,
  DROP COLUMN owner_notes;

COMMIT;
