# JA Werkt — Handover Document

**Datum:** 6 mei 2026 (eerdere versie: 7 april 2026 — zie git history)
**Project:** JA Werkt — Multi-tenant Staffing Platform
**Klant:** JA Werkt, Jeroen Adriaans (Mierlo)
**Developer:** Kas (kas@sitejob.nl), SiteJob
**Repo:** `sitejob-nl/ja-works-hub` (branch: `main`)
**Supabase project:** `noaupcteygfvlyymqtew`

---

## 1. Wat is JA Werkt?

Een SaaS platform voor uitzendbureau JA Werkt, gespecialiseerd in arbeidsmigranten (PT, LT, PL) in Brabant/Limburg. Vervangt meerdere legacy-systemen (Carerix, Joboti, Umanga, OnTrack, Q8, Buddy). Flexpedia blijft als externe loonmotor.

**Tech stack:** React 18 + TypeScript + Vite, Supabase (Postgres + Auth + Edge Functions + Storage + Realtime), TanStack Query v5, shadcn/ui + Tailwind, vite-plugin-pwa.

**Omvang (mei 2026):** ~70 pagina's, ~95 DB-tabellen + 3 views, ~57 edge functions, **4** auth zones (main app, medewerkerportaal, klantportaal, superadmin).

---

## 2. Architectuur in het kort

### Data-model
- **Kandidaat = Medewerker**: Eén `candidates` tabel, `employee_status` bepaalt of iemand in dienst is. Legacy `employees` tabel bestaat nog maar is niet meer leidend.
- **Plaatsing als knooppunt**: `placements` linkt candidate + company + vacancy + housing + vehicle + payroller.
- **4 payrollers**: Flexpedia (NL), BrioWorks (PT), Bromida (LT), Retiva — zit op plaatsing, niet op persoon. JA Werkt factureert alleen voor brioworks/bromida/retiva.
- **Multi-tenant**: Alles gescoped op `organization_id`, RLS op alle tabellen.

### Auth zones
| Zone | Pad | Hook | Doel |
|------|-----|------|------|
| Main App | `/` | `useAuth()` | Intercedenten, backoffice, finance, admin |
| Medewerkerportaal | `/portaal/` | `usePortal()` | Geplaatste medewerkers — uren, documenten, ziekmelding, loonstroken |
| Klantportaal | `/klantportaal/` | (eigen context) | Opdrachtgever-contacten — eigen plaatsingen + uren-goedkeuring |
| Superadmin | `/superadmin/` | `useSuperAdmin()` | Cross-tenant beheer |

Public token-routes: `/onboarding/:token`, `/contract/sign/:token`, `/profiel/:token`, `/match/reageer/:token`, portal/klantportaal-activatie.

### Encryptie
BSN, IBAN, webhook secrets, OAuth tokens: versleuteld via Supabase Vault (DB triggers). Nooit direct lezen — gebruik RPCs (`get_candidate_decrypted`, `get_my_sensitive_data`, `get_whatsapp_token`, `get_exact_token`, `get_carerix_token`).

### MCP-workflow
DB- en edge-function-werk loopt standaard via Supabase MCP-tools (`mcp__claude_ai_Supabase__*`): `apply_migration`, `deploy_edge_function`, `generate_typescript_types`, `list_tables`, etc. Vermijdt CLI-installatie.

---

## 3. Wat is af (productierijp)

### Fase 0–5: Carerix-alignment
- Kandidaat/medewerker merge — één `candidates` tabel + `candidate_employment` voor dienstverbanden
- Notities + Taken systeem (polymorf, gekoppeld aan elke entiteit)
- Contactpersonen als first-class entity
- Dashboards (time-to-hire, datakwaliteit, bronanalyse, activiteiten)
- Talentpools + geavanceerd zoeken (full-text op CV)

### Sprint 0–3
- **Security:** RLS audit alle tabellen, RBAC met `useHasRole()`, onboarding tokens 7d TTL + single-use
- **CRM:** Quick Navigator, signalering, uitstroomanalyse (fishbone), audit trail, deduplicatie, custom velden
- **AI:** CV auto-fill via callback, functiegroep-badges, werkhistorie-tijdlijn, PDF export
- **Huisvesting:** afstand-tot-werk (Haversine + Nominatim), auto-toewijzing, planning-waarschuwingen, wekelijkse huur

