-- SEC: interne rolcheck op org-breed gegate permissive policies.
--
-- RLS is OR-gebaseerd: een permissive policy die alleen op organization_id
-- filtert geeft ook portaalrollen (medewerker/opdrachtgever) org-brede
-- toegang, náást de bedoelde self-policies. Deze migratie zet
-- AND is_internal_user() op alle policies zonder rolcheck (geverifieerd
-- tegen pg_policies op prod, 2026-07-22).
--
-- Ongemoeid: alle *_self_* / client_portal-policies, deny-all-tabellen,
-- subscription_plans (alleen planmetadata) en organization_modules
-- (feature-flags). Edge functions draaien met service role en worden
-- niet geraakt. Eén functionele uitzondering: medewerkers solliciteren
-- vanuit het portaal (PortalJobMarket) met een insert op matches — die
-- krijgt een expliciete self-apply-policy.

-- 1) FOR ALL zonder rolcheck ------------------------------------------------

drop policy if exists "placement_allowances_org_isolation" on public.placement_allowances;
create policy "placement_allowances_internal_all" on public.placement_allowances
  for all to authenticated
  using (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user()))
  with check (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user()));

drop policy if exists "placement_hour_types_org_isolation" on public.placement_hour_types;
create policy "placement_hour_types_internal_all" on public.placement_hour_types
  for all to authenticated
  using (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user()))
  with check (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user()));

drop policy if exists "placement_travel_types_org_isolation" on public.placement_travel_types;
create policy "placement_travel_types_internal_all" on public.placement_travel_types
  for all to authenticated
  using (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user()))
  with check (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user()));

drop policy if exists "Org members can manage proposal tokens" on public.match_proposal_tokens;
create policy "match_proposal_tokens_internal_all" on public.match_proposal_tokens
  for all to authenticated
  using (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user()))
  with check (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user()));

-- 2) Volledig open interne tabellen (select/insert/update/delete) -----------

do $$
declare
  t text;
begin
  -- select + insert + update
  foreach t in array array[
    'candidate_data_quality_flags',
    'fuel_analysis_results',
    'fuel_analysis_runs',
    'fuel_card_imports',
    'housing_cleaning_tasks',
    'property_contracts',
    'vehicle_period_mileage'
  ] loop
    execute format('drop policy if exists tenant_select on public.%I', t);
    execute format($p$create policy tenant_select on public.%I
      for select to authenticated
      using (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user()))$p$, t);
    execute format('drop policy if exists tenant_insert on public.%I', t);
    execute format($p$create policy tenant_insert on public.%I
      for insert to authenticated
      with check (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user()))$p$, t);
    execute format('drop policy if exists tenant_update on public.%I', t);
    execute format($p$create policy tenant_update on public.%I
      for update to authenticated
      using (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user()))
      with check (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user()))$p$, t);
  end loop;
end $$;

drop policy if exists tenant_select on public.task_attachments;
create policy tenant_select on public.task_attachments
  for select to authenticated
  using (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user()));
drop policy if exists tenant_insert on public.task_attachments;
create policy tenant_insert on public.task_attachments
  for insert to authenticated
  with check (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user()));
drop policy if exists tenant_delete on public.task_attachments;
create policy tenant_delete on public.task_attachments
  for delete to authenticated
  using (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user()));

drop policy if exists tenant_select on public.whatsapp_conversation_states;
create policy tenant_select on public.whatsapp_conversation_states
  for select to authenticated
  using (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user()));
drop policy if exists tenant_delete on public.whatsapp_conversation_states;
create policy tenant_delete on public.whatsapp_conversation_states
  for delete to authenticated
  using (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user()));

-- talentpools + leden (ledentabel gaat via talentpool_id-subquery)
drop policy if exists tenant_insert on public.talentpools;
create policy tenant_insert on public.talentpools
  for insert to authenticated
  with check (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user()));
drop policy if exists tenant_delete on public.talentpools;
create policy tenant_delete on public.talentpools
  for delete to authenticated
  using (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user()));

drop policy if exists tenant_select on public.talentpool_members;
create policy tenant_select on public.talentpool_members
  for select to authenticated
  using ((select public.is_internal_user()) and talentpool_id in (
    select id from public.talentpools where organization_id = (select public.get_user_org_id())));
drop policy if exists tenant_insert on public.talentpool_members;
create policy tenant_insert on public.talentpool_members
  for insert to authenticated
  with check ((select public.is_internal_user()) and talentpool_id in (
    select id from public.talentpools where organization_id = (select public.get_user_org_id())));
drop policy if exists tenant_delete on public.talentpool_members;
create policy tenant_delete on public.talentpool_members
  for delete to authenticated
  using ((select public.is_internal_user()) and talentpool_id in (
    select id from public.talentpools where organization_id = (select public.get_user_org_id())));

-- candidate_signup_links: legacy {public}-trio weg, tenant-trio gegate
drop policy if exists candidate_signup_links_select on public.candidate_signup_links;
drop policy if exists candidate_signup_links_insert on public.candidate_signup_links;
drop policy if exists candidate_signup_links_update on public.candidate_signup_links;
drop policy if exists candidate_signup_links_tenant_select on public.candidate_signup_links;
create policy candidate_signup_links_tenant_select on public.candidate_signup_links
  for select to authenticated
  using (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user()));
drop policy if exists candidate_signup_links_tenant_insert on public.candidate_signup_links;
create policy candidate_signup_links_tenant_insert on public.candidate_signup_links
  for insert to authenticated
  with check (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user()));
