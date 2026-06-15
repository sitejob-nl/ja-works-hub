# Security follow-up (advisor `0029` SECURITY DEFINER + RLS) — 2026-06-15

Follow-up to [`db-advisors-2026-06-15.md`](db-advisors-2026-06-15.md). Read-only audit of every `SECURITY DEFINER` function's grants + body, cross-referenced with frontend RPC usage, plus the `onboarding_responses` side-finding from [ADR-001](adr-001-multiple-permissive-policies.md).

## Headline: the function layer is sound

All **56** `SECURITY DEFINER` functions in `public` were reviewed. The security advisor's `0029` lint ("signed-in / anon users can execute a SECURITY DEFINER function") is **informational here** — every exposed function self-gates correctly:

- **RLS helper functions** (`get_user_org_id`, `get_user_role`, `is_internal_user`, `is_superadmin`, `get_employee_id`, `get_employee_candidate_id`, `get_client_portal_company_id`): `authenticated`-only, `anon` blocked, and **required** to be executable — RLS policy evaluation calls them as the querying role, so they cannot be revoked without breaking RLS. Correct as-is.
- **Token / crypto / trigger functions** (`encrypt_*`, `decrypt_sensitive`, `get_*_token`, `enforce_*`, `sync_*`, `consume_ai_credits`, …): `EXECUTE` already denied to both `anon` and `authenticated` (service-role/trigger only). Correctly locked.
- **Superadmin RPCs** (`sa_get_organizations`, `sa_get_profiles`, `sa_get_audit_log`, `sa_get_org_stats`, `sa_update_org_active`, `sa_update_org_plan`): each begins with / filters on `is_superadmin()`. A non-superadmin gets `RAISE` or zero rows. Correct.
- **Org-scoped RPCs** (`get_campaign_candidates`, `get_termination_analytics`, `next_invoice_number`, `peek_credit_balance`, `refresh_candidate_data_quality_flags`): all verify `is_superadmin() OR (is_internal_user() AND p_org_id = get_user_org_id())`. No cross-org access. Correct.
- **PII / sensitive RPCs** (`get_candidate_decrypted`, `get_my_sensitive_data`, `merge_candidate_records`, `find_duplicate_candidates`, `admin_adjust_loyalty_points`, `topup_ai_credits`, `redeem_reward`): each gates on role + org or on the caller's own identity (`auth.uid()` / `get_employee_candidate_id()`). Correct.
- **`resolve_organization_domain`** (`anon`-executable): intentional — public multi-tenant host→org routing, reads only verified domain mappings (no sensitive data).

No privilege-escalation vulnerability was found.

## Two fixes applied (migration `20260615143529`, validated via dry-run)

1. **`anonymize_candidate` no longer executable by `anon`.** The AVG-erasure function is admin/superadmin + cross-org gated in its body, but inherited `EXECUTE` from the default `GRANT … TO PUBLIC`, so `anon` technically held it (the body still blocked it). Defense-in-depth: `REVOKE … FROM PUBLIC` + `GRANT … TO authenticated`. After: `anon` EXECUTE = **false**, `authenticated`/`service_role` = true. No behavior change for legitimate callers.

2. **`onboarding_responses` org-wide read tightened to internal staff.** The `onboarding_responses_select` policy was `(organization_id = get_user_org_id())` for role `public` — missing the `is_internal_user()` gate that every other tenant policy has. Any `medewerker` could read all onboarding responses (other employees' personal data) in their org via direct PostgREST. The app never reads this table from the client (it is only written by the `onboarding-submit` edge function via service-role), so tightening breaks no flow. Now: `((organization_id = (select get_user_org_id())) AND (select is_internal_user()))`; employees keep their own via `onboarding_responses_self_select`.

> Why dry-run mattered: the first `REVOKE … FROM anon` was a no-op — the privilege came via `PUBLIC`, not a direct `anon` grant. The `BEGIN … ROLLBACK` validation caught it before anything was applied.

## Remaining — one manual step (cannot be done via SQL/migration)

- **Enable leaked-password protection.** Supabase Auth can reject passwords found in HaveIBeenPwned. It is a GoTrue/Auth project setting, not a database object. Toggle it in **Dashboard → Authentication → Sign In / Providers → Password → "Leaked password protection"** (or via the Management API). This clears the `auth_leaked_password_protection` security-advisor warning.

## Lower-priority notes (verify, not yet changed)

- `onboarding_responses_insert` (role `public`) is also `(organization_id = get_user_org_id())` without `is_internal_user()`. Lower severity (insert, not read of others' data) and the real onboarding write path is the service-role edge function. Confirm no authenticated client inserts here before tightening it the same way.
- The `sa_*` superadmin functions remain executable by `authenticated` because the superadmin UI calls them as an authenticated (superadmin) user; they self-gate. This is correct — do **not** revoke `authenticated` EXECUTE (it would break the superadmin panel).
