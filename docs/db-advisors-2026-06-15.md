# Supabase Advisors — findings & remediation plan (Pri 4)

**Date:** 2026-06-15
**Project:** `noaupcteygfvlyymqtew`
**How:** `get_advisors` (security + performance) + a `pg_class`/`pg_index` catalog scan of `organization_id` coverage, all read-only.

**Status:** the index migration [`supabase/migrations/20260615093327_perf_org_indexes.sql`](../supabase/migrations/20260615093327_perf_org_indexes.sql) and the companion RLS-`initplan` migration (PR #55) were **applied to production on 2026-06-15** after review. The advisor re-run confirmed `auth_rls_initplan` 57→0 and `unindexed_foreign_keys` 133→121. The remaining items below — `multiple_permissive_policies`, the security toggles, and the `SECURITY DEFINER` `REVOKE` audit — stay proposals.

---

## Performance advisor — 318 lints

| Lint | Count | Level | Meaning |
|---|---|---|---|
| `unindexed_foreign_keys` | 133 | INFO | FK columns without a covering index |
| `multiple_permissive_policies` | 76 | WARN | >1 permissive policy for the same role+action |
| **`auth_rls_initplan`** | **57** | **WARN** | RLS re-evaluates `auth.*()`/helpers per row |
| `unused_index` | 51 | INFO | Indexes with no recorded scans |
| `auth_db_connections_absolute` | 1 | INFO | Auth pool capped at 10 connections |

### #1 win — `auth_rls_initplan` (57 policies, 33 tables)

This is the highest-leverage, fully behavior-preserving scalability fix, and it matters **regardless of table size** — it changes per-row work into per-query work on every read/write to these tables (`candidates`, `timesheets`, `placements`, `documents`, `communications`, `contracts`, `payslips`, `sick_reports`, `vehicle_*`, `placement_*`, …).

The policies call STABLE `SECURITY DEFINER` helpers (`get_user_org_id()`, `get_user_role()`, `is_internal_user()`, `is_superadmin()`, `get_client_portal_company_id()`) and `auth.uid()` **directly**, so Postgres evaluates them once **per row**. Wrapping each call in `(select …)` turns it into an InitPlan the planner runs **once per query**. The boolean result is identical → RLS semantics unchanged.

**Worked example** — `candidates.tenant_select` (real definition):

```sql
-- BEFORE (per-row eval)
USING ((organization_id = get_user_org_id()) AND is_internal_user())

-- AFTER (per-query InitPlan) — identical result, evaluated once
USING ((organization_id = (select get_user_org_id())) AND (select is_internal_user()))
```

```sql
-- client_errors.client_errors_insert_own_org
-- BEFORE
WITH CHECK ((user_id = auth.uid()) AND ((organization_id IS NULL)
            OR (organization_id = get_user_org_id()) OR is_superadmin()))
-- AFTER
WITH CHECK ((user_id = (select auth.uid())) AND ((organization_id IS NULL)
            OR (organization_id = (select get_user_org_id())) OR (select is_superadmin())))
```

Rollout: a dedicated migration that, for each of the 57 policies, recreates it (`ALTER POLICY … USING/WITH CHECK`) with every `auth.*()` / helper / `current_setting()` call wrapped in `(select …)`. It touches RLS on 33 tables, so it must be generated from the live `pg_policies` definitions and **reviewed policy-by-policy** before applying — not auto-rewritten blind. Not included in this PR; recommended as the next step. Remediation: <https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan>

### Indexes — what this PR proposes (and what it deliberately skips)

Org-scoping coverage is already **good**: of the tables with an `organization_id` column, only a handful lack a leading org index. The proposed migration adds exactly those (plus one hot parent→child FK), the only one with real data today being **`vacancies`** (762 rows).

**Deliberately NOT done:**
- **The other ~120 unindexed FKs.** Most are low-traffic audit columns (`created_by`, `approved_by`, `reviewed_by`, `verified_by`). Indexing all 133 adds write overhead for negligible read benefit at this scale — and the DB *already* reports **51 unused indexes**, i.e. it's over-indexed relative to its query patterns. Adding 133 more is the wrong instinct.
- **Dropping the 51 unused indexes.** Tempting, but usage stats are young — several (`idx_match_rerank_cache_org_vac`, `idx_communications_placement_id`, `idx_candidate_signup_links_vacancy_id`, …) are newly added and simply haven't accumulated scans. Revisit after more runtime; don't drop blind.
- **`multiple_permissive_policies` (76).** Consolidating overlapping permissive policies (e.g. `documents` has `{document_self_insert, tenant_insert}` for the same role+action) is a real but lower-priority perf + clarity win, and it's policy surgery — bundle it with the `auth_rls_initplan` RLS pass.
- **`auth_db_connections_absolute`.** Config, not a migration — adjust the Auth connection-allocation strategy in project settings if the instance is scaled up.

---

## Security advisor

Mostly INFO/WARN that are **by-design** for this codebase, but worth a conscious sign-off:

- **`auth_leaked_password_protection` disabled (WARN).** One toggle in Auth settings to check sign-up/reset passwords against HaveIBeenPwned. Cheap win — recommend enabling. <https://supabase.com/docs/guides/auth/password-security>
- **`registration_attempts` — RLS enabled, no policy (INFO).** Effectively locked to non-service roles. Likely intentional (only the service role / an edge function writes it), but confirm nothing client-side needs to read it.
- **~27 `SECURITY DEFINER` functions executable by `authenticated`/`anon` (WARN, lint 0029).** Includes the `sa_*` superadmin RPCs (`sa_update_org_plan`, `sa_get_organizations`, …), `get_candidate_decrypted`, `merge_candidate_records`, `get_user_org_id`, etc. This lint fires whenever a `SECURITY DEFINER` function isn't `EXECUTE`-revoked from the API roles. For this app most of these **self-gate** in their body (e.g. `sa_*` check `is_superadmin()`, decrypt RPCs check org membership) — which is why the app is safe today — but defense-in-depth says: `REVOKE EXECUTE … FROM anon, authenticated` on the ones that should never be called directly (especially the `sa_*` superadmin set and `merge_candidate_records`). **Action:** verify each `sa_*` function begins with an `is_superadmin()` guard; revoke EXECUTE on any that rely solely on being "unlisted." Cross-reference [`docs/security-audit-2026-06-10.md`](security-audit-2026-06-10.md).

---

## Recommended order

1. **`auth_rls_initplan` rewrite** (57 policies) — biggest scalability win, behavior-preserving; dedicated reviewed migration.
2. **This PR's index migration** — apply when convenient (low urgency at current size; `idx_vacancies_org` is the only measurable today).
3. **Enable leaked-password protection** + confirm `registration_attempts` intent (minutes).
4. **`REVOKE EXECUTE`** audit on `SECURITY DEFINER` API functions, folded into the security-audit follow-up.
5. **`multiple_permissive_policies`** consolidation — bundle with step 1.

Nothing here changes application behavior; every item is a performance/security hardening that preserves current functionality.
