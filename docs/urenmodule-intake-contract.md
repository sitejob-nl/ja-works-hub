# Urenmodule: interne broninname en invoervoorstellen

**Status: gedeployed op 8 september 2026** (migratie `20260909090000_hours_week_sources_and_proposals.sql`,
receipt `20260908142509_hours_week_sources_and_proposals`). De migratie is additief en verandert geen
bestaande urenafspraak. `timesheets`, facturatie, urenbrieven, CSV-import en communicatie worden niet
geschreven. **JA Werkt staat UIT, de geverifieerde demo staat AAN** voor `uren-workflow`; die SaaS-poort
geldt ook voor de twee nieuwe tabellen en de privé-bronopslag.

Dit is de eerste helft van "uren ontvangen en uitlezen": **interne** upload met **handmatige**
beoordeling. Automatische uitlezers (Excel, PDF-tekst, OCR/Vision, mailinname) sluiten later op exact
dezelfde bron-/voorstelgrens aan en hoeven daarvoor niets aan de dagrevisies te veranderen.

## Waarom een voorstel geen uur is

Een geüploade bron en een daaruit afgeleid voorstel zijn **feiten over een aanlevering**, geen
betaalbare tijd. Alleen `hours_apply_source_proposal` schrijft een dagrevisie, en dat gebeurt uitsluitend
door een expliciete handeling van een bevoegde interne gebruiker. Zo ontstaat er nooit een tweede set
uit te betalen uren naast de bestaande weekcontrole.

Een voorstel wordt **letterlijk** toegepast. Wie iets wil wijzigen, verwerpt het voorstel en legt een
nieuw voorstel vast. Daardoor is de toegepaste revisie altijd precies wat een met naam bekende persoon
heeft beoordeeld — belangrijk zodra een machine het voorstel aanlevert.

## Privé bronopslag

Originelen staan in de niet-publieke Storage-bucket `hours-sources`, met een pad
`<organisatie>/<week>/<sha256>.<pdf|jpg|png>`. Storage zelf dwingt de grens van 25 MiB (26.214.400 bytes)
en de drie toegestane mediatypen af.

- `private.hours_source_object_allowed(name, write)` is de enige nieuwe hulpfunctie die `authenticated`
  mag uitvoeren naast `private.hours_module_enabled()`. Zij geeft alleen een boolean over het eigen
  actieve profiel en een pad dat de aanvrager zelf meestuurt, en levert nooit gegevens.
- Lezen vereist `finance.view` of `finance.manage`; schrijven vereist `finance.manage`. Beide vereisen
  de SaaS-module, de eigen organisatie in het pad en een bestaande urenweek van die organisatie.
- Er is **geen** update- of delete-policy: een origineel kan niet worden vervangen of verwijderd.
- De browser haalt een kortlopende ondertekende link (5 minuten) op; de bucket is niet publiek
  benaderbaar.

De browser berekent de SHA-256 en uploadt naar het daaruit afgeleide pad. `hours_add_week_source` leest
**grootte en mediatype terug uit `storage.objects`** en weigert een registratie zonder bijbehorend
object of met een afwijkend type. De digest is dus een deduplicatiesleutel en padnaam, geen
vertrouwensgrens: de beoordelaar ziet altijd de werkelijke bytes voordat een voorstel wordt toegepast.

## Opslag en invarianten

`hours_week_sources` legt organisatie, week, opdrachtgever, opslagpad, oorspronkelijke bestandsnaam,
mediatype, bytegrootte, digest en de uploader vast. `UNIQUE (week_id, content_hash)` maakt een herhaalde
aanlevering van hetzelfde bestand binnen dezelfde week één bron; de RPC meldt dat expliciet als
`duplicate` en maakt geen tweede verwerking of voorstel aan. Een rij is onveranderlijk (dezelfde
history-trigger als de overige urentabellen).

`hours_source_proposals` bevat medewerkerdag, minuten of expliciete nulreden, notitie, optionele
broninput (diensten/pauzes/broncategorieën, exact hetzelfde schema als handmatige invoer) en een vrije
`page_label` als vindplaats. De inhoud is onveranderlijk; alleen de afwikkeling beweegt één keer van
`open` naar `applied` of `discarded`, met actor en tijdstip. Een CHECK bewaakt dat een afgewikkeld
voorstel altijd actor én uitkomst heeft, en dat een open voorstel die velden juist niet heeft.

`private.hours_write_day_revision` is nu de enige plek die beslist of opgeslagen feiten verschillen.
Handmatige invoer en een toegepast voorstel volgen daardoor exact dezelfde revisie-, no-op- en
compare-and-swap-regels. `hours_save_day_source` is hierop aangesloten zonder gedragswijziging; dat is
in de databaseproef met de volledige vrijgegeven regressieset aangetoond.

## Herkomst op de dagrevisie

Een toegepast voorstel schrijft `source_references` als
`[{"kind":"upload","label":"<bestandsnaam>","reference":"<vindplaats of null>"}]`, server-side opgebouwd.
Handmatige invoer houdt `[{"kind":"manual","label":"Handmatige invoer"}]`. Er staan bewust **geen interne
identificatoren** in: de koppeling revisie ↔ bron ↔ voorstel staat op `hours_source_proposals`
(`applied_revision_id`), dat alleen intern leesbaar is. De medewerker ziet daardoor wel dat zijn uren uit
een bepaald urenbriefje komen, maar geen interne administratie.

