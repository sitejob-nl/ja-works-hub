-- Dedup (review 03-06): commit de live merge-RPC in de repo (parity, was drift)
-- + nieuwe read-only detectie-RPC voor het duplicatenbeheer-scherm.

-- 1. merge_candidate_records — bestaat al live; hier vastgelegd zodat repo/CI
--    overeenkomt met productie. CREATE OR REPLACE met identieke body = no-op.
create or replace function public.merge_candidate_records(p_survivor uuid, p_loser uuid, p_actor uuid default null::uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
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
begin
  select * into v_survivor from public.candidates where id = p_survivor;
  if not found then raise exception 'merge_candidate_records: survivor % not found', p_survivor; end if;
  select * into v_loser from public.candidates where id = p_loser;
  if not found then raise exception 'merge_candidate_records: loser % not found', p_loser; end if;
  if p_survivor = p_loser then
    raise exception 'merge_candidate_records: survivor and loser are identical (%)', p_survivor;
  end if;
  if v_survivor.organization_id <> v_loser.organization_id then
    raise exception 'merge_candidate_records: cannot merge across organizations (% vs %)',
      v_survivor.organization_id, v_loser.organization_id;
  end if;

  select id into v_loser_emp from public.employees where candidate_id = p_loser;
  select id into v_surv_emp  from public.employees where candidate_id = p_survivor;
  if v_loser_emp is not null and v_surv_emp is not null then
    raise exception 'merge_candidate_records: both candidates have an employees (payroll) record (% and %); merge these manually', v_surv_emp, v_loser_emp;
  end if;
  if exists (select 1 from public.loyalty_accounts     where candidate_id = p_survivor)
     and exists (select 1 from public.loyalty_accounts where candidate_id = p_loser) then
    raise exception 'merge_candidate_records: both candidates have a loyalty account; merge the points ledger manually';
  end if;
  if exists (select 1 from public.loyalty_transactions     where candidate_id = p_survivor)
     and exists (select 1 from public.loyalty_transactions where candidate_id = p_loser) then
    raise exception 'merge_candidate_records: both candidates have loyalty transactions; merge the points ledger manually';
  end if;

  delete from public.candidate_skills where candidate_id = p_loser;

  delete from public.matches l
    where l.candidate_id = p_loser
      and exists (select 1 from public.matches s
                  where s.candidate_id = p_survivor and s.vacancy_id = l.vacancy_id);
  update public.matches set candidate_id = p_survivor where candidate_id = p_loser;

  delete from public.match_distance_cache l
    where l.candidate_id = p_loser
      and exists (select 1 from public.match_distance_cache s
                  where s.candidate_id = p_survivor
                    and s.vacancy_id = l.vacancy_id and s.provider = l.provider);
  update public.match_distance_cache set candidate_id = p_survivor where candidate_id = p_loser;

  delete from public.communication_preferences l
    where l.candidate_id = p_loser
      and exists (select 1 from public.communication_preferences s
                  where s.candidate_id = p_survivor
                    and s.channel = l.channel and s.organization_id = l.organization_id);
  update public.communication_preferences set candidate_id = p_survivor where candidate_id = p_loser;

  delete from public.talentpool_members l
    where l.candidate_id = p_loser
      and exists (select 1 from public.talentpool_members s
                  where s.candidate_id = p_survivor and s.talentpool_id = l.talentpool_id);
  update public.talentpool_members set candidate_id = p_survivor where candidate_id = p_loser;

  delete from public.campaign_recipients l
    where l.candidate_id = p_loser
      and exists (select 1 from public.campaign_recipients s
                  where s.candidate_id = p_survivor and s.campaign_id = l.campaign_id);
  update public.campaign_recipients set candidate_id = p_survivor where candidate_id = p_loser;

  delete from public.birthday_campaign_logs l
    where l.candidate_id = p_loser
      and exists (select 1 from public.birthday_campaign_logs s
                  where s.candidate_id = p_survivor
                    and s.organization_id = l.organization_id and s.birthday_date = l.birthday_date);
  update public.birthday_campaign_logs set candidate_id = p_survivor where candidate_id = p_loser;

  delete from public.candidate_data_quality_flags l
    where l.candidate_id = p_loser
      and exists (select 1 from public.candidate_data_quality_flags s
                  where s.candidate_id = p_survivor
                    and s.organization_id = l.organization_id and s.flag_type = l.flag_type);
  update public.candidate_data_quality_flags set candidate_id = p_survivor where candidate_id = p_loser;

  update public.loyalty_accounts     set candidate_id = p_survivor where candidate_id = p_loser;
  update public.loyalty_transactions set candidate_id = p_survivor where candidate_id = p_loser;
  update public.reward_redemptions   set candidate_id = p_survivor where candidate_id = p_loser;

  if v_loser_emp is not null then
    update public.employees set candidate_id = p_survivor where id = v_loser_emp;
  end if;

  for v_tbl in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not c.relispartition
      and a.attname = 'candidate_id'
      and not a.attisdropped
      and c.relname <> all (v_handled)
  loop
    execute format('update public.%I set candidate_id = $1 where candidate_id = $2', v_tbl)
      using p_survivor, p_loser;
  end loop;

  -- polymorphic references (no FK to candidates) -> repoint by entity_id
  delete from public.external_mappings l
    where l.entity_type = 'candidate' and l.entity_id = p_loser
      and exists (select 1 from public.external_mappings s
                  where s.entity_type = 'candidate' and s.entity_id = p_survivor
                    and s.organization_id = l.organization_id
                    and s.external_system = l.external_system);
  update public.external_mappings set entity_id = p_survivor
    where entity_type = 'candidate' and entity_id = p_loser;

  update public.notes set related_entity_id = p_survivor
    where related_entity_type = 'candidate' and related_entity_id = p_loser;

  delete from public.custom_field_values l
    where l.entity_id = p_loser
      and exists (select 1 from public.custom_field_values s
                  where s.entity_id = p_survivor and s.custom_field_id = l.custom_field_id);
  update public.custom_field_values set entity_id = p_survivor where entity_id = p_loser;

  update public.candidate_employment
     set is_current = false
   where candidate_id = p_survivor and is_current = true
     and id <> (
       select id from public.candidate_employment
        where candidate_id = p_survivor and is_current = true
        order by start_date desc nulls last, created_at desc, id desc
        limit 1
     );

  select string_agg(format('%1$I = coalesce(s.%1$I, l.%1$I)', column_name), ', ')
    into v_set
  from information_schema.columns
  where table_schema = 'public' and table_name = 'candidates'
    and column_name <> all (v_skip_cols);

  if v_set is not null then
    execute format(
      'update public.candidates s set %s from public.candidates l where s.id = $1 and l.id = $2',
      v_set
    ) using p_survivor, p_loser;
  end if;

  update public.candidates s set
    cv_file_url = l.cv_file_url, cv_raw_text = l.cv_raw_text, cv_has_photo = l.cv_has_photo,
    cv_pseudonymized_at = l.cv_pseudonymized_at, cv_pseudonymization_meta = l.cv_pseudonymization_meta,
    ai_analysis = l.ai_analysis, ai_analyzed_at = l.ai_analyzed_at, ai_function_group = l.ai_function_group,
    ai_classification = l.ai_classification, ai_reliability_score = l.ai_reliability_score,
    ai_interview_questions = l.ai_interview_questions, ai_risk_factors = l.ai_risk_factors,
    ai_summary = l.ai_summary, ai_status = l.ai_status, ai_stability = l.ai_stability,
    ai_red_flags = l.ai_red_flags, ai_positive_signals = l.ai_positive_signals,
    ai_target_functions = l.ai_target_functions, ai_languages = l.ai_languages
  from public.candidates l
  where s.id = p_survivor and l.id = p_loser
    and s.cv_file_url is null and l.cv_file_url is not null;

  insert into public.audit_log (organization_id, user_id, action, table_name, record_id, old_values, new_values, reason)
  values (
    v_survivor.organization_id, p_actor, 'delete', 'candidates', p_loser,
    to_jsonb(v_loser) - 'bsn' - 'iban',
    jsonb_build_object('merged_into', p_survivor),
    format('candidate merge: %s merged into %s', p_loser, p_survivor)
  );

  delete from public.candidates where id = p_loser;

  return jsonb_build_object(
    'survivor', p_survivor,
    'loser', p_loser,
    'organization_id', v_survivor.organization_id,
    'merged', true
  );
end;
$function$;

-- 2. find_duplicate_candidates — read-only detectie van waarschijnlijke dubbele
--    profielen binnen de EIGEN organisatie (tenant-veilig via auth.uid()).
--    Groepeert op (a) zelfde telefoon (laatste 9 cijfers) of (b) zelfde
--    geboortedatum + achternaam. E-mail bewust niet als sleutel: info@-catch-all
--    is gedeeld en zou valse dubbelen opleveren.
create or replace function public.find_duplicate_candidates()
returns table (
  group_key text,
  match_reason text,
  candidate_id uuid,
  first_name text,
  last_name text,
  email text,
  phone text,
  date_of_birth date,
  status text,
  created_at timestamptz,
  has_employee boolean
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with me as (
    select organization_id from public.profiles where id = auth.uid()
  ),
  base as (
    select c.id, c.first_name, c.last_name, c.email, c.phone, c.date_of_birth,
           c.status::text as status, c.created_at,
           nullif(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), '') as phone_digits,
           lower(nullif(trim(c.last_name), '')) as lname
    from public.candidates c
    where c.organization_id = (select organization_id from me)
  ),
  phone_groups as (
    select 'phone:' || right(phone_digits, 9) as group_key,
           'Zelfde telefoonnummer' as match_reason, id
    from base
    where length(phone_digits) >= 9
      and right(phone_digits, 9) in (
        select right(phone_digits, 9) from base
        where length(phone_digits) >= 9
        group by right(phone_digits, 9) having count(*) > 1
      )
  ),
  dob_groups as (
    select 'dob:' || date_of_birth::text || ':' || lname as group_key,
           'Zelfde geboortedatum + achternaam' as match_reason, id
    from base
    where date_of_birth is not null and lname is not null
      and (date_of_birth, lname) in (
        select date_of_birth, lname from base
        where date_of_birth is not null and lname is not null
        group by date_of_birth, lname having count(*) > 1
      )
  ),
  grouped as (
    select * from phone_groups
    union all
    select * from dob_groups
  )
  select g.group_key, g.match_reason, b.id as candidate_id,
         b.first_name, b.last_name, b.email, b.phone, b.date_of_birth,
         b.status, b.created_at,
         exists (select 1 from public.employees e where e.candidate_id = b.id) as has_employee
  from grouped g
  join base b on b.id = g.id
  order by g.group_key, b.created_at;
$function$;

-- Alleen ingelogde gebruikers; anon krijgt niets (tenant-scope via auth.uid()).
revoke execute on function public.find_duplicate_candidates() from public, anon;
grant execute on function public.find_duplicate_candidates() to authenticated;
