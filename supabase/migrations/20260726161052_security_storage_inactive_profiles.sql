-- Production hardening before handover:
--   1. A disabled profile must lose database and edge access immediately.
--   2. Storage access is role/category scoped instead of organization-folder only.
--   3. Users cannot reactivate their own profile through the profiles UPDATE policy.

begin;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create or replace function private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.is_active is true
    )
    or (
      not exists (
        select 1
        from public.profiles p
        where p.id = (select auth.uid())
      )
      and public.is_superadmin()
    );
$$;

revoke all on function private.is_active_user() from public, anon;
grant execute on function private.is_active_user() to authenticated, service_role;

-- Central helpers used by the majority of tenant RLS policies. Returning NULL
-- for disabled profiles makes all existing organization/role checks fail closed.
create or replace function public.get_user_org_id()
returns uuid
language sql
stable
security definer
set search_path = 'public', 'extensions', 'vault', 'pg_temp'
as $$
  select organization_id
  from public.profiles
  where id = (select auth.uid())
    and is_active is true
$$;

create or replace function public.get_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = 'public', 'extensions', 'vault', 'pg_temp'
as $$
  select role
  from public.profiles
  where id = (select auth.uid())
    and is_active is true
$$;

-- Portal identity helpers are SECURITY DEFINER and therefore bypass table RLS.
-- Bind each one to an active profile explicitly so disabled portal JWTs cannot
-- retain self-service identities or decrypted-data access.
create or replace function public.get_employee_candidate_id()
returns uuid
language sql
stable
security definer
set search_path = 'public', 'extensions', 'vault', 'pg_temp'
as $$
  select c.id
  from public.candidates c
  join public.profiles p
    on p.id = (select auth.uid())
   and p.organization_id = c.organization_id
   and p.role = 'medewerker'::public.user_role
   and p.is_active is true
  where c.auth_user_id = (select auth.uid())
$$;

create or replace function public.get_portal_org_id()
returns uuid
language sql
stable
security definer
set search_path = 'public', 'extensions', 'vault', 'pg_temp'
as $$
  select c.organization_id
  from public.candidates c
  join public.profiles p
    on p.id = (select auth.uid())
   and p.organization_id = c.organization_id
   and p.role = 'medewerker'::public.user_role
   and p.is_active is true
  where c.auth_user_id = (select auth.uid())
$$;

create or replace function public.get_employee_id()
returns uuid
language sql
stable
security definer
set search_path = 'public', 'extensions', 'vault', 'pg_temp'
as $$
  select e.id
  from public.employees e
  join public.profiles p
    on p.id = (select auth.uid())
   and p.organization_id = e.organization_id
   and p.role = 'medewerker'::public.user_role
   and p.is_active is true
  where e.auth_user_id = (select auth.uid())
$$;

create or replace function public.is_employee_user()
returns boolean
language sql
stable
security definer
set search_path = 'public', 'extensions', 'vault', 'pg_temp'
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'medewerker'::public.user_role
      and p.is_active is true
  )
$$;

create or replace function public.get_client_portal_company_id()
returns uuid
language sql
stable
security definer
set search_path = 'public'
as $$
  select cc.company_id
  from public.company_contacts cc
  join public.profiles p
    on p.id = (select auth.uid())
   and p.organization_id = cc.organization_id
   and p.role = 'opdrachtgever'::public.user_role
   and p.is_active is true
  where cc.auth_user_id = (select auth.uid())
  limit 1
$$;

create or replace function public.get_my_sensitive_data()
returns table(decrypted_bsn text, decrypted_iban text)
language plpgsql
security definer
set search_path = 'public', 'extensions', 'vault', 'pg_temp'
as $$
begin
  if auth.role() <> 'authenticated' then
    raise exception 'Not authenticated';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'medewerker'::public.user_role
      and p.is_active is true
  ) then
    raise exception 'Account is uitgeschakeld of niet toegestaan'
      using errcode = '42501';
  end if;

  return query
  select
    public.decrypt_sensitive(c.bsn) as decrypted_bsn,
    public.decrypt_sensitive(c.iban) as decrypted_iban
  from public.candidates c
  join public.profiles p
    on p.id = (select auth.uid())
   and p.organization_id = c.organization_id
   and p.role = 'medewerker'::public.user_role
   and p.is_active is true
  where c.auth_user_id = (select auth.uid());
end;
$$;

-- A disabled user may still SELECT their own profile so the frontend can show
-- the disabled-account state, but cannot mutate any profile fields.
drop policy if exists active_profile_update_required on public.profiles;
create policy active_profile_update_required
on public.profiles as restrictive for update to authenticated
using ((select private.is_active_user()))
with check ((select private.is_active_user()));

