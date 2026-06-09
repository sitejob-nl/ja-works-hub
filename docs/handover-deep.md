# JA Werkt — Codebase + Supabase deep-dive handover

**Datum:** 2026-05-07
**Doel:** technische rondleiding voor een ontwikkelaar die het project overneemt. Ergänzt [HANDOVER.md](../HANDOVER.md) (status / scope) en [CLAUDE.md](../CLAUDE.md) (agent-guidance).
**Bron:** live Supabase project `noaupcteygfvlyymqtew` + repo state op `main` (commit `acaa437`).

---

## 1. Wat zit hierin (en wat niet)

| Document | Bedoeld voor | Update-frequentie |
|----------|-------------|-------------------|
| `README.md` | Eerste indruk / dev-commando's | Zelden |
| `CLAUDE.md` | AI-agent-instructies (Claude Code, Codex) — patronen + non-obvious invarianten | Per sprint |
| `HANDOVER.md` | Klant-handover — wat is af, wat niet, beslissingen, prioriteiten | Per sprint of major release |
| `HANDOVER_SESSION.md` | Werk-in-uitvoering tussen agent-sessies (kortlevend) | Per sessie |
| **`docs/handover-deep.md` (dit doc)** | Diepe technische details: schema, edge functions, RLS, cron, deployment | Bij nieuwe ontwikkelaar of major refactor |
| `docs/open-gaps.md` | Levende backlog — open client-meeting items + Fase 2 | Doorlopend |

Dit doc duplicaat **niet** de scope-status uit HANDOVER.md. Het focust op het *hoe en waar* van de implementatie.

---

## 2. Lokale dev-omgeving opzetten

### Vereisten
- Node 20.x of Bun (lockfiles voor beide aanwezig — `bun.lockb` is leidend in CI)
- Toegang tot Supabase project `noaupcteygfvlyymqtew` (vraag Kas)
- `.env` met `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY`

### Eerste run
```bash
npm i              # of: bun install
npm run dev        # http://localhost:8080
```

### Test-suite
```bash
npm run test                    # Vitest, single run
npm run test:watch              # Vitest, watch mode
npm run test:e2e                # Playwright (alle)
npm run test:e2e:flows          # Playwright — full UI flows
npm run test:e2e:api            # Playwright — alleen API
npx vitest run src/test/foo.test.ts   # specifiek file
```

E2E-tests staan in `tests/e2e/` (op `main` momenteel niet aanwezig — `playwright.config.ts` verwijst er nog wel naar; eerste e2e moet de directory weer aanmaken). Vitest unit-tests in `src/test/`. Coverage is bewust beperkt — uitbouw lopend.

### Build-tooling
- **Vite 5 + SWC** (snelle TS-compile, geen Babel)
- **PWA** via `vite-plugin-pwa` — autoUpdate, 5MB cache cap, installable manifest
- **Tailwind 3** — bewust niet 4, vanwege shadcn/ui breakage
- **lovable-tagger** in devDependencies (legacy van Lovable, dev-only, harmless)
- **Path alias `@/*`** → `./src/*` in zowel `tsconfig.json` als `vite.config.ts`

### TypeScript
Bewust **relaxed** (`noImplicitAny: false`, `strictNullChecks: false`, `no-unused-vars: off`). Niet aanscherpen zonder expliciet verzoek — er zit ~6400 regels auto-generated `types.ts` achter en veel Supabase JOIN-resultaten zijn losse `any`.

---

## 3. Frontend-architectuur

### 3.1 Vier auth-zones — vier providers

| Zone | Pad | Provider | Layout | Hook | Doelgroep |
|------|-----|----------|--------|------|-----------|
| Main app | `/` (default) | `AuthProvider` | `AppLayout` | `useAuth()` | Intercedenten, backoffice, finance, admin |
| Medewerkerportaal | `/portaal/*` | `PortalProvider` | `PortalLayout` | `usePortal()` | Geplaatste medewerkers (kandidaten met `portal_enabled = true`) |
| Klantportaal | `/klantportaal/*` | `ClientPortalProvider` | `ClientPortalLayout` | (`useClientPortal()`) | Opdrachtgever-contacten — eigen plaatsingen + uren goedkeuren |
| Superadmin | `/superadmin/*` | `SuperAdminProvider` | `SuperAdminLayout` | `useSuperAdmin()` | Cross-tenant systeembeheer |

**Eén route-tabel** voor het hele systeem in [src/App.tsx](../src/App.tsx). Provider + layout worden per prefix gewrapped. **Public token-routes** (`/onboarding/:token`, `/contract/sign/:token`, `/profiel/:token`, `/match/reageer/:token`, `/portaal/activeren/:token`, `/klantportaal/activeren/:token`, `/registreren`, `/installeren`) hebben **geen** provider — auth via tokens, gevalideerd in edge functions met service-role.

