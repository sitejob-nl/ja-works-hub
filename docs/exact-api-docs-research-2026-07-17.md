# Exact Online REST API — officiële-docs-research (voor integratie-audit)

Datum: 2026-07-17. Onderzoek t.b.v. audit van een bestaande Exact Online-koppeling (verkoopfacturen, crm/Accounts, GL-mapping, VATCodes, webhooks) die via SiteJob Connect tokens krijgt en daarna rechtstreeks de Exact API aanroept.

## Bronnen & toegangsmethode (belangrijk voor de bewijswaarde)

- **Entity-referentie (`start.exactonline.nl/docs/…`)**: volledig leesbaar; alle claims hieruit zijn direct tegen de officiële pagina geverifieerd. Label: **[entity-docs]**.
- **Developer-KB (`support.exactonline.com/community/s/article/All-All-DNO-…`)**: de canonieke artikelen bestaan, maar de Salesforce-app rendert **niet** zonder browser-JS (ook niet via rendering-proxy; bot-detectie). Claims hieruit zijn geverifieerd via **letterlijke zoekmachine-snippets van het geïndexeerde officiële artikel** (DuckDuckGo/Yahoo/Brave, alleen `site:support.exactonline.com`-hits). Snippet = originele artikeltekst, maar zonder omringende context. Label: **[KB-snippet]**. Waar zelfs dat niet lukte: expliciet in "Niet geverifieerd".
- **OData v2/v3-spec (`odata.org`)**: Exact's API is OData v3 "verbose JSON"; formaat-claims (literals, `__next`, `/Date()/`, error-object) zijn tegen de spec geverifieerd. Label: **[OData-spec]**.
- Dood/onbereikbaar: `developers.exactonline.com` (cert wijst naar exact.com — portal opgeheven, alles is naar de support-KB verhuisd), `web.archive.org` en `archive.ph` (geblokkeerd in deze omgeving).

---

## 1. OAuth (tokens, rotatie, levensduur)

- **Access token = 10 minuten geldig.** "You now have a new access token that is valid for 10 minutes, and a new refresh token." **[KB-snippet]** — Step 4: https://support.exactonline.com/community/s/article/All-All-DNO-Content-oauth-eol-oauth-devstep4?language=en_US
  - Bevestigd in tweede bron: "An access token is valid for 600 seconds." **[KB-snippet]** — https://support.exactonline.com/community/s/article/All-All-DNO-Content-respcodeserrorhandling?language=en_GB
- **Refresh-token roteert bij élke refresh; oude wordt ongeldig.** "You can use your new refresh token to receive a new access token. Your old refresh token is no longer valid." **[KB-snippet]** — devstep4 (zie boven). En: "When you receive a refresh token, any previous refresh token is invalidated." (geldt óók voor de authorization-code-flow) **[KB-snippet]** — Troubleshooting refresh tokens: https://support.exactonline.com/community/s/article/All-All-DNO-Content-oauth-eol-oauth-devtrblshtng?language=nl_NL
  - Audit-implicatie: refresh-token opslaan moet transactioneel/gelockt; twee gelijktijdige refreshes = één dood token.
- **Refresh-token vervalt na 30 dagen (sinds juli 2021).** "Starting July 2021, refresh tokens will only be valid for 30 days." **[KB-snippet]** — devstep4 + Implementation overview: https://support.exactonline.com/community/s/article/All-All-DNO-Content-oauth-eol-oauth-dev-impleovervw?language=en_GB. Semantiek = inactiviteit: "If the app is not used in 30 days, you must make a new authorization request to the user." **[KB-snippet]** — devstep4 (nl_NL).
- **Token-endpoint is zelf gethrottled: niet refreshen binnen 570 s na de vorige token-request.** "Rate limit exceeded: access_token not expired. An access token is valid for 600 seconds. The access token cannot be refreshed before 570 seconds from the last token request." **[KB-snippet]** — respcodeserrorhandling (zie boven). Oftewel: pas in de laatste ~30 s van de token-levensduur (of ná expiry) mag je verversen; eerder = geweigerd. Exacte HTTP-status van die weigering niet zichtbaar in snippet.
- **Verlopen access token ⇒ 401 "Authentication Required".** "If you make an API call with an expired access token, your call will be rejected with response code 401 and reason Authentication Required." **[KB-snippet]** — Step 3: https://support.exactonline.com/community/s/article/All-All-DNO-Content-oauth-eol-oauth-devstep3?language=nl_NL
- **Redirect-URL moet HTTPS zijn, anders 401 bij de auth-request.** "Otherwise, you will receive a 401 error. Make sure the redirect URL you entered in the App Store is also in HTTPS." **[KB-snippet]** — Step 2: https://support.exactonline.com/community/s/article/All-All-DNO-Content-oauth-eol-oauth-devstep2?language=en_GB
- **`x-exact-oauth2-*` response headers: GEEN spoor.** Nul resultaten in de volledige zoekindex ("x-exact-oauth2" → "We did not find results"), niets in de entity-docs. Vermoedelijk bestaan deze headers niet (of zijn ze ongedocumenteerd). → Zie "Niet geverifieerd"; audit-claim hierop niet baseren, runtime checken.

