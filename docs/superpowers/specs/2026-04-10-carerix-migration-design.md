# Carerix → JA Werkt Migratietool

## Context

JA Werkt gebruikt Carerix als hun huidige ATS (Applicant Tracking System). Alle data moet gemigreerd worden naar het nieuwe JA Werkt platform (Supabase). Dit betreft ~1850 kandidaten, tientallen bedrijven, contactpersonen, plaatsingen, vacatures, werk-/contracthistorie, notities/taken, en alle documenten per kandidaat (CV's, ID-bewijzen, etc.).

De migratie is eerst eenmalig (volledige overheveling), met optioneel later een incrementele sync.

Er zijn nog geen Carerix API-credentials aangemaakt — instructies daarvoor zijn onderdeel van dit ontwerp.

## Architectuur

### Runtime & Locatie

**Node.js/TypeScript script op de Hetzner VPS** (dezelfde VPS als het LLM model). Redenen:
- Geen timeout limieten (Edge Functions: max 150s)
- Kan grote document-downloads verwerken zonder geheugendruk
- Makkelijk te herstarten bij fouten
- Later herbruikbaar voor sync-fase

Het project leeft als standalone directory in de repo: `scripts/carerix-migration/`.

### Carerix GraphQL API

- **Endpoint**: `POST https://api.carerix.io/graphql/v1/graphql`
- **Auth**: OAuth2 `client_credentials` flow, scope `urn:cx/cx5Wrapper:data:manage`
- **Rate limit**: 10 requests/seconde
- **Max records**: 100 per pagina
- **Paginatie**: page-based (`pageNumber`/`pageSize`)
- **Qualifier syntax**: SQL-achtig (bijv. `"firstName = 'John'"`)

### Doeltabellen (Supabase)

| Carerix Entity | JA Werkt Tabel | Scope |
|---|---|---|
| CRCompany | `companies` | Naam, KVK, adres, contact |
| CRContact | `company_contacts` | Contactpersonen per bedrijf |
| CREmployee | `candidates` | Kandidaten/medewerkers (merged model) |
| CRAttachment | `documents` + Supabase Storage | Bestanden per kandidaat |
| CRWorkHistory | `candidate_employment` | Dienstverbanden/contracthistorie |
| CRPublication | `vacancies` | Vacatures |
| CRMatch | `placements` | Plaatsingen |
| CRToDo/CRNote | `notes` | Notities per entiteit |
| CRTask | `recruiter_tasks` | Taken |

## Directory Structuur

```
scripts/carerix-migration/
  package.json
  tsconfig.json
  .env.example
  README.md
  field-mappings.json           # Custom field mappings (additionalInfo)

  src/
    index.ts                    # Orchestrator CLI
    config.ts                   # .env laden + valideren

    lib/
      carerix-auth.ts           # OAuth2 token management (auto-refresh)
      carerix-client.ts         # GraphQL client + paginatie + rate limiter
      supabase-client.ts        # Supabase admin client (service_role key)
      id-mapper.ts              # external_mappings read/write + in-memory cache
      logger.ts                 # Winston: console + file logging
      progress.ts               # Teller per entiteit + eindrapport
      status-maps.ts            # Carerix → JA Werkt enum mappings

    migrators/
      01-companies.ts
      02-contacts.ts
      03-candidates.ts
      04-documents.ts
      05-employment-history.ts
      06-vacancies.ts
      07-placements.ts
      08-notes.ts

    discover-fields.ts          # Helper: ontdek additionalInfo velden
    verify.ts                   # Post-migratie verificatie
```

## Importvolgorde

```
1. companies        (geen afhankelijkheden)
2. contacts         (depends on: companies)
3. candidates       (geen afhankelijkheden)
4. documents        (depends on: candidates)
5. employment-hist  (depends on: candidates)
6. vacancies        (depends on: companies)
7. placements       (depends on: candidates, companies, vacancies)
8. notes            (depends on: candidates, companies — polymorfisch)
```

## Shared Modules

### `carerix-auth.ts`
- OAuth2 `client_credentials` flow tegen Carerix token endpoint
- Cachet token in geheugen, refresht automatisch vóór expiry
- Export: `getAccessToken(): Promise<string>`

### `carerix-client.ts`
- `fetch`-based GraphQL client (geen extra deps, Node 18+ heeft native fetch)
- Ingebouwde rate limiter: token bucket, 10 tokens/sec
- Auto-paginatie: `paginateAll<T>(query, extractPage) → AsyncGenerator<T>`
- Retry met exponential backoff bij 429/5xx (max 3 retries)

### `supabase-client.ts`
- `@supabase/supabase-js` met `service_role` key (bypast RLS)
- Niet de Vite-client uit `src/integrations/supabase/client.ts`

### `id-mapper.ts`
- Bulk-laadt alle bestaande `external_mappings` waar `external_system = 'carerix'` bij startup
- `getJaWerktId(entityType, carerixId): string | null` — snelle in-memory lookup
- `saveMapping(entityType, jaWerktId, carerixId, metadata?): Promise<void>` — insert + cache update
- Dit is het kern-idempotentie-mechanisme: als Carerix ID al gemapped is → skip

### `status-maps.ts`
- Configureerbare `Map<string, string>` per entiteittype
- Onbekende statussen → default fallback + warning log
- Ontdek-fase: `discover-fields.ts` kan alle Carerix statussen ophalen

## Veldmappings

### Companies (`CRCompany` → `companies`)

| Carerix | JA Werkt | Transform |
|---------|----------|-----------|
| `_id` | `external_mappings.external_id` | string |
| `name` | `name` | direct |
| `kvkNumber` | `kvk_number` | direct |
| `btwNumber` | `btw_number` | direct |
| `emailAddress` | `email` | direct |
| `phoneNumber` | `phone` | direct |
| `website` | `website` | direct |
| `street` | `address_street` | direct |
| `postalCode` | `address_postal` | direct |
| `city` | `address_city` | direct |
| `country` | `address_country` | direct |
| — | `organization_id` | config waarde |

### Contacts (`CRContact` → `company_contacts`)

| Carerix | JA Werkt | Transform |
|---------|----------|-----------|
| `_id` | `external_mappings.external_id` | string |
| `firstName` | `first_name` | direct |
| `lastName` | `last_name` | direct |
| `emailAddress` | `email` | direct |
| `phoneNumber` | `phone` | direct |
| `jobTitle` | `function_title` | direct |
| company relatie | `company_id` | via id-mapper |

### Candidates (`CREmployee` → `candidates`)

| Carerix | JA Werkt | Transform |
|---------|----------|-----------|
| `_id` | `external_mappings.external_id` | string |
| `employeeID` | `employee_number` | direct |
| `firstName` | `first_name` | direct |
| `middleName` | `middle_name` | direct |
| `lastName` | `last_name` | direct |
| `emailAddress` | `email` | direct |
| `mobileNumber` / `phoneNumber` | `phone` | prefer mobile |
| `dateOfBirth` | `date_of_birth` | ISO date |
| `gender` | `gender` | map M/V/X |
| `nationality` | `nationality` | direct |
| `socialSecurityNumber` | `bsn` | direct (DB trigger encrypts) |
| `iban` / `bankAccountNumber` | `iban` | direct (DB trigger encrypts) |
| adres velden | `address_*` | direct |
| `statusInfo.value` | `status` | status mapping |
| `additionalInfo` | diverse | via field-mappings.json |
| — | `source` | `'carerix'` |
| — | `organization_id` | config waarde |

### Documents (`CRAttachment` → Storage + `documents`)

| Carerix | JA Werkt | Transform |
|---------|----------|-----------|
| `_id` | `external_mappings.external_id` | string |
| `label` | (naam in storage) | direct |
| `filePath` | storage pad | sanitize filename |
| `content` | bestand in Storage | base64 decode → upload |
| `toTypeNode.value` | `type` | document type mapping |
| — | `candidate_id` | via id-mapper |
| — | `status` | `'geldig'` |

**Storage pad**: `{org_id}/{candidate_id}/{carerix_attachment_id}_{filename}`

**CV special case**: Als type = CV → ook `cv_file_url` op kandidaat updaten.

### Employment History (`CRWorkHistory` → `candidate_employment`)

| Carerix | JA Werkt | Transform |
|---------|----------|-----------|
| `_id` | `external_mappings.external_id` | string |
| `employer` | `notes` (als context) | direct |
| `startDate` | `start_date` | ISO date |
| `endDate` | `end_date` | ISO date |
| `jobTitle` | `notes` (append) | direct |
| `contractType` | `contract_type` | mapping indien bekend |
| — | `candidate_id` | via id-mapper |
| — | `is_current` | `endDate == null` |
| — | `organization_id` | config waarde |

### Vacancies (`CRPublication` → `vacancies`)

| Carerix | JA Werkt | Transform |
|---------|----------|-----------|
| `_id` | `external_mappings.external_id` | string |
| `title` / `jobTitle` | `title` | direct |
| `description` / `body` | `description` | strip HTML |
| `city` / `location` | `location` | direct |
| `hourlyRate` | `hourly_rate` | parse number |
| `statusInfo.value` | `status` | status mapping |
| company relatie | `company_id` | via id-mapper |

### Placements (`CRMatch` → `placements`)

| Carerix | JA Werkt | Transform |
|---------|----------|-----------|
| `_id` | `external_mappings.external_id` | string |
| `toEmployee._id` | `employee_id` + `candidate_id` | via id-mapper (zelfde UUID) |
| `toCompany._id` | `company_id` | via id-mapper |
| `toPublication._id` | `vacancy_id` | via id-mapper (nullable) |
| `startDate` | `start_date` | ISO date (required) |
| `endDate` | `end_date` | ISO date |
| `hourlyRate` | `hourly_rate` | parse, default 0 |
| `functionTitle` | `function_name` | direct, fallback "Onbekend" (required) |
| `statusInfo.value` | `status` | status mapping |
| `notes` | `notes` | direct |

### Notes (`CRToDo`/`CRNote` → `notes` + `recruiter_tasks`)

| Carerix | JA Werkt Tabel | Transform |
|---------|----------------|-----------|
| CRNote/CRToDo (type=note) | `notes` | `body` = content, `related_entity_type` = 'candidate'/'company', `related_entity_id` via id-mapper |
| CRTask/CRToDo (type=task) | `recruiter_tasks` | `title`, `description`, `status`, `due_date`, `related_entity_*` |

**`notes` tabel vereist `created_by`**: Dit is een UUID die naar `profiles` verwijst. Migratie-notities gebruiken de service account's user ID of een dedicated "migratie" profiel.

## Status Mappings

### Candidate Status

| Carerix | JA Werkt (`candidate_status`) |
|---------|-------------------------------|
| Nieuw / New | `nieuw` |
| In behandeling | `in_behandeling` |
| Beschikbaar / Available | `beschikbaar` |
| Geplaatst / Placed | `geplaatst` |
| Inactief / Niet beschikbaar | `inactief` |
| Afgewezen / Rejected | `afgewezen` |
| (onbekend) | `nieuw` (default + warning) |

### Document Type

| Carerix `toTypeNode.value` | JA Werkt (`document_type`) |
|----------------------------|----------------------------|
| CV / Curriculum Vitae | `overig` + set `cv_file_url` |
| ID / Paspoort / Identiteitsbewijs | `id_bewijs` |
| Rijbewijs | `rijbewijs` |
| Certificaat / Diploma | `certificaat` |
| Contract | `contract` |
| Bankbewijs | `bankbewijs` |
| Loonstrook | `loonstrook` |
| (onbekend) | `overig` (default + warning) |

### Vacancy Status

| Carerix | JA Werkt (`vacancy_status`) |
|---------|-----------------------------|
| Open / Actief | `open` |
| On hold | `on_hold` |
| Vervuld / Filled | `vervuld` |
| Gesloten / Closed | `gesloten` |
| (onbekend) | `gesloten` (default) |

### Placement Status

| Carerix | JA Werkt (`placement_status`) |
|---------|-------------------------------|
| Gepland / Planned | `gepland` |
| Actief / Active | `actief` |
| Afgerond / Completed | `afgerond` |
| Voortijdig beëindigd | `voortijdig_beeindigd` |
| (onbekend) | `afgerond` (default) |

## Error Handling

1. **Per record**: try/catch, log error + Carerix ID, ga door met volgende
2. **Per pagina**: 3x retry met exponential backoff (1s, 2s, 4s) bij 429/5xx
3. **Per entiteit**: catastrofale fout (bijv. ongeldige token) → stop migrator, ga door met volgende indien onafhankelijk
4. **Idempotent**: herdraaien is veilig — bestaande records worden overgeslagen via `external_mappings`
5. **Eindrapport**: tabel met Found/Skipped/Created/Failed/Duration per entiteit
6. **Failures file**: `migration-failures-YYYY-MM-DD.json` met alle gefaalde records

## CLI Interface

```bash
# Volledige migratie
npm run migrate

# Dry-run (data ophalen, niets schrijven)
npm run migrate:dry

# Alleen specifieke entiteiten
npm run migrate -- --only=candidates,documents

# Skip specifieke entiteiten
npm run migrate -- --skip=documents

# Ontdek custom velden
npm run discover-fields

# Verificatie na migratie
npm run verify
```

## Configuratie (.env)

```env
# Carerix API
CARERIX_GRAPHQL_URL=https://api.carerix.io/graphql/v1/graphql
CARERIX_TOKEN_URL=               # Ophalen via OpenID Discovery: GET https://{carerix-instance}/.well-known/openid-configuration → token_endpoint
CARERIX_CLIENT_ID=
CARERIX_CLIENT_SECRET=
CARERIX_SCOPE=urn:cx/cx5Wrapper:data:manage

# Supabase (service_role key, NIET anon key)
SUPABASE_URL=https://noaupcteygfvlyymqtew.supabase.co
SUPABASE_SERVICE_ROLE_KEY=

# Migratie
ORGANIZATION_ID=
DRY_RUN=false
BATCH_SIZE=100
STORAGE_BUCKET=documents
```

## Credential Setup (instructies voor Jeroen)

1. **Carerix OAuth2 client aanmaken**:
   - Log in op Carerix als admin
   - Ga naar Identity Access → Clients tab
   - Maak nieuwe client aan:
     - Naam: `JA Werkt Migratie`
     - Code: `urn:jawerkt/migration`
     - Type: Confidential
     - Grant type: `client_credentials`
     - Default scope: `urn:cx/cx5Wrapper:data:manage`
     - Permissions: Read access op alle entiteiten
   - Noteer `client_id` en `client_secret`

2. **Supabase service_role key**:
   - Supabase Dashboard → Settings → API → `service_role` key kopiëren

3. **Organization ID ophalen**:
   ```sql
   SELECT id FROM organizations WHERE name ILIKE '%ja werkt%';
   ```

## Custom Fields (additionalInfo)

Carerix slaat extra velden op in `additionalInfo` met keys als `_10126`. De mapping moet ontdekt worden:

1. Draai `npm run discover-fields` — haalt 10 sample kandidaten op en logt alle unieke keys
2. Vergelijk met Carerix admin panel welke key bij welk veld hoort
3. Vul `field-mappings.json` in:

```json
{
  "_10126": { "target": "birth_place", "transform": "direct" },
  "_10130": { "target": "id_document_number", "transform": "direct" },
  "_10131": { "target": "id_document_type", "transform": "direct" }
}
```

Onbekende keys worden genegeerd (debug log).

## Document Processing

Documenten zijn het zwaarste onderdeel (~3+ bestanden per kandidaat gemiddeld):

1. Per kandidaat: attachments ophalen via GraphQL `attachments { items { _id filePath label content toTypeNode { value } } }`
2. `Buffer.from(content, 'base64')` → raw bytes
3. Upload naar Supabase Storage: `documents/{org_id}/{candidate_id}/{attachment_id}_{filename}`
4. Insert `documents` rij met `file_url`, `type`, `candidate_id`
5. Als type = CV → update `candidates.cv_file_url`
6. Parallelisme: `p-limit(3)` — max 3 uploads tegelijk
7. Geheugen: verwerk per kandidaat, niet alles tegelijk

**Fallback**: Als base64 content niet inline in GraphQL response zit (te groot), gebruik REST endpoint: `GET https://api.carerix.com/CRAttachment/{id}?show=content`

## Verificatie

### Geautomatiseerd (`npm run verify`)

1. **Count vergelijking**: Carerix `totalElements` vs JA Werkt count + failed count
2. **Mapping completeness**: `SELECT entity_type, COUNT(*) FROM external_mappings WHERE external_system = 'carerix' GROUP BY entity_type`
3. **Orphan check**: placements zonder geldige candidate_id of company_id
4. **Document steekproef**: 20 random kandidaten — document count matchen
5. **Storage check**: bestanden bestaan en zijn > 0 bytes

### Handmatig

- 5 random kandidaten vergelijken met Carerix (naam, BSN, documenten)
- BSN/IBAN decrypt testen via `get_candidate_decrypted` RPC
- Documenten downloaden en openen
- Contactpersonen checken bij bedrijven

## Dependencies

```json
{
  "dependencies": {
    "@supabase/supabase-js": "^2.98.0",
    "dotenv": "^16.4.0",
    "winston": "^3.11.0",
    "p-limit": "^5.0.0"
  },
  "devDependencies": {
    "tsx": "^4.7.0",
    "typescript": "^5.8.0",
    "@types/node": "^22.0.0"
  }
}
```

Geen `graphql-request` nodig — plain `fetch` met de GraphQL endpoint is simpeler. Node 18+ heeft native fetch.

## Design Beslissingen

1. **Service role key**: Nodig omdat er geen ingelogde gebruiker is. RLS vereist `auth.uid()`. Audit trail toont `user_id = null` voor migratie-records — acceptabel.

2. **Gescheiden van frontend**: Eigen Supabase client met `process.env`, niet de Vite-client met `import.meta.env`.

3. **Sequentiële entiteitsmigratie**: Referentiële integriteit vereist volgorde (bedrijven vóór contacten vóór plaatsingen).

4. **external_mappings als idempotency key**: Bestaande tabel, al in gebruik door CSV import. Herdraaien is veilig.

5. **BSN/IBAN als plaintext schrijven**: DB triggers encrypten automatisch via Vault.

6. **`notes.created_by` veld**: Required UUID naar `profiles`. Maak een dedicated "migratie" profiel aan, of gebruik een bestaand admin profiel.
