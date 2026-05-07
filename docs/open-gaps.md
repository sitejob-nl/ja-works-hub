# Open gaps & roadmap

Project-management state from client meetings — moved out of CLAUDE.md because it decays fast and isn't codebase guidance. Last updated from meetings through 2026-04-30.

## Closed na sprints 1/2/3/5/D3

- ✅ Phone hard block in PlacementConfirmationDialog (B5)
- ✅ "Voordragen" → "Nieuwe match" labels (al gedaan, geverifieerd)
- ✅ Vacatures-overzicht: Aangemaakt → Startdatum, status-toggle, overdue, urgentie 1-3 (B1)
- ✅ Functie-koppeling op vacatures + Direct/ZSM tekst (B2/C1)
- ✅ Property naam optioneel + adres-gedreven (B3)
- ✅ Units `monthly_cost` + `deposit_amount` verwijderd (B4)
- ✅ Owners als master-data tabel (C2)
- ✅ Housing dashboard: focus op vrije plekken + 12-weken-grafiek (C4)
- ✅ AI CV pseudonimisering server-side (C8) + batch backfill 1100 CV's (C6) + photo-detectie (C7)
- ✅ Talentpools dynamisch met filter-refresh (D3)

## Nog open

- **Schoonmaak-module** (C5) — `cleaning_schedules` + `cleaning_logs` + tab + dashboard widget
- **Kosten-reminder edge function** (C3) — cron, 3 mnd → `recruiter_tasks`
- **Buddy app CSV-import** (C9) — handmatig data uit Buddy migreren
- **AI e-mail triage** (D1) — classificatie + reply-suggesties bovenop Microsoft Graph
- **Carerix productie-import acceptatie** (D2) — CR*-scope, documentenbytes, notities/taken en echte data-validatie; zie `docs/carerix-integratie-audit.md`
- **Outbound SMS** (D4) — provider-keuze (MessageBird/Twilio) eerst nodig
- **WhatsApp inbound replies** (D5) — UI-check of webhook → chat-UI werkt
- **Km-verwachting + alarm** (mileage_entries staat, expected-km + alarm + opvolg-WhatsApp niet)
- **Indirecte facturatiestroom** (A1 → tussenlaag → eindklant) niet expliciet in datamodel
- **`useModuleEnabled`** wordt in slechts 3 files gebruikt — niet breed toegepast
- **Welkomstvideo + i18n medewerkerportaal** (FR-41)

## Missing Features (Fase 2)

- Flexpedia API integration
- Google Calendar sync (internal `Agenda.tsx` exists, no sync)
- SEPA XML export
- Contract template engine with variables
- Digital signatures
- Transport GPS live tracking
- Extended employee dossier (pension, vacation rights)
- Energy Wizard (gas/water/energy for housing)
- Camera integration on dashboard
- WordPress lead webhook (can be routed via `candidate_signup_links`)
- Partner portal for external recruiter CV uploads
