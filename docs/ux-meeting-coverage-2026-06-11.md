# Meeting-coverage + dagelijks-gebruik UX-audit — kern-domeinen

**Datum:** 2026-06-11
**Scope:** verificatie of de meeting-besluiten (05-27 + 06-03, de laatste JA Werkt-recruitment-meetings) écht verwerkt zijn, plus een UX-audit op dagelijks gebruik voor de vier kern-domeinen: **kandidaten, matching, vacatures, huisvesting**. Methode: 4 parallelle agents die de meeting-registry + UX-docs tegen de echte code legden (read-only, file:line-bewijs).

> Plaud-check: de recente opnames (06-04 t/m 06-11) gaan over **andere** SiteJob-projecten (webshops, House of Cars, facturatie, veranda's). Er is **geen nieuwe JA Werkt-recruitment-meeting na 06-03**; 05-27 + 06-03 zijn de bron-van-waarheid en staan in de docs.

---

## Kernconclusie

**De meeste meeting-punten zijn verwerkt — maar het is nog niet overal "fijn, soepel en intuïtief" voor dagelijks gebruik.** Matching en vacatures zijn functioneel af. Kandidaten en huisvesting zijn grotendeels op orde, maar bevatten enkele **echte functionele bugs/regressies** die de dagelijkse kern-flow raken.

| Domein | Meeting-punten verwerkt | Dagelijks-gebruik UX | Verdict |
|---|---|---|---|
| **Matching** | 10/10 ✅ | Sterk; 1 gebroken publieke flow | Af, mits 1 fix |
| **Vacatures** | 9/9 ✅ | Solide; alleen polish | Af |
| **Kandidaten** | ~6/10 (deels) | 1 blokkerende bug + verloren AI-feature | **Niet af** |
| **Huisvesting** | 6/9 (3× deels) | Goede basis; data-integriteitsgat | Bijna af |

**De rode draad:** veel is gebouwd, maar een aantal dingen zijn **niet (meer) bedraad** — de rijke AI-analyse en CV-upload bestaan als component maar staan in dode code, en een paar statuswaarden/queries kloppen net niet met de DB. Dat zijn relatief kleine fixes met grote impact.

---

## Blokkers voor "hart van het bedrijf"-waardig (eerst doen)

### B1 · Kandidaten — instroomfunnel-bug breekt toelaten/afwijzen
`src/components/candidates/LeadFunnelBoard.tsx:166` schrijft `status: 'completed'`, maar de CHECK-constraint op `recruiter_tasks.status` staat alleen `open|in_progress|done|dismissed` toe (migratie `20260308233635`). Heeft een lead een open intake-taak, dan **faalt de hele status-mutatie** → toast-error → het instroombesluit (meeting-besluit 05-27 #3/#4) gaat niet door.
**Fix:** `'completed'` → `'done'` (1 regel).

### B2 · Kandidaten — AI-analyse + CV-upload onbereikbaar (regressie)
De volledige `AiAnalysisCard` (feiten/aannames/onbekend, CEFR-bewijsstatus, rijbewijs="onbekend", bronverwijzingen, contra-indicaties — exact het 06-03-besluit) én de CV-upload met alle documentformaten (PDF/DOC/DOCX/JPG/PNG/ODT — besluit 05-27) zitten **uitsluitend in `CandidateAiTab.tsx`, die nergens gemount is** (dode code). De AI-tab is correct verwijderd per 05-27, maar de upload + AiAnalysisCard zijn **niet teruggeplaatst** onder Screening. Gevolg: een recruiter kan vanaf het kandidaatdetail **geen CV uploaden of analyse starten**, en ziet de besloten AI-output niet (Screening toont alleen platte badges).
**Fix:** render `AiAnalysisCard` als sectie onder de Screening-"AI-context" + geef een "CV uploaden + analyseren"-knop terug op het detail.

### B3 · Matching — publieke voorstel-respons gebroken/onveilig
`src/pages/MatchResponse.tsx:30-65` doet nog directe **anon** `.select()` + `.update()` op `match_proposal_tokens` en `matches`, terwijl SEC-4 (`20260422120000`) de anon-read-policy heeft gedropt. De opdrachtgever-link (besluit 0514-PROPOSAL #9) laadt dus waarschijnlijk niets (RLS blokkeert) óf de statusupdate faalt stil — en als RLS het tóch toelaat, kan een anon willekeurig `matches.status` schrijven. *(Komt overeen met de LOW-bevinding uit de security-audit; in UX-termen is dit een gebroken kernflow.)*
**Fix:** service-role edge function `match-response` (lookup + update binnen token-scope), zoals de hardening-comment zelf voorschrijft.

### B4 · Huisvesting — overboeking-trigger dekt reserveringen niet
De DB-trigger `check_unit_capacity` blokkeert alleen bij `status='ingecheckt'`; een `gereserveerd`-toewijzing telt niet mee. Twee intercedenten kunnen tegelijk dezelfde kamer **dubbel reserveren** tot inchecken. Bij meerdere recruiters dagelijks reëel.
**Fix:** trigger uitbreiden naar `status IN ('ingecheckt','gereserveerd')`.

### B5 · Kandidaten — Workbench is geen persoonlijke funnel
`src/components/.../RecruiterWorkbench.tsx:55-58` haalt **álle** org-taken op (geen `assigned_to`-filter) terwijl de pagina "jouw prioriteiten" claimt. Taakdelegatie (besluit 05-27 #5) werkt daardoor niet als persoonlijke funnel — gedelegeerde taken zijn niet te onderscheiden.
**Fix:** filter `assigned_to = user.id` met een "mij / team"-toggle.

---

## Per domein — wat nog mist (na de blokkers)

### Kandidaten
- **Tab-overload:** tot **22 tabs** op een medewerker-detail (`CandidateDetail.tsx:330-355`). Groepeer de ~10 HR-tabs onder een sub-navigatie/"Dienstverband"-overlay.
- **Funnel-taxonomie** wijkt af van de 7 besloten fasen (mist "Link verstuurd / Profiel ingevuld / Gecontacteerd / Beoordeeld") — de profiellink-status bestaat al als data maar wordt niet als kolom benut.
- **Notities + communicatievoorkeur** zijn nog losse tabs; besluit wilde notities "direct naast profiel" en voorkeur "op profiel".
- **Lijst-zoek dekt geen telefoon** (`Candidates.tsx`) — voor een arbeidsmigranten-bureau is bellen het primaire kanaal.
- **Status-enum inconsistentie** tussen taakschermen (`done` vs `completed`).
- ✅ Goed: notities-intern-by-default, dedup (email+telefoon+DOB) met live waarschuwing + merge-scherm, `?tab=`-navstate, readiness-strip, screening-callflow met autosave.

### Matching
- **Drie matchparadigma's** naast elkaar: vacaturetab = lijst+chips, globale pipeline = drag-kanban, kandidaat = kaarten. Eén `MatchCard`-taal over alle schermen zou de grootste consistentiewinst zijn.
- **Bulk-WhatsApp loopt client-side** over kandidaten (losse Meta-calls, geen progress/retry); outbound-pauze alleen visueel, niet hard afgedwongen vóór de loop.
- **"Gescreend" wordt nooit automatisch gezet** — screening-afronding schuift de match niet door (handmatig).
- **Pipeline laadt alle rows client-side** — performance-schuld die pijnlijk wordt na de ~1900-kandidaten-backfill.
- ✅ Goed: alle 10 besluiten aanwezig, deterministische scoring-core (onbekend ≠ diskwalificatie), fit los van dossierkwaliteit, verplichte afwijsreden, begrijpelijke "Waarom?"-inspector, branding/AI-rapport in voorstelmail.

### Vacatures
- **Zoek heeft geen debounce** (`Vacancies.tsx`) — query per toetsaanslag.
- **Twee verwarrende "Zoek kandidaten"-knoppen** op het detail (interne shortlist vs `/kandidaten-zoeken`).
- **Startdatum toont "—"** op de detailtab bij Direct/ZSM-vacatures (`VacancyDetailsTab.tsx:21` leest alleen `start_date`, niet `start_date_text`).
- **Urgentie-dashboard** toont ook reeds-vervulde urgentie-3 vacatures (geen `openSlots>0`-filter).
- **Bronlabels** missen Carerix/handmatig.
- ✅ Goed: functie-erfenis (beschrijving/tarief/skills/locatie), startdatum-kolom + status-toggle + overdue + urgentie 1-3, AI-skillverrijking uit org-catalogus, website-instroom met verplicht CV + bronlabel "website", navstate.

### Huisvesting
- **Borg-op-org-niveau nooit afgebouwd:** migratie noemt `organizations.settings.deposit_default_amount`, maar **0 orgs** hebben de key en geen UI leest/schrijft 'm. Per-toewijzing alleen een `deposit_paid` boolean.
- **Schoonmaak is taken, geen rooster:** `cleaning_schedules`/`cleaning_logs` bestaan niet — het is één ad-hoc takentabel (`housing_cleaning_tasks`). Voor wekelijkse vaste rondes ontbreekt herhaling/planning.
- **Twee verschillende toewijs-UIs** (vanuit pand = 3-staps kaartjes; vanuit kandidaat = datum-gedreven dropdown) met verschillende beschikbaarheidslogica.
- **Dashboard zonder skeleton** (kale pagina → plof bij laden).
- ✅ Goed: naam optioneel/adres-gedreven, owners als master-data, dashboard met vrije-plekken-focus + 12-weken-grafiek, kandidaat-toewijzing mét acties (de open-gaps doc zegt ten onrechte dat dit nog "open" is — **stale**), kosten-reminder cron, 3-staps wizard + check-in/out/sleutels/kosten.

---

## Nog openstaande meeting-punten (geen bug — product/besluit)

- **AI-verrijking ~1.900 kandidaten** — mechaniek + backfill-UI bestaan, dry-run runbook + functiegroep-taxonomie wachten op klant-input en een gecontroleerde staged run.
- **Decision-needed-items** (geen dev-werk): Exact-scope, VoIP/notetaker-scope, integratie-scope (RMA/HireData/JobDigger/extern huisvestingssysteem), AVG-besluiten (AI-scoring, BSN/nationaliteit, bewaartermijnen, WhatsApp), definitieve lead-terminologie, re-entry-beleid afgewezen leads.
- **Website publiceren/synchroniseren** van vacatures (apart van de instroom-link).
- **Stale docs:** `open-gaps.md:26,42` markeert kandidaat-huisvestingstoewijzing en de schoonmaak-module als "open" terwijl ze (deels) gebouwd zijn — opschonen.

---

## Aanbevolen volgorde

1. **Quick functional fixes (uren, hoge impact):** B1 (funnel `completed→done`, 1 regel), B4 (overboeking-trigger reservering), startdatum-detailtab, urgentie-dashboard `openSlots>0`-filter, vacatures-zoek debounce, lijst-zoek telefoon.
2. **B2 — AI terug op het kandidaatdetail** (AiAnalysisCard + CV-upload onder Screening). Grootste "verloren feature".
3. **B3 — match-response service-role edge function** (gebroken klantflow + security).
4. **B5 — Workbench persoonlijk maken.**
5. **Consistentie-laag:** één `MatchCard` over de matchschermen, één gedeelde huisvesting-toewijsflow, tab-groepering op kandidaatdetail.
6. **Daarna:** funnel-taxonomie naar de 7 fasen, schoonmaak-rooster, borg-op-org-niveau, pipeline server-side pagination (vóór de 1900-backfill).