## 2. Rate limits

- **Minutely: 60 calls per app, per company (division), per minuut. Daily: 5.000 per app, per company, per dag.** "Minutely limit - your app can make 60 API calls, per company, per minute. Daily limit - your app can make 5,000 API calls, per company, per day." **[KB-snippet]** — API limits: https://support.exactonline.com/community/s/article/All-All-DNO-Simulation-gen-apilimits (in werking sinds 1 juli 2021, per eerdere snippet van dezelfde pagina)
  - Scope-bevestiging: "The REST API has a limit per day and per minute. Both are per app and per division." **[KB-snippet]** — Restrictions: https://support.exactonline.com/community/s/article/All-All-DNO-Content-rest-restrictions?language=en_GB
- **Response headers** (artikel "Keep track of Exact Online API limits" — geldt per app): **[KB-snippet]** — https://support.exactonline.com/community/s/article/All-All-HNO-Concept-general-exactonlineappcentre-appcent-apilimitc
  - Daily: "X-RateLimit-Limit - Displays the maximum number of API calls that your app is allowed to make per company, per day".
  - "X-RateLimit-Reset - Displays the remaining time until the time limit window resets" (NB: deze officiële omschrijving is ambigu — "remaining time" vs epoch-timestamp; in de praktijk staat er een Unix-epoch in **milliseconden**, maar dat formaat is hier níet doc-geverifieerd → runtime checken).
  - Minutely-variant bestaat als eigen header-familie: "For minutely limit X-RateLimit-Minutely-Limit - Displays the maximum number …" (snippet afgekapt; `X-RateLimit-Minutely-Remaining` / `-Minutely-Reset` per naamgevingspatroon aannemelijk maar niet letterlijk in snippet gezien).
- **429 = limiet overschreden.** "This error indicates that the API limits have been exceeded. Rate limits are applied to your app's API calls to ensure the reliability and performance of Exact Online." **[KB-snippet]** — respcodeserrorhandling. Of daarbij een `Retry-After`-header wordt meegegeven: niet in leesbare snippets aangetroffen (zoek-hit op de term binnen dat artikel bestaat wél) → runtime verifiëren; veilige backoff: wachten tot de betreffende Reset.
- **Request-size limiet 10.0 MB** en FAQ over verhogen daily limit staan in het API-limits-artikel. **[KB-snippet]** — gen-apilimits. **URL-lengte max 6000 tekens.** **[KB-snippet]** — rest-restrictions.

## 3. OData v3-quirks (pagination, filters, datums)

- **Paginagrootte: 60 voor de meeste endpoints; bulk & sync 1000.** "Most of the REST API have a page size of 60. The bulk and sync endpoints have a pagesize of 1000." + "It is recommended to use the sync endpoints where possible." **[entity-docs]** — index: https://start.exactonline.nl/docs/HlpRestAPIResources.aspx
- **Server-driven paging via `__next` + `$skiptoken`.** "The '__next' property will contain a link to request the next set of records including the $select, $filter, or any other option you passed in the initial request with a $skiptoken option." **[KB-snippet]** — OData Best practices: https://support.exactonline.com/community/s/article/All-All-DNO-Content-dosanddonts
  - `__next`-semantiek in de spec: "included to indicate the response represents a partial listing. The value … is a URI which identifies the next partial set of entities". **[OData-spec]** — https://www.odata.org/documentation/odata-version-2-0/json-format/
  - **`$skip` is afgeschaft voor nieuwe endpoints:** "The $skip option is no longer supported for new endpoints that are released after March 1st 2017 to prevent parallel requests. As an alternative, you are advised to use the $skiptoken option." **[KB-snippet]** — OData query string options: https://support.exactonline.com/community/s/article/All-All-DNO-Simulation-query-string-options
