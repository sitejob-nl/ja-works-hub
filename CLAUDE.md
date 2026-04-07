# CLAUDE.md

This file provides guidance to Claude Code when working with the JA Werkt codebase.

## Project Overview

**JA Werkt** is a multi-tenant staffing agency (uitzendbureau) SaaS platform built for JA Werkt, a temp agency specializing in labor migrants (arbeidsmigranten) in Brabant/Limburg, Netherlands. The platform consolidates multiple legacy systems (Carerix, Joboti, Umanga, OnTrack, Q8, Buddy) into a single system, while keeping Flexpedia as external payroll engine (loonmotor).

**Key workflows:**
1. **Candidate → Employee → Placement**: Create candidate → upload docs → hire (in dienst) → onboarding checklist → compliance check → vacancy matching (AI score) → pipeline (voorgesteld → in_gesprek → geaccepteerd) → place with ComplianceWarningDialog → planning
2. **Housing**: Property → rooms (units) → assign resident (3-step wizard) → check-in → costs → keys → check-out. DB trigger blocks overbooking.
3. **Timesheets**: Enter hours (manual or CSV) → AI validation (edge function, 6 rules) → approval (individual or bulk) → rejected: reopen to concept
4. **Self-service onboarding**: Intercedent generates link → worker opens `/onboarding/{token}` (public) → fill form + accept docs → token-based auth (7 days, single use)

**Status:** Built in Lovable, now transitioning to Claude Code + VS Code for further development.

## Commands

```bash
npm run dev          # Dev server on port 8080
npm run build        # Production build
npm run build:dev    # Development build
npm run lint         # ESLint
npm run test         # Vitest (single run)
npm run test:watch   # Vitest (watch mode)
npx vitest run src/test/example.test.ts  # Run single test file
```

Edge functions are Deno/TypeScript and deploy via Supabase CLI. They live in `supabase/functions/` and are configured in `supabase/config.toml`.

## Tech Stack

- **Frontend**: React 18 + TypeScript, Vite 5 (SWC), React Router v6, TanStack Query v5, React Hook Form + Zod
- **UI**: shadcn/ui (Radix) + Tailwind CSS 3, dark/light mode (next-themes), Sonner toasts, Recharts, Lucide icons
- **Backend**: Supabase (PostgreSQL + Auth + Edge Functions + Realtime + Storage)
- **PWA**: vite-plugin-pwa, standalone mode, auto-update, 5MB cache limit
- **CSV/Excel**: PapaParse (CSV), xlsx (Excel export)
- **Testing**: Vitest + Testing Library + jsdom (minimal coverage — only placeholder test exists)
- **Build tooling**: lovable-tagger (dev only), autoprefixer, postcss

### TypeScript Config

Relaxed settings — do NOT tighten without explicit request:
- `noImplicitAny: false`
- `strictNullChecks: false`
- `no-unused-vars: off`

Path alias: `@/*` → `./src/*`

## Architecture

### Three Authentication Zones

| Zone | Path | Context | Layout | Hook |
|------|------|---------|--------|------|
| Main App | `/` | `AuthContext` | `AppLayout` | `useAuth()` → `{ session, user, profile, loading, signOut }` |
| Employee Portal | `/portaal/` | `PortalContext` | `PortalLayout` | `usePortal()` → `{ session, profile, employee, candidate, loading, signOut }` |
| Superadmin | `/superadmin/` | `SuperAdminContext` | `SuperAdminLayout` | `useSuperAdmin()` → `{ session, user, isSuperAdmin, loading, signOut }` |

- Profile includes `organization_id` and `role`
- Portal's `employee` and `candidate` both point to the same `candidates` row
- SuperAdmin checks the `superadmins` table (no role field)
- Public routes use token-based auth (no login required)

### Directory Structure

