-- Performance: org-scoping + hot-FK indexes (architecture audit Pri 4)
--
-- STATUS: PROPOSED — NOT yet applied to production. Apply via
--   mcp__claude_ai_Supabase__apply_migration after review.
--
-- Source: Supabase performance advisor (2026-06-15) + a pg_class/pg_index catalog
-- scan of organization_id coverage. The advisor flags 133 unindexed foreign keys,
-- but the DB already has 51 *unused* indexes — so this migration deliberately adds
-- only the columns that EVERY tenant query filters on (organization_id) on the tables
-- that lack a leading org index, plus one genuinely-hot parent->child join. It does
-- NOT add the other ~120 FK indexes (mostly low-traffic audit columns such as
-- created_by / approved_by / reviewed_by) — those are not worth the write overhead
-- at current or foreseeable scale.
--
-- Sizing note: every targeted table is small today (largest here is vacancies at
-- ~760 rows), so a plain CREATE INDEX takes milliseconds and the brief lock is
-- negligible — hence no CONCURRENTLY (which cannot run inside a migration transaction).
-- If any of these tables grows to millions of rows before this is applied, switch the
-- relevant statement to `CREATE INDEX CONCURRENTLY` and run it OUTSIDE a transaction.

-- vacancies: 762 rows, the one org-scoped table with real data and no org-leading
-- index today; also closes the unindexed-FK on vacancies.organization_id.
create index if not exists idx_vacancies_org on public.vacancies (organization_id);

-- Org-scoped tables that lack a leading organization_id index. All small today, but
-- organization_id is the universal tenant filter, so these are cheap insurance and
-- also cover cascade-delete scans from organizations.
create index if not exists idx_candidate_employment_org    on public.candidate_employment (organization_id);
create index if not exists idx_invoice_lines_org           on public.invoice_lines (organization_id);
create index if not exists idx_communication_preferences_org on public.communication_preferences (organization_id);
create index if not exists idx_client_portal_invites_org   on public.client_portal_invites (organization_id);
create index if not exists idx_custom_field_values_org     on public.custom_field_values (organization_id);
create index if not exists idx_match_proposal_tokens_org   on public.match_proposal_tokens (organization_id);
create index if not exists idx_vehicle_period_mileage_org  on public.vehicle_period_mileage (organization_id);
create index if not exists idx_fuel_analysis_results_org   on public.fuel_analysis_results (organization_id);
create index if not exists idx_vehicle_assignments_org     on public.vehicle_assignments (organization_id);
create index if not exists idx_termination_reasons_org     on public.termination_reasons (organization_id);

-- Hot parent->child join: invoice rendering loads all lines for an invoice. This FK
-- is unindexed and invoice_lines grows with every invoice.
create index if not exists idx_invoice_lines_invoice_id on public.invoice_lines (invoice_id);

-- NOT included here, on purpose:
--  * mail_account_user_access / mail_accounts composite FKs — need exact column
--    verification against the live schema first (advisor reported attnums, not names).
--  * The ~120 remaining unindexed FKs on low-traffic / audit columns.
--  * Dropping the 51 "unused" indexes — usage stats are young (several indexes are
--    newly added and simply haven't accumulated scans); revisit after more runtime.
