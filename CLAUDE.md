# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**SiteJob** — A multi-tenant staffing agency SaaS platform (uitzendbureau software). Built with Lovable, it covers recruitment, placement, payroll, timesheets, housing, transport, and employee self-service. The app is Dutch-language throughout.

## Commands

```bash
npm run dev          # Dev server on port 8080
npm run build        # Production build
npm run build:dev    # Development build
npm run lint         # ESLint
npm run test         # Vitest (single run)
npm run test:watch   # Vitest (watch mode)
npx vitest run src/test/example.test.ts  # Run a single test file
```

Edge functions are Deno/TypeScript and deploy via Supabase. They live in `supabase/functions/` and are configured in `supabase/config.toml` (JWT requirements per function).

## Architecture

### Three Authentication Zones

The app has three completely separate auth contexts with distinct layouts:

1. **Main App** (`/`) — `AuthContext` + `AppLayout` — recruiter/admin dashboard (30+ Dutch-path routes)
2. **Employee Portal** (`/portaal/`) — `PortalContext` + `PortalLayout` — self-service for placed workers
3. **Superadmin** (`/superadmin/`) — `SuperAdminContext` + `SuperAdminLayout` — multi-tenant management

Public routes (onboarding, contract signing, candidate profile, registration) use token-based auth, no login required.

**Context details:**
- `useAuth()` provides `{ session, user, profile, loading, signOut }` — profile includes `organization_id` and `role`
- `usePortal()` provides `{ session, profile, employee, candidate, loading, signOut }` — `employee` and `candidate` both point to the same candidates row
- `useSuperAdmin()` checks the `superadmins` table for user presence (no role field)

### Tech Stack

- **Frontend**: React 18 + TypeScript, Vite (SWC), React Router v6, TanStack Query, React Hook Form + Zod
- **UI**: shadcn/ui (Radix) + Tailwind CSS, dark/light mode, Sonner toasts, Recharts
- **Backend**: Supabase (PostgreSQL + Auth + Edge Functions + Realtime + Storage)
- **PWA**: Vite Plugin PWA, standalone mode
- **Testing**: Vitest + Testing Library + jsdom (minimal test coverage currently — only a placeholder test exists)

### Data Layer

- Supabase client initialized in `src/integrations/supabase/client.ts`
- Auto-generated types in `src/integrations/supabase/types.ts` (~197KB) — never hand-edit, regenerate with `supabase gen types typescript`
- Server state via TanStack Query + Supabase PostgREST
- Path alias: `@/*` maps to `./src/*`

### Multi-Tenancy

All data is scoped by `organization_id`. RLS policies enforce tenant isolation. The `useOrganizationId` hook provides the current org context. **Warning:** `useOrganizationId` throws if no org ID exists — never call it outside AuthProvider-wrapped routes (not in portal or superadmin contexts).

### Candidates = Employees (Merged Model)

Candidates and employees share the single `candidates` table. The portal's `employee` field is an alias for the candidates row. The `/medewerkers` pages in the main app also operate on the candidates table.

### Sensitive Data Encryption

Database triggers encrypt sensitive fields (BSN, IBAN, webhook secrets, access tokens) on write using Supabase Vault. **Never read encrypted columns directly.** Use:
- `useDecryptedCandidate()` / `useMyDecryptedData()` hooks (call `get_candidate_decrypted` / `get_my_sensitive_data` RPCs)
- `get_whatsapp_token` / `get_exact_token` RPCs in edge functions

### Per-Org Branding

`src/lib/branding.ts` applies white-label branding at runtime via CSS custom properties on `document.documentElement`. Configurable: accent color, sidebar colors, background, card, heading, border radius.

### Audit Logging

`logAudit()` from `src/lib/audit.ts` records changes with `{ action, tableName, recordId, oldValues?, newValues?, reason? }`. It silent-fails (never throws).

### External Integrations

| Service | Edge Functions | Purpose |
|---------|---------------|---------|
| Exact Online | `exact-api`, `exact-webhook`, `exact-register`, `exact-config` | ERP/accounting sync |
| WhatsApp Business | `whatsapp-send`, `whatsapp-webhook`, `whatsapp-register`, `whatsapp-config` | Messaging |
| Apify | `apify-job-import` | Job scraping |
| Exa | `exa-people-search` | People search/enrichment |

### Edge Function Auth Pattern

In `supabase/config.toml`, functions are either `verify_jwt = true` (authenticated) or `verify_jwt = false` (public/webhook). Five functions (`analyze-cv`, `analyze-cv-callback`, `generate-invoice-pdf`, `kvk-lookup`, `rdw-lookup`) have no config entry and implicitly default to JWT-required.

Auth helper pattern used across edge functions:
```typescript
const authHeader = req.headers.get("Authorization");
const { data: { user } } = await supabaseClient.auth.getUser(authHeader.replace("Bearer ", ""));
```

### Key UI Patterns

- **SlideOver panels** for entity detail views (candidates have 7 tabs, companies have 7 tabs)
- **Wizard flows** for multi-step operations (campaigns, onboarding)
- **Feature flags** via `useModuleEnabled` hook (checks org overrides → subscription plan → defaults to true)

### TypeScript Config

The project uses relaxed TypeScript settings: `noImplicitAny: false`, `strictNullChecks: false`, `no-unused-vars: off`. Don't tighten these without explicit request.

## Dutch Terminology

Routes and UI use Dutch. Key mappings:
- kandidaten = candidates, opdrachtgevers = companies/clients, medewerkers = employees
- vacatures = vacancies, plaatsingen = placements, uren = timesheets
- facturatie = invoicing, huisvesting = housing, instellingen = settings
- kennisbank = knowledge base, loonstroken = payslips, uitstroom = attrition/offboarding
