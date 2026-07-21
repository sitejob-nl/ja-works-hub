-- Harde verwijdering van kandidaten (AVG recht-op-verwijdering + spam/dubbele records).
-- Twee RPC's:
--   * delete_candidate_preview(p_candidate_id)  -> jsonb met tellingen (voor de waarschuwingsdialoog)
--   * delete_candidate_record(p_candidate_id, p_reason) -> verwijdert kandidaat + afhankelijke rijen
--
-- Ontwerpkeuzes:
--   - Toegestaan voor rollen admin + intercedent (en service_role); anon/portaalrollen niet.
--   - Historie (plaatsingen/uren/contracten) wordt hard mee-verwijderd — de UI waarschuwt vooraf.
--   - invoice_lines worden NIET verwijderd maar losgekoppeld (candidate_id -> null):
--     facturen zijn financiële administratie en moeten intact blijven.
--   - external_mappings (Carerix) blijft staan als tombstone (metadata.deleted=true):
--     de sync-worker skipt bestaande mappings, dus de kandidaat komt bij een volgende
--     import niet terug. Zonder tombstone zou elke sync het record opnieuw aanmaken.
--   - Storage-bestanden kunnen niet vanuit plpgsql weg; de RPC geeft document_paths
--     terug zodat de frontend ze uit de documents-bucket verwijdert.
--   - Audit: één audit_log-rij met old_values = kern van het kandidaatrecord + reden.

