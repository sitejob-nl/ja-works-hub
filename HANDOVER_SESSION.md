# Session handover — 2026-06-29

Overdracht voor wie verdergaat (Codex / Claude Code). Lees [AGENTS.md](AGENTS.md) voor harde repo-conventies +
commands, [CLAUDE.md](CLAUDE.md) voor de canonieke codebase-diepte, [HANDOVER.md](HANDOVER.md) voor de formele
projectsamenvatting.

## ⚠️ Eerst dit: lokale checkout is stale

- Deze werkkopie staat op branch **`docs/claude-md-session-refresh`** en loopt **~73 commits achter `origin/main`**.
- `origin/main` HEAD = **`2013eab`** (PR #124, perf-indexes), 2026-06-28.
- **Begin elke nieuwe taak met `git fetch origin main` en branch vanaf `origin/main`** (worktree per sessie).
  Niet doorcoderen op deze branch — je base mist alle #111-124-werk hieronder.
- Dirty working tree op deze branch (mag je negeren / niet committen):
  - `package.json` / `package-lock.json` — Sentry-deps; zitten al in `origin/main` via #120, dus lokaal redundant.
  - `test vacatures/` — lokale test-DOCX'en, **bewust buiten git** houden.
  - `CLAUDE.md` — 9 regels lokale diff t.o.v. origin/main (los van de gemergde #110/#119-docupdates).

## Productiestatus

- Frontend productie: `https://ja-works-hub.vercel.app` (Vercel-project `ja-works-hub`; merge naar `main` = auto-deploy frontend).
- Supabase project: `noaupcteygfvlyymqtew`.
- Edge functions + DB-migrations worden **handmatig** gedeployed (geen edge/migratie-CI). Frontend gaat via GitHub/Vercel.
- Verdict laatste readiness-ronde (2026-06-25): **opleverbaar**; kernflow staat op `main`. Resterende blockers zijn
  klant/acceptatie-werk (browser-QA + definitieve juridische template-inhoud), geen code-blockers.

## Wat er sinds de vorige handover (2026-06-17) is geland

### Tech-debt programma — 4 tracks, volledig gemerged (#111-#120)
- **Tests/coverage (#111-112):** v8-coverage zonder gate, goedkope pure-lib unit-tests + compliance-domeintest (`checkCompliance`) met supabase-mockpatroon.
- **Data-laag (#113-117):** gedeelde query-key helper (`qk`) + `unwrap`, ESLint-**warn**-guard tegen rauwe supabase-boilerplate, conventiedoc; heavy pages, transport, housing, employees omgezet. **Volg dit patroon in nieuwe data-code.**
- **De-silo MatchRow (#105, #118, #119):** `VacancyMatchesTab` pipeline op gedeelde `MatchRow`; ongebruikte `MatchCard` verwijderd; gedeelde status-meta + skill-badges. Raakt de live plaatsing-pipeline — voorzichtig bij wijzigingen hier.
- **Observability / Sentry (#120):** frontend Sentry, env-gated + PII-veilig (replay + tracing UIT i.v.m. AVG). Org `sitejob` op EU (`de.sentry.io`), projectslug `ja-werkt`. Activeert via `VITE_SENTRY_*` env-vars in Vercel PROD.

### AI-screening: Gemini als enige provider (#116)
- `analyze-cv` screent nu via **Gemini** (`_shared/gemini-cv.ts`). ⚠️ **CLAUDE.md's AI-sectie is hierdoor deels achterhaald** — die beschrijft nog "default VPS, optioneel Cloud/Anthropic". Vertrouw bij AI-werk de **huidige `analyze-cv/index.ts` op origin/main**, niet de CLAUDE.md-providerdefault.

### Performance (#124, open #125)
- **#124 (gemerged):** covering indexes voor 44 ongeïndexeerde foreign keys (advisor Pri 4, tier A).
- **#125 (OPEN):** drop dode name-trgm index + fix `cv_fts` expressie-mismatch. **Enige open PR** — check/merge als eerste kandidaat.

### Communicatie & operations
- **COM1 (#87, #108):** bedrijfs-communicatie-inbox + realtime; inkomende e-mail auto-persisteren naar `communications` (match-gated). Inkomende WhatsApp koppelt aan bedrijfscontact via telefoon-lookup (kandidaat houdt voorrang).
- **EM1 (#88):** `mail_accounts.reply_to_email` als Graph `replyTo` (antwoorden landen op ingesteld adres, bv. info@); instelbaar per mailaccount.
- **Exact hardening (#107):** 503-poll + suspended-actie via SiteJob Connect.
- **Recruiter-taken (#106):** `recruiter_tasks.created_by` → onderscheid "door mij gemaakt" vs "aan mij toegewezen".
- **Belscreening (#109):** stappen-overzicht scrollt sticky mee.
- **Fuelcard refactor (#121-123):** `FuelCardAnalysis` opgesplitst — pure helpers → `lib/fuel-analysis.ts`, datalaag → `useFuelCardData`-hook, sub-componenten → `src/components/fuel/`.

## Bekende restpunten / divergenties

- **CLAUDE.md AI-providersectie** is stale t.o.v. #116 (Gemini-only screening) — niet blind volgen.
- **`src/integrations/supabase/types.ts`** blijft auto-generated en kan stale zijn; nooit handmatig editen, verifieer live schema vóór schema-werk.
- **Supabase advisors:** security schoon (alle SECURITY DEFINER-fns intern gegate). Perf-hoofditem = unindexed FKs (#124 pakte 44 aan, tier A); resterende tiers + multiple-permissive-policies = post-live hardening, per domein testen.
- **Sentry-creds in Vercel PROD** zijn de resterende klant-/ops-actie om Sentry echt live te laten loggen (MCP/CI-token kon zelf geen Sentry-project/token aanmaken).
- **docs/-gapbestanden** (`open-gaps.md` e.a.) zijn zwaar verouderd — veel daarvan is inmiddels gebouwd (#86-#124). Behandel ze als indicatief, niet als waarheid.
- GitHub Actions toont nog een Node-versie-annotation (`actions/checkout@v4`/`setup-node@v4` → v6); kleine workflow-update vereist een token met `workflow`-scope.

## Verificatie vóór een PR

```bash
git diff --check
npm run lint        # over src/ ÉN supabase/functions/ — edge lint-error faalt CI
npm run typecheck   # dekt geen Deno
npm run test
npm run build
deno check supabase/functions/<gewijzigde-fn>/index.ts   # Deno los
```

UI/a11y-kernroutes (env uit `.env` + `.env.local`, print nooit waarden):

```bash
set -a; source .env; source .env.local; set +a
npx playwright test --config=scripts/playwright.config.ts scripts/e2e-a11y-core.spec.ts
```

QA/demo-toegang via env-keys: `DEMO_ORG_*` (interne admin in demo-org `6dedabe4-…`), `QA_SUPERADMIN_*`
(superadmin, geen org-context). Zet de org **outbound kill-switch** aan vóór flows die mail/WhatsApp sturen, en revert daarna.

## Directe aanbevelingen (next actions)

1. **`git fetch origin main` + branch/worktree vanaf `origin/main`** — niet vanaf deze stale branch.
2. **Open PR #125** (dode index + `cv_fts`-fix) reviewen/mergen; daarna advisors opnieuw draaien.
3. Bij AI-werk: lees de huidige `analyze-cv` op `main` (Gemini-only, #116); werk CLAUDE.md's AI-sectie bij als je daar toch zit.
4. Klant-/acceptatieblockers oppakken: browser-QA kernflow + juridische goedkeuring van actieve contracttemplates.
5. Na elke DDL: live toegepaste migration ook in `supabase/migrations/` zetten + `get_advisors` opnieuw draaien.
