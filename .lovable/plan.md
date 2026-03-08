

# Plan: Resterende Gaps Implementeren

## Overzicht van de 7 items

### 1. Carerix/Excel Import Wizard (Kritiek)

Universele importwizard voor kandidaten, medewerkers en bedrijven vanuit Excel/CSV bestanden.

**Aanpak:**
- Nieuw component `src/components/import/ImportWizard.tsx` — een multi-step Sheet:
  - **Stap 1**: Bestand uploaden (CSV/Excel via PapaParse, al geinstalleerd)
  - **Stap 2**: Kolomkoppeling — drag/select om CSV-kolommen te mappen naar database-velden (first_name, last_name, email, phone, bsn, etc.)
  - **Stap 3**: Preview + validatie — toon rijen met fouten gemarkeerd (missende verplichte velden, dubbele BSN/email)
  - **Stap 4**: Importresultaat — X geimporteerd, Y overgeslagen, Z fouten
- Ondersteunt import naar: `candidates`, `companies`, `employees` (via kandidaat-lookup)
- Duplicaatdetectie op BSN, email of naam+geboortedatum
- Toegankelijk via knoppen op Kandidaten, Bedrijven en Medewerkers pagina's
- Carerix-specifieke kolomnamen als preset-mapping (bijv. "Voornaam" → first_name, "Achternaam" → last_name)

**Geen database-wijzigingen nodig** — gebruikt bestaande tabellen.

---

### 2. AI-Urenvalidatie (groen/oranje/rood) (Belangrijk)

Automatische validatie van ingediende uren via Lovable AI Gateway.

**Aanpak:**
- Nieuwe edge function `supabase/functions/validate-timesheets/index.ts`
- Gebruikt `LOVABLE_API_KEY` + `google/gemini-3-flash-preview` via tool calling om gestructureerde output te krijgen
- Input: timesheet entries + plaatsingsgegevens (contract_hours, functie, bedrijf)
- AI controleert op:
  - Meer dan 12 uur op een dag
  - Meer dan 60 uur per week
  - Weekend-uren zonder overwerk-markering
  - Ongebruikelijk patroon (plotseling 2x meer uren)
  - Ontbrekende dagen in een week
- Output via tool calling: `{ status: "groen"|"oranje"|"rood", issues: string[] }`
- Update timesheet status + `ai_validation_result` + `ai_validated_at`
- Frontend: "AI Validatie" knop op Timesheets pagina, bulk-validatie voor hele week
- Na validatie: badge kleurt automatisch groen/oranje/rood

---

### 3. AI-Kandidaatmatching (match score) (Belangrijk)

AI-berekende match scores bij het voordragen van kandidaten voor vacatures.

**Aanpak:**
- Nieuwe edge function `supabase/functions/calculate-match/index.ts`
- Input: kandidaat (skills, certifications, languages, ervaring) + vacature (title, requirements, function_name, skills_required)
- AI berekent via tool calling: `{ score: 0-100, reasoning: string }`
- Slaat `match_score` en `match_reasoning` op in `matches` tabel (kolommen bestaan al)
- Frontend: bij "Voordragen" in `VacancyMatchesTab`, roep edge function aan en toon score in de pipeline
- Optioneel: "Herbereken scores" knop om alle matches van een vacature opnieuw te scoren

**Database**: vacatures tabel heeft mogelijk nog geen `skills_required` kolom — toevoegen als text array via migratie.

---

### 4. Self-service Onboarding Portal (Belangrijk)

Aparte pagina waar medewerkers zelf hun gegevens invullen en documenten uploaden.

**Aanpak:**
- Nieuwe publieke route `/onboarding/:token` (geen auth vereist)
- Database migratie: `onboarding_tokens` tabel (id, employee_id, token, expires_at, used_at, organization_id)
- Bij het aanmaken van een medewerker (HireEmployeeSheet): genereer een uniek token en toon/kopieer de onboarding-link
- Onboarding pagina toont:
  - Formulier voor persoonlijke gegevens (BSN, IBAN, geboortedatum, nationaliteit, adres)
  - Document upload sectie (ID bewijs, rijbewijs, etc.) naar Supabase Storage
  - Reglement akkoord checkbox
- Bij indienen: update kandidaat-gegevens, maak document-records aan, markeer token als gebruikt
- Edge function `supabase/functions/onboarding-submit/index.ts` verwerkt de data met service role key (geen auth)

---

### 5. Buddy Data Migratie (Belangrijk)

Import tool specifiek voor Buddy HRM systeem data.

**Aanpak:**
- Uitbreiding van de ImportWizard (item 1) met een "Buddy" preset
- Buddy-specifieke kolomnamen als mapping-template
- Ondersteunt Buddy's exportformaat (CSV met specifieke kolomnamen)
- Kan hergebruiken van dezelfde ImportWizard component met een `preset="buddy"` prop
- Geen aparte edge function nodig — alles client-side met PapaParse

---

### 6. Toewijzingslogica Huisvesting (Nice to have)

Slimme suggesties voor huisvesting bij plaatsing.

**Aanpak:**
- Bij het aanmaken van een plaatsing (PlacementSheet/Planning), toon beschikbare kamers
- Query units met beschikbare capaciteit, sorteer op:
  - Afstand tot werklocatie (als adres beschikbaar)
  - Team/bedrijf — voorkeur voor kamers waar collega's van hetzelfde bedrijf zitten
- Toon als suggestie-kaarten in de plaatsing-flow
- Optioneel: direct huisvesting toewijzen vanuit de plaatsings-sheet
- Geen AI nodig — puur database queries met ranking

---

### 7. Plaatsing als Trigger (Nice to have)

Automatische acties bij het aanmaken van een plaatsing.

**Aanpak:**
- Na succesvolle plaatsing in PlacementSheet/Planning, trigger automatisch:
  - **Huisvesting**: open huisvestings-toewijzingssheet als er geen assignment is
  - **Uren**: maak automatisch timesheet-templates aan voor de eerste week
  - **Communicatie**: stuur automatisch WhatsApp-bericht naar medewerker (bevestiging plaatsing)
- Implementeer als post-mutation stappen in de bestaande PlacementSheet onSuccess
- Configureerbaar via organisatie-instellingen (welke auto-acties aan/uit)

---

## Implementatievolgorde

1. **Import Wizard + Buddy preset** (items 1 & 5 samen — delen dezelfde component)
2. **AI Urenvalidatie** (item 2 — edge function + frontend knop)
3. **AI Kandidaatmatching** (item 3 — edge function + VacancyMatchesTab integratie)
4. **Self-service Onboarding** (item 4 — nieuw token-systeem + publieke pagina)
5. **Huisvesting suggesties** (item 6 — uitbreiding plaatsings-flow)
6. **Plaatsing triggers** (item 7 — post-mutation automatisering)

## Database Migraties Nodig

- `onboarding_tokens` tabel voor self-service portal
- `skills_required` kolom op vacancies (als ontbreekt)
- RLS policies voor onboarding_tokens (publiek leesbaar met geldig token)

## Edge Functions Nodig

- `validate-timesheets` — AI urenvalidatie
- `calculate-match` — AI match score
- `onboarding-submit` — self-service onboarding verwerking

Alle AI-functies gebruiken de bestaande `LOVABLE_API_KEY` via het Lovable AI Gateway.

