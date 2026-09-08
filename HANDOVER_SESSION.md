# Session handover — 2026-09-08

Overdracht voor wie verdergaat (Codex / Claude Code). Lees [AGENTS.md](AGENTS.md) voor harde repo-conventies +
commands, [CLAUDE.md](CLAUDE.md) voor de canonieke codebase-diepte, [HANDOVER.md](HANDOVER.md) voor de formele
projectsamenvatting.

## Actuele uitrol urenmodule — 8 september 2026

- Kas vroeg echte demo-QA en een SaaS-schakelaar per organisatie. De nieuwe key is `uren-workflow`, afzonderlijk van legacy `uren`, standaard UIT. Zes nieuwe routes en beide toegangsknoppen zijn afgeschermd; alle 13 nieuwe tabellen en de interne/portal/service-RPC's controleren hetzelfde recht. Zie [modulecontract](docs/urenmodule-organization-gate.md).
- Actieve worktree blijft `/Users/kas/dev/ja-works-hub/.worktrees/urenmodule-classificatie`, branch `codex/urenmodule-classificatie`. De oudere bouwsnapshots hieronder zijn historisch; de backend is inmiddels wel gedeployed.
- Op 8 september zijn de vier urenmigraties atomisch toegepast met Supabase `apply_migration`; receipt `20260908101415_hours_workflow_guarded_initial_release`. Hun oorspronkelijke versies zijn in dezelfde transactie geregistreerd. `scripts/build-hours-initial-release.py` en de manifest/evidence bevatten bronhashes en uitrolinstellingen.
- Live einddoel en geverifieerde huidige database-instelling: **JA Werkt UIT**, **Demo Uitzendbureau Showroom AAN**, andere drie organisaties UIT. JA Werkt is tijdens deze test niet aangezet. De bestaande urenregistratie blijft bestaan.
- Edge `hours-classify-day` via CLI gedeployed met eigen sessievalidatie (`verify_jwt=false`). Live database-types via CLI gegenereerd (+999 regels voor de urenmodule); tijdelijke RPC-casts verwijderd en op de gegenereerde signatures aangesloten. Negen nieuwe RPC-contracttests en typecheck geslaagd.
- Predeploy: 1.402 applicatietests, lint 0 errors, typecheck/build/Deno geslaagd; **100 echte PostgreSQL-tests** (74 regressies +26 gategevallen), vier migraties tweemaal en finale gatehash `e0661385b35b39f72854e4144f94307813ff9dd46b9e7fda2a86c67362d0d14a`. Onafhankelijke securityreview en transactionele bundelreview GO.
- Verbonden browser-QA loopt via echte interne en portal-login, localhost:8083 tegen de geverifieerde demo-tenant. Demo is een organisatie in hetzelfde Supabase-project, geen apart testproject. Alleen unieke synthetische opdrachtgevers `Urenmodule QA 20260908-gate` (plus r2/r3-herhaalfixtures) en bijbehorende demo-plaatsingen zijn toegevoegd.
- Verbonden QA reproduceerde een matrixrace: opgeslagen concept verscheen tijdens nog lopende refetches; een latere editorreset wiste het rekenvoorbeeld. Fix houdt selectie vast en blokkeert de editor tot de gehele save klaar is. Nieuwe regressietest bewezen rood vóór fix en groen erna; 12 gerichte matrixtests, lint en typecheck geslaagd. Runtime bevroren voor een schone r3-herhaling.
- R3 bewees echte matrixpublicatie, week-/bronopslag, twee serverclassificaties, portal-login/deeplink, akkoord → correctie → herakkoord → betwisting en mobiele NL/EN/PL-schermen. De laatste stale-browsercontrole vond een tweede fout: businessconflicten met SQLSTATE `40001` werden door PostgREST eindeloos herhaald. Eigen achtergebleven QA-aanvragen zijn gericht gestopt; daarna nul actieve urenwrites geverifieerd.
- Additieve reparatie `20260908180000_hours_conflict_http_status.sql` is live (receipt `20260908110800_hours_conflict_http_status_release`): uitsluitend 13 expliciete business-errcodes in 12 functies zijn `PT409` geworden, zodat HTTP409 direct terugkomt. Andere functie-inhoud, ACLs en gates zijn gelijk. De aangepaste `hours-classify-day` is opnieuw gedeployed. JA UIT/demo AAN opnieuw geverifieerd. Oude vijf bronmigraties niet herschrijven.
- Laatste lokale checks: **1.429 applicatietests**, lint 0 errors, build, typecheck en Deno groen. **106 echte PostgreSQL-tests** met vijf migraties elk tweemaal, waaronder volledige catalogus/ACL-vergelijking, conflict zonder writes en behoud van native PostgreSQL-fouten. Nieuwe migratiehash `521eb713e62b540445d9c364bc3e5113f472515a7f6ca8bae3590c9ba8b1c97e`. Gerichte echte HTTP-herhaling loopt; frontend nog niet naar main gemerged.
- **Open testafhankelijkheid:** opgeslagen `QA_SUPERADMIN` is bewust inactief en geblokkeerd. Tijdelijke activatie is aan Kas gevraagd, nog niet toegestaan; account niet wijzigen zonder antwoord. De businessflow kan met `HOURS_DEMO_SKIP_SUPERADMIN=1` door. Een latere `HOURS_DEMO_TOGGLE_ONLY=1` test gebruikt hetzelfde bewezen dossier.
- **Tijdelijke demo-instelling:** uitgaande demo-mail/WhatsApp staan tijdens QA op pauze. Oorspronkelijke waarde false/false staat in het fixturebestand; herstel na QA met `scripts/prepare-hours-demo.mjs restore-communications` en `HOURS_DEMO_FIXTURE_PATH`. Geen echte berichten of betaalde AI-calls uitgevoerd.
- Duurzame bewijsmap: `/Users/kas/.codex/visualizations/2026/09/07/01a07bd6-9fd4-7440-a463-9fc32ece3f91/JA-Werkt-urenmodule/bouw/`; onderdelen `module-gate-quality`, `module-gate-db-qa` en `demo-connected-qa`.
- Frontendmerge/publicatie nog niet uitgevoerd. Publiceer de volledige bewaakte branch in één release; merge niet eerst de oudere ongegate foundation-PR. Resterende modulebouw (OCR/inname, mailprofielen/outbox, volledige weekregels, vrijgave/export) blijft open; dit is geen volledige klantoplevering.

