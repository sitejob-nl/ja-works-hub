

## Plan: Exa People Search Module

### Samenvatting
Nieuwe "Kandidaten Zoeken" functionaliteit die de Exa People Search API integreert via een edge function. Hiermee kun je professionals vinden op basis van natural language queries (functie, locatie, ervaring).

### Stap 1: Exa API Key Secret
Een `EXA_API_KEY` secret moet worden toegevoegd aan Supabase. De gebruiker moet deze ophalen op https://exa.ai.

### Stap 2: Database Migration

**Nieuwe tabel: `people_search_results`**
- `id` (uuid PK), `organization_id` (uuid FK, not null)
- `external_id` (text, not null) — Exa result ID
- `name` (text), `title` (text), `url` (text), `image_url` (text)
- `published_date` (timestamptz)
- `text_content` (text) — full profile text if enabled
- `highlights` (text[]), `highlight_scores` (numeric[])
- `search_query` (text) — de query waarmee gevonden
- `date_imported` (timestamptz, default now())
- `raw_data` (jsonb)
- UNIQUE on `(organization_id, external_id)`
- Standard tenant RLS policies

### Stap 3: Edge Function `exa-people-search`

- `supabase/functions/exa-people-search/index.ts`
- Config: `verify_jwt = false`
- Auth via `getClaims()`, haalt `organization_id` op uit profiles
- Accepteert: `{ query, userLocation?, numResults?, includeText?, highlightsQuery? }`
- Calls Exa API: `POST https://api.exa.ai/search` met `type: "neural"`, `category: "company"`, `subpages: 0`
  - Endpoint: `https://api.exa.ai/findSimilar` of `https://api.exa.ai/search` met `category: "person"`
- Upserts resultaten in `people_search_results`
- Returns resultaten direct

### Stap 4: Frontend

**Uitbreiding van de Vacaturebank pagina** met een tweede tab "Kandidaten zoeken", of een **apart pad `/kandidaten-zoeken`**.

Gezien de bestaande structuur: toevoegen als **aparte pagina** die past binnen de `kandidaten` module.

**`src/pages/KandidatenZoeken.tsx`:**
- Zoekbalk met natural language query input
- Optionele filters: land (ISO code), max resultaten (1-100), profieltekst aan/uit
- Resultaten als kaarten met: naam, titel, profielfoto, LinkedIn link, highlights
- "Opslaan" knop om resultaten in de database te cachen
- Mogelijkheid om een resultaat te koppelen aan een bestaande kandidaat (later)

### Stap 5: Routing & Sidebar

- `App.tsx`: route `/kandidaten-zoeken` → `KandidatenZoeken`
- `AppSidebar.tsx`: nieuw nav item `{ label: 'Kandidaten zoeken', icon: UserSearch, path: '/kandidaten-zoeken', moduleKey: 'kandidaten' }` — valt onder bestaande `kandidaten` module
- Geen wijziging nodig in `ALL_MODULES`

### Bestanden

| Actie | Bestand |
|-------|---------|
| Create | `src/pages/KandidatenZoeken.tsx` |
| Create | `supabase/functions/exa-people-search/index.ts` |
| Create | DB migration (people_search_results) |
| Edit | `src/App.tsx` — nieuwe route |
| Edit | `src/components/layout/AppSidebar.tsx` — nav item |
| Edit | `supabase/config.toml` — edge function config |

### Vereist
- Gebruiker moet `EXA_API_KEY` secret toevoegen aan Supabase

