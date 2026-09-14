-- Linking a known catalog skill is a candidate/vacancy edit, not catalog management.
-- INSERT ... ON CONFLICT still fires the INSERT/UPDATE permission guards, even when
-- the skill already exists. Resolve that ID without touching skills or skill_aliases.
-- Unknown terms retain the existing guarded, inactive discovery path.
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

  SELECT id INTO v_skill_id
  FROM public.skills
  WHERE organization_id = p_organization_id AND normalized_name = v_normalized;

  IF v_skill_id IS NOT NULL THEN
    RETURN v_skill_id;
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

-- Trigger implementation detail, not a public write RPC. Preserve the existing ACL.
REVOKE ALL ON FUNCTION public.upsert_skill_for_org(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_skill_for_org(uuid, text) TO service_role;
