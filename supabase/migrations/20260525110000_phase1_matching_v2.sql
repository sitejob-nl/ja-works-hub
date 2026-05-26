-- Phase 1 matching v2: tenant skill catalog, stored breakdown, Mapbox distance cache and feedback reasons.

CREATE OR REPLACE FUNCTION public.normalize_skill_name(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(trim(regexp_replace(lower(coalesce(value, '')), '[^a-z0-9]+', ' ', 'g')), '');
$$;

CREATE TABLE IF NOT EXISTS public.skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  normalized_name text NOT NULL,
  category text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, normalized_name)
);

CREATE TABLE IF NOT EXISTS public.skill_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  skill_id uuid NOT NULL REFERENCES public.skills(id) ON DELETE CASCADE,
  alias text NOT NULL,
  normalized_alias text NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, normalized_alias)
);

CREATE TABLE IF NOT EXISTS public.candidate_skills (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  skill_id uuid NOT NULL REFERENCES public.skills(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'profile',
  confidence numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (candidate_id, skill_id)
);

CREATE TABLE IF NOT EXISTS public.vacancy_required_skills (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  vacancy_id uuid NOT NULL REFERENCES public.vacancies(id) ON DELETE CASCADE,
  skill_id uuid NOT NULL REFERENCES public.skills(id) ON DELETE CASCADE,
  weight numeric NOT NULL DEFAULT 1,
  is_required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (vacancy_id, skill_id)
);

CREATE TABLE IF NOT EXISTS public.company_function_skills (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  company_function_id uuid NOT NULL REFERENCES public.company_functions(id) ON DELETE CASCADE,
  skill_id uuid NOT NULL REFERENCES public.skills(id) ON DELETE CASCADE,
  weight numeric NOT NULL DEFAULT 1,
  is_required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_function_id, skill_id)
);

CREATE TABLE IF NOT EXISTS public.match_distance_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  vacancy_id uuid NOT NULL REFERENCES public.vacancies(id) ON DELETE CASCADE,
  origin_lat numeric,
  origin_lng numeric,
  destination_lat numeric,
  destination_lng numeric,
  distance_km numeric,
  duration_min integer,
  provider text NOT NULL DEFAULT 'mapbox',
  status text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'missing_coords', 'provider_error')),
  calculated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  UNIQUE (candidate_id, vacancy_id, provider)
);

CREATE TABLE IF NOT EXISTS public.match_feedback_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  applies_to public.match_status NOT NULL,
  reason text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, applies_to, reason)
);

CREATE TABLE IF NOT EXISTS public.match_feedback_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  from_status public.match_status,
  to_status public.match_status NOT NULL,
  reason_id uuid REFERENCES public.match_feedback_reasons(id) ON DELETE SET NULL,
  notes text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  match_score_snapshot numeric,
  match_breakdown_snapshot jsonb
);

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS match_breakdown jsonb,
  ADD COLUMN IF NOT EXISTS distance_km numeric,
  ADD COLUMN IF NOT EXISTS duration_min integer;