### Sinds april (sprints 5 / D3 / Carerix-live / 04-25 / 04-29)

**AI / CV-pijplijn:**
- ✅ Server-side **AVG-pseudonimisering** (`_shared/cv-pseudonymize.ts`): naam → `[KANDIDAAT]`, email → `[EMAIL]`, NL-tel → `[TELEFOON]`, BSN met 11-proef → `[BSN]`, IBAN → `[IBAN]`. Counts in `candidates.cv_pseudonymization_meta`.
- ✅ **Batch-backfill** voor 1100 bestaande CV's (`analyze-cv-batch` + UI op `/superadmin/cv-backfill`). Throttle 1.5s/CV, max 25/batch, photo-detectie via `/Subtype /Image` byte-scan.
- ✅ **Provider-switch**: VPS (Qwen3-14B op Hetzner via Ollama) of Cloud Anthropic, per-org credits, custom prompt-override.
- ✅ Realtime status in `CandidateAiTab` via Supabase channel.

**Talentpools (D3):**
- ✅ `is_dynamic` + `filter_criteria` (jsonb) + `refresh_frequency` (manual/daily/weekly).
- ✅ Edge function `refresh-talentpool-members` (single-mode user-JWT of cron-mode `x-cron-secret`). pg_cron schedules opt-in.
- ✅ `talentpool_members.added_by_filter` — handmatig toegevoegden blijven plakken bij refresh.

**Carerix live API sync:**
- ✅ 6 edge functions: `carerix-config` (OAuth), `carerix-test`, `carerix-introspect`, `carerix-sync-start`/`-worker`/`-cancel`. Tokens via `get_carerix_token` RPC.
- ✅ Full CR*-schema sync: kandidaten, matches, plaatsingen, documenten, notes, todos. Bulk-enrich helper voorkomt soft-deadline timeouts. Byte-download voor attachments. Klikbare documents-tab.
- ⚠️ Carerix v1 heeft **geen documents/employment/vacancies endpoints** — voor die data is een aanvullende CSV-route nodig (zie `docs/open-gaps.md`).

**Match-flow:**
- ✅ `send-match-proposal` edge function dual-mode (`preview=true` returnt rendered HTML zonder verzenden).
- ✅ Public response page `/match/reageer/:token` → `MatchResponse.tsx`. Opdrachtgever accepteert/wijst af via unieke token.
- ✅ `match_proposal_tokens` table; service-role validatie (anon enumeration dichtgezet door SEC-4 hardening).
- ✅ "Voordragen" → "Nieuwe match" labels door de hele UI.

**Vacatures (B1/B2/C1):**
- ✅ Overzicht: Aangemaakt → Startdatum, status-toggle, overdue-badge, urgentie 1–3 (`NOT NULL CHECK`).
- ✅ Functie-koppeling: `vacancies.function_id` FK → `company_functions` (optioneel).
- ✅ `start_date_text` voor "Direct" / "ZSM" naast typed `start_date`.

**Huisvesting (B3/B4/C2/C4):**
- ✅ `properties.name` nullable (UI is adres-gedreven, naam is optionele bijnaam).
- ✅ `units.monthly_cost` + `deposit_amount` **DROPPED** — borg op org-level setting, alleen `weekly_cost` per kamer.
- ✅ `property_owners` master-data tabel (`UNIQUE (organization_id, lower(name))`).
- ✅ Housing dashboard: vrije plekken + 12-weken-grafiek.
- ✅ Bulk-kamers, plaats-filter, sortering (adres/beschikbaarheid/bezetting/capaciteit), export CSV/Excel, JA Werkt panden-import, housing reminders via pg_cron.

