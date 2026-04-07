# JA Werkt — Handover Document

**Datum:** 7 april 2026
**Project:** JA Werkt — Multi-tenant Staffing Platform
**Klant:** JA Werkt, Jeroen Adriaans (Mierlo)
**Developer:** Kas (kas@sitejob.nl), SiteJob
**Repo:** `sitejob-nl/ja-works-hub` (branch: `main`)
**Supabase project:** `noaupcteygfvlyymqtew`

---

## 1. Wat is JA Werkt?

Een SaaS platform voor uitzendbureau JA Werkt, gespecialiseerd in arbeidsmigranten (PT, LT, PL) in Brabant/Limburg. Vervangt meerdere legacy-systemen (Carerix, Joboti, Umanga, OnTrack, Q8, Buddy). Flexpedia blijft als externe loonmotor.

**Tech stack:** React 18 + TypeScript + Vite, Supabase (Postgres + Auth + Edge Functions + Storage), TanStack Query, shadcn/ui + Tailwind, PWA.

**Omvang:** 57 pagina's, 77 DB-tabellen, 30 edge functions, 3 auth zones (main app, portaal, superadmin).

---

## 2. Architectuur in het kort

### Data-model
- **Kandidaat = Medewerker**: Eén `candidates` tabel, `employee_status` bepaalt of iemand in dienst is. Legacy `employees` tabel bestaat nog maar is niet meer leidend.
- **Plaatsing als knooppunt**: `placements` linkt candidate + company + vacancy + housing + vehicle + payroller.
- **4 payrollers**: Flexpedia (NL), BrioWorks (PT), Bromida (LT), Retiva — zit op plaatsing, niet op persoon.
- **Multi-tenant**: Alles gescoped op `organization_id`, RLS op alle 74+ tabellen.

### Auth zones
| Zone | Pad | Hook |
|------|-----|------|
| Main App | `/` | `useAuth()` |
| Medewerkerportaal | `/portaal/` | `usePortal()` |
| Superadmin | `/superadmin/` | `useSuperAdmin()` |

### Encryptie
BSN, IBAN, webhook secrets, tokens: versleuteld via Supabase Vault (DB triggers). Nooit direct lezen — gebruik `get_candidate_decrypted`, `get_whatsapp_token`, `get_exact_token` RPCs.

---

## 3. Wat is af (productierijp)

### Fase 0-5: Carerix-alignment (volledig gebouwd)
Commits `6489991` t/m `4e28be4`:
- **Fase 1**: Kandidaat/medewerker merge — één `candidates` tabel, `candidate_employment` voor dienstverbanden
- **Fase 2**: Notities + Taken systeem (polymorf, gekoppeld aan elke entiteit)
- **Fase 3**: Contactpersonen als first-class entity (multi-bedrijf junction table)
- **Fase 4**: Dashboards (time-to-hire, datakwaliteit, bronanalyse, activiteiten)
- **Fase 5**: Talentpools + geavanceerd zoeken (full-text search op CV)

### Sprint 0 — Security & Foundation
- RLS audit: alle 74 tabellen gecontroleerd
- RBAC: `useHasRole()` hook, sidebar filtert per rol, medewerker redirect naar portaal
- Onboarding token security: 7d TTL + single-use (DB default)
- Lovable cleanup: package renamed, tagger verwijderd

### Sprint 1 — CRM & Fundament
- Quick Navigator (RecentItemsBar)
- Dashboard signalering (rood/oranje/groen)
- Uitstroomanalyse (fishbone, door-wie, per-opdrachtgever)
- Audit trail op documents, timesheets, housing
- Contactpersoon rollen (admin/plaatsing/hr/overig)
- Deduplicatie bij aanmaken (email/telefoon/geboortedatum)
- Custom velden systeem (admin UI + auto-render)
- Salaris range op vacatures

### Sprint 2 — AI & Onboarding
- CV auto-fill: callback vult skills/certifications, "Overnemen naar profiel" knop
- Functiegroep badges (specialist/productiekracht + doelgroep)
- Visuele werkhistorie-tijdlijn (WorkHistoryTimeline.tsx)
- PDF export via html2pdf.js
- Onboarding document uploads (ID/rijbewijs/certificaat)
- Verloopnotificaties (check-document-expiry → employee_notifications)

### Sprint 3 — Huisvesting
- Afstand-tot-werk berekening (Haversine, geocoding via Nominatim)
- Auto-toewijzing suggesties bij plaatsing, auto-vrijgave bij exit
- Planning-waarschuwing als geen huisvesting
- Wekelijkse huurberekening (weekly_rent op units)

### Overige modules (al gebouwd in Lovable, gevalideerd)
- **Matching**: AI matching via Gemini, pipeline voorgesteld → geplaatst, compliance check
- **Uren**: 3 invoerstromen, AI-validatie (5 regels), CSV import, groen/oranje/rood
- **Transport**: Voertuigbeheer, boetes, km-registratie, Q8 fraude-detectie
- **WhatsApp**: 4 edge functions, chat interface, bulk campagnes (code compleet, niet live getest)
- **Exact Online**: Register/API proxy/sync via SiteJob Connect (code compleet)
- **Huisvesting**: Panden, units, check-in/out, inspectie, sleutels, kosten, borg, overboeking-blokkade

---

## 4. Wat nog NIET af is (Sprint 4-7)

### Sprint 4 — Uren & Matching (geschat: M effort)
| Item | Status | Beschrijving |
|------|--------|-------------|
| Opdrachtgever-accordering uren | MISSING | Geen expliciete goedkeuringsflow voor opdrachtgevers |
| Urenbevestiging per email | MISSING | Geen email trigger bij goedkeuring (afhankelijk van email infra) |
| Portaal toegang behouden | NEEDS CHECK | Portaal mag niet ingetrokken worden na beeindiging plaatsing |

