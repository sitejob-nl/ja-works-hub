# JA Werkt — Architecture Audit & Refactoring Plan

**Date:** 2026-06-15
**Scope:** full codebase (399 `src` TS/TSX files · 76 edge functions · 96 migrations)
**Branch audited:** `matching-stage2-gemini-rerank`
**Constraint:** recommendations upgrade quality / scalability / maintainability only — no functionality change. All proposed code is additive and adoptable file-by-file.

> **Method.** Reverse-engineered by reading the code directly (App shell, contexts, `_shared/auth.ts`, a representative edge function, a god-component, query hooks, build config) plus quantitative sweeps across the whole repo. A multi-agent verification pass was partially throttled by a transient platform rate limit; the surviving completeness-critic agent measured the repo directly and its numbers are folded in. Every claim below has a `file:line` or a counted `grep` behind it.

---

## 1. The system, reverse-engineered

**Shape:** a single-page React 18 + Vite PWA talking to Supabase (Postgres + Auth + 76 Deno edge functions + Storage + Realtime). There is no backend-of-our-own; **PostgREST + RLS is the API**, and edge functions are the "verbs" (AI, messaging, integrations, cron). Flexpedia stays external for payroll.

**Four auth zones**, one provider + layout each: main app (`AuthContext`), employee portal (`PortalContext`), client portal (`ClientPortalContext`), superadmin (`SuperAdminContext`). Public flows are token-based (no provider).

### Complete data flow

```
                    ┌─────────────────────────── BROWSER (SPA, one 3.4MB bundle) ──────────────────────────┐
                    │  React Router (106 eager imports, 0 lazy)                                            │
   user action ───► │  Page/Component ──► useQuery/useMutation (TanStack)                                  │
                    │        │                   │                                                          │
                    │        │ 70× functions.invoke         │ 369× supabase.from() inline                  │
                    └────────┼───────────────────┼──────────┼──────────────────────────────────────────────┘
                             ▼                    ▼          ▼
                    ┌─────────────────┐   ┌──────────────────────────────┐
                    │ Edge Functions  │   │   Supabase PostgREST          │
                    │ (Deno, self-auth│   │   + RLS (org_id isolation)    │
                    │  verify_jwt=    │   │                               │
                    │  false)         │   └──────────────┬────────────────┘
                    │  • AI dossier   │                  ▼
                    │  • matching     │          ┌───────────────┐   Vault triggers encrypt BSN/IBAN/tokens
                    │  • WhatsApp/    │◄────RPC───┤  PostgreSQL   │   (decrypt via get_*_decrypted RPCs)
                    │    Exact/Carerix│          │  92 tables    │
                    │  • cron (4 jobs)│          └───────────────┘
                    └────────┬────────┘                  ▲
                             ▼                            │
                    External: Meta Graph v25, Exact OData, Carerix, Outlook, Voys, Gemini/Anthropic/Ollama VPS
```

Three write paths into Postgres: **(a)** the SPA directly via PostgREST (RLS-gated), **(b)** edge functions via the service-role client (RLS-bypassing — they must self-enforce org scope), **(c)** webhooks/cron. The security model leans entirely on RLS for (a) and on *correctly-written* edge code for (b). That asymmetry is the root of several findings below.

---

## 2. Critical problem areas (the five dimensions)

### 2.1 Bad architecture decisions

| # | Decision | Evidence | Why it's wrong |
|---|---|---|---|
| A1 | **No data-access layer.** The SPA reaches straight through `supabase.from()` from inside components. | **227** files import the client; **369** `supabase.from(` sites; **329** `useQuery` sites. | Business logic, tenant scoping, column selection, and error handling are smeared across the UI. Nothing is reusable or unit-testable; the DB schema is coupled to JSX. |
| A2 | **Bifurcated, half-migrated edge auth.** A good shared helper exists (`_shared/auth.ts:53` `getAuthenticatedProfile`) but most functions ignore it. | **20** functions import `_shared/auth.ts`; **35** still inline `auth.getUser`; **56** hand-roll CORS. See `generate-notifications/index.ts:1-37` creating *two* clients and re-implementing auth. | 35 independent places to get tenant isolation wrong on the RLS-bypassing service path. This is the 2026-06-10 security audit's cross-tenant class of bug (e.g. `send-portal-invite`). |
| A3 | **`sessionStorage` auth + a `localStorage` wipe on every client load**, plus a `setTimeout(0)` profile-fetch race. | `client.ts:11-17`, `AuthContext.tsx:71-79`. | Session dies on tab close (UX), and the `setTimeout(0)` "deadlock avoidance" means `profile` is briefly null after `session` is set — every consumer must guard for it, and many don't. |
| A4 | **No bundle/route splitting** in a PWA. | `App.tsx` = 106 static imports, **0** `lazy()`; `vite.config.ts` has no `manualChunks`; PWA cache bumped to **8 MB** (`vite.config.ts:21`); prod ships a **3.4 MB** monolith + 960 KB `html2pdf`. | Every user downloads superadmin, all three portals, `pdfjs-dist`, `tesseract.js`, the spreadsheet libs, `recharts`, and `tiptap` on first paint. For a mobile-first labor-migrant audience this is the single highest-leverage defect. |
| A5 | **Two scoring authorities forming on the live branch.** | `_shared/matching-core.ts` (the documented single source) vs the new `_shared/gemini-rerank.ts` + `rerank-matches/` + an **uncommitted** migration `20260612120000_match_rerank_cache.sql`. | Architectural drift in-flight: risk of the deterministic and the LLM rerank paths diverging, with a migration sitting un-applied in the worktree. |

