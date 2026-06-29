# AGENTS.md

Instructiebestand voor coding-agents (Codex, Claude Code, e.a.) op de **JA Werkt** codebase.
Codex laadt dit bestand automatisch; **CLAUDE.md wordt door Codex níét automatisch gelezen** — de dragende
conventies staan daarom hieronder. Lees [CLAUDE.md](CLAUDE.md) voor de volledige, canonieke diepte (schema,
RPC's, ~60 edge functions, integraties) en [HANDOVER_SESSION.md](HANDOVER_SESSION.md) voor de actuele WIP-stand.

## Wat is dit

Multi-tenant SaaS voor uitzendbureau **JA Werkt** (arbeidsmigranten, Brabant/Limburg). Consolideert legacy
(Carerix, Joboti, Umanga, OnTrack, Q8, Buddy); Flexpedia blijft externe loonmotor.
**Stack:** React 18 + TypeScript + Vite (SWC) · Supabase (Postgres/Auth/Edge Functions/Realtime/Storage) ·
TanStack Query v5 · shadcn/ui + Tailwind · Vitest + Playwright · PWA.
**Kernflow:** kandidaat → in dienst → matching (regel-gebaseerd) → voorstel + publieke reactiepagina →
plaatsing-popup → uren → facturatie. Daarnaast huisvesting, transport, communicatie, onboarding, 4 auth-zones.

- **Supabase project:** `noaupcteygfvlyymqtew`  ·  **Repo:** `sitejob-nl/ja-works-hub`  ·  **Frontend:** Vercel (`ja-works-hub.vercel.app`)
- **Dutch-first domein:** zie de terminologietabel onderaan CLAUDE.md (kandidaten/opdrachtgevers/medewerkers/vacatures/plaatsingen/uren/huisvesting…).

## Eerste stap van élke sessie

```bash
git fetch origin main          # lokale main/branches lopen vaak ver achter
git switch -c <feature> origin/main   # branch ALTIJD vanaf origin/main, niet vanaf een stale lokale branch
```

> ⚠️ **Werk nooit rechtstreeks op een stale checkout.** `main` is eerder gebroken door parallelle sessies, en
> deployen vanaf een achtergebleven tree kan oudere edge-function-versies over nieuwere heen zetten. Een aparte
> git worktree per sessie is de norm. PR's via `gh pr create` / `gh pr merge`.

## Commands

```bash
npm run dev          # dev server :8080 (valt terug op :8081)
npm run build        # productie build
npm run typecheck    # TS app + node configs — dekt GEEN Deno edge functions
npm run lint         # ESLint over src/ ÉN supabase/functions/ (CI-gate; alleen errors falen)
npm run test         # Vitest unit (single run)
npm run test:e2e     # Playwright e2e
deno check supabase/functions/<naam>/index.ts   # edge functions los type-checken
```

**CI `quality`-gate = lint + typecheck + build + vitest.** Een edge-function lint-error (bv. `prefer-const`)
laat CI vallen ook al dekt `npm run typecheck` Deno niet — draai dus de volledige `npm run lint` vóór een PR.

## Conventies die bijten (lees vóór je iets verandert)

- **DB & edge functions via Supabase MCP/CLI** (project `noaupcteygfvlyymqtew`): `apply_migration`,
  `deploy_edge_function`, `get_advisors` ná elke DDL. Er is **geen** edge-/migratie-CI — **alleen de frontend
  deployt automatisch via Vercel bij merge**. Edge functions + migrations deploy je handmatig. Behandel
  `merge + supabase functions deploy` als één stap, anders loopt productie-runtime achter op `main`.
- **Edge functions met `_shared/`-imports → deploy via de CLI**: `supabase functions deploy <naam> --project-ref noaupcteygfvlyymqtew`
  (bundelt `_shared/*.ts` automatisch + leest `verify_jwt` uit `config.toml`). De MCP-deploytool vereist dat je
  élk `_shared`-bestand handmatig opsomt en default `verify_jwt=true` — voor de self-auth-functies expliciet `false` zetten.
- **`src/integrations/supabase/types.ts` is auto-generated en kan stale zijn** — verifieer het live schema
  (`list_tables`) vóór schema-werk; **nooit handmatig editen**. Regenereren via MCP of
  `npx supabase gen types typescript --project-id noaupcteygfvlyymqtew`.
- **Matching is regel-gebaseerd, géén LLM** — kern in `supabase/functions/_shared/matching-core.ts → scoreMatch()`,
  gedeeld door `calculate-match` / `rank-candidates` / `rank-vacancies`. Pas dáár aan, niet per functie.
  Unit-tests: `src/test/matching.test.ts`.
- **Uitgaande communicatie heeft een kill-switch** (`_shared/outbound-pause.ts`): elk nieuw e-mail-/WhatsApp-sendpad
  moet `isOutboundPaused()` respecteren (geblokkeerd = als concept loggen in `communications`, niet stil weggooien),
  anders lekt het er langs.
- **Transactionele mail door de merk-wrapper**: `_shared/email-layout.ts → renderBrandedEmail()`. Senders bouwen
  alléén de body en wrappen die (`senderName: null`). Outlook-verzending loopt via `_shared/outlook-send.ts` /
  `outlook-send-mail` (de echte fn-namen; oudere docs noemen `send-*` varianten).
- **Encrypted kolommen nooit direct SELECTen** (`candidates.bsn/iban`, `whatsapp_config`/`exact_config` tokens,
  Carerix-tokens) — gebruik de decrypt-RPC's (`get_candidate_decrypted`, `get_my_sensitive_data`,
  `get_whatsapp_token`, `get_exact_token`, `get_carerix_token`).
