# JA Werkt — Handover Document

**Datum:** 1 juni 2026
**Project:** JA Werkt — multi-tenant staffing platform
**Klant:** JA Werkt, Jeroen Adriaans (Mierlo)
**Developer:** Kas (kas@sitejob.nl), SiteJob
**Repo:** `sitejob-nl/ja-works-hub`
**Supabase project:** `noaupcteygfvlyymqtew`
**Actieve werkbranch in deze workspace:** `codex/portal-i18n`

---

## 1. Wat is JA Werkt?

JA Werkt is een SaaS-platform voor een uitzendbureau gespecialiseerd in arbeidsmigranten in Brabant/Limburg. Het platform vervangt of consolideert Carerix, Joboti, Umanga, OnTrack, Q8 en Buddy. Flexpedia blijft vooralsnog de externe loonmotor.

**Stack:** React 18 + TypeScript + Vite, Supabase (Postgres + Auth + Edge Functions + Storage + Realtime), TanStack Query v5, shadcn/ui + Tailwind, Playwright/Vitest, PWA.

**Omvang:** ruwweg 70+ pagina's, 90+ tabellen plus views, circa 60 edge functions en 4 auth-zones.

Belangrijkste domeinen: kandidaten/medewerkers, opdrachtgevers, vacatures, matches, plaatsingen, uren, facturatie, huisvesting, transport, communicatie, onboarding, portals en superadmin.

---

## 2. Architectuur in het kort

### Kernmodel

- **Kandidaat = medewerker:** `candidates` is de source of truth; `employees` is legacy.
- **Plaatsing is het knooppunt:** `placements` verbindt kandidaat, opdrachtgever, vacature, huisvesting, voertuig en payroller.
- **Payroller op plaatsing:** `flexpedia`, `brioworks`, `bromida`, `retiva`. JA Werkt factureert alleen brioworks/bromida/retiva.
- **Multi-tenant:** vrijwel alle data is gescoped op `organization_id`; RLS bewaakt tenant-isolatie.
- **Sensitive data:** BSN, IBAN, webhook secrets en OAuth tokens worden via Supabase Vault/triggers versleuteld. Gebruik decrypt-RPCs; selecteer encrypted kolommen niet direct.

### Auth zones

| Zone | Pad | Hook/context | Doel |
|------|-----|--------------|------|
| Main app | `/` | `useAuth()` | Intercedenten, backoffice, finance, admin |
| Medewerkerportaal | `/portaal/` | `usePortal()` | Medewerkers: uren, documenten, ziekmelding, loonstroken |
| Klantportaal | `/klantportaal/` | `ClientPortalContext` | Opdrachtgever-contacten: plaatsingen + uren-goedkeuring |
| Superadmin | `/superadmin/` | `useSuperAdmin()` | Cross-tenant beheer |

Public token-routes: `/onboarding/:token`, `/contract/sign/:token`, `/profiel/:token`, `/match/reageer/:token`, `/solliciteren/:slug`, portalactivatie en klantportaalactivatie.

### Supabase workflow

Gebruik voor DB- en edge-function-werk bij voorkeur Supabase MCP:

| Taak | Tool |
|------|------|
| Migration toepassen | `mcp__claude_ai_Supabase__apply_migration` |
| Edge function deployen | `mcp__claude_ai_Supabase__deploy_edge_function` |
| Types regenereren | `mcp__claude_ai_Supabase__generate_typescript_types` |
| Schema/advisors inspecteren | `list_tables`, `list_migrations`, `get_advisors` |

`src/integrations/supabase/types.ts` is generated; nooit handmatig aanpassen.

---

## 3. Productstatus

### Productierijp / grotendeels af

- Kandidaat/medewerker-merge met `candidate_employment`.
- Notities en taken als polymorfe records.
- Dashboards, signalering, uitstroomanalyse, audittrail, custom velden en deduplicatie.
- Huisvesting met units, toewijzingen, reminders, vrije-plekken dashboard en 12-weken vooruitblik.
- Transportmodule met voertuigen, toewijzingen, boetes, ritten, schade, RDW lookup en APK alerts.
- Klantportaal en medewerkerportaal.
- Contract signing, onboarding links, public profile/match routes.
- Microsoft 365 / Outlook OAuth + mail/calendar proxy.
- Exact Online en WhatsApp codepaden via SiteJob Connect; echte acceptatie met productiecredentials blijft deels open.
- Dynamische talentpools met filtercriteria, cron/handmatige refresh en sticky manual members.
- Recruitment intake: publieke sollicitatieroute, leadstatus, verplichte CV, recruiter-taak en notificatie.
- Vacatureflow: functie-koppeling, salary/skills defaults, urgentie, Direct/ZSM, matchpipeline en kandidaatvoorstel-preview.
- Portal i18n: recente branch bevat portal-taaldekking en toggle.