- **`$select`**: spec-semantiek: "If a property … is not requested as a selectItem (explicitly or via a star), it SHOULD NOT be included in the response." **[OData-spec]** — https://www.odata.org/documentation/odata-version-3-0/url-conventions/ . Exact's eigen best-practice-artikel (dosanddonts) beveelt payload-reductie aan, maar de letterlijke $select-passage kon niet worden opgehaald.
- **Filter-literals** (OData v2/v3 Abstract Type System): **[OData-spec]** — https://www.odata.org/documentation/odata-version-2-0/overview/
  - GUID: `guid'dddddddd-dddd-dddd-dddd-dddddddddddd'` (vb. `guid'12345678-aaaa-bbbb-cccc-ddddeeeeffff'`)
  - DateTime: `datetime'yyyy-mm-ddThh:mm[:ss[.fffffff]]'` (vb. `datetime'2000-12-12T12:00'`)
  - String: `'…'` (single quotes); Boolean: `true|false`; Double: o.a. `2.029d`.
  - Exact-specifieke valkuil bij string-keys: zie Accounts.Code (leading spaces in de filterwaarde vereist, §5).
- **JSON-datumformaat in responses: `/Date(ticks)/`.** Spec: `"/Date(<ticks>["+" | "-" <offset>])/"` met **ticks = "number of milliseconds since midnight Jan 1, 1970"**, offset (minuten) optioneel; vb. `"ReleaseDate": "/Date(694224000000)/"`. Parsen: getal eruit strippen → `new Date(Number(ms))` (waarden zijn effectief UTC-epoch). **[OData-spec]** — https://www.odata.org/documentation/odata-version-2-0/json-format/
- **Response-envelop**: alles gewrapt in `d`, collecties als `d.results` (+ evt. `__count`, `__next`). **[OData-spec]** — v2 json-format + v3 verbose: "Each response body MUST be represented as a single JSON object … The name MUST be `d`." — https://www.odata.org/documentation/odata-version-3-0/json-verbose-format/

## 4. SalesInvoices (verkoopfacturen)

Bron **[entity-docs]**: https://start.exactonline.nl/docs/HlpRestAPIResourcesDetails.aspx?name=SalesInvoiceSalesInvoices

- URI `/api/v1/{division}/salesinvoice/SalesInvoices`; GET/POST/PUT/DELETE.
- **Verplicht bij POST**: `Journal` ("Every invoice should be linked to a sales journal"), `OrderedBy`, `InvoiceTo` ("Reference to the Customer who will receive the invoice"), `SalesInvoiceLines` ("Collection of lines"). `Currency` valt terug op de default-currency van de administratie.
- **Deep insert: ja** — `SalesInvoiceLines` als geneste collectie in de POST-body (lines verplicht bij POST, niet bij PUT).
- **Status-waarden**: 10 = Draft ("Draft invoices are not included in financial reports"), 20 = Open ("Open invoices can be changed. New invoices get the status open by default"), 50 = Processed ("Processed invoices can't be changed anymore").
- **Status ≠ betaalstatus.** De SalesInvoices-docs zeggen niets over betaling; 50/Processed betekent alléén verwerkt/onwijzigbaar. **Betaald-status bepaal je via de receivables-endpoints:**
  - `cashflow/Receivables` (GET/PUT): "Use this endpoint to get an overview of all the payment to be received in your administration." Met **`IsFullyPaid`** ("whether the receivable was fully paid by the customer"), `Status` (Edm.Int16): **20 = open, 30 = selected, 40 = processed (collection completed), 50 = matched**, `EndDate` ("Date receivable ceases as outstanding item"), `InvoiceNumber`, `AmountDC` ("receivables matched on this amount"). **[entity-docs]** — https://start.exactonline.nl/docs/HlpRestAPIResourcesDetails.aspx?name=CashflowReceivables
  - `read/financial/ReceivablesList` (GET): openstaande-postenlijst ("Use this endpoint to get all your customers payment terms information … references the Outstanding items report"), met `InvoiceNumber`, `Amount`, `AmountInTransit`, `CurrencyCode`, `DueDate`, `AccountId`, `HID` (PK), `InvoiceDate`. **[entity-docs]** — https://start.exactonline.nl/docs/HlpRestAPIResourcesDetails.aspx?name=ReadFinancialReceivablesList
  - NB: de cashflow-Receivables-statuscodes (20/30/40/50) hebben een ándere betekenis dan de SalesInvoice-statuscodes (10/20/50) — niet verwarren in sync-logica.