- **RLS & autorisatie**: `is_internal_user()` = `admin|intercedent|backoffice|finance` (portal-rollen
  `medewerker`/`opdrachtgever` bewust uitgesloten). Nieuwe org-brede policy op een tenant-tabel → gate met
  `AND is_internal_user()`; laat portal-toegang via eigen self-policies lopen. **SECURITY DEFINER write-RPC's
  mogen niet `anon`-uitvoerbaar zijn.** Verifieer policy-namen tegen de live DB vóór een `DROP POLICY` (verkeerde
  naam = stille no-op die het gat openlaat). Maak DDL idempotent.
- **Data-fetching-conventie (sinds tech-debt programma #111-120)**: server-state via TanStack Query met de
  gedeelde query-key helper (`qk`) + `unwrap`; er is een ESLint-**warn**-guard tegen rauwe supabase-boilerplate.
  Volg dit patroon in nieuwe/aangeraakte data-code i.p.v. ad-hoc fetches.
- **Foutafhandeling & headers**: gebruik de bestaande primitieven — `PageHeader` (#97), `toFriendlyError`/`ErrorState`
  (#98) — i.p.v. ad-hoc varianten.
- **TypeScript-config is bewust relaxed** (`noImplicitAny:false`, `strictNullChecks:false`) — **niet aanscherpen
  zonder expliciet verzoek.** Pad-alias `@/*` → `./src/*`.
- **Kandidaat = medewerker**: `candidates` is source of truth; `employees` is legacy. `notes`/`recruiter_tasks`
  zijn polymorf via `related_entity_type` + `related_entity_id` (géén `candidate_id`).

## Observability

Sentry frontend is live (#120), **env-gated en PII-veilig** (replay + tracing bewust UIT i.v.m. AVG). Activeert
alleen als de `VITE_SENTRY_*` env-vars gezet zijn (Vercel PROD). Lokaal geen Sentry-noise.

## Documentatiekaart

| Bestand | Doel |
|---------|------|
| `AGENTS.md` | Dit bestand — harde conventies + commands voor agents. |
| `CLAUDE.md` | Canonieke, diepe codebase-guidance (schema, RPC's, alle edge functions, integraties). |
| `HANDOVER_SESSION.md` | Actuele WIP-snapshot + volgende acties (lees als eerste bij hervatten). |
| `HANDOVER.md` | Formele projectsamenvatting voor de klant. |
| `docs/handover-deep.md` | Diepe technische rondleiding (live schema, triggers, cron, env vars, deployment). |
| `docs/open-gaps.md` | Levende lijst open klant-/meetingpunten (decayt snel). |
