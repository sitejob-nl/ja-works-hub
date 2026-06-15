-- Security hardening (advisor follow-up). APPLIED to production on 2026-06-15
-- (version 20260615143529). Validated via BEGIN..ROLLBACK dry-run before applying.
--
-- 1) anonymize_candidate (AVG art.17 erasure) is admin/superadmin + cross-org gated in its body,
--    but inherited EXECUTE from PUBLIC, so the `anon` role held it too. The body blocks anon
--    (no admin role -> RAISE), so this is defense-in-depth: revoke the PUBLIC grant and re-grant
--    only to `authenticated` (the role the admin UI calls it as; service_role retains EXECUTE
--    independently). After: anon EXECUTE = false, authenticated/service_role = true.
revoke execute on function public.anonymize_candidate(uuid, text) from public, anon;
grant execute on function public.anonymize_candidate(uuid, text) to authenticated;

-- 2) onboarding_responses holds personal data. Its org-wide SELECT policy was
--    `(organization_id = get_user_org_id())` for role `public` WITHOUT the `is_internal_user()`
--    gate that every other table's tenant_select has -> any `medewerker` could read all onboarding
--    responses in their org via a direct PostgREST query (the app itself never reads this table;
--    it is only written by the onboarding-submit edge function via service-role). Add the gate so
--    org-wide read is internal staff only; employees keep their own via
--    onboarding_responses_self_select. Session functions wrapped in (select ...) (initplan).
alter policy onboarding_responses_select on public.onboarding_responses
  using (((organization_id = (select get_user_org_id())) AND (select is_internal_user())));