- **Webhook-topic**: "Subscribe to the topic SalesInvoices to get updates on the SalesInvoices resource." Zowel SalesInvoices als SalesInvoiceLines staan met webhook-vinkje in de index. **[entity-docs]**
- **Sync-variant** `/api/v1/{division}/sync/SalesInvoice/SalesInvoices` (GET-only): rowversion-`Timestamp` ("The timestamp value returned has no relation with actual date or time"); cursor-patroon: "The highest timestamp value of the records returned should be stored on client side …"; eerste run: "filter on timestamp greater than 1"; alléén timestamp als parameter toegestaan; **header + regels in één stream**: "If the line number is 0 it is the sales invoice header, if the line number is 1 or higher it is a sales invoice line." **[entity-docs]** — https://start.exactonline.nl/docs/HlpRestAPIResourcesDetails.aspx?name=SyncSalesInvoiceSalesInvoices . Bulk-variant bestaat ook (`BulkSalesInvoiceSalesInvoices` in de index).

### SalesInvoiceLines (regels)

Bron **[entity-docs]**: https://start.exactonline.nl/docs/HlpRestAPIResourcesDetails.aspx?name=SalesInvoiceSalesInvoiceLines

- URI `/api/v1/{division}/salesinvoice/SalesInvoiceLines`; GET/POST/PUT/DELETE.
- **Verplicht bij (losse) POST**: `InvoiceID`, `Item`, `GLAccount`.
- **`GLAccount`** (Edm.Guid): "The GL Account of the sales invoice line. This field is mandatory. This field is generated based on the revenue account of the item (or the related item group)." — dus verplicht-maar-autogevuld vanuit het artikel; expliciet zetten = jouw GL-mapping overrulet de item-default. "G/L Account is also used to determine whether the costcenter / costunit is mandatory."
- **`VATCode`** (Edm.String): "The VAT code that is used when the invoice is registered". **`VATPercentage`** (Edm.Double): "The vat percentage of the VAT code. This is the percentage at the moment the invoice is created." — het percentage volgt uit de VATCode; stuur de code, niet zelf een percentage verzinnen.
- `AmountFC`: "For normal lines it's the amount excluding VAT"; `AmountDC = AmountFC × RateFC`; `NetPrice` = nettoprijs per regel.

## 5. crm/Accounts (relaties/debiteuren)

Bron **[entity-docs]**: https://start.exactonline.nl/docs/HlpRestAPIResourcesDetails.aspx?name=CRMAccounts

- URI `/api/v1/{division}/crm/Accounts`; GET/POST/PUT/DELETE. Webhook-topic Accounts beschikbaar.
- **Verplicht bij POST: alléén `Name`.**
- **`Code`**: "Unique key, fixed length numeric string with leading spaces, length 18. IMPORTANT: When you use OData $filter on this field you have to make sure the filter parameter contains the leading spaces" — dus uniek, 18 posities, rechts uitgelijnd met **voorloopspaties**; een filter op `Code eq '123'` zonder padding matcht niet. (Right-pad je eigen waarde tot 18 met spaties links.)
- Debiteur-relevante velden: **`Status`**: "If the status field is filled this means the account is a customer. The value indicates the customer status. Possible values: A=None, S=Suspect, P=Prospect, C=Customer"; **`IsSales`**: "Indicates whether the account is allowed for sales"; **`IsSupplier`**: "Indicates whether the account is a supplier"; **`VATNumber`**: "The number under which the account is known at the Value Added Tax collection agency"; **`Email`**: "E-Mail address of the account".
- Sync-variant bestaat: `SyncCRMAccounts` (index).

