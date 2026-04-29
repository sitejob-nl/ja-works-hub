# Carerix API — Onderzoeksrapport

**Doel**: een volledig beeld krijgen van wat de Carerix-API allemaal kan en hoe je via een keten van calls aan zoveel mogelijk data komt voor de migratie van JA Werkt.

**Datum**: 2026-04-29
**Bronnen**: Carerix Help Center (officiële docs), `docs.carerix.io` GraphQL reference, GitHub `carerix/cxrest-client`, mirror op Manualzz, en de huidige integratie in `supabase/functions/_shared/carerix/*` + `supabase/functions/carerix-*/*`.

---

## 1. Carerix-landschap: drie API's, één wereld

Carerix biedt feitelijk **drie verschillende manieren** om bij data te komen. Onze huidige integratie raakt er maar één aan (de publieke v1 GraphQL), terwijl de meeste rijke data in de andere twee kanalen zit.

| Kanaal | Status | Wat zit erin | Geschikt voor |
|---|---|---|---|
| **REST API** (`api.carerix.com`) | Officieel "outdated, will not be updated" maar **werkt nog steeds** en exposed het **volledige CR\*-datamodel** | Alle entities + attachments (base64) + describe/schema introspection + zoeken via SQL-achtige `qualifier` | Initiele bulk-migratie, attachment downloads, alles wat v1 niet heeft |
| **GraphQL v1 publiek** (`api.carerix.io/graphql/v1`) | Huidige aanbevolen API — **maar publieke schema is uitgekleed** | Alleen `companyPage`, `contactPage`, `candidatePage`, `vacancyPage` met basisvelden (`_id`, name, email, displayName) | Realtime queries vanuit applicaties met beperkte rechten |
| **GraphQL "private/legacy"** (`api.carerix.io/graphql/v1` + scope `urn:cx/cx5Wrapper:data:manage`) | Volledig CR\*-schema via `crEmployeePage`, `crMatchPage`, `crCompanyPage`, `crJobPage`, `crPublicationPage`, `crDataNodePage`, `crNodeTypePage`, etc. | Identiek aan REST in dekking, maar GraphQL-stijl — qualifiers, mutations zoals `crEmployeeApply`, `crEmployeeUpdate`, `crMatchUpdate` | **Dit is wat we eigenlijk willen gebruiken in plaats van/naast REST** |
| **Webhooks** (`api.carerix.io/webhooks/v1`) | Apart product, opt-in via Customer Success | Realtime events op alle CR-entities (created/updated/deleted) | Delta-sync na initiele bulk |
| **Datasource** (FTP/S3 op `datasource.carerix.net`) | Apart betaald bundel | 80+ CSV's met daily snapshots van alles (incl. financials, hours, opportunities) — geen bestanden/attachments | BI/PowerBI-achtige analytics, **NIET** voor live integratie |

> **Belangrijke conclusie**: onze huidige sync (`SUPPORTED_ENTITIES = ['companies', 'contacts', 'candidates']`) loopt vast op de minimale publieke v1 schema. De CLAUDE.md noemt al "v1 API geen docs/employment/vacancies" — dat klopt voor de **publieke** v1, maar het CR\*-schema staat wél achter dezelfde GraphQL-endpoint, alleen met een andere scope.

---

## 2. Authenticatie

### 2.1 OAuth2 (huidige aanbeveling, en wat onze code al doet)

```
POST {token_endpoint}
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&client_id=...
&client_secret=...
&scope=urn:cx/cx5Wrapper:data:manage
```

* **Token endpoint**: per tenant verschillend, b.v. `https://id.carerix.io/auth/realms/csmdemo/protocol/openid-connect/token`. Discoveren via `{instance}/.well-known/openid-configuration` (zie `_shared/carerix/auth.ts`).
* **Client types**:
  * **Confidential** (server-to-server) — `client_credentials` flow. Dit is wat wij gebruiken.
  * **Public** (browser/mobile) — `authorization_code` + PKCE.
* **Scopes** (cruciaal — bepaalt wat je ziet):
  * `urn:cx/cx5Wrapper:data:manage` — full CR\* schema (REST-vervanger)
  * `urn:cx/cx5Wrapper:data/cruser:read` — alleen lezen op contacts/users
  * `urn:cx/cx5Wrapper:data/cruser:manage` — schrijven op contacts/users
  * `urn:cx/webhooks:data:manage` — webhooks beheren
  * `urn:cx/xmlapi:data:manage` — legacy REST/XML scope (cxrest-client gebruikt deze)