create or replace function public.delete_candidate_preview(p_candidate_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cand   public.candidates%rowtype;
  v_role   public.user_role;
  v_emp_ids uuid[];
begin
  select * into v_cand from public.candidates where id = p_candidate_id;
  if not found then
    raise exception 'delete_candidate_preview: kandidaat % niet gevonden', p_candidate_id;
  end if;

  if auth.uid() is not null then
    v_role := public.get_user_role();
    if v_role not in ('admin','intercedent') then
      raise exception 'delete_candidate_preview: rol % mag geen kandidaten verwijderen', v_role;
    end if;
    if public.get_user_org_id() is distinct from v_cand.organization_id then
      raise exception 'delete_candidate_preview: kandidaat hoort niet bij jouw organisatie';
    end if;
  end if;

  select coalesce(array_agg(id), '{}') into v_emp_ids
    from public.employees where candidate_id = p_candidate_id;

  return jsonb_build_object(
    'candidate_id', v_cand.id,
    'full_name', trim(coalesce(v_cand.first_name,'') || ' ' || coalesce(v_cand.last_name,'')),
    'has_employee_record', cardinality(v_emp_ids) > 0,
    'matches',      (select count(*) from public.matches      where candidate_id = p_candidate_id),
    'placements',   (select count(*) from public.placements   where candidate_id = p_candidate_id or employee_id = any(v_emp_ids)),
    'timesheets',   (select count(*) from public.timesheets   where candidate_id = p_candidate_id or employee_id = any(v_emp_ids)),
    'contracts',    (select count(*) from public.contracts    where candidate_id = p_candidate_id or employee_id = any(v_emp_ids)),
    'documents',    (select count(*) from public.documents    where candidate_id = p_candidate_id or employee_id = any(v_emp_ids)),
    'housing',      (select count(*) from public.housing_assignments where candidate_id = p_candidate_id or employee_id = any(v_emp_ids)),
    'vehicles',     (select count(*) from public.vehicle_assignments where candidate_id = p_candidate_id or employee_id = any(v_emp_ids)),
    'invoice_lines',(select count(*) from public.invoice_lines where candidate_id = p_candidate_id),
    'notes',        (select count(*) from public.notes where related_entity_type = 'kandidaat' and related_entity_id = p_candidate_id),
    'communications',(select count(*) from public.communications where candidate_id = p_candidate_id)
  );
end;
$$;

create or replace function public.delete_candidate_record(
  p_candidate_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cand     public.candidates%rowtype;
  v_role     public.user_role;
  v_actor    uuid := auth.uid();
  v_emp_ids  uuid[];
  v_doc_paths text[];
  v_summary  jsonb := '{}'::jsonb;
  v_n        bigint;
  v_tbl      text;
begin
  select * into v_cand from public.candidates where id = p_candidate_id for update;
  if not found then
    raise exception 'delete_candidate_record: kandidaat % niet gevonden', p_candidate_id;
  end if;

  -- Autorisatie: ingelogde gebruiker moet admin/intercedent in dezelfde org zijn.
  -- Zonder auth.uid() (service_role vanuit edge functions/scripts) is de check overgeslagen.
  if v_actor is not null then
    v_role := public.get_user_role();
    if v_role not in ('admin','intercedent') then
      raise exception 'delete_candidate_record: rol % mag geen kandidaten verwijderen', v_role;
    end if;
    if public.get_user_org_id() is distinct from v_cand.organization_id then
      raise exception 'delete_candidate_record: kandidaat hoort niet bij jouw organisatie';
    end if;
  end if;

  select coalesce(array_agg(id), '{}') into v_emp_ids
    from public.employees where candidate_id = p_candidate_id;

  -- Storage-paden verzamelen vóór de documents-rijen verdwijnen.
  select coalesce(array_agg(file_path), '{}') into v_doc_paths
    from public.documents
    where (candidate_id = p_candidate_id or employee_id = any(v_emp_ids))
      and file_path is not null;

  -- 1. Diepste afhankelijkheden eerst (FK-ketens zonder cascade).
  delete from public.housing_inspections hi
    using public.housing_assignments ha
    where hi.housing_assignment_id = ha.id
      and (ha.candidate_id = p_candidate_id or ha.employee_id = any(v_emp_ids));
  get diagnostics v_n = row_count;
  v_summary := v_summary || jsonb_build_object('housing_inspections', v_n);

  delete from public.timesheets t
    where t.candidate_id = p_candidate_id
       or t.employee_id = any(v_emp_ids)
       or t.placement_id in (
            select id from public.placements
            where candidate_id = p_candidate_id or employee_id = any(v_emp_ids));
  get diagnostics v_n = row_count;
  v_summary := v_summary || jsonb_build_object('timesheets', v_n);

  delete from public.hour_letters h
    where h.candidate_id = p_candidate_id
       or h.employee_id = any(v_emp_ids)
       or h.placement_id in (
            select id from public.placements
            where candidate_id = p_candidate_id or employee_id = any(v_emp_ids));
  get diagnostics v_n = row_count;
  v_summary := v_summary || jsonb_build_object('hour_letters', v_n);

  delete from public.sick_reports s
    where s.candidate_id = p_candidate_id
       or s.employee_id = any(v_emp_ids)
       or s.placement_id in (
            select id from public.placements
            where candidate_id = p_candidate_id or employee_id = any(v_emp_ids));
  get diagnostics v_n = row_count;
  v_summary := v_summary || jsonb_build_object('sick_reports', v_n);

  delete from public.placements
    where candidate_id = p_candidate_id or employee_id = any(v_emp_ids);
  get diagnostics v_n = row_count;
  v_summary := v_summary || jsonb_build_object('placements', v_n);

  -- 2. Facturen loskoppelen, niet verwijderen (financiële bewaarplicht).
  update public.invoice_lines set candidate_id = null where candidate_id = p_candidate_id;
  get diagnostics v_n = row_count;
  v_summary := v_summary || jsonb_build_object('invoice_lines_detached', v_n);

  -- 3. Alle overige tabellen met een kandidaat-FK zonder cascade/set-null,
  --    dynamisch zodat nieuwe tabellen automatisch meegaan.
  --    (CASCADE- en SET NULL-FK's regelen zichzelf bij de uiteindelijke delete.)
  for v_tbl in
    select distinct c.conrelid::regclass::text
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.contype = 'f'
      and c.confrelid = 'public.candidates'::regclass
      and a.attname = 'candidate_id'
      and c.confdeltype in ('a','r')  -- NO ACTION / RESTRICT
      and c.conrelid::regclass::text not in (
        'timesheets','hour_letters','sick_reports','placements',
        'invoice_lines','employees','housing_inspections')
  loop
    execute format('delete from public.%I where candidate_id = $1', v_tbl) using p_candidate_id;
    get diagnostics v_n = row_count;
    if v_n > 0 then v_summary := v_summary || jsonb_build_object(v_tbl, v_n); end if;
  end loop;

  -- 4. Legacy employees-rij + resterende employee_id-verwijzingen.
  for v_tbl in
    select distinct c.conrelid::regclass::text
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
    where c.contype = 'f'
      and c.confrelid = 'public.employees'::regclass
      and a.attname = 'employee_id'
      and c.confdeltype in ('a','r')
  loop
    execute format('delete from public.%I where employee_id = any($1)', v_tbl) using v_emp_ids;
    get diagnostics v_n = row_count;
    if v_n > 0 then v_summary := v_summary || jsonb_build_object(v_tbl || ' (medewerker)', v_n); end if;
  end loop;

  delete from public.employees where id = any(v_emp_ids);
  get diagnostics v_n = row_count;
  if v_n > 0 then v_summary := v_summary || jsonb_build_object('employees', v_n); end if;

  -- 5. Polymorfe verwijzingen (geen FK).
  delete from public.notes
    where related_entity_type = 'kandidaat' and related_entity_id = p_candidate_id;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_summary := v_summary || jsonb_build_object('notes', v_n); end if;

  delete from public.recruiter_tasks
    where related_entity_type = 'kandidaat' and related_entity_id = p_candidate_id;
  get diagnostics v_n = row_count;
  if v_n > 0 then v_summary := v_summary || jsonb_build_object('recruiter_tasks', v_n); end if;

  -- 6. Carerix-mapping als tombstone laten staan: de sync-worker skipt bestaande
  --    mappings, dus dit voorkomt her-import van het verwijderde record.
  update public.external_mappings
    set metadata = coalesce(metadata, '{}'::jsonb)
                   || jsonb_build_object('deleted', true, 'deleted_at', now())
    where entity_type = 'candidate' and entity_id = p_candidate_id;

  -- 7. Audit vóór de delete (kernvelden, geen BSN/IBAN — die zijn versleuteld en blijven eruit).
  insert into public.audit_log
    (organization_id, user_id, action, table_name, record_id, old_values, reason)
  values (
    v_cand.organization_id,
    v_actor,
    'delete',
    'candidates',
    p_candidate_id,
    jsonb_build_object(
      'first_name', v_cand.first_name,
      'last_name',  v_cand.last_name,
      'email',      v_cand.email,
      'phone',      v_cand.phone,
      'status',     v_cand.status,
      'source',     v_cand.source,
      'created_at', v_cand.created_at,
      'deleted_relations', v_summary
    ),
    p_reason
  );

  -- 8. De kandidaat zelf; CASCADE/SET NULL-FK's vuren hier.
  delete from public.candidates where id = p_candidate_id;

  return jsonb_build_object(
    'deleted', true,
    'candidate_id', p_candidate_id,
    'summary', v_summary,
    'document_paths', to_jsonb(v_doc_paths)
  );
end;
$$;

revoke all on function public.delete_candidate_preview(uuid) from public, anon;
revoke all on function public.delete_candidate_record(uuid, text) from public, anon;
grant execute on function public.delete_candidate_preview(uuid) to authenticated, service_role;
grant execute on function public.delete_candidate_record(uuid, text) to authenticated, service_role;