## 6. GLAccounts + VATCodes

- **GLAccounts** — URI `/api/v1/{division}/financial/GLAccounts`; GET/POST/PUT/DELETE; POST verplicht: `Code` ("Unique Code of the G/L account") + `Description`. `Type` numeriek (vb. 12=Bank, 20=Accounts receivable, 110=Revenue) met `TypeDescription`; `BalanceSide` D/C; `BalanceType` B (balans) / W (W&V). Description niet muteerbaar bij meertalige omschrijvingen. Webhooks ondersteund. Geen padding-/formaatnotities gedocumenteerd. **[entity-docs]** — https://start.exactonline.nl/docs/HlpRestAPIResourcesDetails.aspx?name=FinancialGLAccounts
- **VATCodes** — URI `/api/v1/{division}/vat/VATCodes`; GET/POST/PUT/DELETE; POST verplicht: `Code` + `Description`. **Geen 3-char/spatie-padding-regel gedocumenteerd** op deze pagina (zie "Niet geverifieerd"). `Percentage` = "Active Percentage of the VAT code"; percentages beheer je via VATPercentage-regels: "you need to add one or more VATPercentage lines to the VAT code. This is only possible when you POST a VAT code." `Type`: "B = VAT 0% (Only base amount), E = Excluding, I = Including, N = No VAT"; `VATTransactionType`: "B = Both, P = Purchase, S = Sales"; `GLToPay`/`GLToClaim`: VAT-grootboekrekeningen ("Must be of type VAT"). Verwijderen kan alleen als de code nog niet in financiële boekingen zit. **[entity-docs]** — https://start.exactonline.nl/docs/HlpRestAPIResourcesDetails.aspx?name=VATVATCodes
- **Btw op factuurregels**: zet `VATCode` (string) op de regel; `VATPercentage` is afgeleid ("The vat percentage of the VAT code") — zie §4-regels. **[entity-docs]**

## 7. Webhooks

- **Subscriptions** — URI `/api/v1/{division}/webhooks/WebhookSubscriptions`; GET/POST/PUT/DELETE; POST verplicht: `CallbackURL` + `Topic` ("Webhook subscription topic, e.g.: Accounts, Items, StockPositions"). `Division`-property (int) aanwezig; de `{division}`-URI impliceert per-division-subscriptions, maar de docs zeggen dat niet expliciet. Remark: "IsInstant parameter is only supported for the Good Deliveries topic." **[entity-docs]** — https://start.exactonline.nl/docs/HlpRestAPIResourcesDetails.aspx?name=WebhooksWebhookSubscriptions
- **Topics**: geen uitputtende lijst op de subscriptions-pagina; per entity-pagina staat het topic vermeld (SalesInvoices: "Subscribe to the topic SalesInvoices…"). Webhook-vinkjes in de index o.a.: CRM: Accounts, BankAccounts, Contacts, Opportunities, Quotations, QuotationLines; SalesInvoice: SalesInvoices, SalesInvoiceLines; verder Documents, DocumentAttachments, BankEntries; GLAccounts-pagina meldt eveneens webhook-support. **[entity-docs]** — index + entity-pagina's.
- **HashCode-verificatie**: "Every Webhook notification contains a hashcode, which is used to verify if the notification was created by Exact Online and was not modified by others. You can use the Webhook secret to recalculate the hash code." + "The hashcode is calculated over the Json of the Content node. The content node includes the brackets you receive from our webhooks after \"Content:\"." + "We use HMAC SHA256 for our hash-based message authentication code." Sleutel = de **Webhook secret** van je app (App Center → app → "Under Authorization you find Webhook secret"). **[KB-snippet]** — Webhooks-artikel: https://support.exactonline.com/community/s/article/All-All-DNO-Content-webhooksc?language=en_GB (tutorial: …All-All-DNO-Content-webhookstut)
  - Praktisch: HMAC-SHA256 over de **exacte JSON-bytes van de `Content`-node inclusief accolades** (dus niet her-serialiseren), key = webhook secret, vergelijken met `HashCode`.
