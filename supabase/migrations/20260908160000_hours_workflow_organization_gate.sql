-- Separate SaaS entitlement for the new workflow. Missing flags are OFF;
-- subscription plans and the existing `uren` module do not grant access.
begin;

create or replace function private.hours_module_enabled()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    join public.organization_modules m on m.organization_id = p.organization_id
    where p.id = auth.uid() and p.is_active is true
      and m.module_name = 'uren-workflow' and m.enabled is true
  );
$$;
revoke all on function private.hours_module_enabled() from public, anon, authenticated, service_role;
grant execute on function private.hours_module_enabled() to authenticated;

create or replace function public.hours_get_module_access()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid; begin
  select organization_id into v_org from public.profiles where id = auth.uid() and is_active is true;
  if auth.uid() is null or not found then
    raise exception 'Geen toegang tot de urenmodule' using errcode = '42501';
  end if;
  return jsonb_build_object('organization_id', v_org, 'enabled', private.hours_module_enabled());
end $$;
revoke all on function public.hours_get_module_access() from public, anon, authenticated, service_role;
grant execute on function public.hours_get_module_access() to authenticated;

-- VOLATILE is intentional: a writer waiting on a SaaS toggle must read the flag
-- from a fresh READ COMMITTED snapshot after acquiring the organization lock.
-- No hours writer locks organization_modules, avoiding a module/organization
-- lock inversion with direct module updates.
create or replace function private.hours_require_module(p_write boolean default false)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_org uuid; begin
  -- A long-lived REPEATABLE READ/SERIALIZABLE snapshot could retain a previously
  -- enabled flag after the toggle committed. PostgREST uses READ COMMITTED;
  -- fail closed for writes from callers using stronger snapshot isolation.
  if p_write and current_setting('transaction_isolation') not in ('read committed', 'read uncommitted') then
    raise exception 'Urenwijzigingen vereisen een actuele transactiesnapshot' using errcode = '25001';
  end if;
  select organization_id into v_org from public.profiles where id = auth.uid() and is_active is true;
  if auth.uid() is null or v_org is null then
    raise exception 'Geen toegang tot de urenmodule' using errcode = '42501';
  end if;
  if p_write then
    perform 1 from public.organizations where id = v_org for share;
    if not found then raise exception 'Geen toegang tot de urenmodule' using errcode = '42501'; end if;
  end if;
  if not exists (select 1 from public.organization_modules
      where organization_id = v_org and module_name = 'uren-workflow' and enabled is true) then
    raise exception 'De urenmodule is niet beschikbaar voor dit bedrijf' using errcode = '42501';
  end if;
  return v_org;
end $$;
revoke all on function private.hours_require_module(boolean) from public, anon, authenticated, service_role;

create or replace function private.hours_require_internal(p_write boolean default false)
returns uuid language plpgsql volatile security definer set search_path = '' as $$
declare v_org uuid := private.hours_require_module(p_write); begin
  if public.is_internal_user() is not true
     or not (public.has_role_permission('finance.manage') or (not p_write and public.has_role_permission('finance.view'))) then
    raise exception 'Geen toegang tot urenbeheer' using errcode = '42501';
  end if;
  return v_org;
end $$;
revoke all on function private.hours_require_internal(boolean) from public, anon, authenticated, service_role;

-- Protect the flag even when an existing admin client uses direct upsert/delete.
-- A profile-less SaaS-only superadmin is accepted by the canonical active-user
-- helper; an explicitly disabled profile is never accepted.
create or replace function private.hours_workflow_module_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_org uuid; begin
  if (tg_op = 'INSERT' and new.module_name <> 'uren-workflow')
    or (tg_op = 'DELETE' and old.module_name <> 'uren-workflow')
    or (tg_op = 'UPDATE' and old.module_name <> 'uren-workflow' and new.module_name <> 'uren-workflow') then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if auth.uid() is null or not coalesce(public.is_superadmin() and private.is_active_user(), false) then
    raise exception 'Alleen een actieve SaaS-beheerder mag de urenmodule wijzigen' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (old.module_name is distinct from new.module_name
      or old.organization_id is distinct from new.organization_id or old.id is distinct from new.id) then
    raise exception 'De organisatie en sleutel van de urenmodule zijn onveranderlijk' using errcode = '22023';
  end if;
  if tg_op <> 'DELETE' and new.enabled is null then
    raise exception 'Kies expliciet aan of uit voor de urenmodule' using errcode = '22023';
  end if;
  v_org := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
  -- UPDATE/DELETE already own the module-row lock here. INSERT must defer this
  -- lock until AFTER INSERT: BEFORE INSERT also runs for ON CONFLICT and would
  -- invert organization/module locks against a simultaneous direct UPDATE.
  if tg_op <> 'INSERT' then
    perform 1 from public.organizations where id = v_org for update;
    -- During an authorized parent deletion the parent row has already gone; its
    -- deletion itself owns the exclusive organization lock.
    if not found and tg_op <> 'DELETE' then
      raise exception 'Bedrijf niet beschikbaar' using errcode = '22023';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;