### AI / kandidaatverrijking

De oorspronkelijke CV-analyse is doorontwikkeld richting **kandidaatdossier-analyse**:

- UI kan CV/document/image uploaden en tekst extraheren uit PDF, DOC/DOCX, ODT, TXT, RTF en images (OCR in browser).
- Edge-code bouwt een dossier met documenttekst, profielvelden, interne notities, communicatie, plaatsingen en arbeidsrelaties.
- Dossier wordt server-side gepseudonimiseerd vóór verzending naar VPS/Cloud.
- Output bevat naast plaatsbaarheid ook dossierbetrouwbaarheid, bronverwijzingen, contra-indicaties en handmatige-review vlaggen.
- Batchbackfill is bedoeld voor circa 1.900 bestaande kandidaten, inclusief kandidaten zonder klassieke CV maar met notitiecontext.

Let op: de huidige dossier-AI wijzigingen staan nog uncommitted in deze workspace; zie [HANDOVER_SESSION.md](HANDOVER_SESSION.md).

### Carerix

Live API-sync bestaat uit `carerix-config`, `carerix-test`, `carerix-introspect`, `carerix-sync-start`, `carerix-sync-worker`, `carerix-sync-cancel` en `carerix-attachment-download`.

Status:

- CR-scope en productieruns voor notities/taken zijn sterk verbeterd.
- `CRTodo` wordt niet meer als gewone notitie geïmporteerd; echte taken gaan naar `recruiter_tasks`.
- `CREmployee.notes` profielnotities zijn opgesplitst en als interne kandidaatnotities opgeslagen.
- Documentflow is metadata + byte-download in twee stappen.
- Huidige uncommitted mapper-update verrijkt kandidaten met `employee_number`, BSN, nationaliteit en talen.

Open Carerix-risico's staan in [docs/carerix-integratie-audit.md](docs/carerix-integratie-audit.md): `crCompanyPage`/`crContactPage`, REST attachment fallback, 27 parentloze `CRNote` records en businessvalidatie van `CRMatch`/`CRWorkHistory`.

---

## 4. Open punten

Levende lijst: [docs/open-gaps.md](docs/open-gaps.md). Recente meetinganalyse: [docs/meeting-open-points-2026-05-27.md](docs/meeting-open-points-2026-05-27.md).

Hoofdthema's:

- **Instroomfunnel:** lead/kandidaat/medewerker als statussen binnen één persoon; re-entry/duplicaatbeleid nog productbesluit.
- **Kandidaatprofiel als werkplek:** notities, screening-AI, huisvesting, vervoer en taken centraler maken; toewijsacties blijven open.
- **AI-verrijking bestaande database:** circa 1.900 kandidaten analyseren op CV én interne notities, met uitlegbare score en functiegroep/taxonomie.
- **Data/compliance:** ICE-telefoonnummer, EU/NL-telefoons, incomplete-statuscriteria, BSN/nationaliteit/taal-migratie, bewaartermijnen en AI/WhatsApp-AVG-besluiten.
- **Carerix productieacceptatie:** volledige data-validatie met echte JA Werkt-data.
- **Schoonmaakmodule, kostenreminder, Buddy CSV, SMS, WhatsApp inbound replies, km-alarm en indirecte facturatiestroom** zijn nog niet volledig gebouwd/besloten.
- **Exact scope:** meetingcontext noemt Exact deels out-of-scope, terwijl de module bestaat; expliciet scopebesluit nodig.

Fase 2 / later: Flexpedia API, Google Calendar sync, SEPA XML, contract template engine, digitale signatures, GPS live tracking, uitgebreid medewerkerdossier, Energy Wizard, camera-integratie, partner portal en marketing automation.

---

## 5. Belangrijke klantbeslissingen