- **Retry-schema**: "If your callback URL is unavailable or not responding as expected, the notification can not be delivered. To ensure that the app doesn't miss a notification, we retry the notification 10 times, each time with an increasing delay of '2 ^ Number of Retry'." **[KB-snippet]** — webhooksc. NB: de **tijdseenheid** van `2^n` staat niet in de snippet; bij minuten is het totaal 2+4+…+1024 = 2046 min ≈ **34 uur** (consistent met de bekende ~34-uurs-claim, maar eenheid zelf niet doc-geverifieerd). Wat er ná de 10e mislukte poging gebeurt (drop? subscription verwijderd?) kon niet worden geverifieerd.

## 8. Fouten & statuscodes

- **401 mid-flight = access token verlopen (na 10 min); herstel met refresh; verlopen refresh (30 d) = hele flow opnieuw.** "401: Unauthorized Access token validity has expired. Request a new access token via the most recently obtained refresh token. See: Step 4. Obtain new access tokens. Using refresh token that had expired (Past 30-day expiration date). Restart OAuth flow from step 2: Step 2. Set up authorization requests." **[KB-snippet]** — respcodeserrorhandling: https://support.exactonline.com/community/s/article/All-All-DNO-Content-respcodeserrorhandling?language=en_GB
  - Merk op "most recently obtained refresh token" — bij rotatie is alleen de láátste refresh token geldig.
- **429**: "This error indicates that the API limits have been exceeded." **[KB-snippet]** — respcodeserrorhandling (zie §2 voor headers/backoff).
- **Foutformaat (OData verbose JSON)**: één `error`-object met `code` + `message`; het spec-voorbeeld toont `message` als object `{ "lang": "en-us", "value": "A custom long message for the user." }` → de leesbare tekst zit in **`error.message.value`**. (Curiosum: de normatieve spec-zin zegt "with names `lang` and `message`", het normatieve voorbeeld toont `lang`+`value`; de praktijk en het voorbeeld zijn `value`.) **[OData-spec]** — https://www.odata.org/documentation/odata-version-3-0/json-verbose-format/
  - Exact's artikel bevestigt sprekende meldingen: "The error message will address what is incorrect. Example: 'Operator 'eq' incompatible with operand types 'System.Guid' and 'System.Int32' at position 3.'" en JSON-syntaxfouten zoals ontbrekende komma's. **[KB-snippet]** — respcodeserrorhandling.
- **503**: geen officiële passage gevonden (zie "Niet geverifieerd").

## 9. Division-discovery (voor multi-tenant)

- **`/api/v1/current/Me`** (GET-only): `CurrentDivision` = "Division number that is currently used in the API. You should use a division number in the url"; verder `DivisionCustomer` ("Owner account of the division"), `UserID`, `Email`; ook AccountingDivision/DossierDivision aanwezig. `ThumbnailPicture`: "will never return value and will be removed". **[entity-docs]** — https://start.exactonline.nl/docs/HlpRestAPIResourcesDetails.aspx?name=SystemSystemMe
- **`/api/v1/{division}/system/Divisions`** (GET, DELETE): "Returns only divisions that are accessible to the signed-in user, as configured in the user card under 'Companies: Access rights'." Properties: `Code` (Int32, PK), `Hid` ("Company number assigned by customer"), `Description`, `Country` ("used for determination of legislation"), `CustomerCode`, `Current` ("True when this division is most recently used by the API"). **Let op voor sync-integraties**: bij `DivisionHRLinkUnlinkDate`/`DivisionMoveDate` geldt "Please resync all data when this value changes because value of Timestamp is regenerated." **[entity-docs]** — https://start.exactonline.nl/docs/HlpRestAPIResourcesDetails.aspx?name=SystemSystemDivisions

---

## Niet geverifieerd / docs onbereikbaar

Alle `All-All-DNO-*`-artikelen op support.exactonline.com renderen niet zonder browser-JS (Salesforce Lightning; ook via rendering-proxy geblokkeerd). Onderstaande punten konden dáárdoor niet (volledig) worden geverifieerd:

1. **`x-exact-oauth2-*` response headers** — nergens aangetroffen: 0 zoekresultaten web-breed, niet in entity-docs. Vermoedelijk onbestaand of intern; **claim laten vallen of runtime aantonen**.
2. **Formaat van `X-RateLimit-Reset` / `X-RateLimit-Minutely-Reset`** — officiële omschrijving ("remaining time until the time limit window resets") is ambigu; het bekende epoch-in-milliseconden-formaat kon niet uit een officiële bron worden bevestigd → runtime checken.
3. **Exacte namen `X-RateLimit-Minutely-Remaining` / `X-RateLimit-Minutely-Reset`** — alleen `X-RateLimit-Minutely-Limit` letterlijk in een snippet gezien; de rest volgt het patroon maar is niet letterlijk geverifieerd.
4. **`Retry-After`-header bij 429** — zoekmachines matchen de term binnen het respcodeserrorhandling-artikel, maar geen leesbare snippet met de uitleg → runtime verifiëren.
5. **503-gedrag** — geen enkele officiële passage gevonden ("Too few matches" op de hele site voor 503). Behandel als transient + retry, maar zonder doc-bewijs.
6. **Webhook-retry-eenheid en einde-gedrag** — "10 times … delay of '2 ^ Number of Retry'" is officieel; de tijdseenheid (minuten ⇒ ~34 uur totaal) en wat er na poging 10 gebeurt (notificatie weg? subscription verwijderd?) niet verifieerbaar.
7. **Callback-response-eis** (bv. HTTP 200 binnen N seconden) — niet gevonden.
8. **VATCode 3-char/spatie-padding** — niet gedocumenteerd op de VATCodes-entity-pagina. Het analoge, wél gedocumenteerde geval is `crm/Accounts.Code` (18-char, leading spaces, filter-waarschuwing). Voor VATCode: runtime inspecteren of waarden als `"2 "` (trailing spaces) terugkomen en of filters exact moeten matchen.
9. **Officiële uitspraak "Processed ≠ betaald"** — niet als losse zin gevonden; wel sluitend af te leiden: Status-50-omschrijving gaat alleen over onwijzigbaarheid, en betaalstatus leeft op `cashflow/Receivables` (`IsFullyPaid`, Status 50 = matched) / `read/financial/ReceivablesList` (outstanding items).
10. **$select-aanbeveling van Exact zelf** — het "OData | Best practices"-artikel (dosanddonts) bestaat en behandelt paging (`__next`-snippet gezien); de letterlijke $select-passage was niet ophaalbaar. Spec-semantiek wél geverifieerd.
11. **Éen-subscription-per-topic-regel voor webhooks** en expliciete per-division-scoping — niet in de docs aangetroffen (URI-structuur impliceert per-division).
12. Dode/onbereikbare bronnen: `developers.exactonline.com` (opgeheven; TLS-cert van exact.com), `https://support.exactonline.com/community/s/knowledge-base#All-All-DNO-Content-restrefdocs` (JS-shell), `web.archive.org` / `archive.ph` (geblokkeerd in deze omgeving), `timetravel.mementoweb.org` (DNS-fout).

## Snelle audit-checklist afgeleid uit dit onderzoek

- [ ] Refresh-flow: single-flight lock + opslaan van de nieuwste refresh token vóór gebruik nieuwe access token; nooit refreshen <570 s na vorige token-request (cache access token ~9,5 min).
- [ ] 401 → één keer token verversen en retry; refresh-fout → re-auth-flow markeren (token >30 d ongebruikt).
- [ ] Rate limiting: per division bijhouden (60/min, 5000/dag per app×company); op 429 backoff tot Reset; headers loggen.
- [ ] Paging: `d.results` + `__next` volgen (geen eigen `$skip`); page size 60 aannemen; overweeg sync-endpoints (1000/pagina, rowversion-cursor).
- [ ] Datums: `/Date(ms)/` parsen als epoch-ms; filters met `datetime'…'`/`guid'…'`-literals.
- [ ] Accounts.Code-filters: 18-char left-padded met spaties.
- [ ] Facturen: POST met Journal/OrderedBy/InvoiceTo + geneste SalesInvoiceLines; GLAccount per regel expliciet voor GL-mapping; VATCode sturen, VATPercentage niet zelf zetten.
- [ ] Betaalstatus: níet uit SalesInvoice.Status afleiden; `cashflow/Receivables.IsFullyPaid` (of verdwijnen uit ReceivablesList) gebruiken.
- [ ] Webhook: HMAC-SHA256 over rauwe `Content`-JSON (incl. `{}`) met webhook secret vergelijken met `HashCode`; idempotent verwerken (tot 10 herleveringen bij eerdere failures).