```
src/
├── App.tsx                    # Main router with all routes
├── components/
│   ├── ui/                    # shadcn/ui primitives (40+ components)
│   ├── layout/                # AppLayout, AppSidebar, TopBar, PortalLayout, SuperAdminLayout
│   ├── candidates/            # SlideOver + 10 tabs (Ai, Communication, Documents, Matches, etc.)
│   ├── companies/             # SlideOver + 6 tabs (Info, Contacts, Functions, Placements, etc.)
│   ├── employees/             # 13 tabs (Contracts, Deductions, Housing, Onboarding, etc.)
│   ├── housing/               # PropertySlideOver + 6 tabs (Units, Residents, Costs, Keys, etc.)
│   ├── transport/             # VehicleSlideOver + 5 tabs (Assignments, Damage, Fines, Mileage)
│   ├── vacancies/             # VacancySlideOver + 3 tabs
│   ├── placements/            # Allowances, HourTypes, TravelTypes config
│   ├── timesheets/            # CSV import, entry sheet
│   ├── campaigns/             # CampaignWizard, SegmentBuilder
│   ├── import/                # ImportWizard (Carerix/CSV)
│   ├── onboarding/            # OnboardingWizard
│   ├── settings/              # WhatsApp, Exact, Compliance, Contracts, Onboarding config
│   ├── dashboard/             # 6 dashboard widgets (KPI, Activity, DataQuality, Source, etc.)
│   ├── uitstroom/             # Attrition analysis (5 components)
│   ├── talentpools/           # Pool management
│   ├── shared/                # NotesSection, TasksSection
│   ├── cv/                    # CV settings & template
│   ├── portal/                # PortalNotifications
│   ├── placement/             # HousingSuggestions, PlacementConfirmation, PlacementTriggers
│   ├── ComplianceWarningDialog.tsx
│   ├── ErrorBoundary.tsx
│   ├── ProtectedRoute.tsx
│   └── ShellPage.tsx
├── contexts/
│   ├── AuthContext.tsx
│   ├── PortalContext.tsx
│   ├── SuperAdminContext.tsx
│   └── RecentItemsContext.tsx
├── hooks/
│   ├── useOrganizationId.ts   # Gets org ID from profile (THROWS outside AuthProvider)
│   ├── useModuleEnabled.ts    # Feature flag: org override → plan → default true
│   ├── useComplianceCheck.ts  # Dynamic rules + fallback hardcoded checks
│   ├── useDecryptedCandidate.ts  # RPC decrypt BSN/IBAN
│   ├── useTrackPageVisit.ts
│   └── use-mobile.tsx
├── lib/
│   ├── audit.ts               # logAudit() — silent-fail audit logging
│   ├── branding.ts            # Per-org CSS custom properties (accent, sidebar, etc.)
│   ├── format.ts              # Date/currency/text formatting (nl-NL locale)
│   ├── payroller.ts           # Payroller types: flexpedia, brioworks, bromida, retiva
│   ├── tasks.ts               # Task utilities
│   ├── termination-constants.ts  # Exit reason enums
│   └── utils.ts               # cn() classname merger
├── pages/                     # 57 page components (see Routes section)
├── integrations/supabase/
│   ├── client.ts              # Supabase client instance
│   └── types.ts               # Auto-generated types (~6400 lines) — NEVER hand-edit
└── test/                      # Vitest test files
```

### Routes

**Main App (40 routes, `AuthProvider` + `ProtectedRoute` + `AppLayout`):**

