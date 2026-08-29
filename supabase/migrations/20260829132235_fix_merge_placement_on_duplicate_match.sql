-- Tweede blokkade bij het samenvoegen van dubbele kandidaten.
--
-- Staan beide profielen op dezelfde vacature, dan gooit de merge de dubbele match
-- van de verdwijnende kandidaat weg. Hangt daar een plaatsing aan, dan weigert
-- Postgres dat: `placements.match_id` is NO ACTION, geen cascade.
--
--   update or delete on table "matches" violates foreign key constraint
--   "placements_match_id_fkey" on table "placements"
--
-- Dat is terecht -- een plaatsing mag nooit stilletjes zijn herkomst verliezen --
-- maar het is ook geen reden om de hele samenvoeging af te breken. De plaatsing
-- hoort gewoon aan de match die blijft: dezelfde vacature, dezelfde persoon.
--
-- Deze fix hangt de plaatsing eerst om en verwijdert de dubbele match daarna.
-- Verder is de functie ongewijzigd t.o.v. de vorige migratie.

CREATE OR REPLACE FUNCTION public.merge_candidate_records(
  p_survivor uuid,
  p_loser uuid,
  p_actor uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_survivor public.candidates%rowtype;
  v_loser    public.candidates%rowtype;
  v_handled  text[] := array[
    'candidate_skills','matches','match_distance_cache','communication_preferences',
    'talentpool_members','campaign_recipients','birthday_campaign_logs',
    'candidate_data_quality_flags','loyalty_accounts','loyalty_transactions',
    'reward_redemptions','employees'
  ];
  v_skip_cols text[] := array[
    'id','organization_id','created_at','updated_at','first_name','last_name',
    'status','compliance_status','has_dutch_address','bsn','iban','skills',
    'auth_user_id','portal_enabled','portal_activated_at','portal_last_login',
    'portal_language','employee_number','employee_status',
    'cv_file_url','cv_raw_text','cv_has_photo','cv_pseudonymized_at','cv_pseudonymization_meta',
    'ai_analysis','ai_analyzed_at','ai_function_group','ai_classification','ai_reliability_score',
    'ai_interview_questions','ai_risk_factors','ai_summary','ai_status','ai_stability',
    'ai_red_flags','ai_positive_signals','ai_target_functions','ai_languages'
  ];
  v_tbl       text;
  v_set       text;
  v_loser_emp uuid;
  v_surv_emp  uuid;
  v_actor     uuid;
BEGIN
  SELECT * INTO v_survivor FROM public.candidates WHERE id = p_survivor;
  IF NOT FOUND THEN RAISE EXCEPTION 'merge_candidate_records: survivor % not found', p_survivor; END IF;
  SELECT * INTO v_loser FROM public.candidates WHERE id = p_loser;
  IF NOT FOUND THEN RAISE EXCEPTION 'merge_candidate_records: loser % not found', p_loser; END IF;
  IF p_survivor = p_loser THEN
    RAISE EXCEPTION 'merge_candidate_records: survivor and loser are identical (%)', p_survivor;
  END IF;
  IF v_survivor.organization_id <> v_loser.organization_id THEN
    RAISE EXCEPTION 'merge_candidate_records: cannot merge across organizations (% vs %)',
      v_survivor.organization_id, v_loser.organization_id;
  END IF;

  IF auth.role() = 'service_role' THEN
    v_actor := p_actor;
  ELSIF auth.role() = 'authenticated' THEN
    IF NOT (
      public.is_superadmin()
      OR (
        public.is_internal_user()
        AND v_survivor.organization_id = public.get_user_org_id()
      )
    ) THEN
      RAISE EXCEPTION 'merge_candidate_records: not authorized';
    END IF;
    v_actor := auth.uid();
  ELSE
    RAISE EXCEPTION 'merge_candidate_records: not authenticated';
  END IF;

  SELECT id INTO v_loser_emp FROM public.employees WHERE candidate_id = p_loser;
  SELECT id INTO v_surv_emp  FROM public.employees WHERE candidate_id = p_survivor;
  IF v_loser_emp IS NOT NULL AND v_surv_emp IS NOT NULL THEN
    RAISE EXCEPTION 'merge_candidate_records: both candidates have an employees (payroll) record (% and %); merge these manually', v_surv_emp, v_loser_emp;
  END IF;
  IF EXISTS (SELECT 1 FROM public.loyalty_accounts     WHERE candidate_id = p_survivor)
     AND EXISTS (SELECT 1 FROM public.loyalty_accounts WHERE candidate_id = p_loser) THEN
    RAISE EXCEPTION 'merge_candidate_records: both candidates have a loyalty account; merge the points ledger manually';
  END IF;
  IF EXISTS (SELECT 1 FROM public.loyalty_transactions     WHERE candidate_id = p_survivor)
     AND EXISTS (SELECT 1 FROM public.loyalty_transactions WHERE candidate_id = p_loser) THEN
    RAISE EXCEPTION 'merge_candidate_records: both candidates have loyalty transactions; merge the points ledger manually';
  END IF;

  -- Leg de samenvoeging vast voordat er ook maar een rij verhuist. De padcontrole
  -- op `documents` leest deze tabel: een bestand blijft fysiek staan in de map van
  -- de kandidaat die verdwijnt, en dat pad is legitiem zolang vastligt dat die
  -- kandidaat in deze is opgegaan. Bestaande ketens worden platgeslagen (A naar B
  -- en daarna B naar C wordt A naar C), zodat een enkele opzoeking altijd volstaat.
  UPDATE public.candidate_merges SET survivor_id = p_survivor WHERE survivor_id = p_loser;
  INSERT INTO public.candidate_merges (organization_id, survivor_id, loser_id, merged_by)
  VALUES (v_survivor.organization_id, p_survivor, p_loser, v_actor)
  ON CONFLICT (loser_id) DO UPDATE
    SET survivor_id = excluded.survivor_id,
        merged_at   = now(),
        merged_by   = excluded.merged_by;

  DELETE FROM public.candidate_skills WHERE candidate_id = p_loser;

  -- Een dubbele match verwijderen lukt niet als er een plaatsing aan hangt
  -- (`placements.match_id` is NO ACTION). Hang die plaatsing eerst om naar de
  -- match die blijft; de plaatsing zelf verhuist verderop met de kandidaat mee.
  UPDATE public.placements p
     SET match_id = s.id
    FROM public.matches l
    JOIN public.matches s
      ON s.candidate_id = p_survivor AND s.vacancy_id = l.vacancy_id
   WHERE l.candidate_id = p_loser
     AND p.match_id = l.id;

  DELETE FROM public.matches l
    WHERE l.candidate_id = p_loser
      AND EXISTS (SELECT 1 FROM public.matches s
                  WHERE s.candidate_id = p_survivor AND s.vacancy_id = l.vacancy_id);
  UPDATE public.matches SET candidate_id = p_survivor WHERE candidate_id = p_loser;

  DELETE FROM public.match_distance_cache l
    WHERE l.candidate_id = p_loser
      AND EXISTS (SELECT 1 FROM public.match_distance_cache s
                  WHERE s.candidate_id = p_survivor
                    AND s.vacancy_id = l.vacancy_id AND s.provider = l.provider);
  UPDATE public.match_distance_cache SET candidate_id = p_survivor WHERE candidate_id = p_loser;

  DELETE FROM public.communication_preferences l
    WHERE l.candidate_id = p_loser
      AND EXISTS (SELECT 1 FROM public.communication_preferences s
                  WHERE s.candidate_id = p_survivor
                    AND s.channel = l.channel AND s.organization_id = l.organization_id);
  UPDATE public.communication_preferences SET candidate_id = p_survivor WHERE candidate_id = p_loser;

  DELETE FROM public.talentpool_members l
    WHERE l.candidate_id = p_loser
      AND EXISTS (SELECT 1 FROM public.talentpool_members s
                  WHERE s.candidate_id = p_survivor AND s.talentpool_id = l.talentpool_id);
  UPDATE public.talentpool_members SET candidate_id = p_survivor WHERE candidate_id = p_loser;

  DELETE FROM public.campaign_recipients l
    WHERE l.candidate_id = p_loser
      AND EXISTS (SELECT 1 FROM public.campaign_recipients s
                  WHERE s.candidate_id = p_survivor AND s.campaign_id = l.campaign_id);
  UPDATE public.campaign_recipients SET candidate_id = p_survivor WHERE candidate_id = p_loser;

  DELETE FROM public.birthday_campaign_logs l
    WHERE l.candidate_id = p_loser
      AND EXISTS (SELECT 1 FROM public.birthday_campaign_logs s
                  WHERE s.candidate_id = p_survivor
                    AND s.organization_id = l.organization_id AND s.birthday_date = l.birthday_date);
  UPDATE public.birthday_campaign_logs SET candidate_id = p_survivor WHERE candidate_id = p_loser;

  DELETE FROM public.candidate_data_quality_flags l
    WHERE l.candidate_id = p_loser
      AND EXISTS (SELECT 1 FROM public.candidate_data_quality_flags s
                  WHERE s.candidate_id = p_survivor
                    AND s.organization_id = l.organization_id AND s.flag_type = l.flag_type);
  UPDATE public.candidate_data_quality_flags SET candidate_id = p_survivor WHERE candidate_id = p_loser;

  UPDATE public.loyalty_accounts     SET candidate_id = p_survivor WHERE candidate_id = p_loser;
  UPDATE public.loyalty_transactions SET candidate_id = p_survivor WHERE candidate_id = p_loser;
  UPDATE public.reward_redemptions   SET candidate_id = p_survivor WHERE candidate_id = p_loser;

  IF v_loser_emp IS NOT NULL THEN
    UPDATE public.employees SET candidate_id = p_survivor WHERE id = v_loser_emp;
  END IF;

  FOR v_tbl IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND NOT c.relispartition
      AND a.attname = 'candidate_id'
      AND NOT a.attisdropped
      AND c.relname <> ALL (v_handled)
  LOOP
    EXECUTE format('UPDATE public.%I SET candidate_id = $1 WHERE candidate_id = $2', v_tbl)
      USING p_survivor, p_loser;
  END LOOP;

  DELETE FROM public.external_mappings l
    WHERE l.entity_type = 'candidate' AND l.entity_id = p_loser
      AND EXISTS (SELECT 1 FROM public.external_mappings s
                  WHERE s.entity_type = 'candidate' AND s.entity_id = p_survivor
                    AND s.organization_id = l.organization_id
                    AND s.external_system = l.external_system);
  UPDATE public.external_mappings SET entity_id = p_survivor
    WHERE entity_type = 'candidate' AND entity_id = p_loser;

  UPDATE public.notes SET related_entity_id = p_survivor
    WHERE related_entity_type = 'candidate' AND related_entity_id = p_loser;

  DELETE FROM public.custom_field_values l
    WHERE l.entity_id = p_loser
      AND EXISTS (SELECT 1 FROM public.custom_field_values s
                  WHERE s.entity_id = p_survivor AND s.custom_field_id = l.custom_field_id);
  UPDATE public.custom_field_values SET entity_id = p_survivor WHERE entity_id = p_loser;

  UPDATE public.candidate_employment
     SET is_current = false
   WHERE candidate_id = p_survivor AND is_current = true
     AND id <> (
       SELECT id FROM public.candidate_employment
        WHERE candidate_id = p_survivor AND is_current = true
        ORDER BY start_date DESC NULLS LAST, created_at DESC, id DESC
        LIMIT 1
     );

  SELECT string_agg(format('%1$I = coalesce(s.%1$I, l.%1$I)', column_name), ', ')
    INTO v_set
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'candidates'
    AND column_name <> ALL (v_skip_cols)
    -- Generated kolommen (nu: search_unaccent) mogen alleen naar DEFAULT geschreven
    -- worden; opnemen in de SET-lijst maakt de hele UPDATE ongeldig.
    AND is_generated <> 'ALWAYS';

  IF v_set IS NOT NULL THEN
    EXECUTE format(
      'UPDATE public.candidates s SET %s FROM public.candidates l WHERE s.id = $1 AND l.id = $2',
      v_set
    ) USING p_survivor, p_loser;
  END IF;

  UPDATE public.candidates s SET
    cv_file_url = l.cv_file_url, cv_raw_text = l.cv_raw_text, cv_has_photo = l.cv_has_photo,
    cv_pseudonymized_at = l.cv_pseudonymized_at, cv_pseudonymization_meta = l.cv_pseudonymization_meta,
    ai_analysis = l.ai_analysis, ai_analyzed_at = l.ai_analyzed_at, ai_function_group = l.ai_function_group,
    ai_classification = l.ai_classification, ai_reliability_score = l.ai_reliability_score,
    ai_interview_questions = l.ai_interview_questions, ai_risk_factors = l.ai_risk_factors,
    ai_summary = l.ai_summary, ai_status = l.ai_status, ai_stability = l.ai_stability,
    ai_red_flags = l.ai_red_flags, ai_positive_signals = l.ai_positive_signals,
    ai_target_functions = l.ai_target_functions, ai_languages = l.ai_languages
  FROM public.candidates l
  WHERE s.id = p_survivor AND l.id = p_loser
    AND s.cv_file_url IS NULL AND l.cv_file_url IS NOT NULL;

  INSERT INTO public.audit_log (organization_id, user_id, action, table_name, record_id, old_values, new_values, reason)
  VALUES (
    v_survivor.organization_id,
    v_actor,
    'delete',
    'candidates',
    p_loser,
    to_jsonb(v_loser) - 'bsn' - 'iban',
    jsonb_build_object('merged_into', p_survivor),
    format('candidate merge: %s merged into %s', p_loser, p_survivor)
  );

  DELETE FROM public.candidates WHERE id = p_loser;

  RETURN jsonb_build_object(
    'survivor', p_survivor,
    'loser', p_loser,
    'organization_id', v_survivor.organization_id,
    'merged', true
  );
END;
$$;