### 2.2 Duplicate logic

- **The query boilerplate, ~329×.** Every read repeats `const { data, error } = await supabase…; if (error) throw error; return data ?? []`. `TimesheetEntrySheet.tsx:41-95` does it **5 times in one component**.
- **Error→toast, ~922 toast calls**, each re-deriving a message from `error`. No `toastError(err)` helper.
- **Manual tenant scoping, 324×.** `organization_id` is threaded by hand through component queries instead of being structurally guaranteed.
- **Edge CORS + OPTIONS + `{ error: message }` envelope** copy-pasted into ~56 functions (`generate-notifications/index.ts:3-11` is the canonical copy), and the service-role client constructed ad hoc despite `_shared/auth.ts:14` `createAdminClient`.
- **Bespoke OAuth/token-refresh/HTTP clients** re-rolled per integration (WhatsApp / Exact / Carerix / Outlook each have their own), instead of one external-API client with pluggable auth.
- A literal copy-paste tell: `generate-notifications/index.ts:102` — `type: isExpired ? 'document_verlopen' : 'document_verlopen'` (both branches identical).

### 2.3 Performance bottlenecks

- **A4's monolithic bundle** is the headline (time-to-interactive on mobile).
- **N+1 inside single edge invocations.** `generate-notifications:182-209` loads *all* candidates with a DOB (no limit), then does **one `exists()` SELECT + one INSERT per candidate** in a loop. O(candidates) round-trips per cron tick; degrades linearly with org size.
- **Client-side heavy compute.** `FuelCardAnalysis.tsx` (1,552 lines, 12 `useMemo`, 11 `supabase.` calls) and the mileage/dedup pages crunch potentially large transaction sets in the render thread; CSV/Excel parsing runs on the main thread (`papaparse`, `read-excel-file`).
- **Cache thrash from coarse invalidation.** Mutations fire `qc.invalidateQueries({ queryKey: ['candidates'] })` / `['communications']` / `['notifications']` in bulk (the lead-funnel mutation invalidates 6 broad keys), refetching far more than changed.
- God-components recompute derived state in render with no memo boundaries.

### 2.4 Scalability risks

- **Whole-pool matching in one request.** `rank-candidates` scores the entire candidate pool for a vacancy per invocation; layered with Gemini rerank (~€0.12/vacancy) this is an O(candidates) cost-and-latency cliff per org growth, with the cache table still uncommitted.
- **Unbounded edge loops** (above) have no pagination/queue — a cron tick's work grows with tenant data inside a single 300 s function budget.
- **RLS performance.** 42/96 migrations touch policies; per-row policy subqueries (`get_user_org_id()` et al.) without `STABLE`/indexed predicates get expensive on the big tables (`timesheets`, `communications`, `matches`, `candidates`). `get_advisors` (security + performance) appears never run on this branch.
- **No pagination** on several large-table list pages (invoices, fuel transactions, communications) — they pull and render full result sets.

### 2.5 Maintainability issues

