

## Plan: Vacatures wegfilteren uit Kandidaten Zoeken resultaten

### Probleem
De Exa API met `category: "person"` geeft een mix terug van echte profielen (LinkedIn, At Monday) en vacaturepagina's (Jigler, Indeed, etc.). Dit is een bekende beperking van de Exa API.

### Oplossing: Server-side filtering in de edge function

**Bestand: `supabase/functions/exa-people-search/index.ts`**

Na ontvangst van Exa resultaten, filter de resultaten op basis van:

1. **URL-patronen uitsluiten** — bekende vacaturesites:
   - `jigler.nl/vacatures`, `indeed.com`, `linkedin.com/jobs`, `werkzoeken.nl`, `nationalevacaturebank.nl`, `jobbird.com`, `monsterboard.nl`, `glassdoor.com/job`, `randstad.nl/vacature`, `tempo-team.nl`, `yacht.nl`, `hays.nl`, `brunel.nl`, `manpower.nl`
   
2. **Titel-patronen uitsluiten** — woorden die duiden op vacatures:
   - Titel bevat "Vacature", "vacature", "Job opening", "Solliciteer", "We're hiring"

3. **Extra resultaten opvragen** — Vraag meer resultaten op dan gevraagd (bijv. 1.5x) zodat na filtering het gewenste aantal overblijft

4. **`is_vacancy` flag** — Optioneel: markeer resultaten die mogelijk vacatures zijn zodat de UI ze kan dimmen/verbergen

### Wijzigingen

**`supabase/functions/exa-people-search/index.ts`**:
- Voeg een `VACANCY_URL_PATTERNS` en `VACANCY_TITLE_PATTERNS` array toe
- Filter `results` array na API response, voor de upsert
- Vraag 1.5x `numResults` op van Exa, trim na filtering terug naar het gewenste aantal
- Log hoeveel resultaten gefilterd zijn

**`src/pages/KandidatenZoeken.tsx`**:
- Toon in de success toast ook hoeveel er gefilterd zijn (bijv. "20 gevonden, 5 vacatures gefilterd, 15 opgeslagen")
- Voeg een kleine hint toe in de UI: "Vacature-links worden automatisch gefilterd"

### Geen database wijzigingen nodig
