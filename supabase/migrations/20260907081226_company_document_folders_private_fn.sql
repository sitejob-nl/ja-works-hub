-- Vervolg op 20260907080729 (mappen op opdrachtgeverdocumenten).
--
-- Security-advisor 0029 (authenticated_security_definer_function_executable):
-- de zichtbaarheidsfunctie stond in public en was daarmee als RPC bereikbaar
-- via /rest/v1/rpc. Ze hoort — net als private.is_active_user (restrictieve
-- policy active_profile_required) en private.can_access_storage_object — in
-- het private schema: RLS-policies en de opslagcontrole roepen haar daar
-- gewoon aan (authenticated heeft USAGE op private), maar PostgREST stelt haar
-- niet bloot. Gedrag is identiek; alleen de plek verandert.

create or replace function private.can_view_company_document_folder(p_folder_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select case
    when p_folder_id is null then true
    when not public.is_internal_user() then false
    else exists (
      select 1
      from public.company_document_folders f
      where f.id = p_folder_id
        and f.organization_id = public.get_user_org_id()
        and (
          public.get_user_role() = 'admin'::public.user_role
          or public.get_user_role() = any (f.allowed_roles)
        )
        and (
          f.required_permission is null
          or public.has_role_permission(f.required_permission)
        )
    )
  end;
$fn$;

revoke all on function private.can_view_company_document_folder(uuid) from public, anon;
grant execute on function private.can_view_company_document_folder(uuid) to authenticated, service_role;

-- === Policies opnieuw, nu op de private functie ==============================

drop policy if exists company_document_folders_select_visible on public.company_document_folders;
create policy company_document_folders_select_visible on public.company_document_folders
  for select to authenticated
  using (
    organization_id = public.get_user_org_id()
    and public.is_internal_user()
    and private.can_view_company_document_folder(id)
  );

drop policy if exists tenant_select on public.documents;
create policy tenant_select on public.documents
  for select to authenticated
  using (
    organization_id = public.get_user_org_id()
    and (
      (candidate_id is not null and public.has_role_permission('candidates.view'))
      or (
        company_id is not null
        and public.is_internal_user()
        and private.can_view_company_document_folder(company_document_folder_id)
      )
    )
  );

drop policy if exists tenant_insert on public.documents;
create policy tenant_insert on public.documents
  for insert to authenticated
  with check (
    organization_id = public.get_user_org_id()
    and public.is_internal_user()
    and (
      company_id is null
      or private.can_view_company_document_folder(company_document_folder_id)
    )
  );

drop policy if exists tenant_update on public.documents;
create policy tenant_update on public.documents
  for update to authenticated
  using (
    organization_id = public.get_user_org_id()
    and public.is_internal_user()
    and (
      company_id is null
      or private.can_view_company_document_folder(company_document_folder_id)
    )
  )
  with check (
    organization_id = public.get_user_org_id()
    and public.is_internal_user()
    and (
      company_id is null
      or private.can_view_company_document_folder(company_document_folder_id)
    )
  );

-- === Opslagcontrole: zelfde body als 20260907080729, aanroep naar private ====

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

  -- Bedrijfsdocumenten (<org>/companies/<bedrijf>/...): de map van de
  -- documentrij bepaalt wie het bestand mag openen — dezelfde controle als de
  -- RLS op documents, zodat een signed URL niet om de weergave heen kan.
  -- Zonder documentrij (upload vóór registratie, of een verweesd object) geldt
  -- de bestaande regel: interne rollen, finance alleen lezend.
  if v_category = 'companies' then
    if p_operation = 'select' then
      if not (v_role = any (array['admin', 'intercedent', 'backoffice', 'finance'])) then
        return false;
      end if;
    elsif not (v_role = any (array['admin', 'intercedent', 'backoffice'])) then
      return false;
    end if;

    return not exists (
      select 1
      from public.documents d
      where d.organization_id = v_org_id
        and d.file_path = p_name
        and d.company_document_folder_id is not null
        and not private.can_view_company_document_folder(d.company_document_folder_id)
    );
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

-- Nu niets meer naar de public-variant verwijst, kan die weg.
drop function if exists public.can_view_company_document_folder(uuid);
