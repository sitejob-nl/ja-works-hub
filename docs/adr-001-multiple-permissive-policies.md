# ADR-001 — Do not consolidate multiple permissive RLS policies

**Date:** 2026-06-15
**Status:** Accepted
**Context source:** Supabase performance advisor (`multiple_permissive_policies`, 76 lints) — see [`db-advisors-2026-06-15.md`](db-advisors-2026-06-15.md).

## Decision

We **keep** the multiple permissive RLS policies per `(table, command)` as-is. We do **not** merge them into single `OR`-combined policies to satisfy the `multiple_permissive_policies` advisor warning.

## Context

Postgres OR's permissive policies: a row passes a command if **any** permissive policy for the caller's role allows it. The advisor flags `(table, command, role)` combinations that have more than one permissive policy, because each extra policy is an extra per-row expression evaluation. The standard "fix" is to merge them into one policy whose expression is `policyA OR policyB OR …`.

A read-only analysis of the live schema found **18 cleanly-mergeable groups** (same table, same command, identical role set, ≥2 permissive policies):

| Table | Command(s) | # policies | Access intents present |
|---|---|---|---|
| `timesheets` | SELECT, UPDATE | 4 each | tenant · opdrachtgever · client-portal · employee-self |
| `timesheets` | INSERT (×2 role sets) | 2 + 2 | tenant · self · client-portal · employee-self |
| `candidates` | SELECT | 3 | tenant · opdrachtgever · client-portal |
| `company_contacts` | SELECT, UPDATE | 3 / 2 | tenant · opdrachtgever · self |
| `placements` | SELECT | 3 | tenant · opdrachtgever · client-portal |
| `companies` | SELECT | 2 | tenant · client-portal |
| `documents` | INSERT | 2 | tenant · self |
| `onboarding_responses` | SELECT | 2 | org-wide · self |
| `properties` / `units` / `vehicles` | SELECT | 2 each | tenant · self |
| `regulation_acknowledgements` / `sick_reports` | INSERT | 2 each | tenant · self |
| `vehicle_damage_reports` | INSERT, SELECT | 2 each | tenant · self |

Two facts drove the decision:

1. **There are no true duplicates.** Every policy within every group has a distinct expression (verified by hashing the normalized `qual`/`with_check`). Nothing is redundant to simply drop.
2. **Each policy encodes one named access intent.** `tenant_*` = internal staff in the same org (`organization_id = get_user_org_id() AND is_internal_user()`); `opdrachtgever_*` / `*_client_portal_*` = an external client contact reached via their placements/company; `*_self_*` = the employee acting on their own record. These are legitimately different callers reaching the same row through different paths.

## Rationale

- **Auditability > micro-optimization.** Named, single-intent policies are what make a multi-tenant RLS model reviewable — especially after the [2026-06-10 security audit](security-audit-2026-06-10.md) surfaced cross-tenant issues. Collapsing four intents into one ~500-character `OR` expression makes it materially harder to answer "who can read this row, and why?" and to change one access path without touching the others.
- **No measurable performance gain at current scale.** The flagged tables are small (`timesheets` ≈ 44 rows, `candidates` ≈ 2,119). Evaluating four policy expressions vs one per row is not a real cost here; the advisor warning is size-agnostic.
- **Real correctness risk.** Each merge is a `DROP POLICY` + `CREATE POLICY` on production RLS. The upside is marginal; the downside (a mis-combined `OR` exposing or hiding tenant rows) is severe.
- **Merging would also hide smells rather than fix them** (see below).

In short: the warning here is flagging a *deliberate, good* design. Optimizing it away would regress the very maintainability and security goals of the architecture audit.

## Consequences

- The 76 `multiple_permissive_policies` advisor lints remain. This is an accepted, documented state — not an oversight.
- If a clean advisor report is ever required (e.g. a compliance checkbox), revisit table-by-table: merge only one `(table, command, role-set)` group at a time, generate the merged policy as `OR` of the live expressions, and prove semantic equivalence on production inside `BEGIN … ROLLBACK` before applying — never a blanket sweep.

## Side-finding (separate from this decision — to verify, not to merge)

`onboarding_responses.onboarding_responses_select` is a `SELECT` policy for role **`public`** whose entire condition is `(organization_id = get_user_org_id())` — i.e. **any** authenticated user in the org (including `medewerker`), with **no `is_internal_user()` gate**. That is broader than its sibling `onboarding_responses_self_select` (the employee's own responses only). If org-wide read of onboarding responses by any employee is not intended, that is a tenant-internal access-scope bug to fix on its own merits. Consolidating the two policies would silently cement the broad behavior, which is a further reason not to merge. Tracked for the security follow-up alongside the `SECURITY DEFINER` `REVOKE` audit.