* **Token gebruik**: `Authorization: Bearer {token}`. Tokens zijn kortlevend; onze code haalt elke invocation een verse op.

### 2.2 Basic Auth (REST, legacy maar werkt)

```
Authorization: Basic base64(SYSTEM_NAME:APP_TOKEN)
```

* `SYSTEM_NAME` = je tenant slug (b.v. `publictest`).
* `APP_TOKEN` = "Application Token" gegenereerd in de Carerix UI. User tokens zijn deprecated.
* Werkt op `https://api.carerix.com/...` (let op: `.com`, **niet** `.io`).

### 2.3 IP whitelisting (alleen Datasource)

FTP/S3 datasource vereist whitelisting van Carerix' IP `3.121.45.103` op TCP 21 + 21000-21010.

---

## 3. Base URL's

| URL | Doel |
|---|---|
| `https://api.carerix.com` | Legacy REST (XML, basic auth + werkt ook met OAuth) |
| `https://api.carerix.io/graphql/v1/graphql` | Huidige GraphQL endpoint (publiek + privé scopes) |
| `https://api.carerix.io/webhooks/v1/applications` | Webhooks management API |
| `https://id.carerix.io/auth/realms/{realm}/protocol/openid-connect/...` | Keycloak OAuth (token + auth + .well-known) |
| `datasource.carerix.net:21` (FTPS) of `s3://datasource-{customer}` | CSV daily exports |
| `https://apigee.com/carerix/embed/console/cxrest` | Interactieve REST-console |
| `https://docs.carerix.io/graphql/welcome` | GraphQL docs |
| `https://help.carerix.com/en/collections/670909-technical-documentation` | Officiele technical docs index |

---

## 4. Datamodel: CR\*-entities en hun relaties

Carerix' interne datamodel hanteert overal `CR`-prefix (Carerix Recruitment). Dit zijn de bevestigde entities, met de relaties die uit de docs en GraphQL voorbeelden af te leiden zijn.

### 4.1 Hoofd-entities

