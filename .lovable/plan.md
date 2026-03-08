

# Gap Analyse: Projectplan + Technisch Eisendocument vs. Huidige Implementatie

## Wat is er al gebouwd (samenvatting)

| Module | Status |
|--------|--------|
| Dashboard met signaleringen + audit trail | ✅ |
| CRM: Opdrachtgevers + contactpersonen + tariefafspraken + SLA | ✅ |
| CRM: Kandidaten + documenten + vaardigheden | ✅ |
| Medewerkersbeheer + in dienst nemen | ✅ |
| Self-service onboarding portal (/onboarding/:token) | ✅ |
| Compliance-gates bij plaatsingen (met override + logging) | ✅ |
| Document verloopdata checker (edge function) | ✅ |
| Huisvesting: panden, kamers, bewoners, inspectie, sleutels | ✅ |
| Vacatures + AI-matching pipeline | ✅ |
| Planning (weekweergave + lijstweergave) | ✅ |
| Uren: handmatig + CSV import + AI-validatie (groen/oranje/rood) | ✅ |
| Transport: voertuigen, boetes, toewijzingen, kilometerregistratie | ✅ |
| Communicatie-tijdlijn | ✅ |
| WhatsApp Business integratie + AI chatbot | ✅ |
| Exact Online koppeling (proxy + dashboard) | ✅ |
| Import wizard (Carerix/Buddy/CSV) | ✅ |
| Kennisbank | ✅ |
| Vacaturebank (scraping via Apify) | ✅ |
| Kandidaten zoeken (Exa API) | ✅ |
| Superadmin panel | ✅ |
| Audit logging overal | ✅ |
| Ziektebegeleiding | ✅ |
| RLS + multi-tenant | ✅ |

---

## Resterende gaps uit het technisch eisendocument

### PRIORITEIT 1 — Ontbrekende kernfunctionaliteit

**1. Plaatsing als trigger (automatische vervolgacties)**
- Technisch eisen doc §1.2: "Alle processen worden getriggerd vanuit de plaatsing"
- Na aanmaken plaatsing automatisch: timesheet-templates genereren, huisvesting-suggestie aanbieden, WhatsApp bevestiging sturen
- Status: niet gebouwd, staat als "nice to have" in het plan maar is een kerneis in het technisch doc

**2. Huisvesting toewijzingslogica (afstand/team suggesties)**
- Technisch eisen doc §3: "Teamclustering mogelijk"
- Projectplan: "Toewijzingslogica — afstand tot werk, teamclustering, capaciteit, duur"
- Slimme suggesties bij plaatsing op basis van collega's bij zelfde bedrijf + beschikbare capaciteit
- Status: niet gebouwd

**3. Directie dashboard met KPI's**
- Technisch eisen doc §14: Dashboarding directie — uren/week totaal en per klant, brutomarge/week, kamers beschikbaar, auto's beschikbaar, actieve klanten, uitzonderingen
- Status: huidig dashboard toont alleen signaleringen en activiteit, geen financiële KPI's

**4. Blokkade bij ongeldig rijbewijs (transport)**
- Technisch eisen doc §8: "Blokkade bij ongeldig rijbewijs"
- Bij voertuig-toewijzing checken of rijbewijs geldig is
- Status: niet gebouwd

**5. CV Tool met JA Werkt huisstijl**
- Technisch eisen doc §6: CV in huisstijl, template engine, AI herschrijven, meertalig, anonieme versie, matchscore
- Status: niet gebouwd

### PRIORITEIT 2 — Uitbreidingen op bestaande modules

**6. Dynamische compliance formulieren**
- Technisch eisen doc §4: Documentvereisten afhankelijk van sector, CAO, contracttype, A1-constructie
- Huidige compliance check is hardcoded (id_bewijs, contract, reglement)
- Moet configureerbaar worden per organisatie/sector

**7. Reglement versiebeheer**
- Technisch eisen doc §4: Per reglement versiebeheer, aftekening met tijdstip, historisch inzicht
- Status: niet gebouwd, reglement is nu alleen een checkbox in onboarding

**8. Bulk communicatie & segmentatie**
- Technisch eisen doc §9: Bulk WhatsApp, rate limiting, anti-spam, segmentatie
- Huidige WhatsApp is 1-op-1 chat, geen bulk outreach
- Projectplan Fase 3: "Anti-spam waarborgen — rate limiting, opt-out per kanaal"

**9. Data-export (JSON/CSV)**
- Technisch eisen doc §1.5: "Volledige export in JSON/CSV mogelijk"
- Projectplan: "Data-export: te allen tijde volledige export"
- Status: geen exportfunctionaliteit gebouwd

**10. Medewerker app / mobiele weergave**
- Technisch eisen doc §13: "Medewerker applicatie op telefoon"
- Inzage in eigen gegevens, uren bevestigen
- Status: geen PWA/mobiele optimalisatie specifiek gebouwd

**11. Recruiter Workbench**
- Technisch eisen doc §6: AI-gestuurde dagprioriteiten, opvolgtaken
- Status: niet gebouwd

**12. Nieuwsbrief manager**
- Technisch eisen doc §12: Automatische nieuwsbrieven naar klanten
- Status: niet gebouwd

**13. TODO applicatie voor interne medewerkers**
- Technisch eisen doc §16: "Interne medewerkers aansturen met een TODO applicatie"
- Status: niet gebouwd

**14. Geautomatiseerde outreach naar recruitment bureaus**
- Technisch eisen doc §13: Wekelijkse open job orders doorsturen naar recruitmentpartners
- Status: niet gebouwd

**15. AI klantacquisitie**
- Technisch eisen doc §7: "Automatische emails versturen met beschikbare medewerkers naar huidige klanten"
- Status: niet gebouwd

---

## Aanbevolen implementatievolgorde

Gezien het projectplan is **Fase 1 het breedst** en grotendeels af. De items hierboven vallen deels in Fase 1 (plaatsing triggers, huisvesting logica) en deels in Fase 2/3 (CV tool, bulk communicatie, recruiter workbench).

**Volgende stappen voor Fase 1 completering:**
1. Plaatsing als trigger (auto timesheet + huisvesting suggestie + WhatsApp)
2. Huisvesting toewijzingslogica
3. Directie dashboard KPI's
4. Data-export functionaliteit
5. Rijbewijs blokkade bij voertuig-toewijzing

**Fase 2/3 items (later):**
6. CV Tool
7. Dynamische compliance formulieren
8. Bulk communicatie
9. Recruiter workbench
10. TODO app
11. Nieuwsbrief manager

Wil je dat ik begin met de Fase 1 items (1-5), of heb je een andere prioritering?