drop policy if exists candidate_signup_links_tenant_update on public.candidate_signup_links;
create policy candidate_signup_links_tenant_update on public.candidate_signup_links
  for update to authenticated
  using (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user()))
  with check (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user()));

-- onboarding-formulierbeheer (publieke invulflow loopt via edge functions
-- met service role en raakt deze policies niet)
do $$
declare
  t text;
begin
  foreach t in array array['onboarding_forms','onboarding_form_steps','onboarding_form_fields'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format($p$create policy %I on public.%I
      for select to authenticated
      using (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user()))$p$, t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format($p$create policy %I on public.%I
      for insert to authenticated
      with check (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user()))$p$, t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format($p$create policy %I on public.%I
      for update to authenticated
      using (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user()))
      with check (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user()))$p$, t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format($p$create policy %I on public.%I
      for delete to authenticated
      using (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user()))$p$, t || '_delete', t);
  end loop;
end $$;

drop policy if exists onboarding_form_regulations_select on public.onboarding_form_regulations;
create policy onboarding_form_regulations_select on public.onboarding_form_regulations
  for select to authenticated
  using ((select public.is_internal_user()) and form_id in (
    select id from public.onboarding_forms where organization_id = (select public.get_user_org_id())));
drop policy if exists onboarding_form_regulations_insert on public.onboarding_form_regulations;
create policy onboarding_form_regulations_insert on public.onboarding_form_regulations
  for insert to authenticated
  with check ((select public.is_internal_user()) and form_id in (
    select id from public.onboarding_forms where organization_id = (select public.get_user_org_id())));
drop policy if exists onboarding_form_regulations_delete on public.onboarding_form_regulations;
create policy onboarding_form_regulations_delete on public.onboarding_form_regulations
  for delete to authenticated
  using ((select public.is_internal_user()) and form_id in (
    select id from public.onboarding_forms where organization_id = (select public.get_user_org_id())));

drop policy if exists onboarding_responses_insert on public.onboarding_responses;
create policy onboarding_responses_insert on public.onboarding_responses
  for insert to authenticated
  with check (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user()));

drop policy if exists organization_domains_tenant_select on public.organization_domains;
create policy organization_domains_tenant_select on public.organization_domains
  for select to authenticated
  using (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user()));

-- 3) organizations + profiles ------------------------------------------------

-- Portaalcode leest organizations/profiles alleen via eigen id (geverifieerd:
-- PortalContext/ClientPortalContext/Portal*Login doen .eq('id', userId)).
drop policy if exists org_select on public.organizations;
create policy org_select on public.organizations
  for select to authenticated
  using (id = (select public.get_user_org_id()) and (select public.is_internal_user()));

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user()))
  );

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user()));

-- 4) select_own_or_super -----------------------------------------------------

drop policy if exists usage_select_own_or_super on public.ai_usage_log;
create policy usage_select_own_or_super on public.ai_usage_log
  for select to authenticated
  using ((select public.is_superadmin())
    or (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user())));

drop policy if exists topups_select_own_or_super on public.credit_topups;
create policy topups_select_own_or_super on public.credit_topups
  for select to authenticated
  using ((select public.is_superadmin())
    or (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user())));

-- 5) microsoft_config: rolcheck erbij, persoonlijke-mailbox-zichtbaarheid blijft

drop policy if exists tenant_select on public.microsoft_config;
create policy tenant_select on public.microsoft_config
  for select to authenticated
  using (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user())
    and (user_id is null or user_id = (select auth.uid())));
drop policy if exists tenant_update on public.microsoft_config;
create policy tenant_update on public.microsoft_config
  for update to authenticated
  using (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user())
    and (user_id is null or user_id = (select auth.uid())))
  with check (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user())
    and (user_id is null or user_id = (select auth.uid())));
drop policy if exists tenant_insert on public.microsoft_config;
create policy tenant_insert on public.microsoft_config
  for insert to authenticated
  with check (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user()));

-- 6) losse tenant_insert-policies zonder rolcheck -----------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'audit_log','bulk_campaigns','campaign_recipients','communication_preferences',
    'companies','company_contacts','company_sla','compliance_rules','contract_templates',
    'custom_field_values','custom_fields','email_templates','employees','exact_config',
    'exact_glaccount_mappings','external_mappings','invoice_lines','invoice_sequences',
    'invoices','job_feed_configs','job_import_logs','job_listings','knowledge_base',
    'mileage_entries','onboarding_tokens','rate_agreements','rate_limit_tracking',
    'recruiter_tasks','regulation_acknowledgements','regulations','vacancies',
    'vehicle_assignments','vehicle_fines','vehicles','whatsapp_config'
  ] loop
    execute format('drop policy if exists tenant_insert on public.%I', t);
    execute format($p$create policy tenant_insert on public.%I
      for insert to authenticated
      with check (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user()))$p$, t);
  end loop;
end $$;

-- 7) matches: intern insert + expliciete self-apply voor het portaal ----------

drop policy if exists tenant_insert on public.matches;
create policy tenant_insert on public.matches
  for insert to authenticated
  with check (organization_id = (select public.get_user_org_id()) and (select public.is_internal_user()));

-- PortalJobMarket: medewerker solliciteert op een interne vacature en maakt
-- daarbij zelf een match aan — alleen voor de eigen kandidaat-rij.
drop policy if exists matches_employee_self_apply on public.matches;
create policy matches_employee_self_apply on public.matches
  for insert to authenticated
  with check (
    organization_id = (select public.get_user_org_id())
    and candidate_id = (select public.get_employee_id())
  );