| Route | Page | Purpose |
|-------|------|---------|
| `/` | Dashboard | Main dashboard |
| `/workbench` | RecruiterWorkbench | Recruiter task board |
| `/taken` | Tasks | Task management |
| `/kandidaten` | Candidates | Candidate list |
| `/kandidaten/new` | CandidateNew | Create candidate |
| `/kandidaten/:id` | CandidateDetail | Candidate view (SlideOver) |
| `/kandidaten/:id/bewerken` | CandidateEdit | Edit candidate |
| `/opdrachtgevers` | Companies | Company list |
| `/opdrachtgevers/new` | CompanyNew | Create company |
| `/opdrachtgevers/:id` | CompanyDetail | Company view (SlideOver) |
| `/opdrachtgevers/:id/bewerken` | CompanyEdit | Edit company |
| `/medewerkers` | Employees | Employee list (operates on candidates table) |
| `/medewerkers/new` | EmployeeNew | Hire employee |
| `/medewerkers/:id` | EmployeeDetail | Employee view (13 tabs) |
| `/contacten` | Contacts | Contact persons list |
| `/contacten/:id` | ContactDetail | Contact view |
| `/talentpools` | Talentpools | Talent pool list |
| `/talentpools/:id` | TalentpoolDetail | Pool detail |
| `/vacatures` | Vacancies | Vacancy list |
| `/vacatures/new` | VacancyNew | Create vacancy |
| `/vacatures/:id` | VacancyDetail | Vacancy view |
| `/vacatures/:id/bewerken` | VacancyEdit | Edit vacancy |
| `/plaatsingen` | PlacementsPage | Placement list |
| `/plaatsingen/:id` | PlacementDetail | Placement view |
| `/planning` | Planning | Week schedule overview |
| `/uren` | Timesheets | Timesheet management |
| `/huisvesting` | Housing | Property list |
| `/huisvesting/:id` | PropertyDetail | Property view (6 tabs) |
| `/transport` | Transport | Vehicle list |
| `/transport/new` | VehicleNew | Add vehicle |
| `/transport/:id` | VehicleDetail | Vehicle view |
| `/transport/:id/bewerken` | VehicleEdit | Edit vehicle |
| `/facturatie` | InvoicesPage | Invoice management |
| `/uitstroom-analyse` | UitstroomAnalyse | Attrition analytics |
| `/tankpas-analyse` | FuelCardAnalysis | Fuel card analysis |
| `/dashboards` | Dashboards | Custom dashboards |
| `/communicatie` | Communications | Message history |
| `/whatsapp` | WhatsAppPage | WhatsApp config & chat |
| `/exact-online` | ExactOnlinePage | Exact Online integration |
| `/bulk-campaigns` | BulkCampaigns | Campaign list |
| `/bulk-campaigns/:id` | BulkCampaignDetail | Campaign detail |
| `/vacaturebank` | Vacaturebank | Job board |
| `/kandidaten-zoeken` | KandidatenZoeken | People search (Exa) |
| `/kennisbank` | KnowledgeBasePage | Knowledge base |
| `/cv-tool/:candidateId` | CvTool | CV generation |
| `/importeren` | ImportData | Data import wizard |
| `/instellingen` | SettingsPage | Organization settings |

**Portal (11 routes, `PortalProvider` + `PortalLayout`):**

| Route | Page |
|-------|------|
| `/portaal/` | PortalDashboard |
| `/portaal/uren` | PortalTimesheets |
| `/portaal/plaatsingen` | PortalPlacements |
| `/portaal/documenten` | PortalDocuments |
| `/portaal/profiel` | PortalProfile |
| `/portaal/ziekmelding` | PortalSickReport |
| `/portaal/huisvesting` | PortalHousing |
| `/portaal/voertuig` | PortalVehicle |
| `/portaal/loonstroken` | PortalPayslips |
| `/portaal/jaaropgaven` | PortalAnnualStatements |
| `/portaal/urenbrieven` | PortalHourLetters |

**Superadmin (5 routes, `SuperAdminProvider` + `SuperAdminLayout`):**

| Route | Page |
|-------|------|
| `/superadmin/` | SuperAdminDashboard |
| `/superadmin/organisaties` | SuperAdminOrganizations |
| `/superadmin/gebruikers` | SuperAdminUsers |
| `/superadmin/abonnementen` | SuperAdminPlans |
| `/superadmin/errors` | SuperAdminErrors |

**Public routes (no login):**

| Route | Purpose |
|-------|---------|
| `/onboarding/:token` | Self-service onboarding form |
| `/contract/sign/:token` | Digital contract signing |
| `/profiel/:token` | Candidate profile view |
| `/portaal/activeren/:token` | Portal account activation |
| `/portaal/login` | Portal login page |
| `/registreren` | Organization registration |
| `/installeren` | Setup/installation |

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

## Database Schema (77 tables + 3 views)

