# Open Meeting Task Registry

Implementation registry for the remaining JA Werkt / VDS Automotive meeting gaps.

| ID | Scope | Owner | Status | Verification |
|---|---|---|---|---|
| ENGAGE | Birthdays, loyalty ledger, reward catalog, portal redemption | Codex code agent | Implemented | typecheck, build, Deno check; full DB workflow after migration apply |
| FISCAL-KM | Fiscal mileage signal-only review flow | Codex code agent | Implemented | typecheck, build; full DB workflow after migration apply |
| DAMAGE-ROUTE | Internal damage routing, contact privacy, definitive categories | Codex code agent | Implemented | typecheck, build, Deno check; existing Playwright smoke |
| LEGAL-TEMPLATES | Template statuses, placeholder block, required placement/legal templates | Codex code agent | Implemented | typecheck, build, Deno check; placement workflow blocks missing active templates |
| QA-E2E | Browser validation for admin and portal workflows | QA agent | Running | Playwright smoke/e2e report |

Quality gates before completion:

- `npm run typecheck`
- `npm run build`
- targeted unit/API checks where available
- Playwright validation for admin settings, portal loyalty, damage reporting, and legal-template blocking
- scope check with `git diff --stat`
