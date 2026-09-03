-- onboarding_responses.employee_id was NOT NULL, but onboarding-submit only ever sets
-- candidate_id (employee_id is legacy — candidates is source of truth, see CLAUDE.md).
-- Every dynamic-form submission has therefore always violated this constraint; nothing
-- has been submitted yet in production so it never surfaced. Align with candidate_id
-- (already nullable) instead of teaching the edge function to populate a legacy FK.
alter table public.onboarding_responses
  alter column employee_id drop not null;