- **Type-safety erosion:** **878** `: any` + **488** `as any` casts route around a 9,672-line generated `types.ts`. The relaxed tsconfig (`strictNullChecks:false`, `noImplicitAny:false`) is deliberate, but the casts concentrate at the DB boundary where the types are *best*.
- **Inverted test pyramid:** **11** unit-test files (pure `lib/` only) for 399 source files; **zero** edge-function or component tests; the 14 Playwright specs live in `scripts/`, not `tests/e2e/` as docs claim — the highest-risk code (auth, PII decrypt, payments, webhooks) is the least tested.
- **Zero in-app observability:** no Sentry/PostHog/OTel dependency in `package.json`; error capture is a homegrown `client_errors` table surfaced only in `SuperAdminErrors.tsx`; edge functions log to bare `console`.
- **19 components > 500 lines** (Vacaturebank 1,695 / FuelCardAnalysis 1,552 / CarerixImport 1,164 / CandidateScreeningTab 850) mixing fetch + business logic + derived state + render.
- **Reproducibility risk:** four lockfiles coexist (`bun.lock`, `bun.lockb`, `package-lock.json`, `deno.lock`) with **no `packageManager` field** — npm and bun can resolve different trees in CI vs locally.

---

## 3. Clean target architecture

```
src/
  integrations/supabase/   client.ts, types.ts            (generated — untouched)
  lib/
    db.ts            ← unwrap()/unwrapList()/toastError()  (kills 329 boilerplate + 922 toast dups)
    query-keys.ts    ← qk.* tenant-safe key factory        (one source of truth for the cache)
    org-scope.ts     ← useOrgQuery()                        (org scoping is structural, not manual)
    <domain>.ts      ← PURE business logic (computeFuelAnalysis already shows the pattern)
  data/                                                     (NEW, optional next step)
    candidates.ts    ← typed repository fns: listCandidates(orgId), getCandidate(id)…
  hooks/             ← thin data hooks wrapping data/ + qk
  components|pages/  ← presentational + orchestration only  (target < 300 lines)

supabase/functions/
  _shared/
    auth.ts          (exists — getAuthenticatedProfile, createAdminClient, jsonResponse)
    http.ts    ← NEW: CORS_HEADERS, serveEdge() wrapper      (dedups CORS+OPTIONS+try/catch ×56)
    external/  ← NEW: one HTTP client w/ pluggable OAuth      (collapses WhatsApp/Exact/Carerix/Outlook)
  <fn>/index.ts      ← compose _shared, no copy-paste plumbing
```

Principle: **components orchestrate, hooks fetch, `lib/` computes, `data/` queries, RLS authorizes.** The DB shape stops leaking into JSX.

---

## 4. Refactoring strategy (staged, behavior-preserving)

The golden rule for "no functionality change": **new keys keep the existing leading token** so TanStack's prefix-matching invalidations (`['timesheets']`, `['candidates']`) keep hitting them unchanged.

1. **Foundations (additive, zero call-site churn):** drop in `lib/db.ts`, `lib/query-keys.ts`, `lib/org-scope.ts`, `_shared/http.ts`. Nothing references them yet → nothing changes.
2. **Mechanical migration, file-by-file:** replace inline query boilerplate with `unwrapList()` + `qk.*`. Pure substitution, same data/key-prefix/`staleTime`. Land per-domain behind review.
3. **Edge convergence:** wrap each function in `serveEdge()` and swap inline client creation for `createAdminClient()`. Auth *semantics* unchanged (keep each function's existing auth; converging the 35 inline ones onto `getAuthenticatedProfile` is a separate, behavior-affecting hardening PR — flag it, don't sneak it).
4. **Build wins (safe, big):** route `lazy()` + `manualChunks`. Same routes render; only load timing changes.
5. **God-component carve-out:** extract data hooks + pure logic (follow the existing `computeFuelAnalysis` precedent), leave render identical.
6. **Hygiene:** add `"packageManager"`, delete dead lockfiles, run `get_advisors`, commit the rerank migration, wire one error tracker.

---

## 5. Improved production-grade code

All additive. Matches repo conventions (sonner, `@/` alias, generated `Database` types, Deno `esm.sh`). No behavior change.

### 5.1 `src/lib/db.ts` — typed unwrap + standardized errors

```ts
import { toast } from 'sonner';
import type { PostgrestError } from '@supabase/supabase-js';

/**
 * Resolve a PostgREST builder, throw on error, return typed data.
 * Replaces the ~329 hand-written `if (error) throw error; return data ?? []` blocks.
 */
export async function unwrap<T>(
  builder: PromiseLike<{ data: T | null; error: PostgrestError | null }>,
): Promise<T> {
  const { data, error } = await builder;
  if (error) throw error;
  return data as T;
}

/** List variant: returns [] (never null), matching the prevailing `?? []` idiom. */
export async function unwrapList<T>(
  builder: PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
): Promise<T[]> {
  const { data, error } = await builder;
  if (error) throw error;
  return data ?? [];
}

/** Single standard place to turn an unknown error into a Dutch toast. */
export function toastError(error: unknown, fallback = 'Er ging iets mis'): void {
  const message =
    error instanceof Error ? error.message :
    typeof error === 'string' ? error : fallback;
  toast.error(message || fallback);
}
```

