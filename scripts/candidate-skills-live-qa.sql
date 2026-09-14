-- Run as a database administrator after setting qa.skills_user_id to the affected
-- backoffice user's UUID. Uses that user's actual JWT claims, grants and RLS.
-- All synthetic candidates and tokens are rolled back; no messages are sent.
BEGIN;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', current_setting('qa.skills_user_id'), 'role', 'authenticated'
)::text, true);
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_org uuid := public.get_user_org_id();
  v_candidate uuid;
  v_skill uuid;
  v_name text;
  v_before jsonb;
  v_aliases jsonb;
  v_token text;
BEGIN
  ASSERT public.get_user_role()::text = 'backoffice';
  ASSERT public.has_role_permission('candidates.edit');
  ASSERT NOT public.has_role_permission('settings.manage');

  SELECT id, name, to_jsonb(s) INTO v_skill, v_name, v_before
  FROM public.skills s
  WHERE organization_id = v_org AND is_active
  ORDER BY (normalized_name = 'lasrobot bedienen') DESC, name LIMIT 1;
  ASSERT v_skill IS NOT NULL, 'An existing active skill is required';
  SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY normalized_alias), '[]')
  INTO v_aliases FROM public.skill_aliases a WHERE skill_id = v_skill;

  INSERT INTO public.candidates (organization_id, first_name, last_name, skills, source)
  VALUES (v_org, 'QA', 'Skillrechten rollback', ARRAY[v_name, upper(v_name), ' '], 'Recruitmentpartner')
  RETURNING id INTO v_candidate;
  ASSERT (SELECT count(*) FROM public.candidate_skills
          WHERE candidate_id = v_candidate AND skill_id = v_skill AND organization_id = v_org) = 1;
  ASSERT (SELECT source FROM public.candidates WHERE id = v_candidate) = 'Recruitmentpartner';

  -- The form also creates and reads a profile link before showing success.
  INSERT INTO public.candidate_profile_tokens (organization_id, candidate_id)
  VALUES (v_org, v_candidate) RETURNING token INTO v_token;
  ASSERT length(v_token) = 64;

  UPDATE public.candidates SET skills = ARRAY[]::text[] WHERE id = v_candidate;
  ASSERT (SELECT count(*) FROM public.candidate_skills WHERE candidate_id = v_candidate) = 0;
  UPDATE public.candidates SET skills = ARRAY[v_name] WHERE id = v_candidate;
  ASSERT (SELECT count(*) FROM public.candidate_skills WHERE candidate_id = v_candidate AND skill_id = v_skill) = 1;
  ASSERT (SELECT to_jsonb(s) FROM public.skills s WHERE id = v_skill) = v_before;
  ASSERT (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY normalized_alias), '[]')
          FROM public.skill_aliases a WHERE skill_id = v_skill) = v_aliases;

  BEGIN
    INSERT INTO public.skills (organization_id, name, normalized_name)
    VALUES (v_org, 'QA forbidden', 'qa forbidden');
    RAISE EXCEPTION 'Catalog INSERT unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.skills SET name = 'QA forbidden' WHERE id = v_skill;
    RAISE EXCEPTION 'Catalog UPDATE unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    DELETE FROM public.skills WHERE id = v_skill;
    RAISE EXCEPTION 'Catalog DELETE unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.candidates (organization_id, first_name, last_name, skills)
    VALUES (v_org, 'QA', 'Unknown skill rollback', ARRAY['QA unknown ' || gen_random_uuid()::text]);
    RAISE EXCEPTION 'Unknown skill creation unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.candidates (organization_id, first_name, last_name)
    VALUES (gen_random_uuid(), 'QA', 'Wrong tenant rollback');
    RAISE EXCEPTION 'Cross-tenant INSERT unexpectedly allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  ASSERT NOT has_function_privilege('authenticated', 'public.upsert_skill_for_org(uuid,text)', 'EXECUTE');
  ASSERT NOT has_function_privilege('anon', 'public.upsert_skill_for_org(uuid,text)', 'EXECUTE');
END;
$$;
ROLLBACK;
SELECT 'PASS: candidate create, profile token, skill edits and unchanged catalog; unauthorized writes denied; fixtures rolled back' AS result;
