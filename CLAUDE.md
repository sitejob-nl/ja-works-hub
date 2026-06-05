# CLAUDE.md

This file provides guidance to Claude Code when working with the JA Werkt codebase.

> **Resuming active work:** read [HANDOVER_SESSION.md](HANDOVER_SESSION.md) first. This file is the stable codebase guide; the handover contains the current branch, dirty worktree and next actions.

## Project Overview

**JA Werkt** is a multi-tenant staffing agency (uitzendbureau) SaaS platform built for JA Werkt, a temp agency specializing in labor migrants (arbeidsmigranten) in Brabant/Limburg, Netherlands. The platform consolidates multiple legacy systems (Carerix, Joboti, Umanga, OnTrack, Q8, Buddy) into a single system, while keeping Flexpedia as external payroll engine (loonmotor).

**Key workflows:**
1. **Candidate → Employee → Placement**: Create candidate → upload docs → hire (in dienst) → onboarding checklist → compliance check → vacancy matching (AI score) → pipeline (voorgesteld → in_gesprek → geaccepteerd) → place with ComplianceWarningDialog → planning
2. **Housing**: Property → rooms (units) → assign resident (3-step wizard) → check-in → costs → keys → check-out. DB trigger blocks overbooking.
3. **Timesheets**: Enter hours (manual or CSV) → AI validation (edge function, 6 rules) → approval (individual or bulk) → rejected: reopen to concept
4. **Self-service onboarding**: Intercedent generates link → worker opens `/onboarding/{token}` (public) → fill form + accept docs → token-based auth (7 days, single use)

**Status:** Originally built in Lovable; now actively developed in Claude Code/Codex + VS Code.

> **Naast dit document:** zie [docs/handover-deep.md](docs/handover-deep.md) voor een diepe technische rondleiding (live Supabase-schema, RPCs, triggers, cron, edge function clusters, env vars, deployment). Bedoeld voor nieuwe ontwikkelaars en als referentie bij infra-werk.

## Commands

```bash
npm run dev              # Dev server on port 8080
npm run build            # Production build
npm run build:dev        # Development build
npm run typecheck        # TypeScript app + node configs
npm run lint             # ESLint
npm run test             # Vitest unit (single run)
npm run test:watch       # Vitest unit (watch)
npm run test:e2e         # Playwright e2e (all)
npm run test:e2e:api     # Playwright e2e against API
npm run test:e2e:flows   # Playwright e2e — full UI flows
npx vitest run src/test/example.test.ts  # Run single test file
```

Edge functions are Deno/TypeScript and live in `supabase/functions/` (configured in `supabase/config.toml`). Deploy via:
- **Supabase MCP** (preferred for this project): `mcp__claude_ai_Supabase__deploy_edge_function` — see "Supabase MCP workflow" below
- **Supabase CLI** (alternatief): `npx supabase functions deploy <name>`

## Tech Stack

- **Frontend**: React 18 + TypeScript, Vite 5 (SWC), React Router v6, TanStack Query v5, React Hook Form + Zod
- **UI**: shadcn/ui (Radix) + Tailwind CSS 3, dark/light mode (next-themes), Sonner toasts, Recharts, Lucide icons
- **Backend**: Supabase (PostgreSQL + Auth + Edge Functions + Realtime + Storage)
- **PWA**: vite-plugin-pwa, standalone mode, auto-update, 5MB cache limit
- **CSV/Excel/Documents**: PapaParse (CSV), xlsx (Excel export), pdfjs-dist + Tesseract.js in UI; unpdf + fflate in edge functions
- **Testing**: Vitest + Testing Library + jsdom (unit), Playwright (e2e via `tests/e2e/`)
- **Build tooling**: lovable-tagger (dev only), autoprefixer, postcss

### TypeScript Config

Relaxed settings — do NOT tighten without explicit request:
- `noImplicitAny: false`
- `strictNullChecks: false`
- `no-unused-vars: off`

Path alias: `@/*` → `./src/*`

## Architecture

### Four Authentication Zones

| Zone | Path | Context | Layout | Hook |
|------|------|---------|--------|------|
| Main App | `/` | `AuthContext` | `AppLayout` | `useAuth()` → `{ session, user, profile, loading, signOut }` |
| Employee Portal | `/portaal/` | `PortalContext` | `PortalLayout` | `usePortal()` → `{ session, profile, employee, candidate, loading, signOut }` |
| Client Portal (opdrachtgever) | `/klantportaal/` | `ClientPortalContext` | `ClientPortalLayout` | Client contact access to own placements + timesheets |
| Superadmin | `/superadmin/` | `SuperAdminContext` | `SuperAdminLayout` | `useSuperAdmin()` → `{ session, user, isSuperAdmin, loading, signOut }` |

- Profile includes `organization_id` and `role`
- Employee portal's `employee` and `candidate` both point to the same `candidates` row
- Client portal is for opdrachtgever contacts — see their own placements and approve timesheets
- SuperAdmin checks the `superadmins` table (no role field)
- Public routes use token-based auth (no login required)

### Directory Structure

Standard React layout under `src/` — `components/`, `pages/`, `hooks/`, `lib/`, `contexts/`, `integrations/`, `test/`. `ls src/` to explore. Notes on the parts where behavior isn't obvious from the path:

- **`src/App.tsx`** — single source of truth for the route table.
- **`src/integrations/supabase/types.ts`** — auto-generated (~6400 lines), never hand-edit. Regenerate via Supabase MCP.
- **`src/contexts/`** — one provider per auth zone (`AuthContext`, `PortalContext`, `ClientPortalContext`, `SuperAdminContext`) plus `RecentItemsContext`.
- **`src/hooks/`**:
  - `useOrganizationId.ts` — **throws** if no org ID; never call outside AuthProvider-wrapped routes.
  - `useModuleEnabled.ts` — feature flag: org override → plan modules → default true.
  - `useComplianceCheck.ts` — dynamic rules from `compliance_rules` + hardcoded fallback.
  - `useDecryptedCandidate.ts` / `useMyDecryptedData.ts` — calls decrypt RPCs, never reads encrypted columns.
- **`src/lib/`**:
  - `audit.ts` — `logAudit()` silent-fails (never throws), so callers don't need to wrap.
  - `branding.ts` — applies per-org CSS custom properties at runtime from `organizations.settings`.
  - `format.ts` — nl-NL locale date/currency formatting.
  - `payroller.ts` — flexpedia / brioworks / bromida / retiva (only the last three get invoiced).
  - `termination-constants.ts` — exit-reason enums.
- **`src/components/{candidates,companies,employees,housing,transport,vacancies}/`** — entity SlideOver + tabs pattern (CandidateSlideOver + 10 tabs, EmployeeDetail with 13 tabs, etc.).
- **`src/components/placement/`** — `HousingSuggestions`, `PlacementConfirmation`, `PlacementTriggers` (the placement *flow*); separate from `src/components/placements/` (allowance/hour/travel-type config).
- **`supabase/functions/`** — Deno edge functions; shared helpers include `candidate-dossier.ts` for AI dossier assembly. `supabase/migrations/` is the schema history.
- **`tests/e2e/`** — Playwright; `src/test/` — Vitest.

### Routes

Routes live in [src/App.tsx](src/App.tsx) — read it for the full list. Patterns:

| Prefix | Provider + Layout | Notes |
|--------|-------------------|-------|
| `/` (everything not below) | `AuthProvider` + `ProtectedRoute` + `AppLayout` | ~40 main-app routes — kandidaten, opdrachtgevers, medewerkers, vacatures, plaatsingen, huisvesting, transport, facturatie, etc. |
| `/portaal/*` | `PortalProvider` + `PortalLayout` | Employee self-service (uren, plaatsingen, documenten, ziekmelding, loonstroken, etc.). `/portaal/login` and `/portaal/activeren/:token` are public. |
| `/klantportaal/*` | `ClientPortalProvider` + `ClientPortalLayout` | Opdrachtgever sees own placements + approves timesheets. `/klantportaal/login` and `/klantportaal/activeren/:token` are public. |
| `/superadmin/*` | `SuperAdminProvider` + `SuperAdminLayout` | System admin — orgs, users, plans, errors, cv-backfill. |

**Public token-based routes** (no provider, no login): `/onboarding/:token`, `/contract/sign/:token`, `/profiel/:token`, `/match/reageer/:token` (alias: `/match-response/:token`), `/registreren`, `/installeren`.