| Entity | Doel | Belangrijke velden | Verwijst naar |
|---|---|---|---|
| **CREmployee** | Kandidaat én medewerker (één tabel, net als bij ons!) | `_id`, `firstName`, `lastName`, `emailAddress`, `phoneNumber`, `employeeID`, `toStatusNode`, `toUser` (eigenaar), `applySource`, `applyTags` | `CRStatusNode`, `CRUser`, `CRMatch[]`, `CRAttachment[]`, `CRWorkHistory[]` |
| **CRUser** | Recruiter/medewerker bureau (intercedent) | `_id`, `firstName`, `lastName`, `userName`, `emailAddress`, `toSingleStatusNode` | `CRStatusNode` |
| **CRCompany** | Klant/inlener | `_id`, `name`, `displayName` (publiek schema toont weinig — privé schema heeft adres/KVK/branche) | `CRContact[]`, `CRJob[]`, `CRPublication[]` |
| **CRContact** | Contactpersoon bij klant. **In privé schema is `crContact(_id)` letterlijk een view op `CRUser`** — dat suggereert dat contactpersonen ook user-records zijn | `_id`, `firstName`, `lastName`, `displayName`, `company { _id }`, `emailAddresses { items }` | `CRCompany`, `CRUser` |
| **CRJob** | Functie/positie (long-running, los van publicatie) | `_id`, `title`, `toCompany`, `toUser` (eigenaar) | `CRCompany`, `CRPublication[]`, `CRMatch[]` |
| **CRPublication** | Concrete vacature-publicatie (job × medium × periode) | `_id`, `publicationStart`, `publicationEnd`, `toMedium`, `toStatusNode`, `toVacancy` | `CRJob`/`CRVacancy`, `CRMedium`, `CRStatusNode` |
| **CRVacancy** | (Synoniem of voorganger van CRPublication — komt voor in v1 publieke schema als `vacancyPage`) | `_id`, `jobTitle`, `displayName` | — |
| **CRMatch** | **De spil**: koppelt CREmployee aan CRPublication/CRJob — dit is wat in JA Werkt een "match" + "placement" + "application" tegelijk dekt | `_id`, `notes`, `statusInfo` (stage in pipeline), `applySource`, `applyTags`, `toEmployee`, `toPublication`, `toUser` (recruiter) | `CREmployee`, `CRPublication`, `CRStatusInfo`, `CRUser` |
| **CRStatusInfo** | Pijplijn-status bij een match (Intake, Voorgesteld, Geplaatst, etc.) | `_id`, label | — |
| **CRStatusNode** | Hierarchische status-tag (b.v. `CandidateActiveTag`) | `_id`, `parentNodes`, `value` | recursief |
| **CRAttachment** | Bestand gekoppeld aan willekeurige entity (CV's, foto's, logo's, contracten) | `_id`, `tag`, `fileName`, `mimeType`, `content` (base64, alleen on-demand) | parent entity (CREmployee/CRCompany/...) |
| **CRWorkHistory** | Werkhistorie / dienstverband-record per kandidaat — **hier zitten de "employment" data die de v1 publieke schema mist** | `_id`, dates, role, company-naam | `CREmployee` |
| **CRDataNode** | Generic key-value waardes (custom fields, picklist values) | `_id`, `value`, `type { identifier }` | `CRNodeType` |
| **CRNodeType** | Definitie van een CRDataNode-type (lookup van picklists) | `_id`, `identifier` | — |
| **CRMedium** | Vacaturebron / publicatie-kanaal (jobboard, eigen site, etc.) | `_id`, `name` | — |
| **CRTodo** + virtuele subtypes `CRTask`, `CRNote`, `CRMeeting`, `CRCampaign` | Activiteiten/taken/notities/meetings/campagnes — allemaal één tabel met type-discriminator | `_id`, type, due, body, parent ref | parent entity (employee/match/company) |
| **CREmployment** | Bevestigde plaatsing (placement) — bestaat in REST/legacy schema; in v1 publiek schema **niet** als query | dates, contract, hourly rate | `CREmployee`, `CRJob`/`CRPublication` |
| **CRReference** | Referentie (referee) bij een kandidaat | naam, contact, relatie | `CREmployee` |
| **CRPicklist** | Picklist-definitie (zie ook CRDataNode) | naam, opties | — |
| **CRUserRole** | Rol van een gebruiker in het systeem | label | `CRUser` |

### 4.2 Niet-eerstelijns / overig (uit Datasource CSV's en Help Center)

`CRAgency` (uitzendbureau-record), `CRInvoice` + `CRInvoiceLine`, `CRHour` (urenregistratie), `CRDeclaration`, `CRLead`, `CRTalentPool` + `CRTalentPoolMember`, `CREducation`, `CRTraining`, `CRSkill`, `CRReport`, `CROpportunity`. Deze komen voor in de 80+ daily CSV's en zeer waarschijnlijk ook als `cr{Entity}Page` GraphQL-queries.

---

## 5. Endpoint-keten: hoe haal je álles op?

Dit is het kern-deel. De API is "een web van endpoints" — je begint bij één resource en navigeert door FK's heen. Hieronder de afhankelijkheidsboom.

### 5.1 GraphQL-pad (aanbevolen)

```
TENANT (vast)
  │
  ├─► crCompanyPage(pageable)                     [bulk companies]
  │     items[] { _id, name, address, kvkNumber, ... }
  │     │
  │     ├─► crContactPage(qualifier:"company._id eq X")   [contactpersonen]
  │     │     items[] { _id, firstName, lastName, emailAddresses, toUser }
  │     │
  │     ├─► crJobPage(qualifier:"toCompany._id eq X")     [vacatures bij klant]
  │     │     items[] { _id, title, toCompany, toUser }
  │     │     │
  │     │     └─► crPublicationPage(qualifier:"toVacancy._id eq Y")  [publicaties]
  │     │           items[] { _id, publicationStart, toMedium, toStatusNode }
  │     │
  │     └─► crAttachmentPage(qualifier:"parent._id eq X")  [logo's etc.]
  │
  ├─► crEmployeePage(pageable, qualifier)          [bulk kandidaten/medewerkers]
  │     items[] { _id, firstName, lastName, emailAddress, phoneNumber,
  │              applySource, applyTags, toUser, toStatusNode }
  │     │
  │     ├─► crMatchPage(qualifier:"toEmployee._id eq X")   [pipeline-historie]
  │     │     items[] { _id, statusInfo { _id }, notes, applySource,
  │     │              toPublication { _id, toMedium, ... },
  │     │              toUser { _id } }
  │     │
  │     ├─► crWorkHistoryPage(qualifier:"toEmployee._id eq X")  [werk-ervaring]
  │     │     items[] { _id, role, dates, companyName }
  │     │
  │     ├─► crAttachmentPage(qualifier:"toEmployee._id eq X")   [CV's, ID's]
  │     │     items[] { _id, tag, fileName, mimeType }
  │     │     │
  │     │     └─► REST: GET /CRAttachment/{_id}?show=content      [base64 bytes]
  │     │              óf GraphQL: crAttachment(_id) { content }
  │     │
  │     ├─► crTodoPage(qualifier:"parent._id eq X")        [taken/notities/meetings]
  │     │
  │     └─► crReferencePage(qualifier:"toEmployee._id eq X") [referenties]
  │
  ├─► crUserPage(pageable)                         [recruiters]
  │     items[] { _id, firstName, lastName, userName, toUserRole }
  │
  ├─► crNodeTypePage(pageable)                     [picklist-definities]
  │     items[] { _id, identifier }
  │     │
  │     └─► crDataNodePage(qualifier:"type.typeID = N")    [picklist-waarden]
  │
  ├─► crMediumPage(pageable)                       [jobboards/bronnen]
  │
  └─► crEmploymentPage(qualifier)                  [bevestigde plaatsingen]
        items[] { _id, dates, contract, toEmployee, toJob }
```

### 5.2 REST-pad (legacy, voor wat GraphQL niet heeft)

```
GET /CREmployee/list?qualifier=...&start=0&count=100&trav=true
  → lijst kandidaten + álle relaties dankzij ?trav=true (let op response size)

GET /CREmployee/{id}?show=firstName&show=attachments&trav=true
  → één kandidaat met geselecteerde velden

GET /CREmployee/{id}/attachment?tag=cv
  → expliciet attachments ophalen (alternatief voor CRAttachment-list)

GET /CRAttachment/{id}?show=content
  → base64-content + filename + mimeType (DIT is hoe je bestanden bytes krijgt)

GET /CRMatch/{id}?show=applySource&show=applyTags
  → applicant tracking (bron, tags) per match

GET /CREmployee/describe
  → schema introspection: alle velden, attributen, relaties, picklists
  → DOE DIT EERST per entity → leg vast wat er is voor je een sync bouwt
```

### 5.3 Webhooks-pad (delta-sync)

```
1. POST {token_endpoint} (scope=urn:cx/webhooks:data:manage)
2. POST https://api.carerix.io/webhooks/v1/applications
   body: { _kind: "Application", name: "ja-werkt-sync" }
   → {applicationId, publicKey, privateKey}
3. POST https://api.carerix.io/webhooks/v1/applications/{appId}/webhooks
   body: {
     _kind: "Webhook",
     url: "https://{supabase}.functions.supabase.co/carerix-webhook",
     filters: [
       { type: "cremployee:created" },
       { type: "cremployee:updated", condition: "metadata.paths has any of ['toStatusNode']" },
       { type: "crmatch:updated", condition: "data.statusinfo eq '<placedStageId>'" },
       { type: "crjob:created" }, { type: "crjob:updated" },
       { type: "crpublication:created" },
       { type: "crcompany:updated" },
       { type: "crplacement:created" }, { type: "crplacement:updated" },
       { type: "crcontact:created" }, { type: "crcontact:updated" },
       { type: "crcampaign:created" }
     ]
   }
4. Bij elk event: Carerix POST'et naar onze URL met payload
   { id, time, type, applicationId, webhookId, tenant,
     data: { entityId, changedFields: [...] } }
   + Cx-Signature header (RSA/SHA256, valideren met publicKey)
5. Wij antwoorden 200/201/204 binnen 10s
   → daarna doen we een gerichte GraphQL fetch op {entityId} om verse data op te halen
```

### 5.4 Datasource-pad (analytics-only)

```
FTPS datasource.carerix.net:21 → 80+ CSV's daily 06:00 UTC
  → vooral handig voor financials/uren/declaraties die anders moeilijk te halen zijn
  → NIET realtime, NIET voor bestanden/attachments
```

---

## 6. Zoekparameters & qualifier-syntax

### 6.1 Standaard query-parameters (REST + identiek bedoeld in GraphQL pageable)

| Parameter | Doel | Voorbeeld |
|---|---|---|
| `qualifier` | SQL-achtig WHERE — required voor zoeken | `firstName='John' AND lastName != 'Doe'` |
| `start` | Offset (0-based) | `start=0` |
| `count` | Page size (default 10, **max 100**) | `count=100` |
| `ordering` | Sortering met richting | `ordering=lastName Ascending` |
| `show` | Whitelist velden (kan herhaald) | `show=firstName&show=lastName&show=attachments` |
| `trav` | Include relaties (booleaans, `true`/`false`) | `trav=true` (let op: vergroot response sterk) |
| `norestrict` | Include soft-deleted records | `norestrict=true` — **belangrijk voor migratie**: anders mis je verwijderde records |
| `language` | Lokalisatie | `language=Dutch` (default) / `English` / `Spanish` |

### 6.2 Qualifier-operatoren

```
=, !=, <, <=, >, >=
AND, OR, NOT
LIKE met wildcards: first_name like 'john*'
IN: id in (1,2,3)
IS NULL / IS NOT NULL
```

### 6.3 Speciale type-casts in qualifier

```
publicationStart <= (NSCalendarDate) '2024-11-08 23:59:59'   # datum
amount > (NSNumber) 1000                                       # numeriek
```

Datums **moeten** een timezone hebben in REST: `YYYY-MM-DD HH:MM:SS +0200`. NSCalendarDate is overgeërfd uit Apple's WebObjects (Carerix' historische runtime).