### Candidates & HR

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `candidates` | Core entity for candidates AND employees (merged) | id, first_name, last_name, email, phone, date_of_birth, gender, nationality, bsn (encrypted), iban (encrypted), skills[], languages[], certifications[], cv_file_url, cv_raw_text, ai_analysis, ai_status, ai_summary, ai_reliability_score, ai_classification, ai_function_group, ai_target_functions[], ai_positive_signals[], ai_red_flags[], ai_risk_factors[], ai_interview_questions[], employee_status, employee_number, status, compliance_status, onboarding_completed, portal_enabled, portal_activated_at, portal_last_login, organization_id, source, auth_user_id |
| `employees` | Legacy employee table (candidates is source of truth) | Similar to candidates |
| `candidate_employment` | Employment history per candidate | candidate_id, start_date, end_date, end_reason, contract_type, contract_hours, pay_frequency, vacation_days_total/used, vacation_money_percentage, pension_scheme, insurance_type, is_current |
| `candidate_profile_tokens` | Public profile access tokens | candidate_id, token, expires_at, organization_id |
| `candidate_signup_links` | Custom signup links | slug, organization_id, source_label, default_status, redirect_url |
| `contracts` | Employment contracts | candidate_id, template_id, status (concept/verzonden/getekend/verlopen), signed_at, pdf_url |
| `documents` | Uploaded documents | candidate_id, type (id_bewijs/rijbewijs/contract/reglement/etc.), file_url, status (geldig/verlopen/etc.), expires_at |
| `sick_reports` | Sick leave reports | candidate_id, start_date, end_date, status, notes |
| `annual_statements` | Year-end pay statements (jaaropgaven) | employee_id, candidate_id, year, total_gross/net/hours, pdf_url |
| `payslips` | Monthly payslips (loonstroken) | candidate_id, period, gross/net amounts, pdf_url |
| `hour_letters` | Hour letters (urenbrieven) | candidate_id, period, pdf_url |
| `employee_deductions` | Salary deductions (inhoudingen) | candidate_id, type, amount, description |
| `employee_subsidies` | Housing/transport subsidies | candidate_id, type, amount |
| `employee_reservations` | Employee reservations | candidate_id, type, amount, description |
| `employee_notifications` | In-app notifications | candidate_id, title, message, read, action_url |

### Companies & Contacts

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `companies` | Client companies (opdrachtgevers/inleners) | name, kvk_number, vat_number (btw), email, phone, website, address fields, organization_id |
| `company_contacts` | Contact persons at companies | company_id, first_name, last_name, email, phone, function_title |
| `company_functions` | Job functions defined per company | company_id, name, description |
| `company_sla` | SLA agreements per company | company_id, terms |
| `rate_agreements` | Rate/salary band agreements | company_id, function, hourly_rate, overtime_rate |

### Placements & Matching

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `placements` | Active placements (tewerkstellingen) | candidate_id, company_id, vacancy_id, start_date, end_date, hourly_rate, contract_type, housing_unit_id, vehicle_id, status (gepland/actief/afgerond/voortijdig_beeindigd), payroller (flexpedia/brioworks/bromida/retiva), compliance_check_passed, matched_score |
| `placement_allowances` | Extra allowances per placement | placement_id, name, amount, type |
| `placement_hour_types` | Hour categorizations per placement | placement_id, name, rate_multiplier |
| `placement_travel_types` | Travel expense types per placement | placement_id, name, rate |
| `matches` | AI candidate-vacancy matching results | candidate_id, vacancy_id, score, reliability_score, skills_match, languages_match, experience_level, cultural_fit, availability_match |
| `vacancies` | Open positions | company_id, title, description, requirements, location, hourly_rate, status (open/on_hold/vervuld/gesloten), organization_id |

### Timesheets & Invoicing

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `timesheets` | Hour tracking entries | candidate_id, placement_id, week_number, date, hours_worked, overtime_hours, status (concept/ingediend/groen/oranje/rood/goedgekeurd/afgekeurd), source (handmatig/csv_import/kloksysteem), ai_validation_result, approved_by |
| `invoices` | Invoice records | reference_number, invoice_date, due_date, total_amount, status (concept/definitief/verzonden/betaald/gecrediteerd), synced_to_exact, exact_document_id |
| `invoice_lines` | Invoice line items | invoice_id, placement_id, description, quantity, unit_price, total_amount |
| `invoice_sequences` | Auto-increment counter for invoice numbers | organization_id, current_number |
| `fuel_card_transactions` | Fuel card usage | vehicle_id, candidate_id, date, amount, liters, location |
| `mileage_entries` | Kilometer logs | candidate_id, vehicle_id, date, km_start, km_end |

### Housing

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `properties` | Housing properties (panden) | name, address fields, owner_name, owner_phone, total_units, max_occupancy, status, organization_id |
| `units` | Rooms/units within properties | property_id, name, floor, capacity, status (beschikbaar/gereserveerd/bezet/onderhoud/geblokkeerd), monthly_rent |
| `housing_assignments` | Resident assignments to units | unit_id, candidate_id, check_in_date, check_out_date, status (gereserveerd/ingecheckt/uitgecheckt), deposit_amount |
| `housing_inspections` | Property inspections | property_id, inspection_date, inspected_by, type (check_in/check_out/periodiek/onderhoud/klacht), status, photos[], notes |
| `key_registrations` | Key handout tracking | unit_id, candidate_id, key_number, handed_out_at, returned_at |

