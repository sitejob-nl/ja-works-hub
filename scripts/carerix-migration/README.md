# Carerix → JA Werkt Migratietool

Modulaire migratietool om alle data uit Carerix over te zetten naar JA Werkt (Supabase).

## Wat wordt gemigreerd?

| # | Carerix Entity | JA Werkt Tabel | Beschrijving |
|---|---------------|----------------|--------------|
| 1 | CRCompany | `companies` | Opdrachtgevers |
| 2 | CRContact | `company_contacts` | Contactpersonen per bedrijf |
| 3 | CREmployee | `candidates` | Kandidaten/medewerkers |
| 4 | CRAttachment | `documents` + Storage | Documenten (CV's, ID-bewijzen, etc.) |
| 5 | CRWorkHistory | `candidate_employment` | Werk-/contracthistorie |
| 6 | CRPublication | `vacancies` | Vacatures |
| 7 | CRMatch | `placements` | Plaatsingen |
| 8 | CRToDo/CRNote | `notes` + `recruiter_tasks` | Notities en taken |

## Vereisten

- Node.js 18+ (voor native `fetch`)
- Carerix API credentials (OAuth2 client)
- Supabase service_role key

## Setup

### 1. Carerix API-credentials aanmaken

1. Log in op Carerix als admin
2. Ga naar **Identity Access** → **Clients** tab
3. Maak een nieuwe client aan:
   - **Naam**: `JA Werkt Migratie`
   - **Code**: `urn:jawerkt/migration`
   - **Type**: Confidential
   - **Grant type**: `client_credentials`
   - **Default scope**: `urn:cx/cx5Wrapper:data:manage`
   - **Permissions**: Read access op alle entiteiten
4. Noteer de `client_id` en `client_secret`

### 2. Token URL ophalen

De token URL is specifiek per Carerix-instantie. Haal deze op via OpenID Discovery:

```
GET https://{jouw-carerix-domein}/.well-known/openid-configuration
```

Kopieer de `token_endpoint` waarde.

### 3. Supabase credentials

- Ga naar [Supabase Dashboard](https://supabase.com/dashboard) → Settings → API
- Kopieer de **service_role key** (niet de anon key!)

### 4. Organization ID

Voer in de Supabase SQL Editor uit:
```sql
SELECT id FROM organizations WHERE name ILIKE '%ja werkt%';
```

### 5. .env instellen

```bash
cp .env.example .env
# Vul alle waarden in
```

### 6. Dependencies installeren

```bash
npm install
```

## Gebruik

### Dry-run (geen data schrijven)

```bash
npm run migrate:dry
```

Haalt data op uit Carerix en toont wat er geïmporteerd zou worden, zonder naar Supabase te schrijven.

### Volledige migratie

```bash
npm run migrate
```

### Specifieke entiteiten

```bash
# Alleen kandidaten en documenten
npm run migrate -- --only=candidates,documents

# Alles behalve documenten
npm run migrate -- --skip=documents
```

Beschikbare namen: `companies`, `contacts`, `candidates`, `documents`, `employment`, `vacancies`, `placements`, `notes`

### Custom velden ontdekken

```bash
npm run discover-fields
```

Haalt 10 sample kandidaten op en toont alle `additionalInfo` veld-IDs met voorbeeldwaarden. Gebruik deze info om `field-mappings.json` in te vullen.

### Verificatie na migratie

```bash
npm run verify
```

Controleert: record counts, orphan references, document integriteit.

## Idempotentie

De tool is veilig om meerdere keren te draaien. Elk geïmporteerd record wordt getracked in de `external_mappings` tabel. Bij herdraaien worden bestaande records overgeslagen.

## Logging

Logs worden geschreven naar `logs/`:
- `migration-YYYY-MM-DD.log` — alle details
- `migration-errors-YYYY-MM-DD.log` — alleen fouten
- `migration-failures-YYYY-MM-DD.json` — gefaalde records met details

## Foutafhandeling

- **Per record**: fouten worden gelogd, migratie gaat door
- **Per pagina**: 3x retry bij netwerk-/serverfouten
- **Per entiteit**: bij fatale fout gaat de volgende entiteit gewoon door
- **Eindrapport**: tabel met Found/Skipped/Created/Failed per entiteit

## Custom Fields (additionalInfo)

Carerix slaat extra velden op met ID-keys (bijv. `_10126`). Workflow:

1. Draai `npm run discover-fields`
2. Match de keys met Carerix veldnamen (via Carerix admin panel)
3. Vul `field-mappings.json` in:

```json
{
  "_10126": { "target": "birth_place", "transform": "direct" },
  "_10130": { "target": "id_document_number", "transform": "direct" },
  "_10135": { "target": "has_drivers_license", "transform": "boolean" }
}
```

Mogelijke targets zijn alle kolommen uit de `candidates` tabel. Transform opties: `direct` (string), `boolean`.