-- profiles_update intentionally permits self-service profile edits. Keep those
-- edits, but reserve account activation/deactivation for the audited service-role
-- user-management boundary (or a superadmin).
create or replace function public.enforce_profile_immutable_fields()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if old.id is distinct from new.id then
    raise exception 'profiles.id is immutable';
  end if;

  if old.organization_id is distinct from new.organization_id
     and not public.is_superadmin() then
    raise exception 'profiles.organization_id can only be changed by a superadmin';
  end if;

  if old.role is distinct from new.role
     and coalesce(auth.role(), '') <> 'service_role'
     and not public.is_superadmin()
     and public.get_user_role() is distinct from 'admin'::public.user_role then
    raise exception 'Only admins can change profile roles';
  end if;

  if old.is_active is distinct from new.is_active
     and coalesce(auth.role(), '') <> 'service_role'
     and not (
       public.is_superadmin()
       and old.id is distinct from (select auth.uid())
     ) then
    raise exception 'Profile activation can only be changed through user management';
  end if;

  return new;
end;
$$;

-- Candidate-document metadata is later consumed by service-role edge functions.
-- Bind every newly stored path to that row's organization/candidate namespace so
-- a portal user cannot register somebody else's known object path for signing.
create or replace function public.enforce_document_storage_path()
returns trigger
language plpgsql
set search_path = 'public'
as $$
begin
  if new.file_path is null then
    return new;
  end if;

  if new.file_path like new.organization_id::text || '/' || new.candidate_id::text || '/%'
     or new.file_path like new.organization_id::text || '/candidates/' || new.candidate_id::text || '/%'
     or new.file_path like new.organization_id::text || '/candidate-signups/' || new.candidate_id::text || '/%' then
    return new;
  end if;

  raise exception 'Documentpad hoort niet bij deze kandidaat'
    using errcode = '23514';
end;
$$;

drop trigger if exists documents_enforce_storage_path on public.documents;
create trigger documents_enforce_storage_path
before insert or update of file_path, candidate_id, organization_id on public.documents
for each row execute function public.enforce_document_storage_path();

revoke all on function public.enforce_document_storage_path() from public, anon, authenticated;

-- Portal evidence rows are operational input, not a way to set internal,
-- financial or routing state. The existing self INSERT policies prove row
-- ownership; this trigger additionally allowlists server-managed fields and
-- candidate-bound Storage paths.
create or replace function public.enforce_portal_operational_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate_id uuid;
  v_org_id uuid;
  v_path text;
  v_expected_prefix text;