### Transport

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `vehicles` | Company vehicles | license_plate, brand, model, year, fuel_type, fuel_card_reference, apk_expiry, current_mileage, status (beschikbaar/toegewezen/onderhoud/uit_dienst) |
| `vehicle_assignments` | Vehicle ↔ employee assignments | vehicle_id, candidate_id, start_date, end_date |
| `vehicle_damage_reports` | Damage tracking | vehicle_id, candidate_id, date, description, photos[], repair_cost |
| `vehicle_fines` | Traffic fines | vehicle_id, candidate_id, date, amount, description, status |

### Communication & Campaigns

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `communications` | Individual messages (all channels) | recipient_id, recipient_type, communication_type, channel (whatsapp/email/voip/notitie/sms), message, status, sent_at, delivered_at, read_at |
| `communication_preferences` | User opt-in/opt-out settings | candidate_id, channel, opted_out |
| `bulk_campaigns` | Bulk message campaigns | name, channel, message_template, segment_filter (JSON), status (draft/scheduled/running/completed), total_recipients, sent_count, failed_count, rate_limit_per_minute/hour |
| `campaign_recipients` | Per-recipient delivery tracking | campaign_id, candidate_id, status (pending/sent/failed/opted_out), sent_at, error_message |
| `whatsapp_config` | WhatsApp Business API config (encrypted) | organization_id, phone_number_id, access_token (encrypted), waba_id, webhook_secret (encrypted), display_phone |

### Onboarding

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `onboarding_forms` | Custom onboarding form definitions | organization_id, name, is_active |
| `onboarding_form_steps` | Form workflow steps | form_id, title, order |
| `onboarding_form_fields` | Form field definitions | step_id, label, field_type, is_required, options |
| `onboarding_form_regulations` | Regulations linked to forms | form_id, regulation_id |
| `onboarding_responses` | Submitted form data | form_id, candidate_id, data (JSON) |
| `onboarding_tokens` | Access tokens for onboarding | candidate_id, token, expires_at, used_at |

### Compliance & Configuration

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `compliance_rules` | Dynamic compliance rule definitions | name, required_documents[], required_fields[], sector, contract_type, is_active |
| `regulations` | Company regulations/policies | organization_id, title, content, is_active |
| `regulation_acknowledgements` | Employee sign-offs on regulations | regulation_id, candidate_id, acknowledged_at |
| `contract_templates` | Contract document templates | organization_id, name, content, variables[] |
| `termination_reasons` | Exit reason codes | organization_id, label, category |
| `knowledge_base` | Internal documentation articles | organization_id, title, content, category |

### Organization & Users

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `organizations` | Tenant organizations | name, kvk_number, btw_number, email, phone, address fields, logo_url, plan_id, settings (JSON for branding), is_active, slug |
| `profiles` | Auth user profiles | id (= auth.users.id), organization_id, role (admin/intercedent/backoffice/finance/medewerker), full_name, email, phone, avatar_url, is_active |
| `superadmins` | System admin accounts | user_id |
| `subscription_plans` | Billing/subscription plans | name, modules (JSON array), price |
| `organization_modules` | Per-org module overrides | organization_id, module_name, enabled |
| `portal_invites` | Employee portal invitations | candidate_id, token, expires_at |

### External Integration Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `exact_config` | Exact Online credentials (encrypted) | organization_id, tenant_id, division, region, base_url, webhook_secret |
| `external_mappings` | Field mappings for imports | organization_id, source_system, source_field, target_field |
| `job_listings` | Job postings from scraping | title, company, location, url, source |
| `job_import_logs` | Import run logs | organization_id, status, records_imported |
| `people_search_results` | Exa people search results | organization_id, query, results (JSON) |

### Logging & System

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `audit_log` | Change tracking | action, table_name, record_id, old_values, new_values, user_id, organization_id, reason |
| `client_errors` | Frontend error logging | message, stack, url, user_id |
| `rate_limit_tracking` | Campaign rate limiting | organization_id, channel, window_type, count |
| `recruiter_tasks` | Recruiter task items | organization_id, title, status, assigned_to, due_date |
| `notes` | Notes on any entity | entity_type, entity_id, content, created_by |
| `talentpools` | Candidate segment pools | organization_id, name, description, filter_criteria |
| `talentpool_members` | Pool membership | talentpool_id, candidate_id |