## Historische bouw urenmodule — 8 september 2026

- Vaste worktree `/Users/kas/dev/ja-works-hub/.worktrees/urenmodule-bouw`, branch `codex/urenmodule-bouw`, vanaf `aedc6dc` (#261). Eerste codecheckpoint `3530bcd`.
- Klantweken, handmatige dagrevisies, exacte medewerkerreacties, interne controle, Nederlandse deadlines, pure minuten-/matrixkern en mailplanningpreview gebouwd. Dit is een ontwikkelversie zonder vrijgave/export of automatische inname. Geen productieklanten geactiveerd en geen migratie gedeployed.
- [Bouwstand](docs/urenmodule-bouw.md) en [databasecontract](docs/urenmodule-db-contract.md) beschrijven grenzen, checks en volgende stappen. De vaste prijs/specificatie blijft de klantafspraak; deze bouwstand is geen volledige opleverclaim.
- Tijdelijke werkmap verdween vóór commit; succesvol uitgevoerde bestandsedits zijn uit sessielogs hersteld. Migratiehash exact behouden, 43 DB-tests opnieuw geslaagd; vervolgwerk blijft in vaste worktrees en krijgt Git-checkpoints.
- Fundering is opgeslagen tot `47c408f`, draft PR #262; CI quality en Vercel preview geslaagd. Nog geen productiemigratie.
- Afhankelijke matrixbouw: `/Users/kas/dev/ja-works-hub/.worktrees/urenmodule-matrix`, branch `codex/urenmodule-matrix`, vanaf `47c408f`. Matrixeditor, expliciete CAO-koppelingen, conceptpublicatie en immutable versies gebouwd. Opslag: 30 echte PG-tests + 85 pariteitsgevallen geslaagd; migratiehash `cee82deced978525e0d92544f6e8d25b027c0cc21e7a97ec97ecaffdd146a0fe`. Zie [matrixcontract](docs/urenmodule-matrix-contract.md). Eerst basiswijzigingen integreren vóór merge naar main.
- Brongegevens en servermatige dagclassificatie zijn in de vervolgbranch gebouwd: nieuwe revisies bewaren diensten, pauzes en broncodes; de eerste vastgelegde matrixbasis van een dag blijft bij correcties behouden. De browser stuurt alleen dag/revisie naar de self-auth serverfunctie; de service-only finalisatie controleert opnieuw actor, revisie en context. Zie [classificatiecontract](docs/urenmodule-classification-contract.md).
- Matrixcheckpoint `da7dbaa` staat als draft in PR #263 (base `codex/urenmodule-bouw`). Inclusief matrixbouw: 1.234 tests, typecheck, lint en build groen; 7 offline browsercontroles zonder API-aanroepen geslaagd.
- Actieve classificatieworktree: `/Users/kas/dev/ja-works-hub/.worktrees/urenmodule-classificatie`, branch `codex/urenmodule-classificatie`, vanaf `69aee12`. Hier verdergaan; niet opnieuw vanaf main beginnen.
- Classificatiecheckpoint `773f3d0` staat als draft in [PR #264](https://github.com/sitejob-nl/ja-works-hub/pull/264), base `codex/urenmodule-matrix`. De drie draft-PR's zijn afhankelijk en nog niet gemerged. De code is in vaste worktrees en op remote branches opgeslagen.
- Classificatievalidatie: 1.349 applicatietests, lint/typecheck/build en Deno groen; 74 echte PG-tests (inclusief 43 foundationregressies), 91 brongevallen en 9 offline browsercontroles geslaagd. Drie migraties elk tweemaal toegepast. Classificatiehash `722e850c895e9cb876a44050c8d2aeaacf78dd2011f91c30677fe22f09c6a484`. Geen productie-DDL, echte uren of berichten gewijzigd.
- Resterende bouw: volledige weekoverwerk-/samenloopregels, fijnere tijdprecisie waar nodig, klantlinks/upload/mailinname, VPS/OCR/Vision, mailprofielen/outbox, vrijgave/export en pilotacceptatie. Voor definitieve inrichting zijn bevestigde klantmatrices en het payrollvoorbeeld nodig. Schema 1 geeft daarvoor geen standaardwaarden of volledige opleverclaim.

## Correctie 2026-09-07 — vast AI-maandbudget (`codex/ai-monthly-budget-reset`)

- Expliciete klantcorrectie: **€50 budget per maand, geen cumulatief tegoed**. Ongebruikt budget vervalt bij de volgende Nederlandse kalendermaand.
- Werkmap `/tmp/ja-works-ai-monthly-cap`, vanaf `origin/main` `3e3735c` (PR #260). De registratie van alle elf betaalde AI-functies blijft intact; bestaande RPC-signatures blijven compatibel.
- Nieuwe migratie corrigeert de maandregeling met herleidbare boekingen. Het huidige maandverbruik telt mee: op het controlemoment €0,01 in september, dus €49,99 beschikbaar. Oude boekingen worden niet gewijzigd of verwijderd.
- Open aanvragen uit een vorige maand behouden hun reservering apart. Late afrekening of vrijgave verandert de ruimte voor de nieuwe maand niet. Er is geen inhaal of stapeling van gemiste maanden; handmatige top-ups zijn geblokkeerd bij een actief maandbudget.
- De huidige afspraak en het databasecontract staan in [docs/ai-accounting.md](docs/ai-accounting.md) en [docs/ai-accounting-db-contract.md](docs/ai-accounting-db-contract.md). De oudere sessie hieronder documenteert de eerste, inmiddels gecorrigeerde interpretatie.

## Sessie 2026-09-07 — eerste AI-accountingrelease (`codex/ai-ledger-monthly-credits`, maandinterpretatie gecorrigeerd)

- Nieuwe worktree `/tmp/ja-works-ai-ledger`, vanaf actuele `origin/main` `cd0ba7d`. De oude dirty checkout is ongemoeid gelaten.
- Eerste implementatie interpreteerde het maandbedrag als €50 extra met behoud van restant. Kas heeft dit expliciet gecorrigeerd naar een vast maandbudget zonder stapeling; zie de correctie hierboven.
- Alle elf betaalde endpoints gebruiken `_shared/ai-accounting.ts`: vooraf reserveren, één providercall, daarna atomair aanvraag/verbruik/boeking afrekenen. Dry-runs tellen mee; cachehits niet. Onbekende uitkomsten houden hun reservering en worden zichtbaar gemeld.
- Migratie `20260907201512_ai_accounting_ledger.sql` voegt onveranderlijke boekingen en een idempotente maandcron toe. Andere organisaties hebben standaard geen maandregeling. Het historische verschil van €0,22 wordt zichtbaar behouden, zonder extra afschrijving.
- Instellingen en superadmin tonen saldo, reserveringen, maandtoelage, providerkosten en volledige historie. Handmatige correcties zijn idempotent.
- Validatie: volledige quality-gate, Deno voor alle elf functies, gemockte provider/handler-tests, echte concurrerende PostgreSQL/pg_cron-tests en desktop/mobiele mock-UI. Geen betaalde testcalls of klantcommunicatie.
- Release vereist migratie, alle elf edge functions via CLI en frontendmerge; alleen de frontend deployt automatisch. Zie [docs/ai-accounting.md](docs/ai-accounting.md) en [databasecontract](docs/ai-accounting-db-contract.md) voor beheer, inschrijving, controles en herstel. De PR/releasecontrole is leidend voor de actuele uitrolstatus.
- De oudere AI/VPS-beschrijvingen verderop zijn historisch; de AI-sectie in `CLAUDE.md` is nu bijgewerkt. Qwen is uitgefaseerd. Documentvoorbewerking op de JA Werkt-VPS en de toekomstige urenfotoherkenning vallen buiten deze accountingrelease.

## Sessie 2026-09-03 — mailhistorie-filter + mailboxrechten (`fix/mail-history-filter-en-rechten`)

- **Worktree:** `.claude/worktrees/fix-mail-history-rechten`, branch `fix/mail-history-filter-en-rechten` vanaf `origin/main` `cdcc248` (#244).
- **Aanleiding:** op de opdrachtgever-tab (Bax Metaal) stond mail van derden, en een admin (Kas) zag de mailbox
  van Jeroen ondanks `can_read_mail = false` in `mail_account_user_access`.
- **Oorzaak 1:** `outlook-mail` plakte per adres een quoted KQL-term met OR aan elkaar; Graph leest dat niet als
  filter en geeft de hele mailbox terug (live bewezen tegen de demo-mailbox: 1 adres → 0 treffers, 2 fictieve adressen → 50).
- **Oorzaak 2:** `adminOrgAccess` in `_shared/outlook-accounts.ts` gaf elke admin lees/verzend op alle
  org-mailboxen, óók bij expliciete `false`-grants.
- **Fix:** `_shared/outlook-mail-filter.ts` (+ Deno-test) → één KQL-string + server-side nafilter op
  from/to/cc/bcc per pagina; client stuurt `participant_emails` ook bij `next_link`; admin-override verwijderd
  op alle drie de plekken. Grants zijn nu leidend.
- **Prod-data:** grants van Jeroen (profiel `35af6e91`, jeroen@jawerkt.nl) op zijn eigen mailbox volledig gezet en
  `can_send_mail` op Algemeen aan, zodat hij na de deploy niets verliest. Kas heeft géén grant op Algemeen —
  zelf aanvinken in Instellingen → Outlook.
- **Deploy:** `outlook-mail`, `outlook-accounts`, `outlook-calendar`, `outlook-send-mail` via CLI vanuit deze worktree.
- **Volgende actie:** PR reviewen + mergen (frontend-deel: `participant_emails` bij vervolgpagina's).

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
