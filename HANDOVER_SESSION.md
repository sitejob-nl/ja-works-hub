# Session handover — 2026-06-17

Korte overdracht voor Codex / Claude Code. Zie [CLAUDE.md](CLAUDE.md) voor stabiele codebase-guidance, [AGENTS.md](AGENTS.md) voor harde repo-conventies en [HANDOVER.md](HANDOVER.md) voor de formele projectsamenvatting.

## Productiestatus

- Frontend productie: `https://ja-works-hub.vercel.app`.
- Laatste bevestigde HTTP-check: 2026-06-17, HTTP 200.
- Huidige `origin/main`: `c991bb9` (`Clean up readiness warnings`, PR #66).
- Vorige launch-readiness merge: `ef5d1f1` (`Harden readiness flows before launch`, PR #65).
- Supabase project: `noaupcteygfvlyymqtew`.
- Edge functions worden handmatig gedeployed; er is geen edge-function deploy-CI.
- DB-migrations worden handmatig live toegepast via Supabase MCP/CLI; frontend gaat via GitHub/Vercel.

## Launch-readiness werk van 2026-06-17

### PR #64 — cron secret en ziekmelden

- Cron-secret flow en ziekmeld UX/backend zijn eerder gefikst en gemerged.
- Main CI was groen.

### PR #65 — kritieke readiness fixes

Gemerged en production gedeployed.

- `rerank-matches` teruggebracht in repo en live gedeployed als Supabase Edge Function.
- `match_rerank_cache` migration toegevoegd en live toegepast.
- Rerank-cache RLS aangescherpt naar internal-only org access.
- Naamloze UI-controls gefixt op kernroutes.
- Playwright a11y smoke toegevoegd: `scripts/e2e-a11y-core.spec.ts`.
- `npm audit` naar 0 vulnerabilities gebracht.
- Plaatsing en facturatie transactioneler gemaakt via RPC's:
  - `create_placement_transaction`
  - `create_invoice_transaction`
- Deze transactionele RPC's zijn bewust `SECURITY INVOKER`; live geverifieerd dat ze niet anon-uitvoerbaar zijn.
- Plaatsing UI gebruikt de RPC, met non-blocking side effects buiten de transaction.
- Facturatie UI gebruikt de RPC, inclusief rollback als geselecteerde uren niet meer factureerbaar zijn.

### PR #66 — follow-up readiness cleanup

Gemerged en production handmatig opnieuw gedeployed naar het juiste Vercel-project `ja-works-hub`.

- Alle ESLint warnings lokaal en in CI naar 0 gebracht.
- Hook/stale-closure warnings opgelost in portal, campagnes, onboarding, import, calendar, e-mail en uren.
- Extra a11y labels/toetsbare controls toegevoegd in calendar en campagne-segmenten.
- React Router future flags aangezet:
  - `v7_startTransition`
  - `v7_relativeSplatPath`
- React Router future warnings zijn weg uit de Playwright a11y smoke.
- Supabase advisor cleanup live toegepast en in repo gezet:
  - expliciete deny-policy voor `registration_attempts`;
  - FK-indexen voor launch-relevante paden: portal invites/contacts, documents, sick reports, timesheets, contracts, campaigns.
- Een per ongeluk aangemaakt tijdelijk Vercel-project `ja-works-readiness-followup-20260617` is direct verwijderd. Het echte project `ja-works-hub` is correct gedeployed.

## Live Supabase wijzigingen

Live toegepast via Supabase MCP:

- `match_rerank_cache`
- `match_rerank_cache_internal_select`
- `transactional_placement_invoice`
- `transactional_rpc_security_invoker`
- `readiness_advisor_cleanup`

Live edge function:

- `rerank-matches` actief gedeployed; `verify_jwt = false` in config en interne Bearer/JWT-validatie in de function.

Belangrijke verificaties:

- `registration_attempts` heeft policy `registration_attempts_no_client_access` met `using false` en `with check false`.
- Gerichte FK-indexcheck op de door PR #66 aangepakte tabellen geeft geen missers.
- Supabase security advisor heeft geen nieuwe waarschuwingen door PR #65/#66; overblijvende SECURITY DEFINER-waarschuwingen zijn bestaand.

## Verificatie

Groen gedraaid op 2026-06-17:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm audit
npm audit --omit=dev
git diff --check
deno check supabase/functions/rerank-matches/index.ts
npx playwright test --config=scripts/playwright.config.ts scripts/e2e-a11y-core.spec.ts
```

Resultaten:

- Unit tests: 14 files, 105 tests passed.
- Playwright a11y smoke: `/kandidaten`, `/match-pipeline`, `/uren` passed met QA/demo login uit lokale env.
- Main CI na PR #65 en #66: groen.
- Vercel production deploy na PR #66: Ready, alias `https://ja-works-hub.vercel.app`.

Niet blokkend:

- `npm run build` toont nog chunk-size waarschuwingen en Vite adviseert `@vitejs/plugin-react` in plaats van SWC. Build is groen.
- Playwright/Vite toont soms Node/module loader deprecation uit tooling, niet uit app-code.

## Bekende restpunten

- GitHub Actions blijft een Node 20 actions annotation tonen voor `actions/checkout@v4` en `actions/setup-node@v4`.
  - De wijziging naar `actions/checkout@v6` en `actions/setup-node@v6` is technisch de juiste fix.
  - Pushen van `.github/workflows/ci.yml` werd geblokkeerd omdat de huidige OAuth-token geen `workflow` scope heeft.
  - Laat iemand met workflow-scope deze kleine workflow-update apart doen.
- Supabase advisors tonen nog bestaande SECURITY DEFINER-waarschuwingen voor helper-/admin-RPC's zoals `get_user_org_id`, `get_candidate_decrypted`, `is_superadmin`, `sa_*`, enzovoort.
  - Niet blind aanpassen vlak voor livegang; veel functies zijn bewust SECURITY DEFINER voor RLS/helpergedrag.
  - Nieuwe write-RPC's uit PR #65 zijn juist `SECURITY INVOKER` en niet anon-executable.
- Performance advisor heeft nog projectbrede waarschuwingen over unindexed FK's en multiple permissive policies.
  - PR #66 pakte de launch-relevante FK-indexen aan.
  - RLS-policy-consolidatie is groter werk en moet per domein getest worden.
- `src/integrations/supabase/types.ts` blijft auto-generated en kan stale zijn; nooit handmatig editen.
- De hoofdcheckout `/Users/kas/dev/ja-works-hub` staat op een bestaande vuile branch `matching-stage2-gemini-rerank`; werk voor nieuwe taken in een aparte worktree.

## QA/demo toegang

- Er is een QA/demo login en organisatie beschikbaar in lokale env-bestanden.
- Gebruik alleen env-keys, print nooit waarden.
- De a11y smoke zoekt o.a. naar:
  - `TEST_EMAIL` / `TEST_PASSWORD`
  - `DEMO_ORG_EMAIL` / `DEMO_ORG_PASSWORD`
  - `QA_SUPERADMIN_EMAIL` / `QA_SUPERADMIN_PASSWORD`

## Veilig verder werken

- Werk altijd in een nieuwe git worktree vanaf `origin/main`.
- Gebruik Supabase MCP/CLI voor DDL en edge deployments; voeg live toegepaste migrations ook toe aan `supabase/migrations/`.
- Na DDL altijd Supabase advisors opnieuw draaien.
- Voor edge functions altijd apart `deno check` draaien; `npm run typecheck` dekt Deno niet.
- Nieuwe uitgaande communicatiepaden moeten de outbound kill-switch respecteren via `_shared/outbound-pause.ts` of via het Outlook chokepoint.
- Encrypted kolommen nooit direct selecteren; gebruik decrypt-RPC's.
- Voor launch fixes minimaal draaien:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm audit
git diff --check
```

Voor UI/a11y-kernroutes:

```bash
set -a
source /Users/kas/dev/ja-works-hub/.env
source /Users/kas/dev/ja-works-hub/.env.local
set +a
npx playwright test --config=scripts/playwright.config.ts scripts/e2e-a11y-core.spec.ts
```

## Directe aanbeveling

1. Doe de kleine GitHub Actions v6 update met een token met `workflow` scope.
2. Laat de jury/demo focussen op de nu groene kernpaden: kandidaten, match pipeline, uren, plaatsing en facturatie.
3. Plan daarna een aparte security-hardening ronde voor bestaande SECURITY DEFINER grants en RLS-policy consolidatie.
4. Plan performance cleanup voor de resterende FK-indexen en grote chunks, maar behandel dit als post-live hardening.
