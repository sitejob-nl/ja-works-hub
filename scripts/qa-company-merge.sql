-- Set qa.merge_actor to an internal test/admin profile UUID before running.
-- Uses the user's actual grants and RLS; every synthetic record is rolled back.
BEGIN;
SELECT set_config('request.jwt.claims', jsonb_build_object(
  'sub', current_setting('qa.merge_actor'), 'role', 'authenticated'
)::text, true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_org uuid := public.get_user_org_id();
  v_survivor uuid;
  v_loser uuid;
  v_candidate uuid;
  v_contact uuid;
  v_placement uuid;
  v_document uuid;
  v_other_note uuid;
  v_kind text;
  v_result jsonb;
BEGIN
  INSERT INTO public.companies(organization_id, name)
  VALUES (v_org, 'QA merge rollback') RETURNING id INTO v_survivor;
  INSERT INTO public.companies(organization_id, name, phone)
  VALUES (v_org, 'QA merge rollback', 'QA phone') RETURNING id INTO v_loser;
  INSERT INTO public.candidates(organization_id, first_name, last_name)
  VALUES (v_org, 'QA', 'Merge rollback') RETURNING id INTO v_candidate;
  INSERT INTO public.company_contacts(organization_id, company_id, full_name)
  VALUES (v_org, v_loser, 'QA contact') RETURNING id INTO v_contact;
  INSERT INTO public.placements(organization_id, company_id, candidate_id, function_name, start_date)
  VALUES (v_org, v_loser, v_candidate, 'QA placement', current_date) RETURNING id INTO v_placement;
  INSERT INTO public.documents(organization_id, company_id, name, type, file_path)
  VALUES (v_org, v_loser, 'QA document', 'overig', v_org::text || '/companies/' || v_loser::text || '/qa.txt')
  RETURNING id INTO v_document;

  FOREACH v_kind IN ARRAY ARRAY['opdrachtgever', 'bedrijf', 'company'] LOOP
    INSERT INTO public.notes(organization_id, created_by, related_entity_type, related_entity_id, body)
    VALUES (v_org, auth.uid(), v_kind, v_loser, 'QA note ' || v_kind);
    INSERT INTO public.recruiter_tasks(organization_id, created_by, related_entity_type, related_entity_id, title)
    VALUES (v_org, auth.uid(), v_kind, v_loser, 'QA task ' || v_kind);
  END LOOP;
  -- A different entity discriminator must never move merely because its UUID matches.
  INSERT INTO public.notes(organization_id, created_by, related_entity_type, related_entity_id, body)
  VALUES (v_org, auth.uid(), 'kandidaat', v_loser, 'QA unrelated note') RETURNING id INTO v_other_note;

  v_result := public.merge_company_records(v_survivor, v_loser);
  ASSERT (v_result->>'merged')::boolean;
  ASSERT NOT EXISTS(SELECT 1 FROM public.companies WHERE id = v_loser);
  ASSERT (SELECT phone = 'QA phone' FROM public.companies WHERE id = v_survivor);
  ASSERT (SELECT company_id = v_survivor FROM public.company_contacts WHERE id = v_contact);
  ASSERT (SELECT company_id = v_survivor FROM public.placements WHERE id = v_placement);
  ASSERT (SELECT company_id = v_survivor FROM public.documents WHERE id = v_document);
  ASSERT (SELECT count(*) FROM public.notes WHERE related_entity_id = v_survivor AND related_entity_type = 'opdrachtgever') = 3;
  ASSERT (SELECT count(*) FROM public.recruiter_tasks WHERE related_entity_id = v_survivor AND related_entity_type = 'opdrachtgever') = 3;
  ASSERT (SELECT related_entity_id = v_loser AND related_entity_type = 'kandidaat' FROM public.notes WHERE id = v_other_note);
  ASSERT EXISTS(SELECT 1 FROM public.company_merges WHERE loser_id = v_loser AND survivor_id = v_survivor);
  ASSERT EXISTS(SELECT 1 FROM public.audit_log WHERE table_name = 'companies' AND record_id = v_loser AND new_values->>'merged_into' = v_survivor::text);
  ASSERT NOT has_function_privilege('anon', 'public.merge_company_records(uuid,uuid,uuid)', 'EXECUTE');
END;
$$;
ROLLBACK;
SELECT 'PASS: merge preserves linked dossier, normalizes legacy notes/tasks, ignores unrelated entity type, audits and rolls back fixtures' AS result;