### 5.2 `src/lib/query-keys.ts` — tenant-safe key factory

```ts
/**
 * Single source of truth for TanStack query keys.
 * RULE: tenant-scoped data ALWAYS carries orgId so caches can't collide across orgs.
 * RULE: the FIRST segment is preserved from today's ad-hoc keys, so existing prefix
 *       invalidations (e.g. invalidateQueries(['timesheets'])) keep matching — no behavior change.
 */
export const qk = {
  candidates: {
    all: (orgId: string) => ['candidates', orgId] as const,
    list: (orgId: string, filters: Record<string, unknown> = {}) =>
      ['candidates', orgId, 'list', filters] as const,
    detail: (id: string) => ['candidate', id] as const,
  },
  timesheets: {
    all: (orgId: string) => ['timesheets', orgId] as const,
    list: (orgId: string, filters: Record<string, unknown> = {}) =>
      ['timesheets', orgId, 'list', filters] as const,
  },
  placements: {
    forEmployee: (employeeId: string) => ['placements-for-employee', employeeId] as const,
    hourTypes:   (placementId: string) => ['placement-hour-types', placementId] as const,
    travelTypes: (placementId: string) => ['placement-travel-types', placementId] as const,
    allowances:  (placementId: string) => ['placement-allowances', placementId] as const,
  },
  // …extend per domain as files are migrated.
} as const;
```

### 5.3 `src/lib/org-scope.ts` — org scoping you can't forget

```ts
import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { useOrganizationId } from '@/hooks/useOrganizationId';

/**
 * Tenant-scoped query: orgId is resolved once and handed to BOTH the key and the fetcher,
 * so a component physically cannot issue a tenant query without scoping it.
 */
export function useOrgQuery<T>(
  keyFor: (orgId: string) => readonly unknown[],
  queryFn: (orgId: string) => Promise<T>,
  options?: Omit<UseQueryOptions<T, Error, T, readonly unknown[]>, 'queryKey' | 'queryFn'>,
) {
  const orgId = useOrganizationId();
  return useQuery({ queryKey: keyFor(orgId), queryFn: () => queryFn(orgId), ...options });
}
```

**Before / after** — `TimesheetEntrySheet.tsx:62-70`:

```ts
// BEFORE — 9 lines, ad-hoc key, hand-rolled error handling
const { data: hourTypes = [] } = useQuery({
  queryKey: ['placement-hour-types', placementId],
  queryFn: async () => {
    const { data, error } = await supabase.from('placement_hour_types')
      .select('*').eq('placement_id', placementId).order('sort_order');
    if (error) throw error;
    return data ?? [];
  },
  enabled: !!placementId,
});

// AFTER — same key prefix, same data, same default []; boilerplate gone
const { data: hourTypes = [] } = useQuery({
  queryKey: qk.placements.hourTypes(placementId),
  queryFn: () => unwrapList(
    supabase.from('placement_hour_types').select('*').eq('placement_id', placementId).order('sort_order'),
  ),
  enabled: !!placementId,
});
```

### 5.4 `supabase/functions/_shared/http.ts` — kill the CORS/OPTIONS/try-catch copy-paste

```ts
import { jsonResponse } from './auth.ts';

/** One CORS policy for every function (matches today's hand-rolled headers exactly). */
export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Handler = (req: Request) => Promise<Response>;

/**
 * Wrap a handler with CORS preflight + the uniform `{ error: message }` / 400 envelope
 * already used across the codebase. Behavior-identical; just no longer copy-pasted.
 */
export function serveEdge(handler: Handler): Handler {
  return async (req) => {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
    try {
      return await handler(req);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Onbekende fout';
      return jsonResponse({ error: message }, 400, CORS_HEADERS);
    }
  };
}
```

**Before / after** — the top of `generate-notifications` collapses from ~37 lines of plumbing to the following, with **identical** auth semantics and response shapes (the only change is reusing `createAdminClient()` and dropping duplicated CORS/try-catch):

```ts
import { serveEdge, CORS_HEADERS } from '../_shared/http.ts';
import { createAdminClient } from '../_shared/auth.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(serveEdge(async (req) => {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) throw new Error('No auth header');

  const supabase = createAdminClient();                      // was: inline createClient(...SERVICE_ROLE_KEY)
  const { data: { user } } = await createClient(             // unchanged: same anon-client getUser semantics
    Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  ).auth.getUser();
  if (!user) throw new Error('Unauthorized');

  // …unchanged notification body…

  return new Response(JSON.stringify({ created }), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}));
```