### 6.4 GraphQL Pageable input

```graphql
crEmployeePage(
  pageable: { page: 0, size: 100, sort: "lastName,asc" }
  qualifier: "toStatusNode.parentNodes.value = 'CandidateActiveTag'"
) {
  totalElements
  totalPages
  page
  size
  first
  last
  numberOfElements
  items { ... }
}
```

---

## 7. Pagination, rate limits, delta-sync

### 7.1 Pagination

* **Page size hard limit: 100 records per request** (GraphQL én REST).
* Default: 10 (REST). Wij gebruiken `PAGE_SIZE = 100` in `carerix-sync-worker`.
* Géén cursor-based pagination — alleen offset (`page` of `start`/`count`). Gevolg: bij wijzigingen tijdens een sync kun je records dubbel of mis krijgen.

### 7.2 Rate limits

* **GraphQL: 10 req/s harde limiet**. Onze client throttle is 120ms tussen calls = ~8 req/s — prima.
* **POST/PUT body: 10 MB max**.
* **Fair use** van toepassing — geen exact aantal genoemd voor REST.
* HTTP 429 verwacht, **wij retryen exponentieel** (`MAX_RETRIES=3`, base 1000ms × 2^attempt).
* GraphQL-cost-systeem: elke query heeft een `@cost` directive (b.v. `crContact = 0.005`). Geen publieke quota's, maar fair-use.