CREATE INDEX IF NOT EXISTS skills_org_active_name_idx ON public.skills (organization_id, is_active, normalized_name);
CREATE INDEX IF NOT EXISTS skill_aliases_org_active_alias_idx ON public.skill_aliases (organization_id, is_active, normalized_alias);
CREATE INDEX IF NOT EXISTS candidate_skills_org_skill_idx ON public.candidate_skills (organization_id, skill_id);
CREATE INDEX IF NOT EXISTS candidate_skills_org_candidate_idx ON public.candidate_skills (organization_id, candidate_id);
CREATE INDEX IF NOT EXISTS vacancy_required_skills_org_skill_idx ON public.vacancy_required_skills (organization_id, skill_id);
CREATE INDEX IF NOT EXISTS vacancy_required_skills_org_vacancy_idx ON public.vacancy_required_skills (organization_id, vacancy_id);
CREATE INDEX IF NOT EXISTS company_function_skills_org_skill_idx ON public.company_function_skills (organization_id, skill_id);
CREATE INDEX IF NOT EXISTS match_distance_cache_org_vacancy_idx ON public.match_distance_cache (organization_id, vacancy_id, calculated_at DESC);
CREATE INDEX IF NOT EXISTS matches_org_vacancy_score_idx ON public.matches (organization_id, vacancy_id, match_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS match_feedback_reasons_org_status_idx ON public.match_feedback_reasons (organization_id, applies_to, is_active, sort_order);
CREATE INDEX IF NOT EXISTS match_feedback_events_org_match_idx ON public.match_feedback_events (organization_id, match_id, created_at DESC);

ALTER TABLE public.skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skill_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidate_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vacancy_required_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_function_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_distance_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_feedback_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_feedback_events ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'skills',
    'skill_aliases',
    'candidate_skills',
    'vacancy_required_skills',
    'company_function_skills',
    'match_distance_cache',
    'match_feedback_reasons',
    'match_feedback_events'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_select ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_select ON public.%I FOR SELECT TO authenticated USING (organization_id = public.get_user_org_id() AND public.is_internal_user())',
      table_name
    );
    EXECUTE format('DROP POLICY IF EXISTS tenant_insert ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user())',
      table_name
    );
    EXECUTE format('DROP POLICY IF EXISTS tenant_update ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_update ON public.%I FOR UPDATE TO authenticated USING (organization_id = public.get_user_org_id() AND public.is_internal_user()) WITH CHECK (organization_id = public.get_user_org_id() AND public.is_internal_user())',
      table_name
    );
    EXECUTE format('DROP POLICY IF EXISTS tenant_delete ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY tenant_delete ON public.%I FOR DELETE TO authenticated USING (organization_id = public.get_user_org_id() AND public.is_internal_user())',
      table_name
    );
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.upsert_skill_for_org(p_organization_id uuid, p_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_normalized text := public.normalize_skill_name(p_name);
  v_skill_id uuid;
BEGIN
  IF v_normalized IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.skills (organization_id, name, normalized_name)
  VALUES (p_organization_id, trim(p_name), v_normalized)
  ON CONFLICT (organization_id, normalized_name)
  DO UPDATE SET name = COALESCE(public.skills.name, excluded.name), updated_at = now()
  RETURNING id INTO v_skill_id;

  INSERT INTO public.skill_aliases (organization_id, skill_id, alias, normalized_alias, source)
  VALUES (p_organization_id, v_skill_id, trim(p_name), v_normalized, 'backfill')
  ON CONFLICT (organization_id, normalized_alias)
  DO NOTHING;

  RETURN v_skill_id;
END;
$$;
REVOKE ALL ON FUNCTION public.upsert_skill_for_org(uuid, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_candidate_skills_from_array()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_skill text;
  v_skill_id uuid;
BEGIN
  DELETE FROM public.candidate_skills
  WHERE candidate_id = NEW.id
    AND source IN ('profile', 'backfill');

  FOREACH v_skill IN ARRAY COALESCE(NEW.skills, ARRAY[]::text[])
  LOOP
    v_skill_id := public.upsert_skill_for_org(NEW.organization_id, v_skill);
    IF v_skill_id IS NOT NULL THEN
      INSERT INTO public.candidate_skills (organization_id, candidate_id, skill_id, source)
      VALUES (NEW.organization_id, NEW.id, v_skill_id, 'profile')
      ON CONFLICT (candidate_id, skill_id) DO UPDATE SET source = excluded.source;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_candidate_skills_from_array() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_vacancy_required_skills_from_array()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_skill text;
  v_skill_id uuid;
BEGIN
  DELETE FROM public.vacancy_required_skills
  WHERE vacancy_id = NEW.id;

  FOREACH v_skill IN ARRAY COALESCE(NEW.required_skills, NEW.skills_required, ARRAY[]::text[])
  LOOP
    v_skill_id := public.upsert_skill_for_org(NEW.organization_id, v_skill);
    IF v_skill_id IS NOT NULL THEN
      INSERT INTO public.vacancy_required_skills (organization_id, vacancy_id, skill_id)
      VALUES (NEW.organization_id, NEW.id, v_skill_id)
      ON CONFLICT (vacancy_id, skill_id) DO NOTHING;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_vacancy_required_skills_from_array() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.sync_company_function_skills_from_array()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_skill text;
  v_skill_id uuid;
BEGIN
  DELETE FROM public.company_function_skills
  WHERE company_function_id = NEW.id;

  FOREACH v_skill IN ARRAY COALESCE(NEW.required_skills, ARRAY[]::text[])
  LOOP
    v_skill_id := public.upsert_skill_for_org(NEW.organization_id, v_skill);
    IF v_skill_id IS NOT NULL THEN
      INSERT INTO public.company_function_skills (organization_id, company_function_id, skill_id)
      VALUES (NEW.organization_id, NEW.id, v_skill_id)
      ON CONFLICT (company_function_id, skill_id) DO NOTHING;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_company_function_skills_from_array() FROM PUBLIC;

DROP TRIGGER IF EXISTS sync_candidate_skills_from_array_trg ON public.candidates;
CREATE TRIGGER sync_candidate_skills_from_array_trg
AFTER INSERT OR UPDATE OF skills ON public.candidates
FOR EACH ROW EXECUTE FUNCTION public.sync_candidate_skills_from_array();

DROP TRIGGER IF EXISTS sync_vacancy_required_skills_from_array_trg ON public.vacancies;
CREATE TRIGGER sync_vacancy_required_skills_from_array_trg
AFTER INSERT OR UPDATE OF required_skills, skills_required ON public.vacancies
FOR EACH ROW EXECUTE FUNCTION public.sync_vacancy_required_skills_from_array();

DROP TRIGGER IF EXISTS sync_company_function_skills_from_array_trg ON public.company_functions;
CREATE TRIGGER sync_company_function_skills_from_array_trg
AFTER INSERT OR UPDATE OF required_skills ON public.company_functions
FOR EACH ROW EXECUTE FUNCTION public.sync_company_function_skills_from_array();

INSERT INTO public.skills (organization_id, name, normalized_name)
SELECT DISTINCT organization_id, trim(skill), public.normalize_skill_name(skill)
FROM (
  SELECT organization_id, unnest(COALESCE(skills, ARRAY[]::text[])) AS skill FROM public.candidates
  UNION ALL
  SELECT organization_id, unnest(COALESCE(required_skills, skills_required, ARRAY[]::text[])) AS skill FROM public.vacancies
  UNION ALL
  SELECT organization_id, unnest(COALESCE(required_skills, ARRAY[]::text[])) AS skill FROM public.company_functions
) source
WHERE public.normalize_skill_name(skill) IS NOT NULL
ON CONFLICT (organization_id, normalized_name) DO NOTHING;

INSERT INTO public.skill_aliases (organization_id, skill_id, alias, normalized_alias, source)
SELECT s.organization_id, s.id, s.name, s.normalized_name, 'backfill'
FROM public.skills s
ON CONFLICT (organization_id, normalized_alias) DO NOTHING;

INSERT INTO public.candidate_skills (organization_id, candidate_id, skill_id, source)
SELECT c.organization_id, c.id, s.id, 'backfill'
FROM public.candidates c
CROSS JOIN LATERAL unnest(COALESCE(c.skills, ARRAY[]::text[])) AS u(skill_name)
JOIN public.skills s
  ON s.organization_id = c.organization_id
 AND s.normalized_name = public.normalize_skill_name(skill_name)
ON CONFLICT (candidate_id, skill_id) DO NOTHING;

INSERT INTO public.vacancy_required_skills (organization_id, vacancy_id, skill_id)
SELECT v.organization_id, v.id, s.id
FROM public.vacancies v
CROSS JOIN LATERAL unnest(COALESCE(v.required_skills, v.skills_required, ARRAY[]::text[])) AS u(skill_name)
JOIN public.skills s
  ON s.organization_id = v.organization_id
 AND s.normalized_name = public.normalize_skill_name(skill_name)
ON CONFLICT (vacancy_id, skill_id) DO NOTHING;

INSERT INTO public.company_function_skills (organization_id, company_function_id, skill_id)
SELECT cf.organization_id, cf.id, s.id
FROM public.company_functions cf
CROSS JOIN LATERAL unnest(COALESCE(cf.required_skills, ARRAY[]::text[])) AS u(skill_name)
JOIN public.skills s
  ON s.organization_id = cf.organization_id
 AND s.normalized_name = public.normalize_skill_name(skill_name)
ON CONFLICT (company_function_id, skill_id) DO NOTHING;

INSERT INTO public.match_feedback_reasons (organization_id, applies_to, reason, sort_order)
SELECT o.id, reason.applies_to::public.match_status, reason.reason, reason.sort_order
FROM public.organizations o
CROSS JOIN (
  VALUES
    ('afgewezen', 'Mist verplichte vaardigheden', 10),
    ('afgewezen', 'Mist certificaat of rijbewijs', 20),
    ('afgewezen', 'Reistijd te hoog', 30),
    ('afgewezen', 'Niet beschikbaar', 40),
    ('afgewezen', 'Kandidaat niet geïnteresseerd', 50),
    ('geaccepteerd', 'Sterke inhoudelijke match', 10),
    ('geaccepteerd', 'Goede beschikbaarheid', 20),
    ('geplaatst', 'Geplaatst na klantakkoord', 10)
) AS reason(applies_to, reason, sort_order)
ON CONFLICT (organization_id, applies_to, reason) DO NOTHING;

COMMENT ON TABLE public.skills IS 'Tenant-scoped canonical skill catalog for Phase 1 matching.';
COMMENT ON COLUMN public.matches.match_breakdown IS 'Structured deterministic matching explanation used by Phase 1 recruiter UI.';
