-- Samenvoegen van dubbele kandidaten faalde zodra de verdwijnende kandidaat een
-- document had, en bedrijfsdocumenten met bestand konden helemaal niet worden
-- opgeslagen. Een en dezelfde trigger is de oorzaak van allebei.
--
-- `documents_enforce_storage_path` eist dat `documents.file_path` in de map van de
-- eigen kandidaat staat (20260726161052). Dat is een goede regel -- hij voorkomt dat
-- iemand andermans objectpad op zijn eigen dossier registreert -- maar hij kent twee
-- situaties niet:
--
--   1. Samenvoegen. `merge_candidate_records` verhuist de documentrij naar de
--      overblijvende kandidaat, terwijl het bestand in de map van de verdwijnende
--      kandidaat blijft staan. De trigger zag een vreemd pad en brak de hele merge af:
--
--        Documentpad hoort niet bij deze kandidaat
--
--      Van de 4.283 kandidaatdocumenten zijn er 4.206 padgebonden, dus vrijwel elke
--      groep met een document liep hierop vast -- ook nadat 20260821082629 de
--      generated-kolom had opgelost.
--
--   2. Bedrijfsdocumenten. Die hebben geen `candidate_id` (wel `company_id`) en staan
--      in `<org>/companies/<bedrijf>/...`. De drie LIKE-vergelijkingen leveren met een
--      lege `candidate_id` NULL op, dus viel elke upload met bestand door naar dezelfde
--      foutmelding. Documenten bij een opdrachtgever werkten alleen zonder bestand.
--
-- De fix voegt geen uitzondering toe maar een feit: `candidate_merges` legt vast welke
-- kandidaat in welke is opgegaan. De trigger accepteert een pad daarmee alleen als de
-- samenvoeging echt heeft plaatsgevonden, en `private.can_access_storage_object` volgt
-- diezelfde lijn zodat de portaalgebruiker die overblijft zijn documenten kan blijven
-- openen. Bedrijfspaden krijgen hun eigen, even strakke vorm.

-- === 1. Herkomst van een samenvoeging ========================================

create table if not exists public.candidate_merges (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  survivor_id     uuid not null references public.candidates(id) on delete cascade,
  loser_id        uuid not null unique,
  merged_at       timestamptz not null default now(),
  -- Geen FK: bij een superadmin-merge is de actor geen rij in `profiles`.
  merged_by       uuid
);

comment on table public.candidate_merges is
  'Welke kandidaat is in welke opgegaan. Gevuld door merge_candidate_records; gelezen door de padcontrole op documents en door de opslagcontrole, zodat bestanden in de map van de verdwenen kandidaat bereikbaar blijven.';

create index if not exists candidate_merges_survivor_idx on public.candidate_merges (survivor_id);
create index if not exists candidate_merges_org_idx      on public.candidate_merges (organization_id);

alter table public.candidate_merges enable row level security;

-- Alleen lezen, en alleen intern. Schrijven gebeurt uitsluitend door de
-- SECURITY DEFINER-merge; er is bewust geen insert/update/delete-policy.
revoke all on public.candidate_merges from anon, authenticated;
grant select on public.candidate_merges to authenticated;

drop policy if exists candidate_merges_select_internal on public.candidate_merges;
create policy candidate_merges_select_internal on public.candidate_merges
  for select to authenticated
  using (organization_id = public.get_user_org_id() and public.is_internal_user());

-- === 2. Padcontrole ==========================================================

create or replace function public.document_path_matches_candidate(
  p_path text,
  p_org uuid,
  p_candidate uuid
)
returns boolean
language sql
immutable
as $fn$
  select p_path is not null
     and p_org is not null
     and p_candidate is not null
     and (
       p_path like p_org::text || '/' || p_candidate::text || '/%'
       or p_path like p_org::text || '/candidates/' || p_candidate::text || '/%'
       or p_path like p_org::text || '/candidate-signups/' || p_candidate::text || '/%'
     );
$fn$;

create or replace function public.enforce_document_storage_path()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.file_path is null then
    return new;
  end if;

  if public.document_path_matches_candidate(new.file_path, new.organization_id, new.candidate_id) then
    return new;
  end if;

  -- Bedrijfsdocument: geen kandidaat, wel een eigen map per opdrachtgever.
  if new.company_id is not null
     and new.file_path like new.organization_id::text || '/companies/' || new.company_id::text || '/%' then
    return new;
  end if;

  -- Samengevoegde kandidaat: het bestand staat in de map van de kandidaat die
  -- verdween. Alleen goed als die samenvoeging is vastgelegd.
  if new.candidate_id is not null and exists (
    select 1
    from public.candidate_merges m
    where m.survivor_id = new.candidate_id
      and m.organization_id = new.organization_id
      and public.document_path_matches_candidate(new.file_path, new.organization_id, m.loser_id)
  ) then
    return new;
  end if;

  raise exception 'Documentpad hoort niet bij deze kandidaat'
    using errcode = '23514';
end;
$fn$;

