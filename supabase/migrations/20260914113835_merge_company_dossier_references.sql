-- Company dossier notes/tasks use opdrachtgevers, while legacy imports also use bedrijf/company.
-- Move and normalize supported labels so the merged history is visible in the dossier.
create or replace function public.merge_company_records(
  p_survivor uuid,
  p_loser uuid,
  p_actor uuid default null::uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_survivor  public.companies%rowtype;
  v_loser     public.companies%rowtype;
  -- Alleen kernidentiteit + metadata blijft van de overlever; alle overige velden
  -- vullen aan waar de overlever leeg is (coalesce). Generated kolommen sluiten we uit
  -- op eigenschap (is_generated), niet op naam — precies de fix die
  -- merge_candidate_records op 21-08 nodig had toen search_unaccent erbij kwam.
  v_skip_cols text[] := array['id', 'organization_id', 'created_at', 'updated_at', 'name'];
  v_tbl       text;
  v_set       text;
  v_actor     uuid;
begin
  select * into v_survivor from public.companies where id = p_survivor;
  if not found then raise exception 'merge_company_records: survivor % not found', p_survivor; end if;
  select * into v_loser from public.companies where id = p_loser;
  if not found then raise exception 'merge_company_records: loser % not found', p_loser; end if;
  if p_survivor = p_loser then
    raise exception 'merge_company_records: survivor and loser are identical (%)', p_survivor;
  end if;
  if v_survivor.organization_id <> v_loser.organization_id then
    raise exception 'merge_company_records: cannot merge across organizations (% vs %)',
      v_survivor.organization_id, v_loser.organization_id;
  end if;

  if auth.role() = 'service_role' then
    v_actor := p_actor;
  elsif auth.role() = 'authenticated' then
    if not (
      public.is_superadmin()
      or (
        public.is_internal_user()
        and v_survivor.organization_id = public.get_user_org_id()
      )
    ) then
      raise exception 'merge_company_records: not authorized';
    end if;
    v_actor := auth.uid();
  else
    raise exception 'merge_company_records: not authenticated';
  end if;

  -- Leg de samenvoeging vast voordat er ook maar een rij verhuist — zie
  -- enforce_document_storage_path hierboven. Bestaande ketens platgeslagen (A naar B
  -- en daarna B naar C wordt A naar C), zodat een enkele opzoeking altijd volstaat.
  update public.company_merges set survivor_id = p_survivor where survivor_id = p_loser;
  insert into public.company_merges (organization_id, survivor_id, loser_id, merged_by)
  values (v_survivor.organization_id, p_survivor, p_loser, v_actor)
  on conflict (loser_id) do update
    set survivor_id = excluded.survivor_id,
        merged_at   = now(),
        merged_by   = excluded.merged_by;

  -- Elke tabel met een company_id-kolom omhangen — vangt zowel de CASCADE-tabellen
  -- (vacancies, company_contacts, company_functions, company_sla, rate_agreements,
  -- communications, client_portal_invites) als de RESTRICT/NO ACTION-tabellen
  -- (documents, invoices, placements, employee_notifications), en elke toekomstige
  -- tabel met dezelfde kolom. Geen van die tabellen heeft een unique constraint op
  -- company_id (geverifieerd tegen het live schema), dus een kale UPDATE volstaat —
  -- anders dan bij candidates is er geen dedupe-voor-de-move nodig.
  for v_tbl in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid
    where n.nspname = 'public'
      and c.relkind = 'r'
      and not c.relispartition
      and a.attname = 'company_id'
      and not a.attisdropped
  loop
    execute format('update public.%I set company_id = $1 where company_id = $2', v_tbl)
      using p_survivor, p_loser;
  end loop;

  -- Polymorfe verwijzingen (geen FK naar companies) -> omhangen op entity_id.
  delete from public.external_mappings l
    where l.entity_type = 'company' and l.entity_id = p_loser
      and exists (select 1 from public.external_mappings s
                  where s.entity_type = 'company' and s.entity_id = p_survivor
                    and s.organization_id = l.organization_id
                    and s.external_system = l.external_system);
  update public.external_mappings set entity_id = p_survivor
    where entity_type = 'company' and entity_id = p_loser;

  update public.notes set related_entity_id = p_survivor, related_entity_type = 'opdrachtgever'
    where organization_id = v_survivor.organization_id
      and related_entity_type in ('opdrachtgever', 'bedrijf', 'company')
      and related_entity_id = p_loser;

  update public.recruiter_tasks set related_entity_id = p_survivor, related_entity_type = 'opdrachtgever'
    where organization_id = v_survivor.organization_id
      and related_entity_type in ('opdrachtgever', 'bedrijf', 'company')
      and related_entity_id = p_loser;

  delete from public.custom_field_values l
    where l.entity_id = p_loser
      and exists (select 1 from public.custom_field_values s
                  where s.entity_id = p_survivor and s.custom_field_id = l.custom_field_id);
  update public.custom_field_values set entity_id = p_survivor where entity_id = p_loser;

  select string_agg(format('%1$I = coalesce(s.%1$I, l.%1$I)', column_name), ', ')
    into v_set
  from information_schema.columns
  where table_schema = 'public' and table_name = 'companies'
    and column_name <> all (v_skip_cols)
    and is_generated <> 'ALWAYS';

  if v_set is not null then
    execute format(
      'update public.companies s set %s from public.companies l where s.id = $1 and l.id = $2',
      v_set
    ) using p_survivor, p_loser;
  end if;

  insert into public.audit_log (organization_id, user_id, action, table_name, record_id, old_values, new_values, reason)
  values (
    v_survivor.organization_id,
    v_actor,
    'delete',
    'companies',
    p_loser,
    to_jsonb(v_loser),
    jsonb_build_object('merged_into', p_survivor),
    format('company merge: %s merged into %s', p_loser, p_survivor)
  );

  delete from public.companies where id = p_loser;

  return jsonb_build_object(
    'survivor', p_survivor,
    'loser', p_loser,
    'organization_id', v_survivor.organization_id,
    'merged', true
  );
end;
$$;

-- SEC: SECURITY DEFINER zonder de auth-guard hierboven zou destructieve merges op
-- willekeurige company-UUID's toelaten. Mag nooit anoniem aanroepbaar zijn.
revoke execute on function public.merge_company_records(uuid, uuid, uuid) from anon, public;
grant execute on function public.merge_company_records(uuid, uuid, uuid) to authenticated, service_role;

