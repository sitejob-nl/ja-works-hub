-- Set qa.cleanup_actor to an active demo admin/backoffice/intercedent profile.
-- Roll back the entire temporary tenant, including automatically seeded folders.
BEGIN;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $$
DECLARE
  v_org uuid;
  v_company uuid;
  v_candidate uuid;
  v_placement uuid;
  v_vehicle uuid;
  v_fine uuid;
BEGIN
  INSERT INTO public.organizations(name,slug) VALUES ('QA cleanup isolation', 'qa-cleanup-' || gen_random_uuid()) RETURNING id INTO v_org;
  ASSERT v_org <> (SELECT organization_id FROM public.profiles WHERE id=current_setting('qa.cleanup_actor')::uuid);
  INSERT INTO public.companies(organization_id,name) VALUES(v_org,'QA cleanup isolation') RETURNING id INTO v_company;
  INSERT INTO public.candidates(organization_id,first_name,last_name) VALUES(v_org,'QA','cleanup isolation') RETURNING id INTO v_candidate;
  INSERT INTO public.placements(organization_id,company_id,candidate_id,function_name,start_date) VALUES(v_org,v_company,v_candidate,'QA cleanup isolation',current_date) RETURNING id INTO v_placement;
  INSERT INTO public.vehicles(organization_id,license_plate) VALUES(v_org,'QA-' || left(gen_random_uuid()::text,6)) RETURNING id INTO v_vehicle;
  INSERT INTO public.vehicle_fines(organization_id,vehicle_id,fine_date,amount) VALUES(v_org,v_vehicle,current_date,10) RETURNING id INTO v_fine;
  PERFORM set_config('qa.foreign_placement',v_placement::text,true);
  PERFORM set_config('qa.foreign_fine',v_fine::text,true);
END $$;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('qa.cleanup_actor'),'role','authenticated')::text,true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE v_count bigint;
BEGIN
  BEGIN
    PERFORM public.get_placement_delete_impact(current_setting('qa.foreign_placement')::uuid);
    RAISE EXCEPTION 'Cross-tenant preview succeeded';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;
  BEGIN
    PERFORM public.delete_placement_record(current_setting('qa.foreign_placement')::uuid);
    RAISE EXCEPTION 'Cross-tenant delete succeeded';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;
  DELETE FROM public.vehicle_fines WHERE id=current_setting('qa.foreign_fine')::uuid;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  ASSERT v_count=0, 'Cross-tenant fine deleted';
END $$;
RESET ROLE;
DO $$ BEGIN
  ASSERT EXISTS(SELECT 1 FROM public.placements WHERE id=current_setting('qa.foreign_placement')::uuid);
  ASSERT EXISTS(SELECT 1 FROM public.vehicle_fines WHERE id=current_setting('qa.foreign_fine')::uuid);
END $$;
ROLLBACK;
SELECT 'PASS tenant isolation; all fixtures rolled back' AS result;
