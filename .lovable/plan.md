

# JA Werkt Platform — Volledig Resterend Bouwplan

## Overzicht: wat is af, wat moet nog

| Fase | Af | Resterend |
|------|----|-----------|
| Fase 1 — Core Platform | ~85% | 6 onderdelen |
| Fase 2 — Koppelingen & Compliance | ~35% | 4 onderdelen |
| Fase 3 — Outreach & Intelligence | ~40% | 10 onderdelen |

---

## FASE 1 — Afronden (6 items)

### 1.1 Huisvesting: Huur & Borg Signalering
- Dashboard widget: medewerkers met `rent_paid_until < today` of `deposit_paid = false`
- Automatische alert in het bestaande alert-systeem op Dashboard.tsx
- Geen nieuwe tabellen nodig, data zit al in `housing_assignments`

### 1.2 Huisvesting: Toewijzingslogica Verbeteren
- `HousingSuggestionsCard` uitbreiden met afstand-tot-werkplek (postcode vergelijking)
- Teamclustering: voorkeur voor units waar collega's van dezelfde plaatsing al zitten
- Sortering op score (afstand + beschikbaarheid + team)

### 1.3 Huisvesting: EnergyWizard
- Nieuw tab op PropertyDetail: gas/water/elektra meterstanden
- Nieuwe tabel `utility_readings` (property_id, unit_id, type, reading_date, value)
- Verbruik per maand grafiek (Recharts)
- Handmatige invoer + CSV import

### 1.4 Ziektebegeleiding: Automatisch Bericht naar Opdrachtgever
- Bij aanmaken sick_report: automatisch WhatsApp/notificatie naar contactpersoon van actieve plaatsing
- Uitbreiding van `EmployeeSickTab` createReport mutatie
- Lookup actieve placement → company contact → whatsapp-send edge function

### 1.5 Huisvesting: Buddy/Migratie Tool
- Import wizard specifiek voor huisvesting data (panden, units, toewijzingen)
- Tab 2 op de bestaande ImportData pagina: "Huisvesting importeren"
- Mapping naar properties + units tabellen

### 1.6 Huurcontrole Dashboard Widget
- Card op Dashboard: "Achterstallige huur" met count en lijst
- Filter op `rent_paid_until < NOW()` uit housing_assignments
- Link naar betreffende medewerker

---

## FASE 2 — Koppelingen & Compliance (4 items)

### 2.1 Reglement Versiebeheer + Aftekening
- Nieuwe tabellen: `regulations` (titel, versie, inhoud, published_at) en `regulation_acknowledgements` (employee_id, regulation_id, signed_at)
- UI in Settings: reglementen beheren, versies uploaden
- Employee detail: tab met "te tekenen" reglementen
- Onboarding wizard uitbreiden: reglement tonen + akkoord checkbox

### 2.2 Contract Generatie + E-sign
- Template engine: contracttemplates met merge fields ({{employee_name}}, {{start_date}}, {{hourly_rate}})
- Nieuwe tabel `contract_templates` + `contracts` (employee_id, template_id, status, signed_at, pdf_url)
- Edge function `generate-contract`: template → HTML → PDF (via headless rendering of pdfmake)
- E-sign: eenvoudige versie met onboarding-style token link + checkbox "Ik ga akkoord"
- Geavanceerd: DocuSign/HelloSign API integratie (optioneel)

### 2.3 Flexpedia Voorbereiding
- Edge function `flexpedia-sync` (stub): API client voor loonverwerking
- Mapping tabel `flexpedia_mappings` (employee_id → flexpedia_id)
- UI in Settings: Flexpedia configuratie (API key, endpoint)
- Eigenlijke koppeling pas actief als klant API credentials levert

### 2.4 Medewerker Self-Service (PWA Uitbreiding)
- PWA is al gebouwd, nu specifieke medewerker-views toevoegen
- Aparte login flow voor medewerkers (role=medewerker)
- Medewerker ziet: eigen profiel, documenten, uren invoeren, ziekmelding, huisvesting info
- Beperkte routes achter role-check

---

## FASE 3 — Outreach & Intelligence (10 items)

### 3.1 TODO-Applicatie
- Nieuwe tabel `tasks` (org_id, assigned_to, title, description, due_date, priority, status, related_entity_type, related_entity_id)
- Nieuwe pagina `/taken` met kanban of lijstweergave
- Sidebar item toevoegen
- Quick-add vanuit elk detail scherm (kandidaat, medewerker, vacature)