### Views

| View | Purpose |
|------|---------|
| `v_active_placements` | Currently active placements with candidate + company info |
| `v_employee_compliance` | Compliance status per employee |
| `v_unit_occupancy` | Housing unit occupancy overview |

## Database Enums

| Enum | Values |
|------|--------|
| `user_role` | admin, intercedent, backoffice, finance, medewerker |
| `audit_action` | create, update, delete, status_change, login, export, override |
| `candidate_status` | nieuw, in_behandeling, beschikbaar, geplaatst, inactief, afgewezen |
| `employee_status` | onboarding, actief, ziek, uit_dienst |
| `placement_status` | gepland, actief, afgerond, voortijdig_beeindigd |
| `timesheet_status` | concept, ingediend, groen, oranje, rood, goedgekeurd, afgekeurd |
| `timesheet_source` | handmatig, klantportaal, csv_import, kloksysteem |
| `vacancy_status` | open, on_hold, vervuld, gesloten |
| `match_status` | nieuwe_match, gescreend, voorgesteld, in_gesprek, geaccepteerd, afgewezen, geplaatst |
| `campaign_status` | draft, scheduled, running, paused, completed, cancelled |
| `campaign_recipient_status` | pending, sent, failed, opted_out |
| `communication_channel` | whatsapp, email, voip, notitie, sms |
| `compliance_status` | incompleet, compleet, verlopen |
| `contract_status` | concept, verzonden, getekend, verlopen |
| `document_type` | id_bewijs, rijbewijs, certificaat, contract, reglement, overig, bankbewijs, loonstrook, jaaropgave, urenbrief |
| `document_status` | geldig, verloopt_binnenkort, verlopen, ongeldig |
| `housing_assignment_status` | gereserveerd, ingecheckt, uitgecheckt |
| `inspection_type` | check_in, check_out, periodiek, onderhoud, klacht |
| `invoice_status` | concept, definitief, verzonden, betaald, gecrediteerd |
| `payroller_type` | flexpedia, brioworks, bromida, retiva |
| `unit_status` | beschikbaar, gereserveerd, bezet, onderhoud, geblokkeerd |
| `vehicle_status` | beschikbaar, toegewezen, onderhoud, uit_dienst |
| `terminated_by_type` | opdrachtgever, medewerker, uitzendbureau |
| `rate_limit_window` | minute, hour |

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
| `sa_get_organizations` | (none) | org list | Superadmin: list all orgs |
| `sa_get_profiles` | (none) | profile list | Superadmin: list all users |
| `sa_get_audit_log` | p_limit, p_offset | audit entries | Superadmin: view audit log |
| `sa_get_org_stats` | org_uuid | { candidates_count, companies_count, etc. } | Superadmin: org statistics |
| `sa_update_org_active` | org_uuid, active | void | Superadmin: activate/deactivate org |
| `sa_update_org_plan` | org_uuid, new_plan_id | void | Superadmin: change subscription |

## Edge Functions (30 functions)

### Public (verify_jwt = false)

| Function | Purpose |
|----------|---------|
| `onboarding-submit` | Process candidate onboarding form submissions |
| `whatsapp-webhook` | Receive WhatsApp messages + status updates from Meta |
| `exact-webhook` | Receive Exact Online invoice notifications |
| `whatsapp-config` | Receive WhatsApp credentials after OAuth setup |
| `exact-config` | Receive Exact Online credentials after OAuth setup |
| `register-organization` | New organization self-registration |
| `contract-sign` | Digital contract signing (token-based) |
| `candidate-profile` | Public candidate profile endpoint |
| `portal-activate` | Employee portal account activation |

### Protected (verify_jwt = true)

