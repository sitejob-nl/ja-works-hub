# JA Werkt — Handover Document

**Datum:** 5 juni 2026
**Project:** JA Werkt — multi-tenant staffing platform
**Klant:** JA Werkt, Jeroen Adriaans (Mierlo)
**Developer:** Kas (kas@sitejob.nl), SiteJob
**Repo:** `sitejob-nl/ja-works-hub`
**Supabase project:** `noaupcteygfvlyymqtew`
**Workspace branch:** `main`

---

## 1. Project in het kort

JA Werkt is een SaaS-platform voor een uitzendbureau gespecialiseerd in arbeidsmigranten in Brabant/Limburg. Het platform consolideert onder meer Carerix, Joboti, Umanga, OnTrack, Q8 en Buddy; Flexpedia blijft vooralsnog externe loonmotor.

**Stack:** React 18 + TypeScript + Vite, Supabase (Postgres/Auth/Edge Functions/Storage/Realtime), TanStack Query, shadcn/ui + Tailwind, Vitest, Playwright, PWA.

**Belangrijkste domeinen:** kandidaten/medewerkers, opdrachtgevers/contacten, vacatures, matching, plaatsingen, uren, facturatie, huisvesting, transport, communicatie, onboarding, medewerkerportaal, klantportaal en superadmin.

---

## 2. Architectuurkern

- **Kandidaat = medewerker:** `candidates` is de source of truth; `employees` is legacy.
- **Plaatsing als knooppunt:** `placements` verbindt kandidaat, opdrachtgever, vacature, huisvesting, voertuig en payroller.
- **Payroller op plaatsing:** `flexpedia`, `brioworks`, `bromida`, `retiva`; JA Werkt factureert niet voor Flexpedia.
- **Multi-tenant:** data is gescoped op `organization_id`; RLS bewaakt tenant-isolatie.
- **Sensitive data:** BSN, IBAN en tokens/secrets via Supabase Vault/triggers; gebruik decrypt-RPCs, selecteer encrypted velden niet direct.

### Auth zones

| Zone | Pad | Context/hook | Doel |
|------|-----|--------------|------|
| Main app | `/` | `AuthContext` / `useAuth()` | Intercedenten, backoffice, finance, admin |
| Medewerkerportaal | `/portaal/*` | `PortalContext` / `usePortal()` | Medewerkers: uren, documenten, profiel, ziekmelding |
| Klantportaal | `/klantportaal/*` | `ClientPortalContext` | Opdrachtgevers: plaatsingen en uren-goedkeuring |
| Superadmin | `/superadmin/*` | `SuperAdminContext` / `useSuperAdmin()` | Cross-tenant beheer |

Public token-routes omvatten o.a. `/onboarding/:token`, `/contract/sign/:token`, `/profiel/:token`, `/match/reageer/:token`, `/solliciteren/:slug`, portalactivatie en klantportaalactivatie.

---

## 3. Actuele productlijn

De **juni-lijn blijft leidend**:

- Portal-i18n en portaal-taalkeuze blijven behouden.
- AI kandidaatdossier-analyse blijft behouden; Gemini is gewenst als goedkope analyseprovider.
- UX-primitieven en klikbare deep-links blijven behouden.
- 27-05 kandidaatvelden blijven behouden: EU/NL telefoon, ICE-contact, Nederlands-adres-vlag.
- Carerix enrichment blijft behouden: employee number, BSN, nationaliteit en talen.
- Matching v3 blijft behouden: whole-pool ranking en gedeelde matching-core.

Deze beurt is de eerdere rollback-achtige dirty code teruggezet naar de committed juni-lijn. Zie `HANDOVER_SESSION.md` voor de actuele WIP.

---

## 4. Nieuwe WIP: geocode-backfill

Nieuwe edge function:

```text
supabase/functions/geocode-backfill/index.ts
```

Doel: kandidaten en bedrijven zonder coördinaten via PDOK geocoderen. De function is bewust voorzichtig bij rommelige adressen:

- combineert losse adresvelden tot één zoekquery;
- verwerkt alleen adressen met herkenbare NL-postcode;
- probeert adresniveau en valt terug op postcode-centroid;
- valideert de eerste 4 postcodecijfers tegen het PDOK-resultaat;
- ondersteunt `dry_run`, `max` en self-triggering bij soft deadline.

`supabase/config.toml` bevat hiervoor:

```toml
[functions.geocode-backfill]
verify_jwt = false
```

Er is geen migration nodig; de coördinaatkolommen bestaan al.

---

## 5. Verificatie

Groen op 2026-06-05:

```bash
git diff --check
npm run typecheck
npm run test
npm run build
npm run lint
deno check supabase/functions/analyze-cv/index.ts supabase/functions/analyze-cv-batch/index.ts supabase/functions/analyze-cv-callback/index.ts supabase/functions/rank-candidates/index.ts supabase/functions/geocode-backfill/index.ts
```

`npm run lint` exit groen, maar toont bestaande warnings, vooral React Hook/Fast Refresh warnings en ruis uit `.claude/worktrees`.

---

## 6. Documentatiekaart

| Bestand | Doel |
|---------|------|
| `AGENTS.md` | Korte pointer naar `CLAUDE.md` en actuele session handover. |
| `CLAUDE.md` | Stabiele codebase-guidance: architectuur, commands, schema/integratiepatronen, Supabase workflow. |
| `HANDOVER_SESSION.md` | Actuele WIP snapshot en volgende acties. |
| `docs/open-gaps.md` | Levende lijst open klant-/meetingpunten t/m 2026-05-27. |
| `docs/ux-design-2026-06-03.md` | Nieuwe UX-roadmap/spec; nog untracked tenzij bewust toegevoegd. |
| `docs/handover-deep.md` | Diepe technische rondleiding: schema, RLS, RPCs, triggers, cron, edge functions. |
| `docs/carerix-integratie-audit.md` | Carerix productie-importstatus en resterende risico's. |

---

## 7. Directe aanbeveling

1. Test `geocode-backfill` eerst met `dry_run: true` en kleine `max`.
2. Commit docs en geocode gesplitst.
3. Houd `test vacatures/*.docx` voorlopig buiten git; ze zijn bedoeld om mee te testen.
4. Deploy `geocode-backfill` pas na dry-run-validatie via Supabase MCP/CLI.
