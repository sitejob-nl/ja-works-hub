# Launch-Ready fixes — status & handoff

**Branch:** `launch-ready-fixes` (off `main`) · **Datum:** 2026-06-15
**Bron-rapport:** [docs/launch-ready-2026-06-15.md](launch-ready-2026-06-15.md)
**Geverifieerde specs (in-repo, herbruikbaar):** [docs/launch-ready-fix-specs.json](launch-ready-fix-specs.json) (8 volledige specs), [analysis-digest](launch-ready-analysis-digest.json), [live-qa](launch-ready-live-qa.json)

> **Deploy-discipline:** alle wijzigingen staan op deze branch. **Niets is op productie toegepast** (geen migraties, geen edge-function-deploys, geen PII-wissing). Pas de deploy-checklist onderaan pas toe na review + go per stap. Er draaien echte externe orgs op de live DB.

## ✅ Gefikst & gecommit op deze branch

| # | Fix | Bestand(en) | Commit | deno check |
|---|---|---|---|---|
| **B17** | `validate-timesheets` overschrijft nooit meer `goedgekeurd`/`afgekeurd` (payroll-integriteit); generieke NL-fout | validate-timesheets/index.ts | 4f98beb | ✅ |
| **B4 (H1)** | `send-portal-invite`: internal-rol vereist + invite-lookup org-scoped → geen cross-tenant token/account-overname; generieke NL-fout | send-portal-invite/index.ts | 4f98beb | ✅ |
| **B2** | `cv-rewrite`: geen naam/e-mail/tel/DOB/nationaliteit meer naar externe AI-gateway; geminimaliseerd profiel + pseudonimisering (AVG); generieke NL-fout | cv-rewrite/index.ts | 4f98beb | ✅ |
| **B6** | RLS: `client_portal_invites` + `portal_invites` → `is_internal_user()` (account-overname dicht) | migratie 20260615120100 | cf55ce2 | n.v.t. |
| **B7** | RLS: `vehicle_damage_reports` 4 generieke policies → `is_internal_user()`; `damage_self_*` behouden | migratie 20260615120200 | cf55ce2 | n.v.t. |
| **B8** | RLS: huisvesting INSERT (5 tabellen) → `is_internal_user()` in WITH CHECK | migratie 20260615120300 | cf55ce2 | n.v.t. |
| **B1 (deel)** | AVG art.9: aard-van-ziekte (`notes`) niet meer in inlener-mail én niet in communications-log | _shared/sick-report-handler.ts | e84ce71 | ✅ |

**7 high/critical bevindingen afgedekt.** De 3 RLS-migraties zijn forward-only en NIET toegepast (zie checklist).

## 🔶 Volledige specs aanwezig — nog implementeren (zie launch-ready-fix-specs.json)

| # | Wat | Waarom nog niet af | destructief/prod |
|---|---|---|---|
| **B1 (rest)** | `reason_internal`-kolom + portaalformulier optioneel/intern + WhatsApp-bot → `reason_internal` + **data-cleanup** (bestaande `notes` legen) + types regenereren | gekoppeld aan migratie (kolom moet bestaan vóór de code die erin schrijft) + destructieve backfill | **ja** (data-cleanup + migratie) |
| **B5 (H2)** | `voys-api` SSRF/open-proxy dicht: `requireInternalProfile` + `directToken`-bypass weg + `voys-helpers.ts` weigert absolute URL's + validatie-allowlist voor connect-wizard | intricaat (wizard-allowlist), niet binnen deze sessie afgerond | nee (code) + optionele anon-REVOKE migratie |
| **B3** | Recht-op-verwijdering (AVG art.17): `anonymize_candidate()` SECURITY DEFINER RPC + `erase-candidate` edge function + delete-knop in CandidateDetail + retentie | groot; RPC + UI + config | **ja** (anonimisering) |

## 🔴 Nog te (her)specen — spec-workflow viel uit op session-limit (reset 4:20 Amsterdam)

Deze 16 hadden geen voltooide spec (21 van 29 agents faalden op de limiet). Heractiveer de spec-workflow (`docs`/script `launch-ready-fix-specs`) ná de reset, of implementeer handmatig met de digest:

- **B9** WhatsApp/bulk-campaign/betaalde-API (apify/exa/voys) edge functions → internal-rolcheck toevoegen (patroon = B4: `requireInternalProfile`).
- **B10** `merge_candidate_records` cross-tenant — **eerst verifiëren** (06-10-audit zegt dat het cross-org blokkeert; mogelijk false-positive/al-gefikst).
- **B16** anonieme UPDATE-RLS op `contracts` — **eerst verifiëren** (mogelijk false-positive).
- **Btenant** `tenant_insert` op candidates/documents/placements/contracts/timesheets/sick_reports/communications → `is_internal_user()` (patroon = B8).
- **B18** plaatsing-aanmaak transactioneel maken (RPC).
- **B19** `EmployeeNew` "in dienst nemen" reparatie (`candidate_employment`).
- **B20** publieke match-response via service-role edge function.
- **Bupload** publieke profielpagina CV/foto-upload (anon→bucket).
- **B11** `vercel.json` security-headers/CSP + Vercel Firewall/BotID (config).
- **B12** `register-organization` captcha + rate-limit + e-mailverificatie + lazy credit-seed.
- **B13** webhook HMAC/replay + decrypt-amplificatie begrenzen.
- **B14** publieke token-endpoints rate-limit + atomaire single-use.
- **B15** `candidate-signup` rate-limit/captcha + grootte-/MIME-limiet + NL-fout.
- **B21** centrale `src/lib/error-message.ts` mapper + sweep ~189 `toast.error(error.message)`.
- **B22** `ErrorBoundary` rauwe `error.message` verbergen (achter DEV).
- **B23** portaal/klantportaal-login rauwe Engelse Supabase-fout → NL.
- **H-a11y / H-perf / H-bugs / H-misc** toegankelijkheid (icon-knoppen/dialog-aria), code-splitting, 2 prod-bugs (CarerixImport `enabled`, Housing `Select.Item`), `useModuleEnabled` fail-open, PWA-meta, config-drift (4 migraties spiegelen), leaked-password-protection.

## Deploy-checklist (GATED — pas toe na go per stap)

1. **Edge functions deployen** (code, niet-destructief): `validate-timesheets`, `send-portal-invite`, `cv-rewrite`, `process-sick-report` + `whatsapp-webhook` (B1 deelt de handler). Via `mcp__claude_ai_Supabase__deploy_edge_function`. `verify_jwt` blijft zoals in config.toml.
2. **RLS-migraties toepassen** (B6/B7/B8): **eerst** live policy-namen verifiëren (`select polname from pg_policies where tablename in (...)`) zodat de `DROP POLICY IF EXISTS` echt de oude policy raakt; dan `apply_migration`; dan `get_advisors(type: security)`; dan smoke-test interne + portaalflows.
3. **B1-rest + data-cleanup**: pas migratie `reason_internal` toe, regenereer types, deploy code, en pas **pas daarna** de destructieve `notes`-cleanup toe (na expliciete go — onomkeerbaar).
4. Na elke wijziging: `npm run typecheck && npm run test && npm run build` + `npm run test:e2e:api`, en de live persona-smoke (kandidaat→kwalificeren→matchen, portaal-uren, ziekmelding, plaatsing-compliance).

## Resume-commando (spec-workflow na limiet-reset)
Worktree: `/Users/kas/dev/ja-works-hub-launchfix`. Heractiveer de fix-spec-workflow voor de 16 open items, implementeer per pakket met `deno check`/`typecheck`, commit per logische groep.