revoke all on function private.hours_workflow_module_guard() from public, anon, authenticated, service_role;
drop trigger if exists hours_workflow_module_guard on public.organization_modules;
create trigger hours_workflow_module_guard before insert or update or delete on public.organization_modules
  for each row execute function private.hours_workflow_module_guard();

create or replace function private.hours_workflow_module_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_id uuid; v_actor uuid; v_old jsonb; v_new jsonb; begin
  if tg_op = 'DELETE' then
    if old.module_name <> 'uren-workflow' then return old; end if;
    v_org := old.organization_id; v_id := old.id;
  else
    if new.module_name <> 'uren-workflow' then return new; end if;
    if tg_op = 'UPDATE' and old.enabled is not distinct from new.enabled then return new; end if;
    v_org := new.organization_id; v_id := new.id;
  end if;
  if tg_op = 'INSERT' then
    -- The inserted override is invisible to other transactions until this
    -- exclusive lock has been acquired and the transaction commits.
    perform 1 from public.organizations where id = v_org for update;
    if not found then raise exception 'Bedrijf niet beschikbaar' using errcode = '22023'; end if;
  end if;
  -- The parent organization deletion also removes its audit trail by design.
  if not exists (select 1 from public.organizations where id = v_org) then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  select id into v_actor from public.profiles where id = auth.uid();
  if tg_op <> 'INSERT' then
    v_old := jsonb_build_object('module_name', old.module_name, 'enabled', old.enabled);
  end if;
  if tg_op <> 'DELETE' then
    v_new := jsonb_build_object('module_name', new.module_name, 'enabled', new.enabled, 'actor_id', auth.uid());
  else
    v_new := jsonb_build_object('module_name', old.module_name, 'enabled', false, 'actor_id', auth.uid(), 'override_deleted', true);
  end if;
  insert into public.audit_log(organization_id, user_id, action, table_name, record_id, old_values, new_values, reason)
    values (v_org, v_actor, case tg_op when 'INSERT' then 'create'::public.audit_action
      when 'UPDATE' then 'update'::public.audit_action else 'delete'::public.audit_action end,
      'organization_modules', v_id, v_old, v_new, 'uren_workflow_module_toggle');
  if tg_op = 'DELETE' then return old; else return new; end if;
end $$;
revoke all on function private.hours_workflow_module_audit() from public, anon, authenticated, service_role;
drop trigger if exists hours_workflow_module_audit on public.organization_modules;
create trigger hours_workflow_module_audit after insert or update or delete on public.organization_modules
  for each row execute function private.hours_workflow_module_audit();

