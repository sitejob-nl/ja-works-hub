-- Tier A van de FK-index-analyse (Supabase advisors-run 2026-06-28, architectuur-audit Pri 4):
-- covering-indexen voor ongeïndexeerde foreign keys die echt op een join-/filter- of
-- candidate-merge/anonymize/delete-pad zitten. Actor-kolommen (created_by/reviewed_by/...
-- → profiles/auth.users) en mini static config-tabellen zijn bewust NIET geïndexeerd
-- (nooit een hot filter; users worden zelden verwijderd → pure write-overhead).
-- Alle tabellen zijn klein → plain CREATE INDEX (geen CONCURRENTLY nodig), idempotent.
-- Reeds toegepast op prod via apply_migration (versie 20260628125735); dit bestand is de
-- spiegel voor lokale dev/CI-consistentie. Resultaat: ongeïndexeerde FK's 105 → 61.

-- candidate_id → candidates (merge_candidate_records/anonymize_candidate repointen
-- elke child op candidate_id; portal leest per-medewerker)
CREATE INDEX IF NOT EXISTS idx_employee_notifications_candidate_id ON public.employee_notifications (candidate_id);
CREATE INDEX IF NOT EXISTS idx_fuel_card_transactions_candidate_id ON public.fuel_card_transactions (candidate_id);
CREATE INDEX IF NOT EXISTS idx_housing_assignments_candidate_id ON public.housing_assignments (candidate_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_fines_candidate_id ON public.vehicle_fines (candidate_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_assignments_candidate_id ON public.vehicle_assignments (candidate_id);
CREATE INDEX IF NOT EXISTS idx_annual_statements_candidate_id ON public.annual_statements (candidate_id);
CREATE INDEX IF NOT EXISTS idx_birthday_campaign_logs_candidate_id ON public.birthday_campaign_logs (candidate_id);
CREATE INDEX IF NOT EXISTS idx_employee_deductions_candidate_id ON public.employee_deductions (candidate_id);
CREATE INDEX IF NOT EXISTS idx_employee_reservations_candidate_id ON public.employee_reservations (candidate_id);
CREATE INDEX IF NOT EXISTS idx_employee_subsidies_candidate_id ON public.employee_subsidies (candidate_id);
CREATE INDEX IF NOT EXISTS idx_hour_letters_candidate_id ON public.hour_letters (candidate_id);
CREATE INDEX IF NOT EXISTS idx_key_registrations_candidate_id ON public.key_registrations (candidate_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_accounts_candidate_id ON public.loyalty_accounts (candidate_id);
CREATE INDEX IF NOT EXISTS idx_mileage_entries_candidate_id ON public.mileage_entries (candidate_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_responses_candidate_id ON public.onboarding_responses (candidate_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_tokens_candidate_id ON public.onboarding_tokens (candidate_id);
CREATE INDEX IF NOT EXISTS idx_payslips_candidate_id ON public.payslips (candidate_id);
CREATE INDEX IF NOT EXISTS idx_portal_invites_candidate_id ON public.portal_invites (candidate_id);
CREATE INDEX IF NOT EXISTS idx_regulation_acknowledgements_candidate_id ON public.regulation_acknowledgements (candidate_id);
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_candidate_id ON public.reward_redemptions (candidate_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_damage_reports_candidate_id ON public.vehicle_damage_reports (candidate_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_conversation_states_candidate_id ON public.whatsapp_conversation_states (candidate_id);
CREATE INDEX IF NOT EXISTS idx_invoice_lines_candidate_id ON public.invoice_lines (candidate_id);
CREATE INDEX IF NOT EXISTS idx_match_rerank_cache_candidate_id ON public.match_rerank_cache (candidate_id);

-- skill_id → skills (matcher-leespad)
CREATE INDEX IF NOT EXISTS idx_candidate_skills_skill_id ON public.candidate_skills (skill_id);
CREATE INDEX IF NOT EXISTS idx_skill_aliases_skill_id ON public.skill_aliases (skill_id);
CREATE INDEX IF NOT EXISTS idx_vacancy_required_skills_skill_id ON public.vacancy_required_skills (skill_id);
CREATE INDEX IF NOT EXISTS idx_company_function_skills_skill_id ON public.company_function_skills (skill_id);

-- placement_id → placements (facturatie/portal-joins)
CREATE INDEX IF NOT EXISTS idx_invoice_lines_placement_id ON public.invoice_lines (placement_id);
CREATE INDEX IF NOT EXISTS idx_hour_letters_placement_id ON public.hour_letters (placement_id);
CREATE INDEX IF NOT EXISTS idx_fiscal_mileage_reviews_placement_id ON public.fiscal_mileage_reviews (placement_id);

-- match_id → matches (voorstel→plaatsing-flow)
CREATE INDEX IF NOT EXISTS idx_placements_match_id ON public.placements (match_id);
CREATE INDEX IF NOT EXISTS idx_match_proposal_tokens_match_id ON public.match_proposal_tokens (match_id);
CREATE INDEX IF NOT EXISTS idx_match_feedback_events_match_id ON public.match_feedback_events (match_id);

-- account_id → loyalty_accounts
CREATE INDEX IF NOT EXISTS idx_loyalty_transactions_account_id ON public.loyalty_transactions (account_id);
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_account_id ON public.reward_redemptions (account_id);

-- company_id → companies
CREATE INDEX IF NOT EXISTS idx_invoices_company_id ON public.invoices (company_id);
CREATE INDEX IF NOT EXISTS idx_employee_notifications_company_id ON public.employee_notifications (company_id);

-- gerichte join-/filter-kolommen
CREATE INDEX IF NOT EXISTS idx_recruiter_tasks_assigned_to ON public.recruiter_tasks (assigned_to);
CREATE INDEX IF NOT EXISTS idx_match_distance_cache_vacancy_id ON public.match_distance_cache (vacancy_id);
CREATE INDEX IF NOT EXISTS idx_candidate_signup_links_vacancy_id ON public.candidate_signup_links (vacancy_id);
CREATE INDEX IF NOT EXISTS idx_fiscal_mileage_reviews_vehicle_id ON public.fiscal_mileage_reviews (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_housing_cleaning_tasks_unit_id ON public.housing_cleaning_tasks (unit_id);
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_reward_id ON public.reward_redemptions (reward_id);