revoke all on function public.enforce_document_storage_path() from public, anon, authenticated;

-- company_id hoort in de triggerlijst: anders kan een document ongecontroleerd
-- naar een andere opdrachtgever worden omgehangen.
drop trigger if exists documents_enforce_storage_path on public.documents;
create trigger documents_enforce_storage_path
before insert or update of file_path, candidate_id, organization_id, company_id on public.documents
for each row execute function public.enforce_document_storage_path();

-- === 3. Merge legt de herkomst vast ==========================================

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

-- === 4. Opslagcontrole volgt de samenvoeging =================================

create or replace function private.can_access_storage_object(
  p_bucket text,
  p_name text,
  p_operation text,
  p_owner_id text default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_org_id uuid;
  v_role text;
  v_category text := split_part(p_name, '/', 2);
  v_subject text := split_part(p_name, '/', 3);
  v_candidate_direct boolean := false;
  v_candidate_service boolean := false;
  v_facility_write boolean := false;
  v_facility_read boolean := false;
begin
  if v_user_id is null
     or p_bucket not in ('documents', 'property-contracts')
     or p_operation not in ('select', 'insert', 'update', 'delete') then
    return false;
  end if;

  select p.organization_id, p.role::text
    into v_org_id, v_role
  from public.profiles p
  where p.id = v_user_id;

  if not found then
    return public.is_superadmin();
  end if;

  if v_role is null
     or not exists (
       select 1
       from public.profiles p
       where p.id = v_user_id
         and p.is_active is true
     ) then
    return false;
  end if;

  if split_part(p_name, '/', 1) <> v_org_id::text then
    return false;
  end if;

  if p_bucket = 'property-contracts' then
    if p_operation = 'select' then
      return v_role = any (array['admin', 'intercedent', 'backoffice', 'finance']);
    end if;
    if p_operation = 'insert' then
      return v_role = any (array['admin', 'intercedent', 'backoffice']);
    end if;
    return p_operation = 'delete' and v_role = 'admin';
  end if;

  v_facility_write := v_category = any (
    array['cleaning', 'inspections', 'damage']
  );
  v_facility_read := v_facility_write
    or v_category = any (array['checkin', 'vehicle-damage']);

  -- Existing internal roles retain the reads their screens rely on. Finance is
  -- read-only in Storage; mutation remains with operational staff.
  if p_operation = 'select'
     and v_role = any (array['admin', 'intercedent', 'backoffice', 'finance']) then
    return true;
  end if;
  if p_operation in ('insert', 'update', 'delete')
     and v_role = any (array['admin', 'intercedent', 'backoffice']) then
    return true;
  end if;

  -- Facility gets operational evidence only: never candidate folders, task
  -- attachments, vehicle fines or property contracts. Deletion stays admin/
  -- operational-staff only, matching the table policies.
  if v_role = 'facility' then
    if p_operation = 'select' then
      return v_facility_read;
    end if;
    return p_operation = 'insert' and v_facility_write;
  end if;

  if v_role <> 'medewerker' then
    return false;
  end if;

  -- Na een samenvoeging staat het bestand nog in de map van de kandidaat die
  -- verdween. De bewoner die overblijft moet er wel bij kunnen, dus telt ook een
  -- map die aantoonbaar in zijn eigen dossier is opgegaan als eigen map.
  select
    exists (
      select 1
      from public.candidates c
      where c.auth_user_id = v_user_id
        and c.organization_id = v_org_id
        and (
          c.id::text = v_category
          or exists (
            select 1
            from public.candidate_merges m
            where m.survivor_id = c.id
              and m.organization_id = v_org_id
              and m.loser_id::text = v_category
          )
        )
    ),
    exists (
      select 1
      from public.candidates c
      where c.auth_user_id = v_user_id
        and c.organization_id = v_org_id
        and v_category in ('candidates', 'candidate-signups')
        and (
          c.id::text = v_subject
          or exists (
            select 1
            from public.candidate_merges m
            where m.survivor_id = c.id
              and m.organization_id = v_org_id
              and m.loser_id::text = v_subject
          )
        )
    )
  into v_candidate_direct, v_candidate_service;

  -- Residents may read/upload their own candidate documents. Operational
  -- uploads are tied either to the new candidate-id path segment or to Storage's
  -- immutable owner_id for legacy app paths. They cannot update/delete objects.
  if p_operation = 'select' then
    return v_candidate_direct
      or v_candidate_service
      or (
        v_category = any (array['checkin', 'inspections', 'vehicle-damage'])
        and p_owner_id = v_user_id::text
      );
  end if;

  if p_operation = 'insert' then
    return v_candidate_direct
      or (
        v_category = any (array['checkin', 'inspections', 'vehicle-damage'])
        and (
          p_owner_id = v_user_id::text
          or exists (
            select 1
            from public.candidates c
            where c.auth_user_id = v_user_id
              and c.organization_id = v_org_id
              and c.id::text = v_subject
          )
        )
      );
  end if;

  return false;
end;
$$;