create or replace function public.sa_set_hours_workflow_enabled(p_organization_id uuid, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not coalesce(public.is_superadmin() and private.is_active_user(), false) then
    raise exception 'Alleen een actieve SaaS-beheerder mag de urenmodule wijzigen' using errcode = '42501';
  end if;
  if p_enabled is null then raise exception 'Kies expliciet aan of uit voor de urenmodule' using errcode = '22023'; end if;
  if p_organization_id is null or not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception 'Bedrijf niet beschikbaar' using errcode = '22023';
  end if;
  insert into public.organization_modules(organization_id, module_name, enabled)
    values (p_organization_id, 'uren-workflow', p_enabled)
    on conflict (organization_id, module_name) do update set enabled = excluded.enabled
    where public.organization_modules.enabled is distinct from excluded.enabled;
  return jsonb_build_object('organization_id', p_organization_id, 'enabled', p_enabled);
end $$;
revoke all on function public.sa_set_hours_workflow_enabled(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.sa_set_hours_workflow_enabled(uuid, boolean) to authenticated;

-- Existing tenant/role policies remain in force. This restrictive policy adds
-- the SaaS entitlement to every current workflow table, including direct SELECT.
do $$ declare t text; begin
  foreach t in array array['hours_company_settings','hours_weeks','hours_week_members','hours_days',
    'hours_day_revisions','hours_day_confirmations','hours_day_reviews','hours_matrices','hours_matrix_versions',
    'hours_company_cao_bindings','hours_company_cao_binding_history','hours_day_matrix_basis','hours_day_classifications'] loop
    execute format('drop policy if exists hours_workflow_module_required on public.%I', t);
    execute format('create policy hours_workflow_module_required on public.%I as restrictive for select to authenticated using ((select private.hours_module_enabled()))', t);
  end loop;
end $$;


-- Keep the current source/classification projection and revision semantics.
create or replace function private.hours_lock_day(p_day_id uuid, p_internal boolean)
returns public.hours_days language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.hours_require_module(true); v_week uuid; v_day public.hours_days%rowtype; begin
  if p_internal then perform private.hours_require_internal(true);
  elsif auth.uid() is null or v_org is null or public.get_user_role() is distinct from 'medewerker'::public.user_role then
    raise exception 'Geen toegang tot deze urendag' using errcode = '42501';
  end if;
  select d.week_id into v_week from public.hours_days d join public.hours_week_members m on m.id = d.member_id
    where d.id = p_day_id and d.organization_id = v_org
      and (p_internal or m.candidate_id = public.get_employee_candidate_id());
  if not found then raise exception 'Geen toegang tot deze urendag' using errcode = '42501'; end if;
  perform 1 from public.hours_weeks where id = v_week and organization_id = v_org for update;
  select * into v_day from public.hours_days where id = p_day_id and organization_id = v_org for update;
  if not exists (select 1 from public.hours_weeks w join public.hours_company_settings s on s.company_id = w.company_id and s.organization_id = w.organization_id where w.id = v_week and s.enabled) then
    raise exception 'Nieuwe urenwerkwijze staat uit voor deze opdrachtgever' using errcode = '22023';
  end if;
  return v_day;
end $$;

-- Keep the current source/classification projection and revision semantics.
create or replace function public.hours_confirm_days(p_week_id uuid, p_revisions jsonb, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_item record; v_day public.hours_days%rowtype; v_last public.hours_day_confirmations%rowtype; v_org uuid := private.hours_require_module(true); begin
  if auth.uid() is null or v_org is null or public.get_user_role() is distinct from 'medewerker'::public.user_role
     or public.get_employee_candidate_id() is null then raise exception 'Geen toegang tot deze urenweek' using errcode = '42501'; end if;
  -- get_week checks both tenant and own membership before acquiring any locks.
  perform public.hours_get_week(p_week_id);
  if p_revisions is null or jsonb_typeof(p_revisions) <> 'array' then raise exception 'Kies ten minste één urendag' using errcode = '22023'; end if;
  if jsonb_array_length(p_revisions) not between 1 and 1000 then raise exception 'Ongeldige selectie urendagen' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_revisions) e where jsonb_typeof(e) <> 'object'
    or jsonb_typeof(e->'day_id') is distinct from 'string' or jsonb_typeof(e->'revision_id') is distinct from 'string'
    or (e->>'day_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or (e->>'revision_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'Ongeldige urendag of revisie' using errcode = '22023';
  end if;
  if (select count(distinct (e->>'day_id')::uuid) from jsonb_array_elements(p_revisions) e) <> jsonb_array_length(p_revisions) then
    raise exception 'Een urendag mag slechts één keer voorkomen' using errcode = '22023';
  end if;
  p_note := nullif(btrim(p_note), '');
  if length(p_note) > 2000 then raise exception 'Toelichting is te lang' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_revisions) e where not exists (
    select 1 from public.hours_days d join public.hours_week_members m on m.id = d.member_id
    where d.id = (e->>'day_id')::uuid and d.week_id = p_week_id and d.organization_id = v_org
      and m.candidate_id = public.get_employee_candidate_id())) then
    raise exception 'Urendag hoort niet bij uw eigen werkweek' using errcode = '42501';
  end if;
  perform 1 from public.hours_weeks where id = p_week_id and organization_id = v_org for update;
  for v_item in select (e->>'day_id')::uuid as day_id, (e->>'revision_id')::uuid as revision_id from jsonb_array_elements(p_revisions) e order by (e->>'day_id')::uuid loop
    v_day := private.hours_lock_day(v_item.day_id, false);
    if v_day.week_id <> p_week_id then raise exception 'Urendag hoort niet bij deze werkweek' using errcode = '42501'; end if;
    if v_day.current_revision_id is distinct from v_item.revision_id then raise exception 'Uren zijn gewijzigd; laad opnieuw' using errcode = '40001'; end if;
    select * into v_last from public.hours_day_confirmations where revision_id = v_item.revision_id order by created_at desc, id desc limit 1;
    if not found or v_last.decision <> 'confirmed' or v_last.note is distinct from p_note then
      insert into public.hours_day_confirmations(organization_id, day_id, revision_id, decision, note, created_by)
        values (v_day.organization_id, v_day.id, v_item.revision_id, 'confirmed', p_note, auth.uid());
    end if;
  end loop;
  return public.hours_get_week(p_week_id);
end $$;

-- Keep the current source/classification projection and revision semantics.
create or replace function public.hours_get_week(p_week_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid := private.hours_require_module(false); v_candidate uuid; v_internal boolean;
  v_week public.hours_weeks%rowtype; v_members jsonb; v_enabled boolean;
begin
  if auth.uid() is null or v_org is null then raise exception 'Geen toegang tot deze urenweek' using errcode = '42501'; end if;
  v_internal := public.is_internal_user() and (public.has_role_permission('finance.view') or public.has_role_permission('finance.manage'));
  if not v_internal then
    if public.get_user_role() is distinct from 'medewerker'::public.user_role then raise exception 'Geen toegang tot deze urenweek' using errcode = '42501'; end if;
    v_candidate := public.get_employee_candidate_id();
    if v_candidate is null then raise exception 'Medewerkersaccount niet gekoppeld' using errcode = '42501'; end if;
  end if;
  select * into v_week from public.hours_weeks where id = p_week_id and organization_id = v_org;
  if not found or (not v_internal and not exists (select 1 from public.hours_week_members where week_id = p_week_id and organization_id = v_org and candidate_id = v_candidate)) then
    raise exception 'Geen toegang tot deze urenweek' using errcode = '42501';
  end if;
  select enabled into v_enabled from public.hours_company_settings where company_id = v_week.company_id and organization_id = v_org;
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'placement_id', m.placement_id, 'candidate_id', m.candidate_id,
    'candidate_name', m.candidate_name, 'start_date', m.start_date, 'end_date', m.end_date,
    'days', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'work_date', d.work_date,
      'current_revision', case when r.id is not null then jsonb_build_object('id', r.id, 'revision_number', r.revision_number,
        'minutes', r.minutes, 'no_hours_reason', r.no_hours_reason, 'note', r.note, 'source_references', r.source_references, 'source_input', r.source_input, 'created_at', r.created_at) end,
      'confirmation', (select jsonb_build_object('id', a.id, 'revision_id', a.revision_id, 'decision', a.decision, 'note', a.note, 'created_at', a.created_at)
        from public.hours_day_confirmations a where a.revision_id = r.id order by a.created_at desc, a.id desc limit 1),
      'review', (select jsonb_build_object('id', x.id, 'revision_id', x.revision_id, 'status', x.status, 'note', case when v_internal then x.note else null end, 'created_at', x.created_at)
        from public.hours_day_reviews x where x.revision_id = r.id order by x.created_at desc, x.id desc limit 1),
      'classification', case when v_internal then (select private.hours_classification_summary(k.id) from public.hours_day_classifications k where k.revision_id = r.id order by k.created_at desc, k.id desc limit 1) else null end,
      'history', case when v_internal then (select coalesce(jsonb_agg(jsonb_build_object(
        'id', h.id, 'revision_number', h.revision_number, 'minutes', h.minutes, 'no_hours_reason', h.no_hours_reason,
        'note', h.note, 'source_references', h.source_references, 'source_input', h.source_input, 'created_by', h.created_by, 'created_at', h.created_at,
        'classification', (select private.hours_classification_summary(k.id) from public.hours_day_classifications k where k.revision_id = h.id order by k.created_at desc, k.id desc limit 1),
        'confirmations', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'decision', a.decision, 'note', a.note, 'created_at', a.created_at) order by a.created_at, a.id), '[]'::jsonb) from public.hours_day_confirmations a where a.revision_id = h.id),
        'reviews', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'status', x.status, 'note', x.note, 'created_at', x.created_at) order by x.created_at, x.id), '[]'::jsonb) from public.hours_day_reviews x where x.revision_id = h.id)
        ) order by h.revision_number desc), '[]'::jsonb) from public.hours_day_revisions h where h.day_id = d.id) else '[]'::jsonb end
      ) order by d.work_date), '[]'::jsonb) from public.hours_days d left join public.hours_day_revisions r on r.id = d.current_revision_id where d.member_id = m.id)
    ) order by m.candidate_name, m.id), '[]'::jsonb) into v_members from public.hours_week_members m
    where m.week_id = p_week_id and m.organization_id = v_org and (v_internal or m.candidate_id = v_candidate);
  return jsonb_build_object('id', v_week.id, 'company_id', v_week.company_id, 'company_name', v_week.company_name,
    'week_start', v_week.week_start, 'submission_deadline_at', v_week.submission_deadline_at,
    'confirmation_deadline_at', v_week.confirmation_deadline_at,
    'settings_snapshot', case when v_internal then v_week.settings_snapshot else '{}'::jsonb end,
    'workflow_enabled', coalesce(v_enabled, false),
    'can_manage', coalesce(v_enabled, false) and v_internal and public.has_role_permission('finance.manage'),
    'can_confirm', coalesce(v_enabled, false) and not v_internal,
    'release_available', false, 'members', v_members);