### 7.3 Delta-sync mechanismen

**Geen ETag, geen If-Modified-Since op REST.** Beschikbare opties:

1. **Webhooks** (beste optie, vereist abonnement) — direct event-driven.
2. **Modificatie-timestamp filter via qualifier**: alle CR-entities hebben velden zoals `modificationDate` / `lastModifiedAt`. Strategie:
   ```graphql
   crEmployeePage(qualifier: "modificationDate >= (NSCalendarDate) '2026-04-28 00:00:00 +0200'")
   ```
   Bewaar de hoogste timestamp per entity en gebruik die als watermark voor de volgende run.
3. **Daily Datasource CSV diff** — alleen voor analytics-tabellen, niet voor live records.
4. **Polling per ID** — alleen zinvol voor heel kleine sets.

---

## 8. Bestanden / attachments — speciale aandacht

Dit is de meest verwarrende plek omdat er twee modellen door elkaar lopen:

### 8.1 CRAttachment (in-database files, base64)

Voor onze migratie de relevante:

```
GET /CRAttachment/{_id}?show=content
→ XML met <content>BASE64STRING</content>, <fileName>, <mimeType>, <tag>

GraphQL alternatief:
query { crAttachment(_id: "...") { _id fileName mimeType tag content } }
```

Discovery:
```
GET /CREmployee/{id}/attachment?tag=cv
→ alle attachments van die employee met een specifieke tag
```

Tags zijn vrij door de tenant te kiezen — typisch `cv`, `motivation`, `id`, `contract`, `photo`, `logo`.