### 3.2 Routing-conventies

- **Dutch slugs**: `/kandidaten`, `/opdrachtgevers`, `/medewerkers`, `/vacatures`, `/plaatsingen`, `/uren`, `/huisvesting`, `/transport`, `/facturatie`, `/instellingen`, `/kennisbank`. Engelse termen alleen waar het origineel domein Engelse is (`talentpools`).
- **Detail-routes via SlideOver, niet via separate pagina** in de meeste gevallen — `/kandidaten/:id` is een full page (`CandidateDetail.tsx`) met 10 tabs, maar de listing opent ook een lichte SlideOver voor quick edit.
- **Edit/New-flows als separate pagina's** (`*Edit.tsx`, `*New.tsx`) — vooral bij multi-stap forms.

### 3.3 Folder-conventies

| Folder | Wat |
|--------|-----|
| `src/contexts/` | 5 providers (4 auth + `RecentItemsContext`) — één per auth-zone |
| `src/hooks/` | Domain-specifieke hooks (zie kritieke set hieronder) |
| `src/lib/` | Pure utility-modules (audit, branding, format, payroller, distance, sanitize-html, …) |
| `src/components/{entity}/` | Entity-cluster: SlideOver + tabs (CandidateSlideOver + 10 tabs, EmployeeDetail met 13 tabs, etc.) |
| `src/components/placement/` | **Plaatsings-flow** — HousingSuggestions, PlacementConfirmation, PlacementTriggers |
| `src/components/placements/` | **Plaatsings-config** — allowance/hour/travel-type. Verschillend van bovenstaande! |
| `src/integrations/supabase/` | Auto-generated types + client |
| `src/pages/superadmin/` | Cross-tenant beheer-pagina's |

### 3.4 Kritieke hooks

| Hook | Gedrag dat verrast |
|------|--------------------|
| `useOrganizationId()` | **Throws** als er geen org-id is. Gebruik alleen binnen AuthProvider-wrapped routes — niet in portal of superadmin contexts. |
| `useModuleEnabled(key)` | Feature-flag: org override → plan modules → default true. Momenteel pas in 3 files gebruikt. |
| `useComplianceCheck()` | Combineert dynamische rules uit `compliance_rules` met hardcoded fallback (ID, contract, reglement, BSN, IBAN, DOB). |
| `useDecryptedCandidate()` / `useMyDecryptedData()` | Roepen `get_candidate_decrypted` / `get_my_sensitive_data` RPC aan. **Lees nooit direct** uit `candidates.bsn` / `iban` — die kolommen zijn ciphertext. |
| `useCustomFields()` | Per-entity custom field config + values. |

### 3.5 Data-fetching

- **TanStack Query v5** voor alle server state. Query-keys volgen `['table-name', orgId, ...filters]`.
- **Supabase JS** vanuit `src/integrations/supabase/client.ts` — één singleton, gebruikt door zowel main app als portals.
- **Realtime** alleen waar nodig: `useWhatsAppRealtime`, `CandidateAiTab` (analyse-status). Niet als default — kost connections.

### 3.6 UI-stack

shadcn/ui (Radix-gebaseerd) + Tailwind, uitgebreid met:
- **Sonner** voor toasts (`toast.success(...)` / `toast.error(...)`)
- **Recharts** voor dashboards
- **PapaParse** voor CSV import, **xlsx** voor Excel export
- **next-themes** voor dark/light, default light
- **per-org branding** via [src/lib/branding.ts](../src/lib/branding.ts) — `organizations.settings` JSON wordt runtime omgezet naar CSS custom properties op `document.documentElement`

---

## 4. Supabase — schema & data-laag

Project: `noaupcteygfvlyymqtew` (eu-central-1, paid tier). Single project voor alle tenants — multi-tenancy via `organization_id` + RLS.

### 4.1 Cijfers (per 2026-05-07)

| Item | Aantal | Notitie |
|------|--------|---------|
| Tabellen in `public` | 92 | Alle met RLS aan |
| Migrations toegepast | 96 | Eerste: `20260308122239`. Laatste: `20260507130100_fuel_card_imports_backfill` |
| Edge functions | 60 (active) | Alle met `verify_jwt = false` op één na (zie §5) |
| pg_cron jobs | 4 active | Zie §4.6 |
| Extensions geïnstalleerd | 9 | Zie §4.7 |
| Storage buckets | 2 | `documents`, `organization-logos` |

