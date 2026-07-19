# Exact Online-integratie — volledige audit (2026-07-17)

> **Status 2026-07-18:** alle bevindingen zijn rechtgetrokken op branch
> `fix/exact-online-rechttrekken`. Zie [§8 Wat is rechtgetrokken](#8-wat-is-rechtgetrokken-2026-07-18)
> voor de resolutie per bevinding en wat er nog een mens vereist (opnieuw koppelen).

**Scope:** alle `exact-*` edge functions + `_shared/exact-helpers.ts`, frontend (Instellingen, GL-mappings, ExactOnline-pagina, Omzet-dashboard, factuur-sync-knop), `exact_config`/`exact_glaccount_mappings` + RPC's, live productie-stand.
**Referenties:** (1) SiteJob Connect-contract (`sitejob-connect-integratie`-skill, `references/exact.md`), (2) de volledig werkende BestOps/Vakflow-implementatie (`/Users/kas/dev/bestops`), (3) officiële Exact Online REST-docs (zie §6).
**Methode:** code gelezen op `origin/main` en live geverifieerd — de gedeployde `exact-config` en `exact-sync-invoice` zijn byte-voor-byte vergeleken met `origin/main` en identiek. Productie == main voor het Exact-cluster.

> ⚠️ Les uit deze audit zelf: de checkout waarop deze sessie startte liep **158 commits achter** op `origin/main`; PR's #94, #107, #133 en #134 hadden een groot deel van de oude gaten al gedicht. Altijd eerst `git fetch origin main` (staat ook in CLAUDE.md).

## TL;DR

1. **De productie-koppeling is dood.** Een liveness-probe (17-07, via `pg_net` rechtstreeks tegen Connect's `exact-token`) geeft **HTTP 404 "Tenant not found"** — de op 09-04 geregistreerde tenant bestaat niet meer bij SiteJob Connect. Elke Exact-functie faalt vandaag, en de UI heeft **geen herstelpad** (E17/E18): ontkoppelen faalt op de 404, en de registratieknop is onbereikbaar zolang er een tenant_id staat.
2. **De koppel-laag zelf is op orde** en volgt sinds PR #107/#133/#134 het Connect-contract én de BestOps-patronen (503-poll, token-cache, suspended, self-service ontkoppelen, per-org webhook-URL, secret-encryptie met legacy-repair).
3. **De factuur-payload is niet af**: geen `Journal`/`InvoiceTo` (officieel verplicht bij POST), geen `VATCode`, geen `InvoiceDate`, hardcoded `PaymentCondition`, geen creditnota's — en zolang er geen GL-mappings zijn geconfigureerd (nu: 0) hebben de regels ook geen `GLAccount`/`Item`, wat volgens de docs eveneens verplicht is. Ook met een levende koppeling zou de eerste sync dus vermoedelijk direct falen. "Betaald" wordt bovendien nooit gedetecteerd.
4. De integratie is in productie **nooit functioneel gebruikt** (0 gesyncte facturen, 0 webhook-events, 0 GL-mappings) en wees naar de **SiteJob-testadministratie**, niet naar JA Werkt's echte Exact. Alles is dus zonder dataverlies te herstellen.

## 1. Productie-stand (gemeten 2026-07-17)

| Meting | Waarde |
|---|---|
| Koppelingen (`exact_config`) | 1 — org "JA Werkt" → administratie **"SiteJob"**, division 4305950, regio nl, actief |
| Gekoppeld sinds / laatst bijgewerkt | 2026-04-09 / 2026-04-09 |
| Facturen gesynct (`exact_invoice_id`) | **0** (van 1 factuur totaal) |
| Facturen met syncfout | 0 |
| Bedrijven met `exact_account_id` | **0** |
| GL-mappings (`exact_glaccount_mappings`) | **0** |
| Webhook-events (audit_log `exact_webhook`) | **0** |

Conclusie: de integratie is één keer gekoppeld (aan een testadministratie) en daarna nooit functioneel gebruikt. Alles hieronder is dus preventief — er is geen productiedata die kapot kan.

## 2. Wat goed staat (Connect-contract + BestOps-parity)

Geverifieerd tegen de skill-checklist en het BestOps-referentierapport:

- ✅ **Token-fetcher** (`_shared/exact-helpers.ts → getExactToken`): vers token per call bij Connect, secret in `X-Webhook-Secret`-header + body, **503-poll 1s × max 10**, in-memory **cache tot `expires_at` − 60s**, `clearExactTokenCache` bij disconnect/suspend, `needs_reauth → REAUTH_REQUIRED`.
- ✅ **`exact-config`**: valideert secret via `decrypt_sensitive` (niet meer via `get_exact_token`, dus geen `is_active`-kip-ei meer bij de eerste push), handelt **`disconnect` én `suspended`** af, legacy-plaintext-repair (her-encrypt), registreert webhook-subscriptions na de push (non-blocking, met dedup-check op bestaande subscriptions).
- ✅ **`exact-register`**: `requireRolePermission('settings.manage')`, org afgeleid van het profiel, **`?organization_id=` in de webhook-URL** (lost de multi-org-botsing op Connect's webhook_url-idempotentie op), weigert een Connect-antwoord zonder secret expliciet, versleutelt het secret vóór opslag, short-circuit als er al een actieve koppeling is.
- ✅ **`exact-disconnect`** (self-service, was het ontbrekende checklist-item) + ontkoppel-knop in `ExactOnlineSettings.tsx`; popup-blocker-veilige setup-flow (voor-geopende popup krijgt de URL).
- ✅ **`exact-webhook`**: verificatie via `verifyExactWebhookSecret` (per-org via query-param, met legacy-fallback voor de bestaande tenant zonder query-param), audit-logging, StatusCode-mapping **50 ≠ betaald** (PR #69-fix), forward-only statusovergangen.
- ✅ **`exact-api`-proxy**: SSRF-guard (`normalizeEndpoint`), `requireRolePermission`, gesaniteerde provider-fouten, diagnostics (nu correct `Type eq 110` voor omzetrekeningen) + webhook-heractivatie.
- ✅ **Fout-hygiëne**: `sanitizeExactErrorDetail` redigeert Bearer/access/refresh-tokens uit alle foutteksten; `classifyExactProviderError` geeft publieke codes (`needs_reauth` 409, `exact_division_scope_error` 409, forbidden/unavailable 502) — zelfde classifier als BestOps.
- ✅ **Security-laag**: RLS op `exact_config`/`exact_glaccount_mappings` met `is_internal_user()`-gate (PR portal_role_gating), `get_exact_token` RPC anon-revoked + org-check, Vault-encryptie van `webhook_secret`.
- ✅ **`exact-list-glaccounts`**: BestOps' type/prefix-logica (omzet = Type 110, prefix "8"; kosten = 130/135/125/140, prefix "4"), `IsBlocked`-filter; de GL-mapping-UI gebruikt deze endpoint.

## 3. Bevindingen

Ernst: 🔴 hoog · 🟠 middel · 🟡 laag · ℹ️ info. Regelverwijzingen zijn naar `origin/main`.

### 🔴 E1 — "Betaald" wordt nooit gedetecteerd
`exact-webhook` mapt StatusCode 20 én 50 naar `verzonden` en stopt daar. Er is géén pad dat een factuur ooit op `betaald` zet vanuit Exact — terwijl de statusladder (`concept→definitief→verzonden→betaald`) dat wel verwacht. PR #69 heeft terecht het "50 = betaald"-misverstand weggehaald, maar er is niets voor teruggekomen.
**Officiële docs:** SalesInvoice-Status 50 betekent alléén "Processed / can't be changed anymore"; betaalstatus leeft op **`cashflow/Receivables`** (`IsFullyPaid`; let op: dáár betekent Status 50 "matched" — andere reeks dan de factuurstatus) of het verdwijnen uit `read/financial/ReceivablesList`.
**BestOps:** haalt bij elk SalesInvoices-webhook-event de factuur op en zet `AmountOpenFC === 0 → status "betaald" + paid_at` (`exact-webhook/index.ts:183-252`) — bewezen werkend equivalent.
**Fix:** in `handleSalesInvoiceEvent` naast StatusCode ook het openstaande saldo lezen (Receivables `IsFullyPaid` of `AmountOpenFC`) en bij volledig betaald → `betaald` (forward-only blijft gelden).

### 🔴 E2 — Geen btw op de factuurregels (fiscaal risico)
`exact-sync-invoice` stuurt regels met alléén `Description/Quantity/NetPrice/GLAccount` — **geen `VATCode`**. Exact valt dan terug op de default van grootboek/debiteur; het btw-bedrag in Exact kan afwijken van `invoices.vat_amount` in JA Werkt, en **btw-verlegd** (in de uitzendbranche gebruikelijk bij doorlening/bouw) is onmogelijk. `invoices.vat_rate` bestaat al in het datamodel maar wordt genegeerd.
**BestOps:** `default_vat_codes`-map per tarief (`{"0":"42 ","9":"1  ","21":"6  "}` — let op de **spatie-gepadde codes**!) met scoring-discovery, `VATCode` op elke regel (`_shared/exact-helpers.ts:902-965`).
**Fix:** VAT-code-discovery (of instelling in Settings) + `VATCode` per regel op basis van `invoices.vat_rate`.

### 🟠 E3 — `InvoiceDate` wordt niet meegestuurd
De Exact-factuur krijgt de syncdatum als factuur-/boekdatum in plaats van `invoices.invoice_date`. Rond een maand-/kwartaalgrens komt omzet dan in de verkeerde (btw-)periode.
**BestOps:** stuurt `InvoiceDate: "YYYY-MM-DDT00:00:00"` (ISO — `/Date()/`-notatie wordt door Exact als input geweigerd, helpers:967-977).

### 🟠 E4 — `PaymentCondition: "30"` hardcoded
Betaalcondities zijn administratie-specifieke codes (`cashflow/PaymentConditions`); code `"30"` bestaat mogelijk niet in JA Werkt's echte administratie → POST-fout of verkeerde vervaldatum. **BestOps** stuurt het veld niet mee (default van de debiteur) en gebruikt `PaymentReference` voor het eigen factuurnummer.
**Fix:** veld weglaten, of de conditie uit de administratie ophalen/instelbaar maken. `invoices.due_date` bestaat lokaal en kan anders als `DueDate` mee.

### 🔴 E5 — Officieel verplichte POST-velden ontbreken: `Journal`, `InvoiceTo`, en per regel `GLAccount`/`Item`
De officiële SalesInvoices-docs markeren bij POST **`Journal`** ("Every invoice should be linked to a sales journal"), **`OrderedBy`**, **`InvoiceTo`** en **`SalesInvoiceLines`** als verplicht; per regel is **`GLAccount`** verplicht (auto-afleidbaar alléén uit een meegegeven `Item`). `exact-sync-invoice` stuurt alleen `OrderedBy` + regels, en de regels hebben **geen `Item` en alleen een `GLAccount` als er een mapping is geconfigureerd — in productie staan er 0 mappings**, dus gaan de regels zonder beide de deur uit. Gevolg: de eerste echte sync faalt vermoedelijk integraal op validatie.
**BestOps (empirie, zelfde administratie):** stuurt altijd `Journal` (code-string, bv. `"80"`), een `DIVERSEN`-`Item` én een expliciete omzet-`GLAccount` per regel; `InvoiceTo` laat ook BestOps weg (default = `OrderedBy` in de praktijk, ondanks de docs). Exact wijst regels op een grootboekrekening van het verkeerde type bovendien actief af ("Grootboekrekeningtype"-fout) — vandaar hun GL-auto-retry.
**Fix:** journal-discovery (Journals, verkoopdagboek) + persist; altijd een fallback-`GLAccount` (of DIVERSEN-item) meesturen, niet alleen bij geconfigureerde mapping.

### 🟠 E6 — Geen creditnota-ondersteuning
Een creditfactuur (negatief totaal / status `gecrediteerd`) gaat als gewone factuur de deur uit. **BestOps:** `Type: 8021` bij negatief totaal (anders `8020`) + negatieve prijzen omgezet naar positieve `UnitPrice` × negatieve `Quantity`.

### 🟠 E7 — Omzet-dashboard filtert grootboekrekeningen op het verkeerde type
`src/pages/Omzet.tsx` (regel ~66) haalt de te kiezen omzetrekeningen op met `financial/GLAccounts?$filter=Type eq 20`, terwijl de eigen diagnostics (`exact-api`), `exact-list-glaccounts` én BestOps **Type 110** (Revenue) gebruiken; 20 is het *dagboek*-type. Gevolg: de picker toont een verkeerde/lege lijst zodra dit tegen een echte administratie draait. (De sommen zelf via `ReportingBalance` + credit-omkering zijn wél correct opgezet.)
**Fix:** picker omzetten naar `exact-list-glaccounts?kind=revenue`.

### 🟠 E8 — Toeslag-GL-mappings zijn schijnconfiguratie
De mapping-UI biedt `toeslag_nacht/toeslag_weekend/toeslag_feestdag/wacht` aan, maar `exact-sync-invoice` gebruikt alleen `normaal`, `overwerk` en `reis`; `allowances_amount`/`surcharge_amount` vallen altijd terug op `normaal`. Wie die mappings invult, denkt omzet te splitsen die niet gesplitst wordt.
**Fix:** óf de sync de toeslag-codes laten gebruiken (vereist toeslag-type op de factuurregel), óf de niet-gebruikte opties uit de UI halen.

### 🟠 E9 — Dubbel-sync-venster is niet atomair
`exact-sync-invoice` doet check-then-act op `exact_invoice_id` (409 bij al-gesynct), maar zonder claim: twee gelijktijdige aanroepen maken twee facturen in Exact. (Bekend uit de juni-audit; BestOps heeft overigens hetzelfde patroon.)
**Fix:** claim vóór de POST — `UPDATE invoices SET exact_sync_error='SYNCING' WHERE id=… AND exact_invoice_id IS NULL AND exact_sync_error IS DISTINCT FROM 'SYNCING' RETURNING id` — en bij 0 rijen 409 teruggeven.

### 🟠 E10 — Accountmatching is te mager (duplicaat-risico in Exact)
`exact-sync-invoice` matcht een bestaande debiteur uitsluitend op **exacte naam**; `exact-sync-account` zoekt vóór create helemaal niet. "JA Werkt B.V." vs "JA Werkt BV" → duplicaat in Exact.
**BestOps:** zoekt in volgorde Code → KvK (`ChamberOfCommerce`) → `VATNumber` → `Email`, met `IsSales eq true`, en accepteert alleen bij precies één hit (`findExistingAccount`, helpers:784-841). KvK- en btw-nummer zitten al op `companies` — de betere sleutels zijn beschikbaar.
**Docs-valkuil bij Code-matching:** `crm/Accounts.Code` is een 18-posities numerieke string met **vóórloopspaties**, en een `$filter` op dit veld moet die spaties bevatten (officieel gedocumenteerde waarschuwing) — links padden tot 18 dus.

### 🟡 E11 — Geen webhook-idempotentie
Exact levert webhooks gegarandeerd-minstens-één-keer (retry-schema tot ~34 uur). BestOps dedupliceert via `webhook_events` met unieke `(source, event_id)`; JA Werkt verwerkt elke levering opnieuw. De forward-only-statusguard beperkt de schade, maar elke duplicate kost wel een token + Exact-GET.

### 🟡 E12 — Beperkte observability
Geen sync-log: alleen `exact_sync_error` op de factuur en een audit_log-regel per webhook. BestOps heeft `exact_sync_log` (richting/entiteit/operatie/status/duur/payload) + `last_sync_at`/`last_sync_error` op de connectie + een gesaniteerd status-endpoint. Voor een boekhoudkoppeling is een raadpleegbare sync-historie het verschil tussen "de klant belt" en "wij zagen het al".

### 🟡 E13 — Geen 429-backoff
Officieel: **60 calls/app/administratie/minuut én 5.000/dag**, met `X-RateLimit-*`-headers (daily) en een aparte `X-RateLimit-Minutely-*`-familie. 429 wordt netjes geclassificeerd als `exact_provider_unavailable` maar niet geretried; de headers worden niet gelezen (`Retry-After` bij 429 is niet doc-bevestigd — backoff op de Reset-header is de veilige route). (BestOps heeft dit ook niet — gedeelde verbetering; pas relevant bij bulk-sync.) Randnoot voor toekomstige paginering: `$skip` is afgeschaft voor nieuwere endpoints — volg `__next`/`$skiptoken`; paginagrootte is 60 (sync-endpoints 1000).

### 🟡 E14 — Frontend-quirks ExactOnline.tsx
Zoektermen gaan on-geëscaped in `$filter=substringof('…',Name)` — een `'` in de zoekterm breekt de query (geen security-issue; de proxy-guard voorkomt URL-uitbraak). Het zoekveld op de facturen-tab doet niets (state ongebruikt). Wél correct (docs-bevestigd): de `/Date(ms)/`-datumparsing en de statuslabels 10 = Concept / 20 = Open / 50 = Verwerkt.

### 🟡 E15 — Her-registratie-randgeval
Het Connect-secret wordt maar één keer uitgegeven. Zolang de `exact_config`-rij bestaat is dat afgedekt (short-circuit + "Setup voltooien"-knop), maar als de rij ooit verwijderd wordt terwijl de Connect-tenant bestaat, faalt her-registratie met 502 ("Connect returned incomplete tenant data") tot de beheerder het secret roteert. Gedocumenteerd Connect-gedrag; vermeldenswaard voor support.

### 🟡 E16 — Nul testdekking
Geen enkele unit/e2e-test raakt het Exact-cluster (alleen een query-key-naam). De regel-splitsingslogica in `exact-sync-invoice` (componenten + restantcorrectie) is puur en uitstekend unit-testbaar; BestOps' aanpak leunt op geverifieerde snapshots.

### 🔴 E17 — De productie-koppeling is dood: tenant bestaat niet meer bij Connect (geverifieerd)
Liveness-probe 2026-07-17 (server-side via `pg_net`, met de opgeslagen `tenant_id` + gedecrypt secret — geen van beide heeft de database verlaten) tegen Connect's `exact-token`: **HTTP 404, `error: "Tenant not found"`**. De op 09-04 geregistreerde tenant is aan de Connect-kant verdwenen; er is geen token meer op te halen — élke Exact-functie faalt vandaag met "Token ophalen mislukt: Tenant not found" (en omdat dit géén `needs_reauth` is, toont de UI niet eens de herkoppel-hint).
Context: de koppeling wees naar administratie **"SiteJob"** (division 4305950) — dezelfde administratie waar BestOps-productie op synct — en was toch al bedoeld als test. Voor livegang moest sowieso opnieuw gekoppeld worden met JA Werkt's eigen Exact-administratie en -login (Connect-gotcha: één tenant = één administratie/gebruiker; nooit dezelfde vanuit twee producten koppelen).

### 🔴 E18 — Geen herstelpad in de UI voor een broker-side verdwenen tenant
Met de dode tenant uit E17 loopt de UI muurvast:
- **Ontkoppelen** (`exact-disconnect`) POSTt naar `tenant-disconnect` → Connect antwoordt niet-ok voor een onbekende tenant → de functie retourneert 502 **vóór** de lokale opschoning; `exact_config` blijft dus "actief" staan.
- **Opnieuw registreren** kan niet: de registratieknop verschijnt alleen als er géén `tenant_id` staat, en `exact-register` short-circuit't op de bestaande actieve rij — die geeft de dode tenant + setup-URL terug.
- De **setup-link** ("Beheer koppeling") opent de Connect-setup voor een niet-bestaande tenant.
**Herstel nú:** handmatig de rij resetten (`UPDATE exact_config SET tenant_id = NULL, webhook_secret = NULL, division = NULL, company_name = NULL, base_url = NULL, is_active = false WHERE organization_id = '<JA Werkt-org>';`) waarna de normale registratieflow weer werkt.
**Structurele fix:** `exact-disconnect` moet een 404/"Tenant not found" van Connect als "al weg" behandelen (idempotent) en de lokale opschoning tóch uitvoeren; en `exact-register` zou bij een dode tenant (token-check faalt met tenant-not-found) een verse registratie moeten toestaan.

## 4. Vergelijking met BestOps (22-punts checklist)

| # | BestOps-feature | JA Werkt |
|---|---|---|
| 1 | Broker-architectuur (geen OAuth in eigen app) | ✅ |
| 2 | Token-cache tot expires_at − 60s | ✅ |
| 3 | 503-poll richting Connect | ✅ (1s × 10 vs 2s × 3) |
| 4 | needs_reauth end-to-end → UI-heropen-setup | ✅ backend · 🟠 UI toont alleen een toast met setup_url in de fout-payload die niet gelezen wordt |
| 5 | clearTokenCache bij disconnect/suspend | ✅ |
| 6 | Idempotente register/subscribe | ✅ |
| 7 | 409 already_synced-guard | ✅ (maar niet atomair — E9) |
| 8 | Lazy defaults-discovery (journal/GL/VAT/item) | ❌ (alleen handmatige GL-mapping — E2/E5) |
| 9 | GL-auto-retry bij grootboektype-fout | ❌ |
| 10 | Creditnota-detectie (8020/8021) | ❌ E6 |
| 11 | VAT-code-scoring per tarief | ❌ E2 |
| 12 | OData-datum beide richtingen (lezen `/Date()/`, schrijven ISO) | 🟠 lezen ✅ (frontend), schrijven n.v.t. want geen datums verstuurd — E3 |
| 13 | Foutclassificatie met publieke codes | ✅ (zelfde classifier) |
| 14 | Secret-redactie in fouten, nooit tokens loggen | ✅ |
| 15 | Webhook-idempotentie (webhook_events) | ❌ E11 |
| 16 | Webhook 200-bij-handlerfout (geen retry-storm) | ✅ |
| 17 | Betaald-detectie via AmountOpenFC | ❌ E1 |
| 18 | Bidirectionele account-sync (Modified-vergelijking) | ❌ (alleen outbound; webhook logt Accounts-events alleen) |
| 19 | Volledige sync-audittrail | 🟠 gedeeltelijk — E12 |
| 20 | Gesaniteerd status-endpoint (browser leest tabel nooit) | 🟠 UI leest `exact_config` direct (RLS-beschermd, secret encrypted — acceptabel) |
| 21 | Health-classificatie in status → UI-badges | 🟠 diagnostics-knop bestaat; geen permanente health-badge |
| 22 | Externe-refs-bridge | n.v.t. (BestOps-specifiek) |

## 5. SiteJob Connect-contract — verificatie

Checklist uit de `sitejob-connect-integratie`-skill:

- [x] `exact-webhook` + `exact-config` bestaan, publiek (`verify_jwt=false`), beide valideren `X-Webhook-Secret`
- [x] `-config` handelt initial push, token-refresh push én `disconnect|suspended` af
- [x] `tenant_id`/`webhook_secret` server-side, encrypted (Vault) met legacy-plaintext-repair
- [x] Token-fetcher met 503-poll, in elke API-call gebruikt; geen hardcoded tokens
- [x] Koppel-popup + `exact-connected`-postMessage-listener; ontkoppel-knop → `tenant-disconnect` (via `exact-disconnect`)
- [x] Geen tokens/bodies in logs (redactie-helper)
- [x] Secret via header/POST-body, niet als `?secret=` in de URL

## 6. Verificatie tegen de officiële Exact Online-docs

### 6a. Empirisch bevestigd in BestOps-productie (zelfde administratie!)

Bron: `bestops/docs/plans/exact-vervolg-en-webhooks.md` (Sprint A geverifieerd 2026-05-04, met echte sync-ID's) + de werkende BestOps-code:

- **Journal is een code-string** en hoort in de payload: verkoopdagboek `"80"`, inkoopdagboek `"70"` (administratie-specifiek — vandaar discovery, niet hardcoden). → onderbouwt E5.
- **VAT-codes zijn spatie-gepad**: `{"0":"42 ", "9":"1  ", "21":"6  "}` — "Exact geeft padded codes terug", de padding is bewust behouden. Een naïeve `"21"`-string matcht dus niet. → onderbouwt E2.
- **Exact weigert regels op een grootboekrekening van het verkeerde type** ("Grootboekrekeningtype"-fout); BestOps' omzet-GL is pas via de auto-retry-lus gevonden. → onderbouwt E2/E5 en de waarde van GL-auto-retry (checklist #9).
- **Creditnota's vereisen een expliciet Type**: SalesInvoices `8021` (credit) vs `8020` (standaard) in de werkende code; PurchaseEntries `31` vs `30`. → onderbouwt E6.
- **Rate limit 60 calls/min per administratie** (BestOps-notitie "volgens Exact spec"; bevestigt de `accounting-apis`-skill). Bij <10 syncs/dag geen issue; bij bulk wel. → onderbouwt E13.
- **Betaald-detectie loopt via het openstaande saldo** (`AmountOpenFC === 0`), niet via StatusCode — zo draait het in BestOps-productie. → onderbouwt E1.
- **`/Date(ms)/`-datums bij lezen, ISO (`YYYY-MM-DDT00:00:00`) bij schrijven** — Exact weigert `/Date()/` als input. → onderbouwt E3.

### 6b. Officiële-docs-check (primaire bronnen)

Volledig onderzoek met bron-URL per claim: [exact-api-docs-research-2026-07-17.md](exact-api-docs-research-2026-07-17.md) (research-agent, 2026-07-17; entity-docs op start.exactonline.nl direct gelezen, developer-KB via letterlijke zoekmachine-snippets van de officiële artikelen omdat de Salesforce-app niet zonder browser-JS rendert). Relevantste bevestigingen voor deze audit:

- **OAuth:** access token 10 min; refresh-token roteert bij élke refresh (oude direct ongeldig) en vervalt na 30 dagen inactiviteit. **Verrassing:** het token-endpoint is zelf gethrottled — refreshen mag pas 570 s ná de vorige token-request. De in-memory token-cache (E-helpers) is dus niet alleen performance maar noodzaak; Connect's serialisatie + onze cache dekken dit af. De aanname over `x-exact-oauth2-*`-headers (accounting-apis-skill, "direct koppelen"-pad) is **nergens** terug te vinden — schrappen.
- **SalesInvoices:** POST-verplicht = `Journal`, `OrderedBy`, `InvoiceTo`, `SalesInvoiceLines` (deep insert van regels kan en moet). Status: 10 = Draft, 20 = Open ("New invoices get the status open by default"), 50 = Processed ("can't be changed anymore") — de labels in `ExactOnline.tsx` (Concept/Open/Verwerkt) kloppen. Betaalstatus: zie E1 (`cashflow/Receivables.IsFullyPaid`; andere statusreeks dan de factuur!).
- **SalesInvoiceLines:** `GLAccount` verplicht ("This field is mandatory. This field is generated based on the revenue account of the item") — expliciet zetten is precies de juiste plek voor de GL-mapping; `VATCode` is de bron, `VATPercentage` is afgeleid ("the percentage at the moment the invoice is created") — stuur de code, nooit zelf een percentage.
- **crm/Accounts:** alleen `Name` verplicht bij POST; `Status` C = Customer (zoals gebruikt); `Code` = uniek, 18 posities, **vóórloopspaties, óók in `$filter`** (gedocumenteerde valkuil, zie E10).
- **GLAccounts:** `Type` numeriek met o.a. **20 = Accounts receivable** en **110 = Revenue** — bevestigt E7: `Type eq 20` in `Omzet.tsx` selecteert debiteuren-rekeningen, geen omzet.
- **VATCodes:** vrije `Code` + `Description`; percentages via VATPercentage-regels; **de 3-char/spatie-padding is niet gedocumenteerd** — alleen empirisch bevestigd (BestOps: `"6  "`); runtime dus tolerant matchen (trim-vergelijking) maar padded wegschrijven.
- **Rate limits:** 60/min + 5.000/dag per app × administratie; headers `X-RateLimit-*` (daily) + `X-RateLimit-Minutely-Limit` (minutely-familie); 429 = overschreden. `Retry-After` niet doc-bevestigd → backoff op de Reset-headers. Paginering: `__next`/`$skiptoken` (`$skip` afgeschaft voor nieuwe endpoints), paginagrootte 60 / sync-endpoints 1000. Request-limiet 10 MB, URL max 6.000 tekens.
- **Webhooks:** HMAC-SHA256 over de **rauwe JSON van de `Content`-node inclusief accolades**, key = app-level webhook secret (dit valideert Connect voor ons); retry 10× met delay `2^n` (eenheid niet doc-bevestigd; bij minuten ≈ 34 u totaal). Per entity-pagina staat het topic (SalesInvoices, Accounts, …).
- **Division-discovery:** `current/Me → CurrentDivision` en `system/Divisions` (alleen divisies waar de gebruiker recht op heeft) — relevant voor de toekomstige multi-administratie-vraag; Connect levert de division nu mee in de token-response.
- **Fouten:** leesbare tekst zit in `error.message.value` (OData verbose) — precies wat `exactApi()` al parst; 401 mid-flight = token verlopen (na 10 min).

Niet-verifieerbare punten (12 stuks, o.a. 503-gedrag, webhook-retry-eenheid, `Retry-After`) staan expliciet in het researchbestand onder "Niet geverifieerd".

## 7. Aanbevolen aanpak

**P0a — koppeling herstellen (kan vandaag, geen code nodig):**
1. E18: `exact_config`-rij resetten via SQL (zie E18) — de dode tenant loslaten.
2. Opnieuw registreren + koppelen, nu meteen met **JA Werkt's eigen Exact-administratie en -login** (nieuwe registratie krijgt automatisch de per-org webhook-URL). Diagnostics ("Test koppeling") draaien.

**P0b — code vóór eerste echte factuur (één PR "factuur-payload compleet"):**
1. E5 `Journal` + fallback-`GLAccount`/`Item` per regel (verplichte velden; anders faalt de POST).
2. E2 `VATCode` per regel (vanaf `invoices.vat_rate`, codes discoverable/instelbaar — padded wegschrijven, trim-tolerant matchen).
3. E3 `InvoiceDate` (+ evt. `DueDate`) meesturen.
4. E4 `PaymentCondition` weghalen of instelbaar maken.
5. E1 betaald-detectie in de webhook (Receivables/`AmountOpenFC` → `betaald`, forward-only).
6. E9 sync-claim atomair maken.
7. E18-structureel: `exact-disconnect` idempotent bij Connect-404; `exact-register` staat herregistratie toe bij dode tenant.

**P1 — kort daarna:** E6 creditnota's (Type 8021), E7 Omzet-picker naar `exact-list-glaccounts`, E8 toeslag-mappings echt gebruiken of verwijderen, E10 accountmatching op KvK/btw/e-mail (Code-padding!), needs_reauth-UX in de frontend (checklist #4).

**P2 — hygiëne:** E11 webhook-idempotentie, E12 `exact_sync_log`, E13 429-backoff op de Reset-headers, E14 UI-quirks, E16 unit-tests op de regel-splitsing.

**Livegang-draaiboek:** P0a → GL-mappings + (na P0b) VAT-codes instellen → één testfactuur syncen en in Exact controleren (bedrag, btw, datum, dagboek, debiteur) → webhook-test (factuur in Exact wijzigen → status terug in JA Werkt) → betaal-test (factuur afletteren in Exact → `betaald` in JA Werkt).

---
*Audit uitgevoerd met: Connect-skill-reference, BestOps-referentierapport (Explore-agent), officiële-docs-research (api-integrator-agent), live Supabase-verificatie (deployed code + data). Zie ook `docs/security-audit-2026-06-10.md` en het eerdere Exact-auditgeheugen (2026-06-17, PR #69).*

---

## 8. Wat is rechtgetrokken (2026-07-18)

Branch `fix/exact-online-rechttrekken`, gebaseerd op `origin/main`. Migratie
`20260718174705_exact_integration_hardening.sql` is toegepast op productie en
`src/integrations/supabase/types.ts` is opnieuw gegenereerd (alleen toevoegingen).

### Resolutie per bevinding

| # | Bevinding | Opgelost met |
|---|---|---|
| E1 | Betaald werd nooit gedetecteerd | `exact-webhook` leest bij StatusCode 50 de openstaande post via `cashflow/Receivables` (`IsFullyPaid`) en zet dan `betaald` + `paid_at`/`paid_amount`. Blijft forward-only; kan de betaalstatus niet ophalen → status blijft `verzonden` (geen gok). |
| E2 | Geen btw-code op de regels | BTW-code per regel uit `exact_config.default_vat_codes`, met discovery (`selectVatCodeForRate`: alleen verkoopcodes, "verlegd" scoort bewust lager) én een instelbare **BTW-codes**-kaart in Instellingen (`exact-list-vatcodes` + `ExactVatCodeMappings`). Padding van Exact-codes blijft intact. |
| E3 | Geen factuurdatum | `InvoiceDate` uit `invoices.invoice_date`, ISO zonder tijdzone (`toExactDate`) — Exact weigert het `/Date()/`-formaat als invoer. |
| E4 | `PaymentCondition: "30"` hardcoded | Verwijderd; Exact leidt de vervaldatum af van de debiteur. `PaymentReference` = ons factuurnummer. |
| E5 | Verplichte POST-velden ontbraken | `Journal` (discovery op Journals `Type eq 20`), `InvoiceTo`, en per regel altijd een `GLAccount` (mapping → `normaal` → ontdekte omzetrekening) plus een generiek `Item`. Alles gepersisteerd in `exact_config`, dus één keer ontdekken. |
| E6 | Geen creditnota's | `Type` 8020/8021 via `exactSalesInvoiceType`; bij een creditnota worden de regelbedragen omgedraaid naar positief (zoals Exact verwacht) en een negatieve prijs wordt uitgedrukt als negatief aantal. |
| E7 | Omzet-picker op `Type eq 20` | `Omzet.tsx` gebruikt nu `exact-list-glaccounts?kind=revenue` (Type 110 + prefix 8), zelfde bron als de GL-mapping. |
| E8 | Schijn-mappings voor toeslagen | Uurtypes teruggebracht tot wat de sync echt gebruikt: `normaal`, `overwerk`, `reis`, `toeslagen` — en `toeslagen` wordt nu daadwerkelijk toegepast op `allowances_amount`/`surcharge_amount`. |
| E9 | Dubbel-sync-venster | Atomaire claim op `invoices.exact_sync_started_at` (conditionele update + `RETURNING`); een claim ouder dan 5 minuten vervalt. Claim wordt vrijgegeven bij een fout; een fout op de claim-query zelf faalt hard i.p.v. stil te blokkeren. |
| E10 | Accountmatching op naam | `findExactAccountId` zoekt KvK → BTW → e-mail → naam en accepteert alleen een eenduidige treffer. Ook `exact-sync-account` zoekt nu vóór het aanmaken (koppelt i.p.v. dupliceert). |
| E11 | Geen webhook-idempotentie | `exact_webhook_events` met uniek `(organization_id, event_id)`; herleveringen binnen 5 minuten worden overgeslagen. Bewust géén permanente dedup — een échte latere wijziging (factuur wordt betaald) heeft hetzelfde event-id en moet wél verwerkt worden. |
| E12 | Geen sync-historie | `exact_sync_log` (richting, entiteit, operatie, status, duur, provider-status, payload) wordt gevuld door factuur-sync, account-sync en de webhook. Faalt stil. |
| E13 | Geen 429-afhandeling | `exactApi` retryt op 429 (en op 5xx alléén bij GET — een schrijvende call herhalen kan een dubbele boeking geven), met `Retry-After`/`X-RateLimit-*-Reset` en anders exponentieel. |
| E14 | Frontend-quirks | OData-literals worden geëscapet, dode zoek-state verwijderd. |
| E15 | Her-registratie-randgeval | Opgelost via E18: bij een verdwenen tenant maakt `exact-register` een verse registratie aan. |
| E16 | Geen testdekking | 29 unit-tests op de pure logica: regel-splitsing (incl. restant, creditnota, negatieve prijs), BTW-selectie, factuurtype, datums, zoeksleutels, retry-vertraging, foutclassificatie. |
| E17 | Dode koppeling naar testadministratie | Code kan nu herstellen (E18); het daadwerkelijk opnieuw koppelen aan JA Werkt's eigen administratie vereist een mens met Exact-inloggegevens — zie draaiboek hieronder. |
| E18 | Geen herstelpad in de UI | `exact-disconnect` behandelt een 404 van Connect als "al weg" en ruimt lokaal op (inclusief `tenant_id`/secret); `exact-register` probeert de tenant-liveness en registreert opnieuw als die dood is (`force`-vlag beschikbaar). Foutcode `exact_tenant_not_found` wordt in de UI vertaald naar begrijpelijke tekst. |

### Structuurwijziging

De pure reken- en classificatielogica staat nu in `_shared/exact-format.ts`
(Deno-vrij, daardoor testbaar vanuit vitest); `_shared/exact-helpers.ts` houdt de
fetch- en Deno-laag en exporteert de pure module door, zodat bestaande imports
ongewijzigd blijven. Regel-opbouw zit in `_shared/exact-invoice-lines.ts`.

### Verificatie

`npm run typecheck` ✓ · `npm run lint` 0 errors ✓ · `npm run test` 329 tests ✓ ·
`npm run build` ✓ · `deno check` op alle 9 exact-functies ✓ · migratie toegepast en
gecontroleerd op productie ✓ · PostgREST-`or`-filter van de claim live geverifieerd ✓.

**Niet verifieerbaar zonder levende koppeling:** de daadwerkelijke Exact-POST
(veldnamen, journaal-, artikel- en BTW-codes in de echte administratie). Dat is de
eerste testfactuur uit het draaiboek.

### Draaiboek na deploy

1. **Ontkoppelen** in Instellingen → Koppelingen → Exact Online. Dat werkt nu ook met
   de verdwenen tenant en ruimt de dode registratie op.
2. **Koppelen** met JA Werkt's eigen Exact-administratie en -login (niet de
   SiteJob-testadministratie — één tenant = één administratie/gebruiker).
3. **Test koppeling** draaien; daarna **Grootboekkoppelingen** en **BTW-codes**
   controleren (het voorstel is een startpunt, geen wet — zeker bij 0%/verlegd).
4. **Eén testfactuur** syncen en in Exact narekenen: bedrag, btw, factuurdatum,
   dagboek, debiteur en of de regels op de juiste omzetrekening staan.
5. **Webhook-test**: factuur in Exact verwerken → status in JA Werkt wordt `verzonden`;
   factuur afletteren → `betaald`.
