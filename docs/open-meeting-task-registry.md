# Open Meeting Task Registry

Implementation registry for the remaining JA Werkt / VDS Automotive meeting gaps.

Detailed 2026-05-14 open-point analysis: `docs/meeting-open-points-2026-05-14.md`.
Phased fix plan: `docs/meeting-fix-plan-2026-05-14.md`.

| ID | Scope | Owner | Status | Verification |
|---|---|---|---|---|
| ENGAGE | Birthdays, loyalty ledger, reward catalog, portal redemption | Codex code agent | Implemented | typecheck, build, Deno check; full DB workflow after migration apply |
| FISCAL-KM | Fiscal mileage signal-only review flow | Codex code agent | Implemented | typecheck, build; full DB workflow after migration apply |
| DAMAGE-ROUTE | Internal damage routing, contact privacy, definitive categories | Codex code agent | Implemented | typecheck, build, Deno check; existing Playwright smoke |
| LEGAL-TEMPLATES | Template statuses, placeholder block, required placement/legal templates | Codex code agent | Implemented | typecheck, build, Deno check; placement workflow blocks missing active templates |
| QA-E2E | Browser validation for admin and portal workflows | QA agent | Running | Playwright smoke/e2e report |
| 0514-DATA-SSOT | Data cleanup, deduplication, test-vacancy cleanup, historical relation fixes | TBD | Open | Carerix acceptance report with duplicate/test-data/relation checks |
| 0514-CRTODO | Split Carerix `CRTodo` into notes/tasks and import separate `CRNote` records in live sync | Codex code agent | Implemented, pending validation | Productiedata validation for historical notes/appointments and recruiter_tasks |
| 0514-VACANCY-TEMPLATE | Vacancy creation inherits function description, salary, skills, location defaults, tariff decision | Codex code agent | Implemented, pending validation | UI flow test: company function -> vacancy defaults -> editable override |
| 0514-SKILL-MATCH | Vacancy match tab filters/scores internal candidates by function/vacancy skills | Codex code agent | Implemented, pending validation | Browser/API test with matching and non-matching candidate skill sets |
| 0514-URGENCY | Central team dashboard/workbench signal for urgent open vacancies | Codex code agent | Implemented, pending validation | Dashboard/workbench test showing high-urgency vacancies without manual assignment |
| 0514-INTAKE | Public recruitment intake funnel with mandatory CV, lead state, AI triage, recruiter notification | Codex code agent | Implemented, deployed, smoke-validated | Production UI smoke created lead `f86d612a-3909-432c-808f-e92ceee05570` with CV, task and notification; lead promotion acceptance remains |
| 0514-PARTNER | External recruiter/agency portal with RBAC and own-candidate status visibility | TBD | Open | Tenant/agency isolation test plus candidate submission/status flow |
| 0514-BULK-NOTIFY | Bulk email/app/WhatsApp notification from vacancy match pipeline | Codex code agent | Implemented, pending validation | Match selection test with portal notifications and outbound communication records |
| 0514-PROPOSAL | Candidate proposal mail uses JA Werkt/org branding and validated AI report content | Codex code agent | Implemented, pending validation | Preview/send test with logo/branding, AI summary and response token |
| 0514-SCREENING | Screening checklist for missing candidate data and AI interview questions | Codex code agent | Implemented, pending validation | Recruiter flow test showing missing fields/questions and follow-up task creation |
| 0514-NAVSTATE | Preserve detail tab/view state when navigating away and back | Codex code agent | Implemented, pending validation | Browser regression for vacancy, company, candidate, vehicle and property tabs |
| 0514-SEARCH | Correct vacancy/match search to function title + opdrachtgever behavior | Codex code agent | Implemented, pending validation | Reproduction test for 05-14 search bug and corrected filters |
| 0514-EMAIL-TRIAGE | AI mail classification and routing for CVs, klantvragen and noise | Codex code agent | Implemented, pending validation | Outlook inbox test: classify, assign owner, create linked candidate/task where needed |
| 0514-MARKETING | Meta Ads Library + Higgsfield + campaign performance feedback loop | TBD | Open | Scope decision first; then API integration smoke and cost/error handling tests |
| 0514-EXACT-SCOPE | Resolve Exact out-of-scope conflict versus existing Exact module | Product/client | Decision needed | Written scope decision and separate Exact acceptance result if kept active |

Quality gates before completion:

- `npm run typecheck`
- `npm run build`
- targeted unit/API checks where available
- Playwright validation for admin settings, portal loyalty, damage reporting, and legal-template blocking
- scope check with `git diff --stat`