Convention: Dutch URL slugs (`/kandidaten`, `/opdrachtgevers`, `/medewerkers`, `/uren`, `/huisvesting`, etc.) — see [Dutch Terminology](#dutch-terminology) for the mapping.

### Multi-Tenancy

All data scoped by `organization_id`. RLS policies enforce tenant isolation. The `useOrganizationId()` hook provides the current org context. **Warning:** `useOrganizationId()` throws if no org ID exists — never call it outside AuthProvider-wrapped routes (not in portal or superadmin).

### Candidates = Employees (Merged Model)

Candidates and employees share the single `candidates` table. The portal's `employee` field is an alias for the candidates row. The `/medewerkers` pages also operate on the candidates table. The `employees` table still exists but is legacy — `candidates` is the source of truth.

### Sensitive Data Encryption

Database triggers encrypt sensitive fields (BSN, IBAN, webhook secrets, access tokens) on write using Supabase Vault. **Never read encrypted columns directly.** Use:
- `useDecryptedCandidate()` / `useMyDecryptedData()` hooks (call `get_candidate_decrypted` / `get_my_sensitive_data` RPCs)
- `get_whatsapp_token` / `get_exact_token` RPCs in edge functions
- `encrypt_sensitive()` / `decrypt_sensitive()` database functions

### Per-Org Branding

`src/lib/branding.ts` applies white-label branding at runtime via CSS custom properties on `document.documentElement`. Configurable: accent_color, sidebar_bg, sidebar_fg, sidebar_fg_active, background, card, heading, border_radius. Values come from `organizations.settings` JSON column.

### Audit Logging

`logAudit()` from `src/lib/audit.ts` records changes with `{ action, tableName, recordId, oldValues?, newValues?, reason? }`. It silent-fails (never throws). Actions: `create`, `update`, `delete`, `status_change`, `login`, `export`, `override`.

## Database Schema

~92 tables, 3 views. Full schema is canonical in [src/integrations/supabase/types.ts](src/integrations/supabase/types.ts) (auto-generated, ~6400 lines, never hand-edit) and discoverable via `mcp__claude_ai_Supabase__list_tables`. Below: only the **non-obvious** parts you can't infer from a list.

### Domain landscape

- **Candidates & HR**: `candidates` (merged with employees, see Architecture), `candidate_employment`, `candidate_profile_tokens`, `candidate_signup_links`, `contracts`, `documents`, `sick_reports`, `payslips`, `annual_statements`, `hour_letters`, `employee_deductions`, `employee_subsidies`, `employee_reservations`, `employee_notifications`.
- **Companies**: `companies`, `company_contacts`, `company_functions`, `company_sla`, `rate_agreements`.
- **Placements & Matching**: `placements`, `placement_allowances` / `_hour_types` / `_travel_types`, `matches`, `vacancies`, `match_proposal_tokens`.
- **Timesheets & Invoicing**: `timesheets`, `invoices`, `invoice_lines`, `invoice_sequences`, `fuel_card_transactions`, `mileage_entries`.
- **Housing**: `properties`, `property_owners`, `units`, `housing_assignments`, `housing_inspections`, `key_registrations`.
- **Transport**: `vehicles`, `vehicle_assignments`, `vehicle_damage_reports`, `vehicle_fines`.
- **Communication**: `communications`, `communication_preferences`, `bulk_campaigns`, `campaign_recipients`, `whatsapp_config`.
- **Onboarding**: `onboarding_forms` / `_form_steps` / `_form_fields` / `_form_regulations` / `_responses` / `_tokens`.
- **Compliance & Config**: `compliance_rules`, `regulations`, `regulation_acknowledgements`, `contract_templates`, `termination_reasons`, `knowledge_base`.
- **Org & Users**: `organizations`, `profiles`, `superadmins`, `subscription_plans`, `organization_modules`, `portal_invites`.
- **External Integration**: `exact_config`, `external_mappings`, `job_listings`, `job_import_logs`, `people_search_results`.
- **Logging & System**: `audit_log`, `client_errors`, `rate_limit_tracking`, `recruiter_tasks`, `notes`, `talentpools`, `talentpool_members`.

### Encrypted columns (never SELECT directly)

- `candidates.bsn`, `candidates.iban` → use `get_candidate_decrypted` / `get_my_sensitive_data` RPC
- `whatsapp_config.access_token`, `whatsapp_config.webhook_secret` → use `get_whatsapp_token` RPC
- `exact_config.webhook_secret` (and decrypted token fields) → use `get_exact_token` RPC
- Carerix tokens → `get_carerix_token` RPC
- All driven by Vault triggers + `encrypt_sensitive` / `decrypt_sensitive` functions.

### Non-obvious columns & invariants

- **`candidates.cv_pseudonymized_at`, `cv_pseudonymization_meta` (jsonb), `cv_has_photo`** — markers for AVG-pseudonimisering pipeline. `cv_raw_text` stores extracted document/CV text, while the AI prompt now uses a wider candidate dossier assembled server-side. AI-classification fields: `ai_status`, `ai_reliability_score`, `ai_classification`, `ai_function_group`, `ai_target_functions[]`, `ai_positive_signals[]`, `ai_red_flags[]`, `ai_risk_factors[]`, `ai_interview_questions[]`.
- **`vacancies.urgency`** is `NOT NULL CHECK 1-3`. **`function_id`** is optional FK → `company_functions`. **`start_date_text`** holds free-text values like "Direct" / "ZSM" alongside the typed `start_date`.
- **`properties.name` is nullable** (optionele bijnaam — UI is address-driven). **`owner_id`** FK → `property_owners`.
- **`property_owners`** is master-data: 1 row per unique owner per org, `UNIQUE (organization_id, lower(name))`.
- **`units.monthly_cost` and `units.deposit_amount` are DROPPED** — borg lives on an org-level setting now. `units.weekly_cost` is the only cost on a unit.
- **`talentpools.is_dynamic`** + `filter_criteria` (jsonb) + `refresh_frequency` (manual/daily/weekly) + `last_refresh_meta` (`{added, removed, total, matched}`) drive the dynamic-pool engine. **`talentpool_members.added_by_filter`** distinguishes auto-added (`true`, removed on refresh-mismatch) from manual (`false`, sticky).
- **`employees`** table still exists but is legacy — `candidates` is source of truth.

### Views

- `v_active_placements` — current placements with candidate + company joined
- `v_employee_compliance` — compliance status per employee
- `v_unit_occupancy` — housing unit occupancy overview

### Enums

Canonical in [src/integrations/supabase/types.ts](src/integrations/supabase/types.ts) (search for `Enums:`). All Dutch values where the domain is Dutch (e.g. `placement_status: gepland | actief | afgerond | voortijdig_beeindigd`, `timesheet_status: concept | ingediend | groen | oranje | rood | goedgekeurd | afgekeurd`). The 5 user roles — `admin | intercedent | backoffice | finance | medewerker` — are documented under [Auth / Roles](#auth--roles).

## RPC Functions (Database)

| Function | Args | Returns | Purpose |
|----------|------|---------|---------|
| `get_candidate_decrypted` | p_candidate_id | { decrypted_bsn, decrypted_iban }[] | Decrypt sensitive candidate data |
| `get_my_sensitive_data` | (none) | { decrypted_bsn, decrypted_iban }[] | Current user's own sensitive data |
| `get_exact_token` | p_org_id | { tenant_id, base_url, division, region, decrypted_webhook_secret }[] | Decrypt Exact Online credentials |
| `get_whatsapp_token` | p_org_id | { phone_number_id, waba_id, decrypted_access_token, decrypted_webhook_secret }[] | Decrypt WhatsApp credentials |
| `get_user_org_id` | (none) | string | Get current user's organization_id |
| `get_user_role` | (none) | user_role enum | Get current user's role |
| `get_employee_id` | (none) | string | Get current user's employee/candidate ID |
| `is_employee_user` | (none) | boolean | Check if current user is employee role |
| `is_superadmin` | (none) | boolean | Check if current user is superadmin |
| `encrypt_sensitive` | plaintext | string | Encrypt via Supabase Vault |
| `decrypt_sensitive` | ciphertext | string | Decrypt via Supabase Vault |
| `get_campaign_candidates` | p_org_id, p_channel, p_filter | { candidate_id, first_name, last_name, phone }[] | Filter candidates for campaigns |
| `check_rate_limit` | p_org_id, p_channel, p_window_type | boolean | Check campaign rate limits |
| `record_rate_limit` | p_org_id, p_channel | void | Log rate limit usage |
| `next_invoice_number` | org_id | string | Auto-increment invoice number |
| `find_duplicate_candidates` | (none) | duplicate groups | Read-only, tenant-scoped (`auth.uid()`) dedup-scan op e-mail / telefoon(laatste 8) / DOB+naam. **anon REVOKED**. Voedt `/kandidaten/duplicaten`. |
| `merge_candidate_records` | p_survivor, p_loser, p_actor | void | Merge twee kandidaten (repoint gerelateerde rijen, dan delete loser). SECURITY DEFINER; blokkeert cross-org + dubbel payroll/loyalty. **anon REVOKED** (migratie 20260604130000). |
| `sa_get_organizations` | (none) | org list | Superadmin: list all orgs |
| `sa_get_profiles` | (none) | profile list | Superadmin: list all users |
| `sa_get_audit_log` | p_limit, p_offset | audit entries | Superadmin: view audit log |
| `sa_get_org_stats` | org_uuid | { candidates_count, companies_count, etc. } | Superadmin: org statistics |
| `sa_update_org_active` | org_uuid, active | void | Superadmin: activate/deactivate org |
| `sa_update_org_plan` | org_uuid, new_plan_id | void | Superadmin: change subscription |

## Edge Functions (~60 functies)

> **NB**: alle protected functions hebben `verify_jwt = false` in `config.toml` met **self-auth** in de function body (de Supabase Edge Runtime kan ES256 signing keys niet valideren). Dat is bewust en gedocumenteerd in config.toml. **Uitzondering**: `analyze-cv` heeft `verify_jwt = true` (synchroon vanuit UI, anonieme JWT validatie volstaat).

### pg_cron-getriggerde functies

4 actieve cron jobs (zie `cron.job` in productie). Elk cron-target valideert `x-cron-secret` header tegen `current_setting('app.cron_secret')`:

| Schedule | Job | Edge function |
|----------|-----|---------------|
| `0 6 * * *` | document-expiry check | `check-document-expiry` |
| `0 9 * * *` | onboarding-reminders | `automated-messages` (`?job=onboarding-reminders`) |
| `30 2 * * *` | housing-reminder daily | `housing-reminder-cron` |
| `45 2 * * *` | vehicle-APK daily | `check-vehicle-apk` |

### Public (verify_jwt = false)

| Function | Purpose |
|----------|---------|
| `onboarding-submit` | Process candidate onboarding form submissions |
| `whatsapp-webhook` | Receive WhatsApp messages + status updates from Meta |
| `exact-webhook` | Receive Exact Online invoice notifications |
| `whatsapp-config` | Receive WhatsApp credentials after OAuth setup |
| `exact-config` | Receive Exact Online credentials after OAuth setup |
| `carerix-config` | Receive Carerix credentials after OAuth setup |
| `register-organization` | New organization self-registration |
| `contract-sign` | Digital contract signing (token-based) |
| `candidate-profile` | Public candidate profile endpoint |
| `portal-activate` | Employee portal account activation |
| `client-portal-activate` | Client portal (opdrachtgever) account activation |
| `microsoft-callback` | Microsoft Graph OAuth callback |

### Protected (verify_jwt = false + self-auth)

**Communication & messaging**
| Function | Purpose |
|----------|---------|
| `whatsapp-register` | Register WhatsApp Business Account via SiteJob Connect |
| `whatsapp-send` | Send WhatsApp messages via Meta Graph API |
| `whatsapp-api` | Generic WhatsApp API proxy |
| `whatsapp-templates-sync` | Sync approved message templates from Meta |
| `send-placement-confirmation` | Email placement confirmations (to klant + medewerker) |
| `send-match-proposal` | Send candidate-voorstel email to opdrachtgever (supports preview-only mode) |
| `send-damage-report` | Email vehicle damage report with photos + template |
| `send-portal-invite` | Send employee portal activation link |
| `send-timesheet-approval` | Notify approval/rejection of timesheets |
| `send-ai-analysis` | Email AI-CV-analyse naar opdrachtgever / interne stakeholder |
| `automated-messages` | Scheduled/triggered automatic messaging (birthdays, expiries) |
| `bulk-campaign-processor` | Process bulk WhatsApp campaigns (batch of 50, rate limited) |
| `email-campaign-processor` | Process bulk email campaigns |
| `opt-out-handler` | Process communication opt-outs |
| `generate-notifications` | Create in-app notifications |
| `microsoft-api` | Microsoft Graph API proxy (mail, calendar) |
| `microsoft-auth` | Microsoft OAuth initiation |

**Integrations — financial / ATS**
| Function | Purpose |
|----------|---------|
| `exact-register` | Register Exact Online tenant via SiteJob Connect |
| `exact-api` | Proxy for Exact Online API calls (OData) |
| `exact-sync-invoice` | Sync invoices to/from Exact Online |
| `exact-sync-account` | Sync companies / accounts to Exact |
| `carerix-introspect` | Discover Carerix field schema |
| `carerix-sync-start` | Start Carerix full/delta sync |
| `carerix-sync-worker` | Worker that fetches pages from Carerix |
| `carerix-sync-cancel` | Cancel running Carerix sync |
| `carerix-test` | Test Carerix credentials/connection |
| `carerix-attachment-download` | Byte-download Carerix attachments → `documents` bucket |
| `generate-invoice-pdf` | Generate PDF invoices |

**Sourcing / job data**
| Function | Purpose |
|----------|---------|
| `apify-job-import` | Import job listings from web scraping (Apify) |
| `job-feed-runner` | Scheduled runner to ingest configured feeds |
| `linkedin-job-search` | LinkedIn job search |
| `exa-people-search` | Search people using Exa AI |

**Matching (regel-gebaseerd, gedeelde `_shared/matching-core.ts`)**
| Function | Purpose |
|----------|---------|
| `calculate-match` | Score één match (kandidaat × vacature) via `scoreMatch()`; schrijft `match_score` + `match_breakdown` op de `matches`-rij |
| `rank-candidates` | Rangschikt de hele kandidatenpool voor één vacature (shortlist "Beste kandidaten") |
| `rank-vacancies` | **Reverse matching**: rangschikt alle open vacatures voor één kandidaat (tab "Vacatures" op het dossier) |
| `enrich-vacancies` | **AI-skillverrijking** (Gemini): kent `required_skills` toe uit de volledige vacaturetekst, uitsluitend uit de actieve org-skillcatalogus. Batch (admin/superadmin/service) óf single (`vacancy_id`, RLS eigen-org elke rol). Idempotent via `skills_enriched_at`-cursor |

**AI**
| Function | Purpose |
|----------|---------|
| `cv-rewrite` | AI-powered CV improvement |
| `analyze-cv` | Submit kandidaatdossier for LLM analysis via VPS or Cloud. Builds dossier from CV/document text, profile and internal context; pseudonimiseert naam/email/tel/BSN/IBAN vóór verzending |
| `analyze-cv-callback` | Receive async CV analysis results from LLM VPS |
| `analyze-cv-batch` | **Backfill** voor bestaande kandidaten: select document/CV + notes/context → pseudonimiseer dossier → VPS. Superadmin-auth, throttle 1.5s/dossier |
| `refresh-talentpool-members` | **Dynamische talentpools**: past `filter_criteria` toe + diff vs huidige leden. Single-mode (user-JWT) of cron-mode (`x-cron-secret`) |
| `validate-timesheets` | AI validation of timesheet entries (6 rules) |
| `recruiter-priorities` | Calculate recruiter task priorities |

**Telephony (Voys) — AI call support**
| Function | Purpose |
|----------|---------|
| `voys-api` | Voys PBX API proxy |
| `voys-sync-calls` | Pull call logs / recordings for transcript + summary |

**Operations**
| Function | Purpose |
|----------|---------|
| `process-sick-report` | Handle ziekmelding from portal (create record + notify) |
| `check-document-expiry` | Scheduled document expiry validation (cron 06:00) |
| `housing-reminder-cron` | Wekelijkse reminders voor huisvesting-acties (cron 02:30) |
| `check-vehicle-apk` | APK-vervaldatum scan + alerts (cron 02:45) |
| `data-export` | Full-data export per organisatie (CSV/Excel bundel) |

### No config entry (default: JWT required)

| Function | Purpose |
|----------|---------|
| `kvk-lookup` | Dutch Chamber of Commerce (KVK) company lookup |
| `rdw-lookup` | Dutch vehicle registration (RDW) lookup |

### Storage Buckets

- **documents** — candidate/employee documents (CVs, IDs, contracts, inspection photos)
- **organization-logos** — company branding logos

## Integration Status

### WhatsApp Business API — Code complete, NOT tested with real Meta credentials

**Edge functions:** `whatsapp-register`, `whatsapp-webhook`, `whatsapp-config`, `whatsapp-send`

**Flow:**
1. User clicks register → `whatsapp-register` calls SiteJob Connect
2. Returns `tenant_id` + opens setup popup at `https://connect.sitejob.nl/whatsapp-setup`
3. Meta OAuth completes → credentials pushed back to `whatsapp-config` endpoint
4. Stored encrypted in `whatsapp_config` table
5. Messages sent via Meta Graph API v25.0 through `whatsapp-send`
6. Incoming messages received via `whatsapp-webhook` (validates X-Webhook-Secret)

**UI:** Full chat interface in `src/pages/WhatsApp.tsx` with conversations list, message bubbles, status tracking, media support. Settings in `src/components/settings/WhatsAppSettings.tsx`.

### Exact Online — Code complete, integration via SiteJob Connect

**Edge functions:** `exact-register`, `exact-api`, `exact-config`, `exact-webhook`, `exact-sync-invoice`

Similar to WhatsApp — tenant registration via SiteJob Connect → OAuth popup → credentials returned via callback. API proxy handles OData queries.

**UI:** `src/pages/ExactOnline.tsx`, `src/components/settings/ExactOnlineSettings.tsx`

### AI / LLM — Candidate dossier analysis via VPS + optional Cloud

**Edge functions:** `analyze-cv`, `analyze-cv-callback`, `analyze-cv-batch`

**Single-candidate flow (`analyze-cv`):**
1. UI upload supports PDF, DOC/DOCX, ODT, TXT, RTF and images; PDF/image OCR happens client-side with pdfjs-dist + Tesseract.js where possible.
2. Edge helper `_shared/candidate-dossier.ts` builds a server-side dossier from explicit CV text or best matching document, plus profile fields, internal notes, communication notes, placements and employment context.
3. Server-side sanitization strips prompt-injection phrases and wraps the dossier as data.
4. **AVG-pseudonimisering** (`_shared/cv-pseudonymize.ts`): naam → `[KANDIDAAT]`, emails → `[EMAIL]`, NL-telefoon → `[TELEFOON]`, BSN met 11-proef → `[BSN]`, IBAN → `[IBAN]`. Counts in `cv_pseudonymization_meta`.
5. Provider-keuze: request override → `organizations.settings.cv_ai_provider` → default `vps`. Org prompt lives in `organizations.settings.candidate_analysis_prompt`; legacy `cv_prompt_addendum` is still read/written for compatibility.
6. **VPS-pad:** dossier capped at ~28k chars, sent to `{OLLAMA_BASE_URL}/analyze` with `system_prompt`, JSON schema and callback URL. Current request remains backwards compatible via `cv_text`.
7. **Cloud-pad:** Anthropic Claude Haiku 4.5 via `ANTHROPIC_API_KEY`, synchroon, met gesanitized org prompt, tool-schema output en credit-afschrijving via `consume_ai_credits`.
8. Results in candidate: `ai_analysis`, `ai_status`, `ai_reliability_score`, `ai_function_group`, `ai_classification`, `ai_red_flags`, etc. New schema includes `dossier`, `manual_review_required`, `contra_indicaties` and `bronverwijzingen`.

**Batch backfill (`analyze-cv-batch`):**
- UI in `/superadmin/cv-backfill` (alleen superadmins), now labelled AI Dossier Backfill.
- Selects candidates with `ai_status` null/idle (and failed if requested), not only candidates with `cv_file_url`.
- Chooses the best text document from `candidate.cv_file_url` or `documents` (`type=cv`, CV-like filename, recency), then adds internal notes/context.
- Text extraction in the edge function supports PDF, DOCX, ODT, RTF, TXT and heuristic legacy DOC; image-only files are flagged but not OCRed server-side.
- Throttle 1.5s/dossier. Max batch 25. Optie: mislukten opnieuw proberen.

**LLM:** default lokaal/EU via Qwen3-14B op Hetzner VPS (`OLLAMA_BASE_URL` + `OLLAMA_API_KEY`). Optioneel sneller Cloud-pad via Anthropic Claude Haiku 4.5 (`ANTHROPIC_API_KEY`) met €50 starterbudget per organisatie in `organization_credits`.

**UI:** `src/components/candidates/tabs/CandidateAiTab.tsx` (realtime via Supabase channel) + `src/components/settings/AiCvProviderSettings.tsx` + `src/pages/superadmin/SuperAdminCvBackfill.tsx`

### Carerix — CSV wizard + live API sync

**Two paths** (in active development, see `carerix-*` commits):
1. **CSV import wizard** — `src/components/import/ImportWizard.tsx` — 4-step: Upload → Map → Preview → Execute. Preset mappings for Carerix exports. Supports candidates + companies.
2. **Live API sync** — `src/pages/CarerixImport.tsx` + 7 edge functions:
   - `carerix-config` — OAuth callback
   - `carerix-test` — verify credentials + required CR* scope
   - `carerix-introspect` — discover available fields
   - `carerix-sync-start` / `carerix-sync-worker` / `carerix-sync-cancel` — paginated sync pipeline
   - Tokens decrypted via `get_carerix_token` RPC (hardened by `20260422120000_pre_handover_security_hardening.sql`)

Current mapper focus: `CREmployee` enriches existing candidates with `employee_number`, BSN (through encrypted-column update path), nationality and normalized languages from CR fields plus `additionalInfo`. Tests live in `src/test/carerix-mappers.test.ts`.

### Microsoft 365 / Outlook — OAuth + API proxy

**Edge functions:** `microsoft-auth`, `microsoft-callback`, `microsoft-api`

Used for mail/calendar integration. OAuth handshake + proxied API calls. Frontend: `src/pages/Email.tsx` + `src/pages/EmailTemplates.tsx`. NOTE: email triage / AI-classification layer on top of this is NOT built yet.

### Voys — Call logs + AI call support

**Edge functions:** `voys-api`, `voys-sync-calls`

Pulls call logs (and potentially transcripts) from Voys PBX. Linked to candidate records via phone number. Supports the "AI call support" requirement from 03-20 meeting (less manual note-taking, post-call observations).

### Matching engine & flow (regel-gebaseerd, géén LLM)

De matching-kern is **deterministisch** in `supabase/functions/_shared/matching-core.ts → scoreMatch()`, gedeeld door `calculate-match`, `rank-candidates` en `rank-vacancies` (+ unit-tests in `src/test/matching.test.ts`).

- **Gewichten (genormaliseerd):** skills 50 / certifications 13 / functionGroup 12 / distance 20 (telt alléén mee als afstand bekend — anders geen straf) / availability 5. **Bonussen** (additief): taal +6, accommodatie +4, rijbewijs +5. Label: `rood` bij hardBlock of <45%, `groen` bij fit ≥72 + minstens één harde match, anders `oranje`.
- **Functie-groep-guard** (Alam-fix): een als `specialist` geclassificeerde kandidaat (`candidates.ai_classification`) zónder skill-match én zónder functie-titel-signaal wordt gecapt op ≤40 (valt uit de shortlist). Productie-kandidaten worden nooit geraakt; een specialist mét match scoort normaal.
- **Frontend `VacancyMatchesTab.tsx`:** de match-pipeline is een **lijst** (statusfilter-chips per fase, géén drag-kanban). Klik "Waarom?" → volledige `match_breakdown` (punten per onderdeel). Shortlist "Beste kandidaten" met %-drempelfilter + multi-select + bulk "Voorstellen". **Bulk-acties op matches:** Status wijzigen + **Interesse-bericht (ja/nee)** → WhatsApp-knoppen met reply-id `match_ja:<id>` / `match_nee:<id>`; `whatsapp-webhook → handleMatchInterest()` verschuift de match automatisch (ja → `in_gesprek`, nee → `afgewezen`). Reverse matching op het kandidaatdossier via `CandidateVacancyMatchesTab.tsx`.

### Kill-switch uitgaande communicatie (`_shared/outbound-pause.ts`)

Globale org-pauze in `organizations.settings.outbound_paused` (`true` of `{ email, whatsapp }`). Geblokkeerde berichten worden als **concept** in `communications` gelogd (`message_type='concept'`), niet stil weggegooid. Toggle in **Instellingen → Algemeen** (`OutboundPauseSettings.tsx`).
- **E-mail-guards:** `isOutboundPaused()` in `_shared/outlook-send.ts` (`sendViaOutlookAccount`, alle template-mailers) én in `outlook-send-mail` (interactieve hoofdmail).
- **WhatsApp-guards:** `whatsapp-send`, `bulk-campaign-processor`, `automated-messages`, `check-document-expiry`, `send-placement-confirmation`.
- `logConceptCommunication` slaat over (met `console.warn`) wanneer er geen candidate/company-id is (CHECK `chk_comm_target`).

### Candidate dedup

- **Scherm:** `/kandidaten/duplicaten` (`src/pages/DuplicateCandidates.tsx`), knop op `Candidates.tsx`. Route staat in `App.tsx` **vóór** `/kandidaten/:id`.
- **RPC's:** `find_duplicate_candidates` (read-only detectie) + `merge_candidate_records` (merge/delete) — beide **anon-revoked**. Payroll-dubbel blokkeert auto-merge in de RPC én de UI. `info@jawerkt.nl` is catch-all → e-mail is géén unieke sleutel.

### Vacancy skill enrichment

`enrich-vacancies` (Gemini) vult `required_skills` uit de volledige vacaturetekst, **uitsluitend** uit de actieve org-skillcatalogus (`skills.is_active`). Auto-getriggerd bij `VacancyNew` (alleen als er geen handmatige skills zijn) + handmatige knop **"AI-skills"** op `VacancyDetail`. Cap via `skills_enriched_at`. Curatie van de actieve catalogus → `SkillCatalogSettings.tsx`.

### Match Proposal (voorstelmail met preview)

**Edge function:** `send-match-proposal` (dual-mode: `preview=true` returns rendered HTML without sending)
**Frontend:** `src/components/vacancies/tabs/VacancyMatchesTab.tsx` — preview dialog + send flow
**Public response page:** `/match/reageer/:token` (alias: `/match-response/:token`) → `src/pages/MatchResponse.tsx` — opdrachtgever kan accepteren/afwijzen via unieke link
**Security:** `match_proposal_tokens` table; public anon enumeration dropped by SEC-4 hardening migration — public validation flows through service-role edge function

### Damage reports email

`send-damage-report` edge function emails vehicle damage report (with photos) using a pre-filled template to the configured recipient.

### Flexpedia — No API integration built

Referenced only as payroller type in `src/lib/payroller.ts`. JA Werkt invoices for brioworks/bromida/retiva but NOT for Flexpedia placements.

### KVK API — Edge function built

`supabase/functions/kvk-lookup/index.ts` — calls `https://api.kvk.nl/api/v1`. Requires `KVK_API_KEY` env var.

### Google Calendar — Not implemented

No code exists. `src/pages/Agenda.tsx` is an internal calendar view, not a Google-synced calendar.

### Dynamische talentpools

**Edge function:** `refresh-talentpool-members` (single-mode via user-JWT, cron-mode via `x-cron-secret`)

- `talentpools.is_dynamic = true` + `filter_criteria` jsonb → pool wordt auto-gevuld
- Refresh past filter toe op candidates → diff vs `talentpool_members.added_by_filter = true`
- Voegt missende toe (`added_by_filter = true`), verwijdert die niet meer matchen — handmatig toegevoegden (`added_by_filter = false`) blijven altijd staan
- `last_refresh_meta` houdt `{ added, removed, total, matched }` bij
- pg_cron schedules zijn opt-in via `supabase/migrations/20260425170000_d3_dynamic_talentpools_cron.sql` (vereist `CRON_SECRET` env var op edge function + `app.cron_secret` setting in DB)
- UI: `/talentpools` lijst toont type + last_refreshed; detail-pagina heeft "Ververs nu" knop + frequency-selector

## Working with Supabase MCP (preferred for this project)

Voor DB- en edge-function-werk gebruiken we standaard de Supabase MCP-tools (vermijdt CLI-installatie + auth):

| Taak | MCP tool |
|------|----------|
| Migration toepassen op productie | `mcp__claude_ai_Supabase__apply_migration` |
| Edge function deployen | `mcp__claude_ai_Supabase__deploy_edge_function` |
| Types regenereren | `mcp__claude_ai_Supabase__generate_typescript_types` (output in JSON-wrapper, extract via `python3 -c 'json.load...'` naar `src/integrations/supabase/types.ts`) |
| Migration-historie | `mcp__claude_ai_Supabase__list_migrations` |
| Tabellen / extensies | `mcp__claude_ai_Supabase__list_tables` / `list_extensions` |
| Security / performance audit | `mcp__claude_ai_Supabase__get_advisors` (type: `security` of `performance`) — draaien na DDL-changes |

Project-id: `noaupcteygfvlyymqtew` (vermeld in CLAUDE.md "Team & Contact" hieronder).

**Patroon na schema-wijziging**: apply_migration → generate_typescript_types → schrijf naar `src/integrations/supabase/types.ts` → spiegel-migration aanmaken in `supabase/migrations/` voor lokale dev/CI consistency.

## Key Patterns & Conventions

### Data Fetching

- All server state via **TanStack Query** + Supabase PostgREST
- Query keys: `['table-name', orgId, ...filters]`
- Supabase client: `src/integrations/supabase/client.ts`
- Types: `src/integrations/supabase/types.ts` — regenereer via Supabase MCP (zie sectie hierboven) of `npx supabase gen types typescript --project-id noaupcteygfvlyymqtew`

### Auth / Roles

5 roles: `admin`, `intercedent`, `backoffice`, `finance`, `medewerker`

- `admin` — full access
- `intercedent` — recruiter/placement specialist
- `backoffice` — administrative operations
- `finance` — invoicing and financial features
- `medewerker` — employee role, redirected to portal

### Compliance

`src/hooks/useComplianceCheck.ts` + `src/components/ComplianceWarningDialog.tsx`

1. Loads dynamic rules from `compliance_rules` table (filterable by sector/contractType)
2. Falls back to hardcoded checks: valid ID, signed contract, signed reglement, BSN, IBAN, DOB
3. Validates document expiry
4. `ComplianceWarningDialog` shows issues and logs override via audit

### Feature Flags

`useModuleEnabled(moduleKey)` checks: org override → plan modules → default true

### Payrollers

4 types in `src/lib/payroller.ts`: flexpedia, brioworks, bromida, retiva. JA Werkt invoices for brioworks/bromida/retiva only.

### Edge Function Auth Pattern

```typescript
const authHeader = req.headers.get("Authorization");
const { data: { user } } = await supabaseClient.auth.getUser(authHeader.replace("Bearer ", ""));
```

## Known Issues & Technical Debt

### Lovable Legacy
- `lovable-tagger` in devDependencies (dev-only, harmless)
- Some components may have verbose/duplicated code typical of AI-generated code

### Testing
- Vitest + Testing Library + jsdom voor unit; **Playwright voor e2e** (`tests/e2e/`)
- Coverage is nog beperkt — uitbouw lopend

### Integrations
- WhatsApp: full code but not tested with real Meta credentials
- Exact Online: depends on SiteJob Connect service
- AI dossier analysis: UI has OCR for PDFs/images; server batch does not OCR image-only files. Prompt-injection sanitization + **server-side AVG-pseudonimisering actief**.

### Hardcoded Values
- SiteJob Connect URLs hardcoded in edge functions
- Meta Graph API version: `v25.0`
- AI dossier cap: ~28.000 chars; selected document/CV text cap: ~16.000 chars
- Campaign batch size: 50 recipients
- AI dossier batch throttle: 1500 ms/dossier, max 25 per call

### Open gaps & roadmap

Project-management state (closed sprints, open client-meeting items, Fase 2 missing features) lives in [docs/open-gaps.md](docs/open-gaps.md) — kept out of CLAUDE.md because it decays fast.

## Development Setup

### Environment Variables

**Frontend (in `.env`):**
- `VITE_SUPABASE_URL` — Supabase project URL
- `VITE_SUPABASE_PUBLISHABLE_KEY` — Supabase publishable/anon key

**Edge function secrets (Supabase Dashboard or CLI):**
- `OLLAMA_BASE_URL` — Hetzner VPS for LLM
- `OLLAMA_API_KEY` — LLM API key
- `ANTHROPIC_API_KEY` — optional Cloud candidate-dossier analysis provider (Claude Haiku 4.5)
- `KVK_API_KEY` — Chamber of Commerce API
- `APIFY_API_TOKEN` — Apify web scraping
- `EXA_API_KEY` — Exa people search

### Regenerate Types

Voorkeur via Supabase MCP (zie "Working with Supabase MCP" sectie). CLI-fallback:

```bash
npx supabase gen types typescript --project-id noaupcteygfvlyymqtew > src/integrations/supabase/types.ts
```

## Dutch Terminology

| Dutch | English |
|-------|---------|
| kandidaten | candidates |
| opdrachtgevers | companies/clients (inleners) |
| medewerkers | employees |
| vacatures | vacancies |
| plaatsingen | placements (tewerkstellingen) |
| uren | timesheets/hours |
| facturatie | invoicing |
| huisvesting | housing |
| transport | transport/vehicles |
| instellingen | settings |
| kennisbank | knowledge base |
| loonstroken | payslips |
| jaaropgaven | annual statements |
| urenbrieven | hour letters |
| uitstroom | attrition/offboarding |
| ziekmelding | sick report |
| tankpas | fuel card |
| rijbewijs | driver's license |
| BSN | citizen service number (burgerservicenummer) |
| KVK | Chamber of Commerce (Kamer van Koophandel) |
| BTW | VAT (belasting toegevoegde waarde) |
| RDW | vehicle registration authority |
| intercedent | recruiter/staffing consultant |
| loonmotor | payroll engine |

## Team & Contact

- **Developer:** Kas (kas@sitejob.nl) — SiteJob
- **Client:** JA Werkt, Jeroen Adriaans, Mierlo
- **Supabase project ID:** `noaupcteygfvlyymqtew`
- **GitHub repo:** `sitejob-nl/ja-works-hub`
- **LLM infra:** Hetzner VPS, Qwen3-14B via Ollama by default; optional Anthropic Claude Haiku 4.5 Cloud path with per-org credits