**Transport:**
- ✅ Volledige CRUD op voertuigen, toewijzingen, boetes, ritten, schade.
- ✅ **RDW-lookup** voor kentekens met APK-datum first-class + APK-alerts.
- ✅ `vehicles.first_registration_nl` (RDW datum eerste tenaamstelling) — migration uncommitted, zie `HANDOVER_SESSION.md`.
- ✅ `send-damage-report` edge function (email met foto's + template).

**Communicatie / email:**
- ✅ Microsoft Graph integration: `microsoft-auth`, `microsoft-callback`, `microsoft-api`. Frontend `Email.tsx` + `EmailTemplates.tsx`.
- ✅ Email signatures.
- ✅ Bulk WhatsApp + email campagnes (`bulk-campaign-processor`, `email-campaign-processor`), opt-out handler, rate-limiting.
- ⚠️ Email-triage / AI-classificatie laag bovenop Microsoft Graph **nog niet gebouwd** (D1).

**Telefonie (Voys):**
- ✅ `voys-api` + `voys-sync-calls` voor call-logs/transcripts gekoppeld aan kandidaat-records via telefoonnummer. Dekt "AI call support" requirement uit 03-20 meeting.

**KVK / RDW:**
- ✅ KVK v2 endpoint, naam-zoek met autocomplete bij nieuwe + bestaande opdrachtgever, errors zichtbaar in toast.
- ✅ RDW-lookup zoals genoemd onder Transport.

**Klantportaal:**
- ✅ Aparte zone `/klantportaal/*` voor opdrachtgever-contacten. Eigen plaatsingen + uren-goedkeuring. Token-based activatie via `client-portal-activate`.

---

## 4. Wat nog NIET af is

> **Tip:** levende lijst van open items staat in [`docs/open-gaps.md`](docs/open-gaps.md). Onderstaande is een snapshot van mei 2026.

### Open na meeting Jeroen 25-04
- **Schoonmaak-module** (C5) — `cleaning_schedules` + `cleaning_logs` + tab + dashboard widget
- **Kosten-reminder edge function** (C3) — cron 3 mnd → `recruiter_tasks`
- **Buddy app CSV-import** (C9)
- **AI e-mail triage** (D1) — classificatie + reply-suggesties bovenop Microsoft Graph
- **Carerix documenten/historie via CSV** (D2) — alternatieve route, want v1 API ontbreekt
- **Outbound SMS** (D4) — provider-keuze (MessageBird/Twilio) eerst nodig
- **WhatsApp inbound replies** (D5) — UI-check of webhook → chat correct binnenkomt
- **Km-verwachting + alarm + opvolg-WhatsApp** — `mileage_entries` staat, maar expected-km / alarm / opvolg ontbreken
- **Indirecte facturatiestroom** (A1 → tussenlaag → eindklant) — niet expliciet in datamodel

### Meeting Jeroen 29-04 (in-progress, **uncommitted in `main`**)
- 🟡 **`company_functions` salaris-range + skills** (migration `20260429190000`) — UI in CompanyFunctionsTab + VacancyNew + Talentpools wordt nu uitgewerkt. Zie [HANDOVER_SESSION.md](HANDOVER_SESSION.md).
- 🟡 **`vehicles.first_registration_nl`** (migration `20260430160000`) — UI in VehicleNew/Edit aangepast.

### Fase 2 (groter, nog niet gepland)
- Flexpedia API integration
- Google Calendar sync (`Agenda.tsx` is intern, geen sync)
- SEPA XML export
- Contract template engine met variabelen
- Digital signatures
- Transport GPS live tracking
- Uitgebreid medewerkerdossier (pensioen, vakantierechten)
- Energy Wizard (gas/water/energie voor huisvesting)
- Camera-integratie op dashboard
- WordPress lead webhook (kan via `candidate_signup_links`)
- Partner portal voor externe recruiter CV-uploads
- Welkomstvideo + i18n medewerkerportaal (FR-41)

### Test-coverage
- Vitest + Testing Library + jsdom (unit) en Playwright (e2e via `tests/e2e/`) — infra klaar, dekking nog beperkt. Uitbouw lopend.

---

## 5. Belangrijke klantbeslissingen

### Meeting 26-03-2026
1. **"Kandidaat blijft altijd kandidaat"** — geen apart employee-record, status verandert maar persoon blijft in kandidatenlijst
2. **Payroller op plaatsing** — niet op persoon of bedrijf. Eén opdrachtgever kan 2 facturen krijgen
3. **Uitstroomanalyse = topprioriteit** — fishbone diagram, door-wie + waarom
4. **Tarieven bewust geparkeerd** — Exact Online handelt dit af
5. **Huisvesting wekelijks** — niet maandelijks
6. **Portaal alleen voor geplaatste kandidaten** — toegang NIET intrekken na exit
7. **Salaris op vacatures** — range zonder specificatie ("3000-4000")

### Meeting 25-04-2026 (D-sprint scope)
8. Talentpools moeten **dynamisch** kunnen — auto-refresh op filter, manual ledenbijhoud
9. Vacatures: **urgentie 1-3** + Direct/ZSM tekstveld + functie-koppeling
10. Property naam **optioneel** (adres-gedreven), `units.monthly_cost`/`deposit_amount` **schrappen**
11. Property eigenaren als **master-data** (1 row per unique owner per org)
12. CV-pseudonimisering **server-side** voor AVG (1100 CV-batch backfill)
13. Housing dashboard: focus op **vrije plekken** + 12-weken-vooruitblik

### Meeting 29-04-2026
14. **Salaris-range op `company_functions`** (geen vast uurtarief — range tussen min/max). Vacatures erven als defaults.
15. **`required_skills` op `company_functions`** — vacatures + talentpool "Genereer uit functie" gebruiken dit als seed.
16. **Master-list skills**: uitgesteld (te complex voor nu, eerst per-functie skills laten settelen).

---

## 6. Bekende technische schuld

| Issue | Detail |
|-------|--------|
| `employees` tabel | Legacy, data is gemigreerd naar `candidates` maar tabel bestaat nog |
| `types.ts` | Auto-generated (~6400 regels) — regenereer via Supabase MCP na schema-wijzigingen |
| WhatsApp | Code compleet, niet live getest met echte Meta credentials |
| Exact Online | Afhankelijk van SiteJob Connect service (extern) |
| CV-analyse | Alleen text-based PDFs (geen OCR) — basic prompt-injection sanitization |
| Edge-function auth | Alle protected functions hebben `verify_jwt = false` met self-auth in body. Bewust — Supabase Edge Runtime kan ES256 niet valideren. |
| Hardcoded URLs | SiteJob Connect URLs in edge functions, Meta Graph API `v25.0`, CV text cap 15k, campaign batch 50 |
| `useModuleEnabled` | Nog maar in 3 files gebruikt — niet breed toegepast |
| Lovable legacy | `lovable-tagger` in devDependencies (dev-only, harmless) |

---

## 7. Ontwikkelomgeving

```bash
npm run dev              # Dev server (port 8080)
npm run build            # Production build
npm run lint             # ESLint
npm run test             # Vitest unit
npm run test:e2e         # Playwright e2e (alle)
npm run test:e2e:flows   # Playwright — full UI flows
```

### Environment variables

**Frontend (`.env`):**
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

**Edge function secrets (Supabase Dashboard):**
- `OLLAMA_BASE_URL` + `OLLAMA_API_KEY` (Hetzner VPS, Qwen3-14B)
- `ANTHROPIC_API_KEY` (Cloud Anthropic provider voor CV-analyse)
- `KVK_API_KEY`, `APIFY_API_TOKEN`, `EXA_API_KEY`
- `CRON_SECRET` (voor talentpool refresh + housing reminders cron)
- Microsoft OAuth client/secret, Voys credentials

### Types regenereren
Voorkeur via Supabase MCP. CLI-fallback:
```bash
npx supabase gen types typescript --project-id noaupcteygfvlyymqtew > src/integrations/supabase/types.ts
```

---

## 8. Bestanden & documentatie

| Bestand | Doel |
|---------|------|
| [`CLAUDE.md`](CLAUDE.md) | Volledige codebase-guidance — schema, routes, patterns, integraties, MCP-workflow. **Single source of truth.** |
| [`AGENTS.md`](AGENTS.md) | 1-regel pointer naar CLAUDE.md (Codex en Claude Code lezen hetzelfde) |
| [`README.md`](README.md) | Korte project-intro + dev-commands |
| [`docs/open-gaps.md`](docs/open-gaps.md) | Levende lijst open client-meeting items + Fase 2 backlog |
| [`HANDOVER_SESSION.md`](HANDOVER_SESSION.md) | Werk-in-uitvoering snapshot — uncommitted changes, in-progress features |
| [`docs/carerix-api-research.md`](docs/carerix-api-research.md) | Research op Carerix v1 API endpoints + gaps |
| [`docs/carerix-credentials-setup.md`](docs/carerix-credentials-setup.md) | Setup-instructies Carerix OAuth |
| `src/integrations/supabase/types.ts` | Auto-generated — NOOIT handmatig bewerken |

> Eerdere `.claude/plans/agile-hopping-hopper.md` en `reactive-brewing-dragon.md` zijn verwijderd; de actuele roadmap zit in `docs/open-gaps.md`.

---

## 9. Recente commits (mei 2026)

| Hash | Beschrijving |
|------|-------------|
| `c5a5f9e` | feat(transport): basis-CRUD aanvullen op voertuigen, toewijzingen, boetes, ritten en schade |
| `8fcb890` | feat(companies): KVK naam-zoek ook bij bewerken bestaande opdrachtgever |
| `351a6e2` | fix(kvk): zoeken endpoint naar v2 + lekkere error doorgeven |
| `5704b6e` | feat(housing): sorteren op adres, beschikbaarheid, bezetting en capaciteit |
| `2eff8e8` | feat(transport): RDW-lookup voor kentekens + APK-datum first-class + APK-alerts |
| `ec0abe7` | feat(housing): export-knop op panden-overzicht (CSV + Excel) |
| `be54f45` | feat(housing): bulk-kamers + plaats-filter |
| `2e84b86` | feat(companies): KVK naam-zoek met autocomplete bij nieuwe opdrachtgever |
| `e58fa33` | feat(ai-cv): provider-switch (VPS ↔ Cloud Anthropic) + per-org credits + custom prompt |
| `c70e3be` | feat(housing): pg_cron schedule voor housing-reminder-cron |
| `ef198e3` | feat(fase1): sprint 1+2 — email signature, housing reminders, AI-analyse delen, home check-in |
| `6a49975` | feat(carerix): full CR*-schema sync — matches, placements, documents, notes |
| `879b4c8` | feat(meeting jeroen): D3 — dynamische talentpools met auto-refresh |
| `3ad11dd` | feat(meeting jeroen): sprint 5 — AVG pseudonimisering + AI CV batch-backfill |

Volledige geschiedenis: `git log --oneline`.

---

## 10. Prioriteiten voor vervolg

1. **Sluit meeting 29-04 features af** — `company_functions` salary-range + skills + vacancy-defaults + talentpool generate-uit-functie. Migrations zijn live, UI is uncommitted (zie `HANDOVER_SESSION.md`).
2. **Schoonmaak-module** (C5) — concrete impact voor klant, redelijk afgebakend.
3. **Kosten-reminder cron** (C3) — kleine edge function, hoog signal-to-noise.
4. **AI e-mail triage** (D1) — bovenop bestaande Microsoft Graph stack; hoogste impact-per-uur na de meeting-29 features.
5. **Carerix CSV-route voor documenten/historie** (D2) — nodig om migration-plan af te ronden.
6. **WhatsApp live testen** — code is af, moet alleen nog met echte Meta credentials gevalideerd.
7. **E2E test-uitbouw** — risicobeperking voor refactoring.
8. **Buddy CSV-import** (C9) — eenmalige actie, kan parallel.

---

*Voor agent-handoff naar Codex / Claude Code: lees [CLAUDE.md](CLAUDE.md) als primary, dit document voor context, [HANDOVER_SESSION.md](HANDOVER_SESSION.md) voor de huidige uncommitted state.*