### Sprint 5 — Transport (geschat: M effort)
| Item | Status | Beschrijving |
|------|--------|-------------|
| Schademelding email naar garage | PARTIAL | `garage_notified` flag bestaat, email niet gebouwd |
| Tankpas koppeling UI | PARTIAL | Veld bestaat, geen Q8 API integratie |

### Sprint 6 — Communicatie (geschat: XL effort, GROOTSTE BLOCKER)
| Item | Status | Beschrijving |
|------|--------|-------------|
| Email infrastructuur | **VOLLEDIG MISSING** | Geen SMTP, geen Microsoft Graph API, geen email verzending |
| Variabele afzender | MISSING | Afhankelijk van email infra |
| Email logging | PARTIAL | Communicatie-tijdlijn bestaat maar email kanaal is leeg |
| Geautomatiseerde WhatsApp | MISSING | Geen onboarding-reminders, verlopen docs triggers |
| Ziektebegeleiding flow | MISSING | WhatsApp ziekmelding → ticket → bericht opdrachtgever |
| WhatsApp live testen | NOT TESTED | Code compleet, echte Meta credentials nodig |

### Sprint 7 — Polish (geschat: M effort)
| Item | Status | Beschrijving |
|------|--------|-------------|
| Kandidaatkwalificatie labels | MISSING | Extra labels/tags voor productie vs specialist |
| UX review | TODO | Doorloop alle flows op mobile + desktop |
| E2E tests | MISSING | Alleen placeholder test, infra (Vitest) is klaar |
| Handleiding Jeroen | TODO | Gebruikershandleiding voor klant |

---

## 5. Belangrijke klantbeslissingen (meeting 26-03-2026)

1. **"Kandidaat blijft altijd kandidaat"** — geen apart employee-record, status verandert maar persoon blijft in kandidatenlijst
2. **Payroller op plaatsing** — niet op persoon of bedrijf. Eén opdrachtgever kan 2 facturen krijgen
3. **Uitstroomanalyse = topprioriteit** — "Fucking belangrijk." Fishbone diagram, door-wie + waarom
4. **Tarieven bewust geparkeerd** — te complex, Exact Online handelt dit af
5. **Huisvesting wekelijks** — niet maandelijks
6. **Portaal alleen voor geplaatste kandidaten** — toegang NIET intrekken na exit
7. **Salaris op vacatures** — range zonder specificatie ("3000-4000")

---

## 6. Bekende technische schuld

| Issue | Detail |
|-------|--------|
| `employees` tabel | Legacy, data is gemigreerd naar `candidates` maar tabel bestaat nog |
| Types.ts | Auto-generated (~6400 regels), regenereer met `supabase gen types typescript` na schema wijzigingen |
| WhatsApp | Alle code af, nooit live getest met echte Meta credentials |
| Exact Online | Afhankelijk van SiteJob Connect service (extern) |
| CV analyse | Alleen text-based PDFs (geen OCR), basic prompt injection sanitization |
| Tests | Vrijwel geen testdekking, alleen placeholder test. Vitest + Testing Library klaar |
| Hardcoded URLs | SiteJob Connect URLs in edge functions, Meta Graph API v25.0 |

---

## 7. Ontwikkelomgeving

### Commando's
```bash
npm run dev          # Dev server (port 8080)
npm run build        # Production build
npm run lint         # ESLint
npm run test         # Vitest
```

### Environment variables
**Frontend (.env):**
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

**Edge function secrets (Supabase Dashboard):**
- `OLLAMA_BASE_URL` + `OLLAMA_API_KEY` (Hetzner VPS, Qwen3-14B)
- `KVK_API_KEY`, `APIFY_API_TOKEN`, `EXA_API_KEY`

### Types regenereren
```bash
npx supabase gen types typescript --project-id noaupcteygfvlyymqtew > src/integrations/supabase/types.ts
```

---

## 8. Bestanden & plannen

| Bestand | Doel |
|---------|------|
| `CLAUDE.md` | Volledige project documentatie (schema, routes, patterns) |
| `.claude/plans/agile-hopping-hopper.md` | Carerix-alignment masterplan (Fase 1-5) |
| `.claude/plans/reactive-brewing-dragon.md` | Gap analyse + sprintplan (Sprint 0-7) |
| `src/integrations/supabase/types.ts` | Auto-generated Supabase types — NOOIT handmatig bewerken |

---

## 9. Recente commits (chronologisch)

| Hash | Beschrijving |
|------|-------------|
| `6489991` | Merge candidates/employees into single entity (Carerix model) |
| `f2a692a` | Fase 3: Contactpersonen als first-class entity |
| `f5b3ee5` | Fase 2: Notes + Tasks systeem |
| `08113d7` | Fase 4: Analytical dashboards |
| `4e28be4` | Fase 5: Talentpools & Geavanceerd Zoeken |
| `83f7a29` | Sprint 0+1: Security, RBAC, deduplicatie, custom velden |
| `6c6da79` | Sprint 2: AI auto-fill, tijdlijn, PDF export, onboarding uploads |
| `a043798` | Sprint 3: Huisvesting — afstand, auto-toewijzing, planning, wekelijkse huur |

---

## 10. Prioriteiten voor vervolg

1. **Email infrastructuur (Sprint 6)** — grootste blocker, veel features zijn hiervan afhankelijk (plaatsingsbevestiging, urenbevestiging, schademelding)
2. **Opdrachtgever-accordering uren (Sprint 4)** — belangrijk voor operatie
3. **WhatsApp live testen** — code is af, moet getest met echte credentials
4. **E2E tests** — geen dekking, risico bij refactoring
5. **Handleiding** — klant heeft documentatie nodig