### 8.2 Datasource-bestanden (FTP/S3)

Geen API-endpoint — je verbindt FTPS naar `datasource.carerix.net` of S3 bucket `datasource-{customer}`. Alleen CSV-data, **geen attachment-bytes**.

---

## 9. Bekende quirks en valkuilen

1. **Twee verschillende domeinen**: `api.carerix.com` (REST/legacy) vs `api.carerix.io` (GraphQL/webhooks). Niet verwarren met `id.carerix.io` (auth).
2. **REST docs zijn officieel "outdated"**, maar niet uitgezet. Je mag ervan uitgaan dat REST blijft werken — Carerix heeft GraphQL er expliciet bovenop gebouwd zonder REST eruit te trekken.
3. **`crContact` query is een proxy op `CRUser`** (zie `docs.carerix.io/graphql/queries/crContact` — return type is `CRUser`). Contactpersonen zijn dus user-records met een company-link.
4. **v1 publieke GraphQL = uitgekleed**: alleen `companyPage`, `contactPage`, `candidatePage`, `vacancyPage` met basisvelden. Voor alles meer **moet je de `cx5Wrapper:data:manage` scope hebben**.
5. **NSCalendarDate / NSNumber / NSArray** — Apple-WebObjects-erfenis. Verwacht XML met `<NSArray>` rondom lijsten in REST-responses.
6. **Soft deletes**: zonder `?norestrict=true` mis je verwijderde records. Voor migratie: zet 'm aan om ook geannuleerde matches en uitgeschreven kandidaten op te halen, zodat audit/historie compleet is.
7. **`?trav=true` is een bom**: trekt álle relaties in één response. Werkt voor losse fetches, maar bij `list` exploderen response-sizes. Liever expliciet per `show=`.
8. **`?show=` is whitelist, niet blacklist**: standaard krijg je een minimal set (alleen `_id` + `displayName`). Je moet expliciet alles aanvragen wat je wil zien. Dit is waarschijnlijk waarom onze huidige sync zo weinig velden vult.
9. **Datums hebben verplichte timezone in REST**: `2026-04-29 14:30:00 +0200` — zonder TZ krijg je 400 errors.
10. **Webhook-modificatie**: er is **geen update-endpoint**. Wijzigen = disable + delete + recreate. Dit moet je in je webhook-management UI verwerken.
11. **Webhook auto-disable**: als 30%+ van laatste 1.000 deliveries faalt, zet Carerix de webhook automatisch uit. Monitor 5xx rates op je `carerix-webhook` edge function.
12. **GraphQL `crEmployeeApply` mutation** voert workflow-logica uit (anti-dedupe, publicatie-koppeling, mail trigger) — gebruik die voor inbound applications uit JA Werkt naar Carerix, niet `crEmployeeUpdate`.
13. **Tokens kort levend**: ~1 uur typisch. Onze code haalt elke invocation een verse op — prima voor edge functions, voor een long-running batch zou je moeten cachen + refreshen.
14. **Geen GraphQL subscriptions** — push gaat altijd via webhooks.

---

## 10. Praktische sync-strategie voor JA Werkt

Op basis van bovenstaande, het advies:

### Fase 1 — Initiele bulk (eenmalig)

1. **Vraag scope `urn:cx/cx5Wrapper:data:manage` aan** bij Carerix admin (we gebruiken nu blijkbaar alleen de publieke v1 schema, vandaar onze gaps).
2. **Volgorde respecteren** (al goed in `ENTITY_DEPENDENCIES`):
   `CRMedium` + `CRStatusNode` + `CRNodeType` (lookups eerst) → `CRUser` → `CRCompany` → `CRContact` + `CRJob` → `CRPublication` → `CREmployee` → `CRMatch` + `CRWorkHistory` + `CRAttachment` + `CRTodo` + `CREmployment`.
3. **Voor elk entity-type**: eerst `GET /{Entity}/describe` om te zien welke velden er zijn, dan `crEntityPage` met expliciete `show=`-equivalent (volledige selectionset in GraphQL).
4. **Attachments parallel** in een aparte run: per `_id` → `crAttachment(_id) { content }` → upload naar Supabase storage `documents` bucket → vul `documents.file_url`.
5. **Norestrict: aan** om historie compleet te krijgen.

### Fase 2 — Webhooks aanvragen