### 4.2 Tabellen — domeingroepen

Volledig schema staat canonical in [src/integrations/supabase/types.ts](../src/integrations/supabase/types.ts) (~6400 regels, regenereer via `mcp__claude_ai_Supabase__generate_typescript_types`). Hieronder de logische clusters:

| Cluster | Tabellen | Rij-volume (peak) |
|---------|----------|-------------------|
| **Kandidaten / HR** | `candidates`, `candidate_employment`, `candidate_profile_tokens`, `candidate_signup_links`, `contracts`, `documents`, `sick_reports`, `payslips`, `annual_statements`, `hour_letters`, `employee_deductions`, `employee_subsidies`, `employee_reservations`, `employee_notifications` | candidates: 1974 / documents: 3343 |
| **Companies** | `companies`, `company_contacts`, `company_functions`, `company_sla`, `rate_agreements` | contacts: 76 |
| **Plaatsing & matching** | `placements`, `placement_allowances`, `placement_hour_types`, `placement_travel_types`, `matches`, `vacancies`, `match_proposal_tokens` | matches: 1572 / vacancies: 659 |
| **Uren & facturatie** | `timesheets`, `invoices`, `invoice_lines`, `invoice_sequences`, `fuel_card_transactions`, `fuel_card_imports`, `mileage_entries` | timesheets: 15 (low-use) |
| **Huisvesting** | `properties`, `property_owners`, `units`, `housing_assignments`, `housing_inspections`, `key_registrations` | units: 51 / properties: 14 |
| **Transport** | `vehicles`, `vehicle_assignments`, `vehicle_damage_reports`, `vehicle_fines` | vehicles: 22 |
| **Communicatie** | `communications`, `communication_preferences`, `bulk_campaigns`, `campaign_recipients`, `whatsapp_config`, `whatsapp_templates` | external_mappings: 12k+ (Carerix sync history) |
| **Onboarding** | `onboarding_forms`, `onboarding_form_steps`, `onboarding_form_fields`, `onboarding_form_regulations`, `onboarding_responses`, `onboarding_tokens` | empty — wizard nog niet in productie-gebruik |
| **Compliance & config** | `compliance_rules`, `regulations`, `regulation_acknowledgements`, `contract_templates`, `termination_reasons` (54 rows seeded), `knowledge_base` | termination: 54 |
| **Org & users** | `organizations` (3), `profiles` (6), `superadmins` (1), `subscription_plans` (3), `organization_modules` (60), `portal_invites`, `client_portal_invites` | low |
| **Externe sync** | `exact_config`, `microsoft_config`, `carerix_config`, `carerix_import_jobs`, `carerix_import_entity_runs`, `carerix_import_failures`, `external_mappings`, `job_listings`, `job_import_logs`, `people_search_results`, `job_feed_configs` | failures: 5510, mappings: 12098 |
| **AI / credits** | `ai_usage_log`, `organization_credits`, `credit_topups` | low |
| **Logging / system** | `audit_log` (37), `client_errors` (31), `rate_limit_tracking`, `recruiter_tasks`, `notes` (4467), `talentpools` (2), `talentpool_members` (6), `custom_fields`, `custom_field_values`, `email_templates`, `exact_glaccount_mappings` | notes: 4467 |

**Legacy / aandachtspunten:**
- `employees` (8 rows) bestaat nog maar is **niet meer leidend** — alle nieuwe code schrijft naar `candidates`. Trigger `sync_candidate_id_from_employee` houdt eventuele legacy-writes consistent.
- `external_mappings` bevat 12k+ rows — vooral Carerix CR* → JA Werkt UUID mappings. Wordt door `carerix-sync-worker` aangemaakt.

### 4.3 Niet-evidente kolom-invarianten

Veel hiervan staat ook in CLAUDE.md, hier de complete lijst:

- **`candidates.bsn` / `candidates.iban`** — ciphertext via Supabase Vault. Nooit direct selecten; gebruik `get_candidate_decrypted(p_candidate_id)` of `get_my_sensitive_data()` RPC.
- **`candidates.cv_pseudonymized_at`, `cv_pseudonymization_meta` (jsonb), `cv_has_photo`** — markers voor AVG-pipeline. AI-velden: `ai_status`, `ai_reliability_score`, `ai_classification`, `ai_function_group`, `ai_target_functions[]`, `ai_positive_signals[]`, `ai_red_flags[]`, `ai_risk_factors[]`, `ai_interview_questions[]`.
- **`vacancies.urgency`** is `NOT NULL CHECK 1-3`. **`function_id`** is optionele FK → `company_functions`. **`start_date_text`** holds free-text ("Direct"/"ZSM") naast typed `start_date`.
- **`properties.name` is nullable** — adres-gedreven UI, naam is alleen bijnaam. **`owner_id`** FK → `property_owners`.
- **`property_owners`** — master-data, `UNIQUE (organization_id, lower(name))`.
- **`units.monthly_cost` en `deposit_amount` zijn DROPPED** — borg leeft op org-level setting; alleen `weekly_cost` per kamer.
- **`talentpools.is_dynamic`** + `filter_criteria` jsonb + `refresh_frequency` (manual/daily/weekly) + `last_refresh_meta` (`{added, removed, total, matched}`). **`talentpool_members.added_by_filter`**: `true` = automatisch (verwijderbaar bij refresh-mismatch), `false` = handmatig (sticky).
- **`whatsapp_config.access_token`, `webhook_secret`** — ciphertext. Gebruik `get_whatsapp_token(p_org_id)` RPC.
- **`exact_config.webhook_secret`** + tokens — ciphertext. `get_exact_token(p_org_id)` RPC.
- **`microsoft_config`** is per-org **én per-user** (twee key-paden). `get_microsoft_token` heeft twee overloads.
- **`carerix_config`** — token via `get_carerix_token(p_org_id)`. Gehard door migration `20260422064134_pre_handover_security_hardening.sql`.

### 4.4 RPC-functies (callable via PostgREST)

Naast standaard pg_trgm-extension funcs zijn er **~30 custom RPCs**:

**Auth / context (security definer):**
- `get_user_org_id()` — current user's org
- `get_user_role()` — `user_role` enum
- `get_employee_id()` — current user's employee/candidate id
- `is_employee_user()` / `is_internal_user()` / `is_superadmin()`

**Encrypted-data getters (security definer, vault-decrypt):**
- `get_candidate_decrypted(p_candidate_id)`
- `get_my_sensitive_data()` — current user's eigen BSN/IBAN
- `get_whatsapp_token(p_org_id)`, `get_exact_token(p_org_id)`, `get_carerix_token(p_org_id)`, `get_microsoft_token(p_org_id, p_user_id?)`

**Vault-helpers (gebruikt door triggers):**
- `encrypt_sensitive(plaintext)` / `decrypt_sensitive(ciphertext)`
- Trigger-gebonden encrypters: `encrypt_candidate_sensitive`, `encrypt_carerix_secret`, `encrypt_exact_sensitive`, `encrypt_whatsapp_sensitive`

**Business-logica:**
- `get_campaign_candidates(p_org_id, p_filter, p_channel)` — filter-gedreven kandidaten voor campagnes
- `check_rate_limit(p_org_id, p_channel, p_window_type)` / `record_rate_limit(...)`
- `next_invoice_number(org_id)` — sequentieel via `invoice_sequences`
- `get_termination_analytics(p_org_id, p_from, p_to)` — fishbone exit-cijfers
- `consume_ai_credits(p_org_id, p_amount_cents)` / `topup_ai_credits(...)` / `peek_credit_balance(p_org_id)`

**Superadmin-only:**
- `sa_get_organizations()`, `sa_get_profiles()`, `sa_get_audit_log(p_limit, p_offset)`, `sa_get_org_stats(org_uuid)`
- `sa_update_org_active(org_uuid, active)`, `sa_update_org_plan(org_uuid, new_plan_id)`