- Kandidaat blijft altijd kandidaat; medewerker is status/relatie, geen tweede persoonrecord.
- Payroller hoort op plaatsing, niet op persoon of bedrijf.
- Uitstroomanalyse en datakwaliteit zijn belangrijk voor acceptatie.
- Huisvesting is wekelijks, niet maandelijks.
- Portaaltoegang alleen voor geplaatste kandidaten, maar niet automatisch intrekken na exit.
- Vacatures gebruiken salary ranges/defaults vanuit functies; master-list skills is uitgesteld.
- Nieuwe website-instroom moet door lead-/kwalificatiefunnel voordat deze in de bruikbare kandidatenpool komt.
- Afwijzen betekent niet verwijderen; afgewezen leads moeten vindbaar blijven.
- Notities zijn standaard intern; officiële waarschuwingen horen in een apart proces.
- AI ondersteunt screening/matching, maar menselijke controle blijft nodig.

---

## 6. Technische schuld en risico's

| Issue | Detail |
|-------|--------|
| Legacy `employees` | Tabel bestaat nog; `candidates` is leidend |
| Generated types | `src/integrations/supabase/types.ts` alleen regenereren via Supabase MCP/CLI |
| Edge auth | Veel protected functions hebben `verify_jwt=false` met self-auth in body; bewust vanwege Supabase ES256 beperking |
| AI dossier | UI heeft OCR; server-batch heeft geen OCR voor image-only documenten |
| VPS worker | Nieuwe requests sturen `system_prompt`/schema mee; verifieer dat VPS geldig JSON blijft leveren |
| Integraties | WhatsApp/Exact afhankelijk van echte credentials en SiteJob Connect |
| Carerix | Bedrijven/contacten nog niet via rijke CR-runners; attachment REST fallback ontbreekt |
| Hardcoded waarden | Meta Graph `v25.0`, campaign batch 50, AI dossier cap, batch throttle 1.5s |
| `useModuleEnabled` | Nog niet breed toegepast |
| Lovable legacy | `lovable-tagger` in devDependencies; sommige componenten blijven verbose |

---

## 7. Ontwikkelomgeving

```bash
npm install
npm run dev              # Vite dev server, standaard port 8080
npm run typecheck        # TypeScript app + node configs
npm run build            # Productiebuild
npm run lint             # ESLint
npm run test             # Vitest unit
npm run test:e2e         # Playwright e2e
npm run test:e2e:flows   # Kritieke UI-flows
```

Single test voorbeeld:

```bash
npx vitest run src/test/carerix-mappers.test.ts
```

Belangrijke env vars:

- Frontend: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
- Edge: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- AI: `OLLAMA_BASE_URL`, `OLLAMA_API_KEY`, `ANTHROPIC_API_KEY`
- Integraties: `KVK_API_KEY`, `APIFY_API_TOKEN`, `EXA_API_KEY`, Microsoft OAuth, Voys credentials, `CRON_SECRET`

---

## 8. Documentatiekaart

| Bestand | Doel |
|---------|------|
| [AGENTS.md](AGENTS.md) | Korte pointer voor agenten |
| [CLAUDE.md](CLAUDE.md) | Canonieke codebase-guidance |
| [HANDOVER_SESSION.md](HANDOVER_SESSION.md) | Actuele dirty-worktree en volgende stappen |
| [docs/open-gaps.md](docs/open-gaps.md) | Levende backlog/open clientpunten |
| [docs/open-meeting-task-registry.md](docs/open-meeting-task-registry.md) | Implementatiestatus per meetingpunt |
| [docs/meeting-open-points-2026-05-27.md](docs/meeting-open-points-2026-05-27.md) | Laatste productanalyse |
| [docs/carerix-integratie-audit.md](docs/carerix-integratie-audit.md) | Carerix importstatus en risico's |
| [docs/handover-deep.md](docs/handover-deep.md) | Diepe technische rondleiding |

---

## 9. Recente commits

| Hash | Beschrijving |
|------|--------------|
| `5559b1f` | fix: complete portal translation coverage |
| `4b7097b` | feat: add portal i18n toggle |
| `ee61023` | Merge PR: instroom fast path |
| `a0997a5` | feat: add candidate intake funnel |
| `8960926` | feat: add skill dropdowns to vacancy forms |
| `cd311d8` | Sync unit status with housing occupancy |
| `1c46967` | fix: show AI analysis edge errors |
| `bd89f8f` | Broaden housing resident candidate list |

---

## 10. Directe overdracht

Voor de volgende Claude Code sessie:

1. Start met [HANDOVER_SESSION.md](HANDOVER_SESSION.md).
2. Draai minimaal `npm run typecheck`, de Carerix mapper-test en `deno check` op de drie AI edge functions.
3. Test kandidaatdossier-AI met één Cloud-run en één VPS-run.
4. Valideer superadmin AI backfill met `batch_size=1`.
5. Deploy pas na checks via Supabase MCP.