| Function | Purpose |
|----------|---------|
| `whatsapp-register` | Register WhatsApp Business Account via SiteJob Connect |
| `whatsapp-send` | Send WhatsApp messages via Meta Graph API |
| `exact-register` | Register Exact Online tenant via SiteJob Connect |
| `exact-api` | Proxy for Exact Online API calls (OData) |
| `exact-sync-invoice` | Sync invoices to/from Exact Online |
| `apify-job-import` | Import job listings from web scraping (Apify) |
| `exa-people-search` | Search people using Exa AI |
| `calculate-match` | AI candidate-vacancy matching score |
| `cv-rewrite` | AI-powered CV improvement |
| `analyze-cv` | Submit CV for LLM analysis (async, calls VPS) |
| `analyze-cv-callback` | Receive async CV analysis results from LLM VPS |
| `validate-timesheets` | AI validation of timesheet entries (6 rules) |
| `recruiter-priorities` | Calculate recruiter task priorities |
| `bulk-campaign-processor` | Process bulk WhatsApp campaigns (batch of 50, rate limited) |
| `generate-notifications` | Create in-app notifications |
| `send-placement-confirmation` | Email placement confirmations |
| `check-document-expiry` | Scheduled document expiry validation |
| `opt-out-handler` | Process communication opt-outs |
| `generate-invoice-pdf` | Generate PDF invoices |

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

### AI / LLM — CV Analysis via external VPS

**Edge functions:** `analyze-cv`, `analyze-cv-callback`

**Flow:**
1. PDF uploaded → text extracted client-side (`file.text()`, text-based PDFs only, no OCR)
2. Sanitization: removes prompt injection patterns
3. Text capped at 15,000 chars → POST to `{OLLAMA_BASE_URL}/analyze` with callback URL
4. VPS processes asynchronously → calls back to `analyze-cv-callback`
5. Results stored in candidate: ai_analysis, ai_status, ai_reliability_score, ai_function_group, ai_classification, ai_interview_questions[], ai_risk_factors[], ai_summary

**LLM:** Qwen3-14B on Hetzner VPS, accessed via `OLLAMA_BASE_URL` + `OLLAMA_API_KEY` env vars

**UI:** `src/components/candidates/tabs/CandidateAiTab.tsx` with realtime Supabase channel subscription

### Carerix Import — Working CSV import wizard

`src/components/import/ImportWizard.tsx` — 4-step wizard: Upload → Map fields → Preview → Execute. Has preset field mappings for Carerix exports. Supports candidates and companies.

### Flexpedia — No API integration built

Referenced only as payroller type in `src/lib/payroller.ts`. JA Werkt invoices for brioworks/bromida/retiva but NOT for Flexpedia placements.

### KVK API — Edge function built

`supabase/functions/kvk-lookup/index.ts` — calls `https://api.kvk.nl/api/v1`. Requires `KVK_API_KEY` env var.

### Google Calendar — Not implemented

No code exists.

## Key Patterns & Conventions

### Data Fetching

- All server state via **TanStack Query** + Supabase PostgREST
- Query keys: `['table-name', orgId, ...filters]`
- Supabase client: `src/integrations/supabase/client.ts`
- Types: `src/integrations/supabase/types.ts` — regenerate with `supabase gen types typescript`

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
- Package name is `vite_react_shadcn_ts` (generic Lovable default)
- `lovable-tagger` in devDependencies (dev-only, harmless)
- Some components may have verbose/duplicated code typical of AI-generated code

### Testing
- Only a placeholder test exists — no real test coverage
- Infrastructure (Vitest + Testing Library + jsdom) is set up and ready

### Integrations
- WhatsApp: full code but not tested with real Meta credentials
- Exact Online: depends on SiteJob Connect service
- CV Analysis: text-based PDFs only (no OCR), basic prompt injection sanitization

### Hardcoded Values
- SiteJob Connect URLs hardcoded in edge functions
- Meta Graph API version: `v25.0`
- CV text cap: 15,000 chars
- Campaign batch size: 50 recipients

### Missing Features (Fase 2)
- Flexpedia API integration
- Google Calendar sync
- SEPA XML export
- Contract template engine with variables
- Digital signatures
- Transport GPS/kilometer registration
- Extended employee dossier (pension, vacation rights)

## Development Setup

### Environment Variables

**Frontend (in `.env`):**
- `VITE_SUPABASE_URL` — Supabase project URL
- `VITE_SUPABASE_ANON_KEY` — Supabase anon/public key

**Edge function secrets (Supabase Dashboard or CLI):**
- `OLLAMA_BASE_URL` — Hetzner VPS for LLM
- `OLLAMA_API_KEY` — LLM API key
- `KVK_API_KEY` — Chamber of Commerce API
- `APIFY_API_TOKEN` — Apify web scraping
- `EXA_API_KEY` — Exa people search

### Regenerate Types

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
- **LLM infra:** Hetzner VPS, Qwen3-14B via Ollama
