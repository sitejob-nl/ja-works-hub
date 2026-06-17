-- Launch readiness advisor cleanup.
-- Keep registration attempts inaccessible to client roles while making the
-- intent explicit for Supabase's RLS advisor.
drop policy if exists registration_attempts_no_client_access on public.registration_attempts;
create policy registration_attempts_no_client_access
  on public.registration_attempts
  for all
  to public
  using (false)
  with check (false);

-- Cover frequently joined launch-flow foreign keys flagged by the advisor.
create index if not exists idx_bulk_campaigns_created_by on public.bulk_campaigns(created_by);
create index if not exists idx_bulk_campaigns_email_template_id on public.bulk_campaigns(email_template_id);

create index if not exists idx_client_portal_invites_company_contact_id on public.client_portal_invites(company_contact_id);
create index if not exists idx_client_portal_invites_company_id on public.client_portal_invites(company_id);

create index if not exists idx_communications_sent_by on public.communications(sent_by);
create index if not exists idx_company_contacts_auth_user_id on public.company_contacts(auth_user_id);

create index if not exists idx_contracts_candidate_id on public.contracts(candidate_id);
create index if not exists idx_contracts_created_by on public.contracts(created_by);
create index if not exists idx_contracts_template_id on public.contracts(template_id);
create index if not exists idx_contracts_template_version_id on public.contracts(template_version_id);

create index if not exists idx_documents_employee_id on public.documents(employee_id);
create index if not exists idx_documents_verified_by on public.documents(verified_by);

create index if not exists idx_sick_reports_candidate_id on public.sick_reports(candidate_id);
create index if not exists idx_sick_reports_created_by on public.sick_reports(created_by);

create index if not exists idx_timesheets_approved_by on public.timesheets(approved_by);
create index if not exists idx_timesheets_client_approved_by on public.timesheets(client_approved_by);
create index if not exists idx_timesheets_hour_type_id on public.timesheets(hour_type_id);
create index if not exists idx_timesheets_invoice_line_id on public.timesheets(invoice_line_id);
create index if not exists idx_timesheets_travel_type_id on public.timesheets(travel_type_id);