### 3.2 Directie Dashboard
- Uitbreiding KpiDashboard met:
  - Brutomarge berekening (omzet - loonkosten per plaatsing)
  - Beschikbare kamers overzicht
  - Beschikbare voertuigen overzicht
  - Omzet per opdrachtgever (top 10)
- Recharts grafieken voor trends

### 3.3 Recruitment Dashboard / KPI's per Recruiter
- Nieuwe component op Dashboard of aparte pagina
- Metrics per recruiter: plaatsingen, time-to-fill, kandidaten in pipeline, conversieratio
- Data uit placements + candidates tabellen, gegroepeerd op created_by

### 3.4 E-mail Integratie
- Edge function `email-send` via Resend/SendGrid API
- Inbound: webhook endpoint voor inkomende e-mail
- Opslaan in `communications` tabel (channel=email)
- Weergave in bestaande communicatietijdlijn

### 3.5 WhatsApp AI-Chatbot
- Uitbreiding `whatsapp-webhook`: intent detection via AI (OpenAI/Claude)
- Pre-screening flow: vragen stellen, antwoorden opslaan als kandidaat notes
- FAQ beantwoording uit kennisbank
- Fallback naar menselijke intercedent

### 3.6 Vacaturepublicatie (Indeed/Werk.nl)
- Edge function `publish-vacancy`: API calls naar Indeed XML feed of Werk.nl API
- UI op VacancyDetail: "Publiceer" knop met kanaal selectie
- Status tracking per publicatie

### 3.7 Nieuwsbriefmanager
- Uitbreiding bulk campagnes met kanaal "email"
- E-mail templates met rich text editor
- Dezelfde segment builder hergebruiken
- Opt-out via bestaand preferences systeem

### 3.8 AI Klantacquisitie
- Automatische e-mails over beschikbare medewerkers naar prospects
- Edge function die wekelijks draait: beschikbare medewerkers matchen met bedrijfsprofiel
- Template-based outreach via email-send

### 3.9 CV Database Refresh
- Bulk operatie: kandidaten ouder dan X maanden markeren als "te updaten"
- Automatisch WhatsApp bericht: "Is je profiel nog actueel?"
- Deduplicatie tool: fuzzy match op naam + email + telefoon

### 3.10 VoIP Integratie
- Twilio/Vonage SDK integratie
- Click-to-call vanuit kandidaat/bedrijf detail
- Gesprekslog opslaan in communications tabel
- Optioneel: opname + transcriptie via AI

---

## Prioriteitsvolgorde (aanbevolen)

| Prioriteit | Items | Geschatte omvang |
|------------|-------|------------------|
| **Sprint 1** | 1.1 + 1.4 + 1.6 (huur/ziekte signalering) | Klein — 1 sessie |
| **Sprint 2** | 3.1 (TODO app) | Medium — 1 sessie |
| **Sprint 3** | 2.1 (reglementen) + 2.2 (contracten) | Groot — 2-3 sessies |
| **Sprint 4** | 3.2 + 3.3 (dashboards) | Medium — 1-2 sessies |
| **Sprint 5** | 1.2 + 1.3 (huisvesting verbeteren) | Medium — 1-2 sessies |
| **Sprint 6** | 3.4 (e-mail) + 3.7 (nieuwsbrief) | Groot — 2 sessies |
| **Sprint 7** | 3.5 (AI chatbot) | Groot — 2 sessies |
| **Sprint 8** | 2.3 (Flexpedia) + 2.4 (medewerker PWA views) | Medium — 2 sessies |
| **Sprint 9** | 3.6 + 3.8 + 3.9 + 3.10 (overig) | Groot — 3+ sessies |

---

## Technische haalbaarheid

Alles is haalbaar binnen de huidige stack (Supabase + Edge Functions + React). Externe API's nodig voor:
- **E-mail**: Resend of SendGrid (API key)
- **VoIP**: Twilio (API key)
- **AI Chatbot**: OpenAI of Anthropic (API key)
- **Flexpedia**: Credentials van klant
- **Indeed/Werk.nl**: Publisher API credentials

Geen van deze vereist backend wijzigingen buiten Edge Functions.