begin
  if public.get_user_role()::text is distinct from 'medewerker' then
    return new;
  end if;

  if tg_op <> 'INSERT' then
    raise exception 'Portaalgegevens kunnen hier alleen worden toegevoegd'
      using errcode = '42501';
  end if;

  v_candidate_id := public.get_employee_candidate_id();
  v_org_id := public.get_portal_org_id();
  if v_candidate_id is null or v_org_id is null then
    raise exception 'Geen actief medewerkerprofiel'
      using errcode = '42501';
  end if;

  if tg_table_name = 'housing_inspections' then
    if new.inspected_by is not null
       or coalesce(new.resolved, false)
       or new.resolved_at is not null
       or new.notes is not null then
      raise exception 'Interne inspectievelden zijn niet schrijfbaar vanuit het portaal'
        using errcode = '42501';
    end if;

    -- Evidence timestamps are server-authored. A resident may confirm their
    -- own check-in, but cannot backdate either the row or that confirmation.
    new.created_at := now();
    new.confirmed_at := case
      when coalesce(new.confirmed_by_resident, false) then now()
      else null
    end;

    v_expected_prefix := case new.inspection_type::text
      when 'check_in' then v_org_id::text || '/checkin/' || v_candidate_id::text || '/'
      when 'klacht' then v_org_id::text || '/inspections/' || v_candidate_id::text || '/'
      else null
    end;
    if v_expected_prefix is null then
      raise exception 'Inspectietype is niet toegestaan vanuit het portaal'
        using errcode = '42501';
    end if;

    foreach v_path in array coalesce(new.photos, array[]::text[]) loop
      if not v_path like v_expected_prefix || '%'
         or v_path like '%/../%'
         or v_path like '%://%' then
        raise exception 'Inspectiefoto hoort niet bij deze medewerker'
          using errcode = '42501';
      end if;
    end loop;
    foreach v_path in array array[
      new.photo_mattress,
      new.photo_room_overview,
      new.photo_bathroom,
      new.photo_kitchen,
      new.photo_damage
    ] loop
      if v_path is not null and (
        not v_path like v_expected_prefix || '%'
        or v_path like '%/../%'
        or v_path like '%://%'
      ) then
        raise exception 'Inspectiefoto hoort niet bij deze medewerker'
          using errcode = '42501';
      end if;
    end loop;

  elsif tg_table_name = 'vehicle_damage_reports' then
    if new.candidate_id is distinct from v_candidate_id
       or coalesce(new.resolved, false)
       or new.resolved_at is not null
       or new.resolution_notes is not null
       or new.cost_estimate is not null
       or coalesce(new.garage_notified, false)
       or new.garage_notified_at is not null
       or new.garage_email is not null
       or new.internal_contact_email is not null
       or new.external_contact_email is not null
       or coalesce(new.contact_phone_shared, false)
       or coalesce(new.contact_route, 'internal_fleet') <> 'internal_fleet'
       or coalesce(new.route_status, 'pending_internal') <> 'pending_internal' then
      raise exception 'Interne schadevelden zijn niet schrijfbaar vanuit het portaal'
        using errcode = '42501';
    end if;

    -- Portal reports are append-only evidence; client-supplied timestamps must
    -- not be usable to rewrite the incident chronology.
    new.reported_at := now();
    new.created_at := now();
    new.updated_at := now();

    if not exists (
      select 1
      from public.employees e
      join public.vehicle_assignments a
        on a.candidate_id = e.candidate_id
       and (a.employee_id is null or a.employee_id = e.id)
       and a.organization_id = e.organization_id
       and a.vehicle_id = new.vehicle_id
       and a.returned_date is null
      where e.id = new.employee_id
        and e.candidate_id = v_candidate_id
        and e.organization_id = v_org_id
    ) then
      raise exception 'Voertuig of medewerker hoort niet bij de actieve portaaltoewijzing'
        using errcode = '42501';
    end if;

    v_expected_prefix := v_org_id::text || '/vehicle-damage/' || v_candidate_id::text || '/';
    foreach v_path in array coalesce(new.photos, array[]::text[]) loop
      if not v_path like v_expected_prefix || '%'
         or v_path like '%/../%'
         or v_path like '%://%' then
        raise exception 'Schadefoto hoort niet bij deze medewerker'
          using errcode = '42501';
      end if;
    end loop;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_portal_operational_fields()
  from public, anon, authenticated;

drop trigger if exists housing_inspections_portal_field_guard
  on public.housing_inspections;
create trigger housing_inspections_portal_field_guard
before insert or update on public.housing_inspections
for each row execute function public.enforce_portal_operational_fields();

drop trigger if exists vehicle_damage_reports_portal_field_guard
  on public.vehicle_damage_reports;
create trigger vehicle_damage_reports_portal_field_guard
before insert or update on public.vehicle_damage_reports
for each row execute function public.enforce_portal_operational_fields();

-- Audit history is append-only. Permissive UPDATE/DELETE policies previously
-- allowed same-org staff to rewrite or erase the audit trail.
do $$
declare
  target record;
begin
  for target in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'audit_log'
      and cmd in ('UPDATE', 'DELETE', 'ALL')
  loop
    execute format('drop policy if exists %I on public.audit_log', target.policyname);
  end loop;
end;
$$;

revoke update, delete on public.audit_log from authenticated, anon;

-- A restrictive policy composes with every existing permissive policy. This
-- closes direct auth.uid()-based portal policies as well as org helper policies.
-- profiles is excluded so a disabled user can read only their own profile and the
-- frontend can show/sign out the disabled account; self-reactivation is blocked by
-- the trigger above. Superadmins have no regular profile and remain allowed.
do $$
declare
  target record;
begin
  for target in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
      and c.relname <> 'profiles'
  loop
    execute format(
      'drop policy if exists active_profile_required on %I.%I',
      target.schema_name,
      target.table_name
    );
    execute format(
      'create policy active_profile_required on %I.%I as restrictive for all to authenticated using ((select private.is_active_user())) with check ((select private.is_active_user()))',
      target.schema_name,
      target.table_name
    );
  end loop;
end;
$$;

