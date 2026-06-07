# Open gaps & roadmap

Project-management state from client meetings — moved out of CLAUDE.md because it decays fast and isn't codebase guidance. Last updated from meetings through 2026-06-03. Fix plan for 05-14: `docs/meeting-fix-plan-2026-05-14.md`. Open-point analysis for 05-27: `docs/meeting-open-points-2026-05-27.md`. Latest gap scan: 06-03 recruitment/AI workflow + Carerix/Westerhorn benchmark notes.

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

- **06-03 AI betrouwbaarheid / screening** — AI-output moet feiten, aannames en onbekende velden expliciet scheiden; taal naar CEFR A1-C2 met bewijsstatus; rijbewijs ontbrekend is "onbekend" en nooit automatisch "nee"; bronverwijzingen moeten zichtbaar blijven in de screening.
- **06-03 AI-backfill acceptatie** — bestaande batchfunctie moet eerst via een gecontroleerde dry-run/staged-run: sample, kostenlimiet, runtime, foutstatussen, dossierbronnen en QA-steekproef voordat circa 1.900 kandidaten volledig worden verrijkt.
- **06-03 matching / reverse matching** — matching moet volledige vacaturecontext meenemen, hard/soft criteria uitleggen, onbekende data niet diskwalificeren, threshold/criteria-controls bieden en vanuit kandidaat naar passende vacatures kunnen zoeken.
- **06-03 communicatie kill-switch / feature freeze** — basis is gebouwd via een centrale `communication_pause` instelling voor e-mail, WhatsApp-campagnes en workflowberichten; browser-/acceptatievalidatie met echte campagne- en matchflows blijft open.
- **06-03 integratiebesluiten** — VoIP/KPN/notetaker, RMA/HireData, JobDigger, websitekoppeling en extern huisvestingssysteem zijn aparte scope-/AVG-besluiten. Carerix/Westerhorn-meeting geldt als benchmark tenzij hetzelfde punt expliciet JA Werkt-scope is.
- **05-27 instroomfunnel** — eerste lead-/kwalificatiekanban staat in Kandidaten met verplichte notitie bij toelaten/afwijzen; definitieve terminologie en re-entry/duplicaatbeleid blijven productvalidatie.
- **05-27 kandidaatprofiel als centrale werkplek** — profieltabs compacter: notities direct naast profiel, communicatievoorkeur op profiel, AI onder Screening, huisvesting/vervoer/taken vanuit kandidaat. Eerste UI-richting is ingezet; toewijsacties voor huisvesting/auto blijven open.
- **05-27 AI-verrijking bestaande database** — circa 1.900 kandidaten analyseren op CV én interne notities, met uitlegbare kandidaatkwaliteitsscore, functiegroep/taxonomie en fallback voor ontbrekende CV's.
- **05-27 website/vacature-instroom** — vacature-specifieke sollicitatielinks maken nu verplicht CV/profiel en automatisch een "Nieuwe match" met bronlabel; vacatures publiceren/synchroniseren naar website blijft uitwerken.
- **05-27 data/compliance** — ICE-telefoonnummer, EU/NL-telefoons, incomplete-statuscriteria, BSN/nationaliteit/taal-migratie, bewaartermijnen en AI/WhatsApp-AVG-besluiten zijn open.
- **05-14 data cleanup / Carerix SSOT** — import bevriezen, deduplicatie, test-vacatures opschonen en foutieve historische koppelingen herstellen; zie `docs/meeting-open-points-2026-05-14.md`.
- **05-14 Carerix notities/taken** — codepad splitst `CRTodo` nu naar notes/tasks plus meeting/e-mail metadata en importeert aparte `CRNote`-notities naar gekoppelde kandidaten/bedrijven/matches/vacatures/contacten; productiedata-steekproef en historische validatie blijven open.
- **05-14 vacature-template verdieping** — vacature-aanmaak/-bewerken erft beschrijving, locatie, tarief en skills; UI-flow en tariefacceptatie nog valideren.
- **05-14 skill-based matching vanuit vacature** — matchtab filtert/scored nu op vacature-eisen vóór handmatige match; browser/API-regressie nog toevoegen.
- **05-14 urgentie-dashboard** — workbench toont nu open urgentie-3 vacatures met opdrachtgever, startdatum, ouderdom en open plaatsen; browservalidatie blijft open.
- **05-14 recruitment intake funnel** — publieke `/solliciteren/:slug` route + `candidate-signup` edge function zijn gedeployed en production-smoke gevalideerd met verplichte CV, leadstatus, bronlabel, recruiter-taak en notificatie; lead-promotie werkt op het bestaande record met besluitnotitie, maar browseracceptatie blijft open.
- **05-14 bulk kandidaat-notificaties** — matchpipeline heeft selectie + bulkactie via `match-bulk-notify` voor portal/appmeldingen, outbound e-mailrecords en WhatsApp-concepten met voorkeuren/duplicaatguard; echte Outlook/WhatsApp-verzending blijft bewust een apart kanaalbesluit.
- **05-14 kandidaatvoorstel branding/AI-rapport** — voorstelmail gebruikt nu org-naam/logo/contact en compacte AI-rapportsectie; preview/send-validatie blijft open.
- **05-14 screening-call ondersteuning** — screeningtab toont nu ontbrekende kernvelden, callvragen en kan een opvolgtaak maken; browservalidatie blijft open.
- **05-14 navigatiestate** — kandidaat-, vacature-, opdrachtgever-, voertuig- en panddetailtabs bewaren nu `?tab=` in de URL; browserregressie blijft open.
- **05-14 zoek/functiefilters** — vacature- en matchpipeline zoeken gebruikt nu functietitel + opdrachtgever; regressietest/browservalidatie blijft open.
- **05-14 Exact scopebesluit** — meeting noemt Exact out-of-scope, bestaande module staat wel in app; expliciet acceptatie-/scopebesluit nodig.
- **Schoonmaak-module** (C5) — `cleaning_schedules` + `cleaning_logs` + tab + dashboard widget
- **Kosten-reminder edge function** (C3) — cron, 3 mnd → `recruiter_tasks`
- **Buddy app CSV-import** (C9) — handmatig data uit Buddy migreren
- **AI e-mail triage** (D1) — Outlook inbox toont nu heuristische AI-triage en kan een gekoppelde taak + communicatie-record maken; reply-suggesties blijven open.
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
- Meta/Facebook Ads Library + Higgsfield marketing automation
