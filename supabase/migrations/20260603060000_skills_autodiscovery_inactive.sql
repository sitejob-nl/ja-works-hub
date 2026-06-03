-- Structurele fix tegen catalogus-vervuiling.
--
-- Probleem: de sync-triggers op candidates.skills / vacancies.required_skills /
-- company_functions.required_skills roepen upsert_skill_for_org() aan, die voor ELKE
-- onbekende term een ACTIEVE skills-rij aanmaakte. De AI-kandidaat-backfill schreef daardoor
-- duizenden verzonnen termen als actieve catalogus-skills weg (79 -> 7559), wat de
-- recruiter-dropdown en de match-vocabulaire vervuilde.
--
-- Fix: auto-ontdekte skills komen voortaan als is_active = false de catalogus in. Ze worden
-- nog steeds genormaliseerd gekoppeld (candidate_skills / vacancy_required_skills /
-- company_function_skills + skill_aliases blijven gevuld, en calculate-match blijft werken op
-- de tekst-arrays), maar verschijnen NIET in de actieve catalogus/dropdown. De actieve
-- catalogus groeit alleen nog via bewuste curatie (SkillCatalogSettings -> insert is_active=true).
--
-- Bestaande rijen behouden hun is_active: ON CONFLICT raakt is_active bewust niet aan, dus een
-- al-actieve skill die opnieuw langskomt blijft actief, en een eerder gedeactiveerde blijft uit.
CREATE OR REPLACE FUNCTION public.upsert_skill_for_org(p_organization_id uuid, p_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_normalized text := public.normalize_skill_name(p_name);
  v_skill_id uuid;
BEGIN
  IF v_normalized IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.skills (organization_id, name, normalized_name, is_active)
  VALUES (p_organization_id, trim(p_name), v_normalized, false)
  ON CONFLICT (organization_id, normalized_name)
  DO UPDATE SET name = COALESCE(public.skills.name, excluded.name), updated_at = now()
  RETURNING id INTO v_skill_id;

  INSERT INTO public.skill_aliases (organization_id, skill_id, alias, normalized_alias, source)
  VALUES (p_organization_id, v_skill_id, trim(p_name), v_normalized, 'backfill')
  ON CONFLICT (organization_id, normalized_alias)
  DO NOTHING;

  RETURN v_skill_id;
END;
$function$;