> **Security advisor (mei 2026)**: alle `sa_*`, `is_*`, `get_*`-helpers staan als WARN gemarkeerd ("Signed-In Users Can Execute SECURITY DEFINER Function"). Bewust gekozen — de `is_superadmin()` / org-id checks zitten in de functies zelf, niet via grants. Niet weghalen zonder eerst te begrijpen waarom de check daar staat. Migrations `20260506222423` + `20260506222832` hebben grants al strakker gezet voor de meeste; de overgebleven warnings zijn intentional. Zie [Supabase docs lint=0029](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

### 4.5 Triggers (encryption + invariants)

| Trigger | Tabel | Doel |
|---------|-------|------|
| `encrypt_candidate_sensitive` BEFORE INSERT/UPDATE | `candidates` | BSN + IBAN → vault ciphertext |
| `encrypt_whatsapp_sensitive` BEFORE INSERT/UPDATE | `whatsapp_config` | access_token + webhook_secret |
| `encrypt_exact_sensitive` BEFORE INSERT/UPDATE | `exact_config` | webhook_secret + tokens |
| `encrypt_carerix_secret` BEFORE INSERT/UPDATE | `carerix_config` | secret + token |
| `check_unit_capacity` BEFORE INSERT | `housing_assignments` | Blokkeert overbooking — kamer mag niet meer assignments hebben dan `units.capacity` |
| `check_drivers_license` BEFORE INSERT/UPDATE | `vehicle_assignments` | Verplicht geldig rijbewijs in `documents` |
| `enforce_profile_immutable_fields` BEFORE UPDATE | `profiles` | `organization_id` en `user_id` zijn immutable post-create |
| `sync_candidate_id_from_employee` BEFORE INSERT | `candidate_employment` | Houdt `candidate_id` consistent ook bij legacy-employee writes |
| `set_updated_at` / `handle_updated_at` BEFORE UPDATE | overal | Mutates `updated_at` automatisch (niet alle tabellen — zie migration `20260310161508_fix_missing_updated_at_triggers`) |
| `create_org_credits_row` AFTER INSERT | `organizations` | Auto-aanmaak `organization_credits` met €50 starter |

### 4.6 pg_cron — geplande jobs

```
jobid | schedule       | jobname                            | target edge function
------+----------------+------------------------------------+------------------------
1     | 0 9 * * *      | automated-onboarding-reminders     | automated-messages
2     | 0 6 * * *      | automated-document-expiry          | check-document-expiry
3     | 30 2 * * *     | housing-reminder-daily             | housing-reminder-cron
4     | 45 2 * * *     | check-vehicle-apk-daily            | check-vehicle-apk
```

Authenticatie via `current_setting('app.cron_secret')` → wordt gestuurd als `x-cron-secret`/`X-Cron-Secret` header. Edge functions valideren die match; cron jobs mogen geen hardcoded gedeelde sleutels bevatten.

**Niet-actief** (opt-in voorzien maar niet aangezet):
- Talentpool-refresh cron — definitie zit in migration `20260425170000_d3_dynamic_talentpools_cron.sql` (alleen lokaal aangewezen). Activeer pas als de UI-zijde stabiel is.

### 4.7 Extensions (geïnstalleerd)

| Extension | Schema | Gebruik |
|-----------|--------|---------|
| `pg_cron` | `pg_catalog` | §4.6 |
| `pg_net` | `extensions` | HTTP requests vanuit cron jobs naar edge functions |
| `pgcrypto` | `extensions` | Hash + random-functies |
| `supabase_vault` | `vault` | Sensitieve data encryption |
| `pg_stat_statements` | `extensions` | Query-performance stats |
| `pg_trgm` | **`public`** ⚠️ | Trigram-similarity (CV full-text + naam-zoek). **Advisor warning**: zou `extensions` moeten zijn — niet verplaatsen zonder index-rebuilds. |
| `uuid-ossp` | `extensions` | UUID-generatie |
| `plpgsql` / `pg_graphql` | system | default |

### 4.8 Storage buckets

| Bucket | Access | Inhoud |
|--------|--------|--------|
| `documents` | Authenticated, RLS-gated per org | CV's, ID's, contracten, inspectie-foto's, schade-foto's |
| `organization-logos` | Public read, write via RLS | Org-logo's voor witlabel |

Beide buckets hebben tenant-isolatie policies (zie migration `20260310161501_fix_storage_upload_policies` + `20260309012716_fix_logo_bucket_tenant_isolation`).

### 4.9 Auth

- **Roles** (enum `user_role`): `admin`, `intercedent`, `backoffice`, `finance`, `medewerker`. `medewerker` redirect altijd naar `/portaal/`.
- **Superadmin** is geen role maar een aparte `superadmins`-tabel (1 rij). `is_superadmin()` checkt op user-id match.
- **Leaked-password protection**: **uit** (advisor warning). Niet aangezet vanwege migrant-arbeiders gebruikersbasis met soms zwakke wachtwoorden bij eerste activatie. Heroverwegen als volwassenheid toeneemt.

---

## 5. Edge functions

Locatie: `supabase/functions/`. 60 deployed functions.

### 5.1 Auth-pattern

**Alle protected functions hebben `verify_jwt = false`** in `config.toml`, met **self-auth in de body**:

```typescript
const authHeader = req.headers.get("Authorization");
const token = authHeader?.replace("Bearer ", "");
const { data: { user } } = await supabaseClient.auth.getUser(token);
if (!user) return new Response("Unauthorized", { status: 401 });
```

**Reden**: Supabase Edge Runtime kan ES256 signing keys niet valideren. Dit is gedocumenteerd in `supabase/config.toml`. Niet "fixen" — dat breekt alles.

**Uitzondering**: `analyze-cv` heeft `verify_jwt = true` en gebruikt anonieme JWT-validatie omdat het synchroon vanuit de UI wordt aangeroepen.

**Public functions** (geen JWT nodig, eigen secret-validatie): webhooks, OAuth callbacks, token-based public flows. Ze worden in §5.2 gemarkeerd.

**Cron functions**: valideren `x-cron-secret` header tegen env-var `CRON_SECRET`.

### 5.2 Functies per cluster

**Public / anon (eigen validatie):**
- `onboarding-submit`, `contract-sign`, `candidate-profile`, `portal-activate`, `client-portal-activate`, `register-organization`
- `whatsapp-webhook` (Meta signature validation), `exact-webhook`
- `*-config` (callbacks vanuit SiteJob Connect): `whatsapp-config`, `exact-config`, `carerix-config`
- `microsoft-callback` (OAuth code exchange)

**Communication & messaging:**
- `whatsapp-register`, `whatsapp-send`, `whatsapp-api`, `whatsapp-templates-sync`
- `send-placement-confirmation`, `send-match-proposal` (dual-mode: `preview=true` returnt rendered HTML), `send-damage-report`, `send-portal-invite`, `send-timesheet-approval`, `send-ai-analysis`
- `automated-messages` (cron-triggered, multiple jobs via `?job=` querystring)
- `bulk-campaign-processor` (50/batch, rate-limited), `email-campaign-processor`, `opt-out-handler`, `generate-notifications`
- `microsoft-api`, `microsoft-auth`

**Integraties — financieel / ATS:**
- `exact-register`, `exact-api`, `exact-sync-invoice`, `exact-sync-account`
- `carerix-test`, `carerix-introspect`, `carerix-sync-start`, `carerix-sync-worker`, `carerix-sync-cancel`, `carerix-attachment-download`
- `generate-invoice-pdf`

**Sourcing / job data:**
- `apify-job-import`, `job-feed-runner`, `linkedin-job-search`, `exa-people-search`

**AI:**
- `analyze-cv` (synchroon entry-point, kiest VPS / Cloud)
- `analyze-cv-callback` (async result-handler vanuit VPS)
- `analyze-cv-batch` (superadmin backfill, throttle 1.5s/CV, max 25/batch)
- `cv-rewrite` (LLM-based CV verbetering)
- `calculate-match` (kandidaat ↔ vacature score)
- `validate-timesheets` (6 regels)
- `recruiter-priorities` (taken-prioritering)
- `refresh-talentpool-members` (single-mode user-JWT of cron-mode `x-cron-secret`)

**Telefonie:**
- `voys-api`, `voys-sync-calls`

**Operationeel / cron:**
- `check-document-expiry` (cron 06:00)
- `housing-reminder-cron` (cron 02:30)
- `check-vehicle-apk` (cron 02:45)
- `process-sick-report`

**No-config (default JWT required):**
- `kvk-lookup`, `rdw-lookup`

**Data-export:**
- `data-export` — recente toevoeging, full-data export per org

### 5.3 Gedeelde modules (`_shared/`)

Importeerbaar als `../_shared/{module}.ts` vanuit elke functie:

| File | Inhoud |
|------|--------|
| `auth.ts` | `getUserFromAuthHeader()`, JWT-validatie helper |
| `cv-pseudonymize.ts` | AVG-pipeline: naam/email/tel/BSN/IBAN strippers + counts |
| `cv-prompt.ts` | LLM-prompt templates voor CV-analyse |
| `cv-write.ts` | Update candidate met AI-output |
| `anthropic-cv.ts` | Cloud-pad (Claude Haiku 4.5) — credit-aftrek + tool-schema |
| `sanitize-org-prompt.ts` | Strip prompt-injection uit org-custom prompts |
| `exact-helpers.ts` | OData-query builder + token-refresh |
| `outlook-send.ts` | Microsoft Graph mail-send |
| `whatsapp-utils.ts` | Meta Graph API v25.0 wrappers |
| `voys-helpers.ts` | Voys auth + endpoints |
| `map-job-to-row.ts` | Apify scrape → `job_listings` row |
| `sick-report-handler.ts` | Sick-report logica gedeeld door portal en intercedent UI |
| `carerix/*` | Carerix-specific helpers (entity mapping, attachment download) |

### 5.4 Deployment-workflow

**Voorkeur**: `mcp__claude_ai_Supabase__deploy_edge_function` — geen CLI-installatie nodig, file-tree direct uit lokale `supabase/functions/<name>/`.

CLI-fallback: `npx supabase functions deploy <name>`.

`config.toml` houdt verify_jwt-flags bij. Wijzig in beide files (lokaal + dashboard) bij scope-aanpassing.

---

## 6. Externe integraties — quick reference

| Integratie | Status | Kritiek bestand | Externe deps |
|------------|--------|-----------------|--------------|
| **WhatsApp Business** | Code compleet, niet live getest | `_shared/whatsapp-utils.ts` + 6 functies | Meta Graph v25.0 + SiteJob Connect tenant-registratie |
| **Exact Online** | Code compleet, draait via SiteJob Connect | `_shared/exact-helpers.ts` + 5 functies | OData v4 |
| **Carerix** | Live (CR* schema sync) — geen documents/employment/vacancies endpoints | `_shared/carerix/*` + 6 functies | Carerix API v1 met `cr.read` scope |
| **Microsoft 365 (Outlook)** | Live (mail + calendar proxy) | `_shared/outlook-send.ts` + 3 functies | Graph API |
| **Voys** | Live (call logs) | `_shared/voys-helpers.ts` + 2 functies | Voys PBX API |
| **KVK** | Live (v2) | `kvk-lookup` | `KVK_API_KEY` env |
| **RDW** | Live (geen auth) | `rdw-lookup` | RDW open data |
| **Apify** | Live (job scraping) | `apify-job-import` | `APIFY_API_TOKEN` env |
| **Exa AI** | Live (people search) | `exa-people-search` | `EXA_API_KEY` env |
| **Hetzner VPS LLM** | Default voor CV-analyse | `analyze-cv` (VPS-pad) | `OLLAMA_BASE_URL` + `OLLAMA_API_KEY` |
| **Anthropic Cloud** | Optionele Cloud-CV-analyse | `_shared/anthropic-cv.ts` | `ANTHROPIC_API_KEY` |
| **Flexpedia** | **Geen API-integratie** — alleen referentie in [src/lib/payroller.ts](../src/lib/payroller.ts) | n.v.t. | n.v.t. |
| **Google Calendar** | Niet geïmplementeerd | n.v.t. | `Agenda.tsx` is intern |

Volledige flow-beschrijving per integratie staat in [CLAUDE.md](../CLAUDE.md) §"Integration Status".

---

## 7. Operationele zaken

### 7.1 Environment variables

**Frontend (`.env`):**
```
VITE_SUPABASE_URL=https://noaupcteygfvlyymqtew.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=...   # supabase anon/publishable key
```

**Edge function secrets** (Supabase Dashboard → Settings → Edge Functions → Secrets):
- `OLLAMA_BASE_URL` + `OLLAMA_API_KEY` (Hetzner VPS)
- `ANTHROPIC_API_KEY` (Cloud CV-analyse)
- `KVK_API_KEY`, `APIFY_API_TOKEN`, `EXA_API_KEY`
- `CRON_SECRET` (gevalideerd in housing-reminder-cron + check-vehicle-apk + refresh-talentpool-members cron-mode)
- `MICROSOFT_CLIENT_ID` + `MICROSOFT_CLIENT_SECRET` (Graph OAuth)
- `VOYS_USERNAME` + `VOYS_API_KEY`
- `RESEND_API_KEY` (transactional email — alle `send-*` functies)
- `SITEJOB_CONNECT_*` (WhatsApp + Exact tenant-registratie URLs)

**DB-settings:**
- `app.cron_secret` (postgres setting) — gelezen door `current_setting('app.cron_secret')` in cron commands

### 7.2 Deployment

**Frontend → Vercel** via `vercel.json`. Auto-deploy op push naar `main`. Preview-URLs voor PR-branches.

**Edge functions** worden **niet via Vercel** gedeployed. Apart via Supabase MCP / CLI. CI/CD-koppeling is er nog niet — handmatig na schema-wijzigingen.

**Migrations** worden via Supabase MCP toegepast op productie. Spiegel-migration-bestand in `supabase/migrations/` voor lokale dev/CI consistency. Patroon: `mcp_apply_migration` → `generate_typescript_types` → schrijf naar `src/integrations/supabase/types.ts` → commit migration-file lokaal.

**Types regenereren**:
```bash
npx supabase gen types typescript --project-id noaupcteygfvlyymqtew \
  > src/integrations/supabase/types.ts
```
Of via MCP: `mcp__claude_ai_Supabase__generate_typescript_types` (output JSON-wrapped, extract met `python3 -c "import json,sys; print(json.load(sys.stdin)['types'])"` naar het types-bestand).

### 7.3 Monitoring

- **Supabase Dashboard** → Logs (Postgres / Edge / Auth / Realtime). Filter op function-slug of timeframe.
- **Client errors** worden naar `client_errors` tabel gestuurd via een silent-catch in [src/lib/audit.ts](../src/lib/audit.ts) of een dedicated error-boundary (zoek `client_errors` voor de schrijfpaden).
- **Audit-log** — `audit_log` tabel + `logAudit()` helper. Silent-fails by design — nooit throwt, dus geen wrappers nodig in callers.
- Geen Sentry / Datadog op dit moment. Logging-export is open punt.

### 7.4 Backups

Supabase daily backups (paid tier, 7 dagen retentie). Geen aparte point-in-time-recovery setup. Bij major schema-changes: handmatig snapshot via dashboard.

---

## 8. Bekende issues / aandachtspunten

| Issue | Detail | Bron |
|-------|--------|------|
| **WhatsApp niet live getest** | Volledige codepath aanwezig, alleen geen real-Meta credentials gevalideerd | CLAUDE.md |
| **Edge-function ES256 limitatie** | Alle protected functions zijn `verify_jwt = false` met self-auth — niet "fixen" | `supabase/config.toml` |
| **`pg_trgm` in public schema** | Advisor warning. Verplaatsen vereist index-rebuild — risk vs reward laag | §4.7 |
| **Leaked-password protection uit** | Bewust voor labor-migrant gebruikersbasis; heroverwegen | §4.9 |
| **`employees` tabel legacy** | Niet meer leidend, blijft voor backwards-compat | §4.2 |
| **CV-analyse alleen text-PDF** | Geen OCR — image-only PDFs falen stil. Photo-detection via `/Subtype /Image` byte-scan | CLAUDE.md "AI / LLM" |
| **Hardcoded constants** | SiteJob Connect URLs, Meta Graph `v25.0`, CV cap 15k chars, batch 50 voor campaigns, AI throttle 1.5s/CV | CLAUDE.md |
| **`useModuleEnabled` underused** | Slechts 3 files gebruiken de hook — feature-flagging is nog niet gebruikelijk | §3.4 |
| **Tests beperkt** | Vitest infra OK, e2e-folder leeg op `main`. Uitbouw lopend | §2 |
| **`tests/e2e/` ontbreekt** | `playwright.config.ts` verwijst er nog naar — eerste e2e moet de directory weer aanmaken | §2 |

---

## 9. Eerst-doen checklist voor een nieuwe ontwikkelaar

1. Vraag Kas (`kas@sitejob.nl`) toegang tot:
   - Supabase project `noaupcteygfvlyymqtew`
   - GitHub repo `sitejob-nl/ja-works-hub`
   - Vercel project (frontend deploys)
   - Hetzner VPS (LLM) — alleen als je AI-pijplijn moet wijzigen
2. Lees in deze volgorde:
   - [README.md](../README.md) (5 min)
   - [CLAUDE.md](../CLAUDE.md) (~30 min — heel uitgebreid)
   - Dit document (~20 min)
   - [HANDOVER.md](../HANDOVER.md) §3-§5 (~10 min — wat is af / wat niet / klantbeslissingen)
   - [docs/open-gaps.md](open-gaps.md) (5 min — backlog)
3. Run lokaal:
   - `npm i && npm run dev` → ga naar `http://localhost:8080`
   - `npm run test` → verifieer dat unit-tests groen zijn
4. Verken vier auth-zones door in te loggen als:
   - admin → main app
   - medewerker → portal
   - opdrachtgever-contact → klantportaal
   - superadmin → `/superadmin/`
5. Doe één klein PR (typo of lint-fix) om de deploy-pipeline te testen.
6. Pas dan grotere features.

---

## 10. Contactpunten

| Wie | Voor wat | Hoe |
|-----|----------|-----|
| Kas (SiteJob) | Code, Supabase, infra, alle technische vragen | `kas@sitejob.nl` |
| Jeroen Adriaans (klant) | Functionele beslissingen, scope, prioriteiten | via SiteJob — niet direct |
| Jens / Thomas (SiteJob team) | Code-reviews, architecture-sparring | intern |
| Nobisoft (externe dev) | Niet primair betrokken bij JA Werkt — wel partner-projecten | via SiteJob |

Voor diepe Carerix-specific vragen: zie [docs/carerix-api-research.md](carerix-api-research.md) en [docs/carerix-credentials-setup.md](carerix-credentials-setup.md).

Voor acceptance-test-scope: [docs/ja-werkt-acceptatie-audit.md](ja-werkt-acceptatie-audit.md).

---

*Dit document is een snapshot per 2026-05-07. Schema-cijfers (rij-aantallen, migration-versies) verouderen snel — verifieer via `mcp__claude_ai_Supabase__list_tables` / `list_migrations` voor je acteert.*