> The N+1 insert loop and the `: 'document_verlopen'` copy-paste are separately fixable (batch the inserts, pre-fetch `exists` in one query) but that touches behavior/ordering, so land it as its own PR — not under "no functionality change."

### 5.5 Build: route-splitting + vendor chunks (huge, safe)

```ts
// vite.config.ts — add to defineConfig(...)
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        'pdf-ocr':     ['pdfjs-dist', 'tesseract.js'],
        'spreadsheet': ['papaparse', 'read-excel-file', 'write-excel-file'],
        'charts':      ['recharts'],
        'editor':      ['@tiptap/react', '@tiptap/starter-kit', '@tiptap/pm'],
        'pdf-export':  ['html2pdf.js'],
      },
    },
  },
},
```

```tsx
// App.tsx — keep Login + layouts eager; lazy the ~100 route pages
import { lazy, Suspense } from 'react';
const Vacaturebank      = lazy(() => import('@/pages/Vacaturebank'));
const FuelCardAnalysis  = lazy(() => import('@/pages/FuelCardAnalysis'));
// …

<Suspense fallback={<div className="p-8 text-muted-foreground">Laden…</div>}>
  <Routes>{/* unchanged route table */}</Routes>
</Suspense>
```

Same routes, same render output — only load timing changes, and heavy libs leave the critical path (the 8 MB PWA cap can drop back to ~3 MB).

### 5.6 God-component carve-out (using the precedent already in the repo)

`FuelCardAnalysis.tsx` already delegates the verdict math to `lib/fuel-analysis.ts` (`computeFuelAnalysis`). Finish the job: move the remaining pure helpers (`coerceConditions`, `countWorkDays`, `dateInRange`, `displayPlate` — `FuelCardAnalysis.tsx:34-129`) into `lib/fuel-analysis.ts`, and lift the 4 `useQuery` + 11 `supabase.` calls into a data hook:

```ts
// src/hooks/useFuelCardData.ts  (NEW — pure extraction, identical queries)
import { useOrgQuery } from '@/lib/org-scope';
import { unwrapList } from '@/lib/db';
import { supabase } from '@/integrations/supabase/client';

export function useFuelTransactions(monthStart: string, monthEnd: string) {
  return useOrgQuery(
    (orgId) => ['fuel-card-transactions', orgId, monthStart, monthEnd] as const,
    (orgId) => unwrapList(
      supabase.from('fuel_card_transactions').select('*, vehicles(*)')
        .eq('organization_id', orgId)
        .gte('transaction_date', monthStart).lte('transaction_date', monthEnd),
    ),
  );
}
```

The page shrinks to orchestration + JSX; the logic becomes unit-testable (it already has `fuel-analysis.test.ts` to extend).

---

## 6. Prioritized backlog (impact × effort)

| Pri | Action | Dimension | Effort |
|----|--------|-----------|--------|
| 1 | Route `lazy()` + `manualChunks` (§5.5) | perf/scale | S |
| 2 | Land `db.ts` + `query-keys.ts`, migrate per-domain (§5.1-5.3) | dup/maint | M (incremental) |
| 3 | `_shared/http.ts` + converge the 56 CORS / 35 inline-auth fns (§5.4) | arch/dup/sec | M |
| 4 | Run `get_advisors` (security+perf); index `org_id`-filtered hot tables | scale/perf | S |
| 5 | Batch the N+1 edge loops (`generate-notifications` et al.) | perf/scale | S |
| 6 | Wire one error tracker (Sentry/PostHog) in app + edge | maint/ops | S |
| 7 | Carve the 19 >500-line components, starting Vacaturebank/FuelCard (§5.6) | maint | M |
| 8 | Commit the rerank migration; decide single-vs-dual scoring authority | arch | S |
| 9 | Add `packageManager`, delete dead lockfiles | maint/repro | XS |
| 10 | Edge-function unit tests (auth, PII decrypt, matching-core) | maint | M |

---

## 7. Net assessment

The foundations are genuinely solid — RLS multi-tenancy, Vault encryption + AVG-pseudonymization, a real single-source `matching-core`, the outbound kill-switch with concept-logging. The debt is concentrated and *mechanical*: missing seams (data layer, shared edge plumbing, query-key factory, code-splitting) rather than broken logic. That is the good kind of debt — every fix above is additive and behavior-preserving, adoptable file-by-file behind review.

**Related:** `docs/security-audit-2026-06-10.md` (6 HIGH findings — ingest into Pri 3/4).