1. Customer Success vragen om webhooks te activeren (zit in betaald Datasource-bundel).
2. `crCompanyContext`-endpoint deployen + `Cx-Signature` valideren.
3. Filters per entity zoals in §5.3.
4. Op event → fetch verse data via GraphQL → upsert in JA Werkt.

### Fase 3 — Watermark-fallback

Voor elk event-type dat we **niet** via webhook krijgen (b.v. CRWorkHistory bestaat niet in webhook list):
* daily cron → `cr{Entity}Page(qualifier: "modificationDate >= '{lastSync}'")` → upsert.

### Fase 4 — Datasource voor financials

* FTP-credentials aanvragen → 80+ CSV's daily → parser in edge function → vul `invoices`, `invoice_lines`, `timesheets`, `mileage_entries` waar de live API geen dekking biedt.

---

## 11. Concrete URLs (officiele docs)

| Onderwerp | URL |
|---|---|
| REST API overzicht | https://help.carerix.com/en/articles/9464648-carerix-rest-api |
| REST API methods | https://help.carerix.com/en/articles/9470760-rest-api-methods |
| GraphQL overzicht | https://help.carerix.com/en/articles/9482350-graphql-api |
| GraphQL voorbeelden | https://help.carerix.com/en/articles/10067801-graphql-api-examples |
| GraphQL schema docs | https://docs.carerix.io/graphql/welcome |
| GraphQL crContact ref | https://docs.carerix.io/graphql/queries/crContact |
| GraphQL crMatchPage ref | https://docs.carerix.io/graphql/queries/crMatchPage |
| Webhooks intro | https://help.carerix.com/en/articles/9240207-introducing-webhooks-in-carerix |
| Webhook step-by-step | https://help.carerix.com/en/articles/9362341-creating-your-first-webhook-a-step-by-step-guide-with-popular-examples |
| Applicant Source Tracking | https://help.carerix.com/en/articles/1745721-applicant-source-tracking-api-developer |
| Datasource CSV-export | https://help.carerix.com/en/articles/4561381-carerix-datasource |
| Datasource files retrieve | https://help.carerix.com/en/articles/9582534-carerix-datasource-how-to-link-retrieve-datasource-files |
| Technical docs collection | https://help.carerix.com/en/collections/670909-technical-documentation |
| Search/qualifier syntax | https://help.carerix.com/en/articles/1958440-search |
| REST API console (Apigee) | https://apigee.com/carerix/embed/console/cxrest |
| PHP client (officieel) | https://github.com/carerix/cxrest-client |
| PHP client (community fork) | https://github.com/mrbaileys/cxrest-client |
| Manualzz REST mirror | https://manualzz.com/doc/30049762/cxrest---carerix |

---

## 12. Aanknopingspunten voor onze bestaande code

Bestanden om aan te passen voor uitbreiding naar volledig CR\*-schema:

| Bestand | Verandering |
|---|---|
| `supabase/functions/_shared/carerix/types.ts` | Voeg interfaces toe voor `CREmployee` (volledig), `CRMatch`, `CRJob`, `CRPublication`, `CRWorkHistory`, `CRAttachment`, `CRTodo`, `CREmployment`. Pas `SUPPORTED_ENTITIES` uit zodra scope geregeld is. |
| `supabase/functions/_shared/carerix/queries.ts` | Voeg `employmentQuery`, `matchQuery`, `attachmentQuery`, `todoQuery`, `workHistoryQuery` toe — met `qualifier` parameter voor delta-sync. |
| `supabase/functions/_shared/carerix/runner.ts` | Voeg `runMatchesPage`, `runEmploymentPage`, `runDocumentsPage` (= attachment download), `runNotesPage` toe. |
| `supabase/functions/_shared/carerix/auth.ts` | Scope per entity overrideable maken (lees-scope vs manage-scope). |
| Nieuw: `supabase/functions/carerix-webhook/index.ts` | Inkomende events ontvangen + `Cx-Signature` valideren + gerichte GraphQL fetch + upsert. |
| Nieuw: `supabase/migrations/...carerix_external_ids.sql` | `external_mappings` tabel uitbreiden met `carerix_match_id`, `carerix_publication_id` etc. — nu is alleen `candidate`/`company`/`contact` gemapped. |
| `src/pages/CarerixImport.tsx` | UI om scope-niveau te kiezen + delta-sync watermark te tonen. |

---

**Einde rapport.**