-- The helper is deliberately in an unexposed schema. It returns only a boolean,
-- always binds authorization to auth.uid(), and is used exclusively by Storage
-- policies. Role text comparisons keep this migration valid before the Facility
-- enum value is added by the following migration.
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

  select
    exists (
      select 1
      from public.candidates c
      where c.auth_user_id = v_user_id
        and c.organization_id = v_org_id
        and c.id::text = v_category
    ),
    exists (
      select 1
      from public.candidates c
      where c.auth_user_id = v_user_id
        and c.organization_id = v_org_id
        and v_category in ('candidates', 'candidate-signups')
        and c.id::text = v_subject
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

revoke all on function private.can_access_storage_object(text, text, text, text)
  from public, anon;
grant execute on function private.can_access_storage_object(text, text, text, text)
  to authenticated, service_role;

-- Remove every permissive policy that mentions one of the three application
-- buckets. Keeping even one old org-folder policy would OR around the new rules.
do $$
declare
  target record;
begin
  for target in
    select policyname
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and (
        position('documents' in coalesce(qual, '')) > 0
        or position('documents' in coalesce(with_check, '')) > 0
        or position('property-contracts' in coalesce(qual, '')) > 0
        or position('property-contracts' in coalesce(with_check, '')) > 0
        or position('organization-logos' in coalesce(qual, '')) > 0
        or position('organization-logos' in coalesce(with_check, '')) > 0
      )
  loop
    execute format('drop policy if exists %I on storage.objects', target.policyname);
  end loop;
end;
$$;

create policy storage_documents_select_v2
on storage.objects for select to authenticated
using (
  bucket_id = 'documents'
  and (select private.can_access_storage_object(bucket_id, name, 'select', owner_id))
);

create policy storage_documents_insert_v2
on storage.objects for insert to authenticated
with check (
  bucket_id = 'documents'
  and (select private.can_access_storage_object(bucket_id, name, 'insert', owner_id))
);

create policy storage_documents_update_v2
on storage.objects for update to authenticated
using (
  bucket_id = 'documents'
  and (select private.can_access_storage_object(bucket_id, name, 'update', owner_id))
)
with check (
  bucket_id = 'documents'
  and (select private.can_access_storage_object(bucket_id, name, 'update', owner_id))
);

create policy storage_documents_delete_v2
on storage.objects for delete to authenticated
using (
  bucket_id = 'documents'
  and (select private.can_access_storage_object(bucket_id, name, 'delete', owner_id))
);

create policy storage_property_contracts_select_v2
on storage.objects for select to authenticated
using (
  bucket_id = 'property-contracts'
  and (select private.can_access_storage_object(bucket_id, name, 'select', owner_id))
);

create policy storage_property_contracts_insert_v2
on storage.objects for insert to authenticated
with check (
  bucket_id = 'property-contracts'
  and (select private.can_access_storage_object(bucket_id, name, 'insert', owner_id))
);

create policy storage_property_contracts_update_v2
on storage.objects for update to authenticated
using (
  bucket_id = 'property-contracts'
  and (select private.can_access_storage_object(bucket_id, name, 'update', owner_id))
)
with check (
  bucket_id = 'property-contracts'
  and (select private.can_access_storage_object(bucket_id, name, 'update', owner_id))
);

create policy storage_property_contracts_delete_v2
on storage.objects for delete to authenticated
using (
  bucket_id = 'property-contracts'
  and (select private.can_access_storage_object(bucket_id, name, 'delete', owner_id))
);

-- Logos are public by bucket design, but only an active same-org admin may
-- create, replace or remove an object. Keep TO public because Storage can use
-- that database role while still providing auth.uid() for an authenticated call.
create policy storage_organization_logos_select_v2
on storage.objects for select to authenticated
using (
  bucket_id = 'organization-logos'
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.is_active is true
      and p.organization_id::text = split_part(name, '/', 1)
      and public.has_role_permission('settings.manage')
  )
);

create policy storage_organization_logos_insert_v2
on storage.objects for insert to public
with check (
  bucket_id = 'organization-logos'
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.is_active is true
      and p.organization_id::text = split_part(name, '/', 1)
      and (
        p.role = 'admin'::public.user_role
        or (
          split_part(name, '/', 2) = 'signatures'
          and public.has_role_permission('settings.manage')
        )
      )
  )
);

create policy storage_organization_logos_update_v2
on storage.objects for update to public
using (
  bucket_id = 'organization-logos'
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.is_active is true
      and p.role = 'admin'::public.user_role
      and p.organization_id::text = split_part(name, '/', 1)
  )
)
with check (
  bucket_id = 'organization-logos'
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.is_active is true
      and p.role = 'admin'::public.user_role
      and p.organization_id::text = split_part(name, '/', 1)
  )
);

create policy storage_organization_logos_delete_v2
on storage.objects for delete to public
using (
  bucket_id = 'organization-logos'
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.is_active is true
      and p.role = 'admin'::public.user_role
      and p.organization_id::text = split_part(name, '/', 1)
  )
);

commit;