De frontend leest de herkomst uit `source_references` in plaats van een vaste tekst; een onbekende
`kind` uit een latere uitlezer blijft leesbaar en wordt nooit als handmatige invoer gepresenteerd.

## Publieke RPC's

Alle vijf zijn uitvoerbaar voor `authenticated` en autoriseren opnieuw in de functie: actief profiel,
eigen organisatie, `is_internal_user()`, de SaaS-module en `finance.view`/`finance.manage`. Geen enkele
is uitvoerbaar voor `anon` of `service_role`.

| RPC | Parameters | Resultaat |
| --- | --- | --- |
| `hours_get_week_sources` | `p_week_id uuid` | `{week_id, can_manage, sources[]}` met per bron zijn voorstellen |
| `hours_add_week_source` | `p_week_id uuid`, `p_content_hash text`, `p_file_name text`, `p_content_type text` | Dezelfde projectie plus `duplicate` en `source_id` |
| `hours_create_source_proposal` | `p_source_id uuid`, `p_day_id uuid`, `p_minutes integer`, `p_no_hours_reason text`, `p_note text`, `p_source_input jsonb`, `p_page_label text` | Dezelfde projectie |
| `hours_discard_source_proposal` | `p_proposal_id uuid`, `p_note text` | Dezelfde projectie |
| `hours_apply_source_proposal` | `p_proposal_id uuid`, `p_expected_revision_id uuid` | `WeekDetail` plus `applied_created_revision` en `sources` |

`can_manage` is `true` bij een interne gebruiker met `finance.manage` **en** een ingeschakelde
opdrachtgever; bij een uitgeschakelde opdrachtgever blijven bestaande bronnen leesbaar.

Vergrendelvolgorde bij schrijven: organisatie → voorstel → week → dag. Een voorstel wordt nooit ná de
week vergrendeld, zodat er geen omgekeerde volgorde met de bestaande dagschrijvers ontstaat.

### Toepassen

`hours_apply_source_proposal` controleert de verwachte dagrevisie (compare-and-swap). Een verouderde
verwachting geeft `PT409` (HTTP 409) en schrijft niets. Een al afgewikkeld voorstel geeft `22023`; een
tweede toepassing kan dus nooit een tweede revisie maken.

Wanneer het voorstel inhoudelijk gelijk is aan de huidige dagversie ontstaat er **geen** nieuwe revisie.
Het voorstel wordt afgewikkeld met `applied_created_revision = false` en verwijst naar de bestaande
revisie; het eerdere medewerkerakkoord blijft daardoor geldig. Het scherm meldt dit expliciet. Een echte
wijziging maakt wél een nieuwe revisie, waarna het eerdere akkoord en de eerdere controle vervallen —
precies zoals bij handmatige correctie.

## Portaalgrens

Een medewerker ziet de bronherkomst van de eigen dag, maar:

- `hours_week_sources` en `hours_source_proposals` leveren via directe tabeltoegang nul rijen;
- `hours_get_week_sources` weigert een portaalgebruiker met `42501` (HTTP 403);
- interne revisiehistorie en classificaties blijven leeg in de portaalprojectie.

## Fouten

| SQLSTATE | Betekenis |
| --- | --- |
| `42501` | Geen bevoegdheid, verkeerde organisatie, ontoegankelijke week/dag/bron, of poging historie te wijzigen |
| `22023` | Ongeldige invoer, niet-ondersteund bestandstype, ontbrekend of afwijkend opslagobject, uitgeschakelde opdrachtgever, al afgewikkeld voorstel |
| `PT409` | De dagversie is ondertussen gewijzigd; opnieuw laden en het voorstel opnieuw beoordelen |

## Verificatie

- **126 echte PostgreSQL-tests** (`scripts/hours-intake-db-test.py`): 25 nieuwe innamegevallen plus de
  volledige vrijgegeven foundation-, classificatie- en modulepoortregressies op het nieuwe schema. Alle
  zes migraties worden tweemaal toegepast. De poortcontrole is uitgebreid van dertien naar **vijftien**
  tabellen en van de bestaande RPC-inventaris naar de vijf nieuwe.
- **29 nieuwe applicatietests** (`src/test/hours-sources.test.ts`, `src/test/hours-week-sources-ui.test.tsx`);
  totaal 1.458 groen, met lint (0 errors), typecheck en productiebuild.
- **Verbonden demo-QA** (`scripts/e2e-hours-intake-demo.spec.ts` + `scripts/prepare-hours-intake-demo.mjs`):
  echte interne en medewerkerlogin tegen de live API met synthetische bestanden. Zie de bouwstand voor
  het bewijs. Deze stroom verstuurt niets en doet geen betaalde AI-aanroepen, dus de
  communicatie-instelling van de demo is niet aangeraakt.

Nog niet gebouwd: paginasplitsing en toewijzingscontrole bij meerdere medewerkers per bestand,
bestandslezers (Excel/Word/PDF-tekst/OCR), mailinname, de klantpagina zonder inloggen, en vrijgave of
export. Zie [de ticketlijst](urenmodule-tickets.md).