end $$;

-- Keep the current source/classification projection and revision semantics.
create or replace function public.hours_list_weeks(p_week_start date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid := private.hours_require_module(false); v_candidate uuid; v_internal boolean; v_rows jsonb; begin
  if auth.uid() is null or v_org is null then raise exception 'Geen toegang tot uren' using errcode = '42501'; end if;
  v_internal := public.is_internal_user() and (public.has_role_permission('finance.view') or public.has_role_permission('finance.manage'));
  if not v_internal then
    if public.get_user_role() is distinct from 'medewerker'::public.user_role then raise exception 'Geen toegang tot uren' using errcode = '42501'; end if;
    v_candidate := public.get_employee_candidate_id();
    if v_candidate is null then raise exception 'Medewerkersaccount niet gekoppeld' using errcode = '42501'; end if;
  end if;
  if p_week_start is not null and extract(isodow from p_week_start) <> 1 then raise exception 'Kies de maandag van de werkweek' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'company_id', w.company_id, 'company_name', w.company_name,
    'week_start', w.week_start, 'submission_deadline_at', w.submission_deadline_at, 'confirmation_deadline_at', w.confirmation_deadline_at,
    'member_count', counts.member_count, 'day_count', counts.day_count, 'received_day_count', counts.received_day_count,
    'confirmed_day_count', counts.confirmed_day_count, 'blocked_day_count', counts.blocked_day_count)
    order by w.week_start desc, w.company_name), '[]'::jsonb) into v_rows
  from public.hours_weeks w cross join lateral (
    select count(distinct m.id) as member_count, count(d.id) as day_count,
      count(d.current_revision_id) as received_day_count,
      count(*) filter (where a.decision = 'confirmed') as confirmed_day_count,
      count(*) filter (where a.decision = 'disputed' or x.status = 'blocked' or (v_internal and k.status = 'blocked')) as blocked_day_count
    from public.hours_week_members m join public.hours_days d on d.member_id = m.id
    left join lateral (select decision from public.hours_day_confirmations where revision_id = d.current_revision_id order by created_at desc, id desc limit 1) a on true
    left join lateral (select status from public.hours_day_reviews where revision_id = d.current_revision_id order by created_at desc, id desc limit 1) x on true
    left join lateral (select status from public.hours_day_classifications where revision_id = d.current_revision_id order by created_at desc, id desc limit 1) k on v_internal
    where m.week_id = w.id and (v_internal or m.candidate_id = v_candidate)
  ) counts
  where w.organization_id = v_org and (p_week_start is null or w.week_start = p_week_start)
    and (v_internal or counts.member_count > 0);
  return jsonb_build_object('weeks', v_rows, 'can_manage', v_internal and public.has_role_permission('finance.manage'));
end $$;

-- CREATE OR REPLACE preserves existing privileges. Assert the intended public
-- contract explicitly so rerunning this migration cannot widen helper access.
revoke all on function private.hours_lock_day(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.hours_confirm_days(uuid, jsonb, text) from public, anon, service_role;
revoke all on function public.hours_get_week(uuid) from public, anon, service_role;
revoke all on function public.hours_list_weeks(date) from public, anon, service_role;
grant execute on function public.hours_confirm_days(uuid, jsonb, text) to authenticated;
grant execute on function public.hours_get_week(uuid) to authenticated;
grant execute on function public.hours_list_weeks(date) to authenticated;

comment on function public.hours_get_module_access() is 'Own active profile organization only. New hours workflow is available solely with explicit organization_modules uren-workflow=true; no plan fallback.';
comment on function public.sa_set_hours_workflow_enabled(uuid, boolean) is 'Active SaaS superadmins only. Serializable against in-flight hours writes; same value is idempotent. Does not modify legacy uren or customer-level operational settings.';
notify pgrst, 'reload schema';
commit;
