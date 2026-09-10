# Urenmodule: scans en foto's uitlezen tot invoervoorstellen (T4)

**Status: gedeployed.** Dit document legt eerst het hostbesluit vast; het contract staat eronder.

## Welke host het uitleeswerk doet — geverifieerd besluit

De ticketlijst noemt bij T4 "de JA Werkt-VPS" als host. Dat is achterhaald. Het uitlezen
draait op **Google Gemini**, aangeroepen via `_shared/ai-accounting.ts`. Er is geen
VPS-stap en geen aparte documentvoorbewerkingshost.

Wat er op 9 september 2026 daadwerkelijk is nagegaan:

| Bevinding | Hoe vastgesteld |
| --- | --- |
| Elke betaalde aanroep van de afgelopen zestig dagen liep via Gemini | `ai_usage_log` in productie: `gemini-3.5-flash` (vacature-skills, CV-analyse, veldextractie), `gemini-3.1-flash-lite` (match-herrangschikking). Eén historische `claude-sonnet-5` voor vacatureteksten. Geen enkele VPS-regel. |
| De centrale transportlaag kent de VPS niet | `AiProvider` in `_shared/ai-accounting.ts` is `gemini \| anthropic \| lovable \| exa`, en `validateRequest` vergelijkt de doel-URL letterlijk. Een VPS-aanroep zou per definitie buiten het grootboek vallen — precies het tweede pad dat dit ticket verbiedt. |
| Beeld mag alleen via Gemini | Diezelfde validatie weigert beeldinvoer op elke andere provider (`unsupported_ai_media`, "Gebruik voor beeldinvoer de gecontroleerde Gemini-route") en laat op Gemini uitsluitend JPEG, PNG, WebP, HEIC, HEIF en PDF toe. |
| Het lokale Qwen-pad is uitgefaseerd | `analyze-cv-batch` antwoordt `410` met code `vps_provider_retired`; `analyze-cv` kent alleen nog `provider = "gemini"`. |
| De VPS is niet bereikbaar | `http://204.168.221.107:11434/api/tags` en `:8000/health` geven allebei een verbindingstime-out (12 s). De secrets `OLLAMA_BASE_URL` en `OLLAMA_API_KEY` bestaan nog, maar alleen `analyze-cv-callback` gebruikt de sleutel — als inkomende authenticatie voor een worker die niets meer verstuurt. |
| Qwen3-14B kan dit werk niet | Het is een tekstmodel op CPU; een gescand urenbriefje is beeld. |

`docs/ai-accounting.md` schrijft dit ook met zoveel woorden voor: "Nieuwe functies, waaronder
urenfotoherkenning, moeten dezelfde transportlaag gebruiken."

### Documentvoorbewerking

Er is er geen, en dat is de bedoeling. Gemini leest een PDF en een foto rechtstreeks als
`inlineData`; een PDF hoeft dus niet eerst naar afbeeldingen te worden omgezet. De enige
voorbewerking die deze module kent, gebeurt al bij het uploaden en staat in de browser:
paginatelling met pdf.js, controle van de eerste bytes, en de SHA-256 die het opslagpad
bepaalt. Dat blijft ongewijzigd (T1 tot en met T3).

Wat wél op de server gebeurt en niet in de browser kan: het origineel terughalen uit de
privébucket, en de betaalde aanroep doen met een gereserveerd budget. Daarvoor is de edge
function `hours-read-scan` er.

---

# Contract

**Status: gedeployed** (migratie `20260913090000_hours_scan_reading.sql` en edge function
`hours-read-scan`, 9 september 2026). De migratie is additief en verandert geen bestaande
urenafspraak. `timesheets`, facturatie, urenbrieven, CSV-import en communicatie worden niet
geschreven. **JA Werkt staat UIT, de geverifieerde demo staat AAN** voor `uren-workflow`.

## De grens is ongewijzigd

Een uitlezing is een **feit over een aanlevering**, geen betaalbare tijd. Wat de uitlezer
teruggeeft is een voorstel-in-wording; het wordt pas een voorstel als een interne gebruiker het
bewaart, en pas een dagversie als diezelfde persoon het toepast. Alleen
`hours_apply_source_proposal` schrijft een dagrevisie en neemt het voorstel letterlijk over.

Alle paginaregels van T2 gelden ongewijzigd. Een foto is één pagina; een PDF heeft het aantal dat
de browser bij het uploaden telde. Een beoordeelde bron eist een pagina op elk nieuw voorstel, en
een tegensprekend paginabesluit forceert `assignment_uncertain`.

## Het model leest, de kern beslist

Alles wat het model teruggeeft is tekst zoals die op het papier stond. Elk oordeel dat uren bij de
verkeerde persoon, de verkeerde dag of het verkeerde getal kan brengen valt in
`_shared/hours-scan.ts`, deterministisch, tegen de week die de lezer mag zien.

- **De uitlezer beslist niet wie iemand is.** Exact geschreven naam is zeker; een gedeeltelijke
  maar unieke naam levert `assignment_uncertain`; een naam die bij niemand of bij meerdere mensen
  past levert géén voorstel. Dat is letterlijk dezelfde regel als de Excel-uitlezer gebruikt —
  `_shared/hours-member-match.ts` is van beide de enige bron.
- **De namen van de week gaan niet naar het model.** Alleen de weekdatums, zodat een geschreven
  "maandag" geplaatst kan worden. Met de namenlijst erbij zou het model een slecht leesbare naam
  naar die lijst toe kunnen trekken, en die correctie zou hier binnenkomen alsof zij zeker is.
- **Een onzekere datum levert geen voorstel**, want er is dan geen werkdag om aan te wijzen.
- **Ontbrekende tijden worden niet verzonnen.** Geen leesbaar totaal en geen reden betekent geen
  voorstel; de regel wordt met de letterlijke lezing benoemd. `8,5` en `8:30` zijn dezelfde duur.
  Een kale nul levert bewust geen voorstel: daar hoort een reden bij. Een streepje, kruisje of
  "n.v.t." is geen reden.
- **Handgeschreven pauzes tellen mee.** Een geschreven tijdvak (`12:00-12:30`) wordt als pauze in
  de dienst bewaard. Een kale duur (`30`) zegt hoe lang maar niet wanneer; die wordt daarom **niet**
  als tijdvak verzonnen, maar wel gebruikt om te controleren of de dag klopt.
- **Een eindtijd vóór de begintijd** wordt als doorlopend naar de volgende dag gelezen en meteen
  als onzekere dienst gemarkeerd — het verandert de lengte van de dag, dus het mag niet stil.
- **Een half gelezen dienst** wordt niet overgenomen en met naam gemeld; dat is een ontbrekend
  feit, geen onzeker feit.
- **Een deels onleesbare indeling** levert helemaal geen indeling. Een half aangeleverde verdeling
  ziet eruit als een volledige.
- **Een werkdag mag hoogstens één keer in één uitlezing staan.** Twee regels over dezelfde dag
  blokkeren de hele uitlezing, met beide vindplaatsen erbij.

## Wat "onzeker" betekent, en wat het blokkeert

`hours_source_proposals.uncertain_fields` bewaart welke gelezen waarden onzeker waren: `total`,
`shift`, `break`, `categories` of `reason`. De vorm is canoniek: vaste volgorde, geen dubbels. Een CHECK van louter ingebouwde functies bewaakt
de inhoud en de omvang; de canonieke vorm zelf wordt door een schrijftrigger afgedwongen. Die
verdeling is opzettelijk. Een CHECK wordt bij élke UPDATE opnieuw beoordeeld en deze tabel kent geen
verwijderpad, dus een CHECK die van een projectfunctie afhing zou bestaande voorstellen voorgoed
vastzetten zodra die functie ooit versmalde; een schrijftrigger beoordeelt alleen de rij die wordt
geschreven. Een onbekend label wordt **geweigerd** (`22023`), nooit stil weggelaten — weglaten zou de
twijfel van de uitlezer in schijnzekerheid veranderen.

`employee` en `date` staan bewust niet in die lijst. Twijfel over wie stuurt `assignment_uncertain`
aan; twijfel over welke dag laat de regel helemaal weg. Geen van beide heeft een plek in een
voorstel.

Zolang die twijfel niet is bevestigd blokkeert `hours_apply_source_proposal` met `22023` en
schrijft niets. `hours_confirm_proposal_values(p_proposal_id, p_note)` heft de blokkade op: het zet
`values_confirmed_by`/`_at` (eenmalig, bewaakt door de trigger) en laat het voorstel verder met
rust — status blijft `open`, toepassen blijft een aparte handeling. De toelichting staat in een
**eigen** kolom `values_note`, nooit in `note`: `note` is voorgestelde inhoud die letterlijk wordt
toegepast.

Twee twijfels kunnen tegelijk op één voorstel staan, en elk wordt in een eigen handeling
afgehandeld — de guard-trigger weigert een schrijfactie die er twee tegelijk beweegt.
`hours_get_week_sources` telt `uncertain_values` server-side over de hele week, naast
`undecided_assignments`.

**Een zekerheidsscore overrulet nooit een ontbrekend gegeven of een niet-sluitende optelling.**
Ontbreekt het totaal, dan komt er geen voorstel, ongeacht wat het model over zijn eigen zekerheid
zei. Sluit de optelling niet — de gelezen diensttijd of de gelezen urensoorten komen niet uit op
het opgeschreven totaal — dan wordt `total` als onzeker gemarkeerd en het verschil getoond, ook
wanneer het model niets meldde. Bij een scan is elk getal een lezing, dus daar is een verschil een
reden tot kijken; de bestaande servercontrole (`sourceControlIssues`) levert dezelfde melding als
bij handmatige invoer.

## De betaalde aanroep

Er is één route: `_shared/ai-accounting.ts`. Reserveren vóór de aanroep, één providerverzoek, en
aanvraag, verbruik en boeking atomair afrekenen. Er is geen tweede pad ernaast en geen
Qwen-terugval.

| Wat | Waar |
| --- | --- |
| Provider en model | Gemini, standaard `gemini-3.5-flash`; te overschrijven met `HOURS_SCAN_MODEL` |
| Boekingskenmerk | `feature = 'hours_scan_reading'` |
| Antwoordgrens | 40.960 uitvoertokens plus 1.024 denktokens — genoeg voor de vijfhonderd regels die één aanlevering mag bevatten |
| Bestandsgrens | 10 MiB; daarboven een zichtbare blokkade en géén aanroep |
| Gemeten kosten | ~1.500 invoertokens en ~275 uitvoertokens per A4-briefje; **1 cent per uitlezing** |

De onzekerheidslijst die het model krijgt aangeboden ís de lijst die de uitlezer accepteert
(`REPORTABLE_UNCERTAINTY`), en de lijst met uitleesbare mediatypen staat óók maar op één plek
(`HOURS_READABLE_SCAN_TYPES`). Beide worden door het scherm, de edge function en een test gedeeld;
één woord verschil zou anders een betaalde uitlezing laten stranden op een label dat niemand afwees.

**Elk veld in het antwoordschema is verplicht.** Gestructureerde uitvoer vult wat zij moet vullen
en slaat de rest over; een optioneel totaalveld kwam in een echte proef niet terug, waarna elke
regel eerlijk werd overgeslagen. Een lege tekst is hoe het model zegt dat er niets staat.

**Een uitgeput budget blokkeert zichtbaar en niets anders.** `reserve_ai_usage` weigert, de
uitlezer geeft `402` met code `insufficient_credits`, en het scherm zegt dat handmatig een voorstel
vastleggen gewoon werkt. Uploaden, paginatoewijzing, handmatige voorstellen, Excel uitlezen,
bevestigen en toepassen zijn allemaal ongemoeid.

Een onbekende provideruitkomst (time-out, ontbrekend verbruik) houdt zijn reservering vast en komt
als zodanig terug; dat wordt nooit stil een gratis nieuwe poging.

**Een kaal getal in de pauzekolom is minuten.** "15", "30", "45" zijn hoe een pauze op een briefje
staat; een geschreven duur (`0,5`, `1:00`) blijft uren. Een streepje, "n.v.t." of een nul betekent
dat er geen pauze was, en de dienst kan dan gewoon worden bewaard.

**Elke uitlezing wordt geclaimd voordat er wordt betaald.** `hours_source_readings` legt per poging
vast welk document, welke week, wie het vroeg, wat het kostte en hoeveel regels eruit kwamen — geen
inhoud, alleen de overdracht. Een partiële unieke index laat per bron één lopende uitlezing toe, dus
een tweede klik of een tweede tabblad krijgt `409` in plaats van een tweede rekening. Een claim die
nooit is afgesloten — een edge-instantie die tussendoor omvalt — vervalt na een kwartier vanzelf, want
de bron mag daar niet voorgoed door op slot komen. Die claim is
tegelijk het antwoord op "welk document is wanneer naar de verwerker gegaan", dat het AI-grootboek
zelf niet kan geven: dat kent organisatie, gebruiker en kosten, maar niet de bron. De tabel is
append-only, service-role-only beschrijfbaar en intern leesbaar met `finance.view`.

**Een mislukking ná betaling zegt wat zij kostte.** Het antwoord van het model kan afgekapt,
geweigerd of onleesbaar zijn terwijl de provider al is afgerekend. Dan komt code
`scan_reading_unusable` terug mét kosten, saldo en aanvraagkenmerk — het enige aanknopingspunt in het
grootboek voor die boeking — en de melding nodigt niet uit tot opnieuw proberen, want dat zou een
tweede keer kosten voor dezelfde weigering. Alleen een mislukking *vóór* de aanroep zegt "probeer het
opnieuw". Uitlezen is bovendien per bron één handeling tegelijk: dat wordt door de
claim in de database afgedwongen, niet door de knop.

## De uitleesroute

Edge function `hours-read-scan` (`verify_jwt = false`, self-auth). De browser stuurt **alleen een
bron-id**.

1. `requireRolePermission(req, 'finance.manage')` — een actief, intern profiel.
2. `hours_get_source_reading_context(p_source_id)` met de gebruikers-JWT. Die RPC autoriseert
   opnieuw in de database (module, eigen organisatie, `finance.manage`, ingeschakelde
   opdrachtgever) en levert opslagpad, mediatype, bytegrootte, paginatal en de week. Het pad komt
   dus van de server; een aanroeper kan de uitlezer nooit op een bestand van eigen keuze richten.
   De functie is **volatile**: zij neemt de schrijfpoort, en die vergrendelt een rij — PostgREST
   draait een `STABLE` functie read-only, waar dat met `25006` faalt en de route achter een kale
   405 verdwijnt.
3. Het origineel wordt met de service-role uit de privébucket gehaald.
4. Eén aanroep via `meteredAiFetch`.
5. `interpretScanReading` maakt er een beoordeelbare uitlezing van. **Er wordt niets geschreven.**

Een werkmap krijgt hier geen route: `.xlsx` heeft zijn eigen gratis, deterministische uitlezer en
een oud binair `.xls` heeft er geen. De knop verschijnt daar niet en de RPC weigert het (`22023`).

**Privacy.** Een scan is beeld en kan niet worden gepseudonimiseerd zoals dossiertekst; de bytes
van het briefje gaan zoals ze zijn naar de provider. Dat is dezelfde bewuste afweging die het
vision-pad van de CV-analyse al maakt. De namenlijst van de week reist niet mee.

## Fouten

| Code | HTTP | Betekenis |
| --- | --- | --- |
| `42501` | 403 | Geen bevoegdheid, verkeerde organisatie, of een ontoegankelijke bron |
| `22023` | 400 | Geen uitleesbaar bestandstype, uitgeschakelde opdrachtgever, onbekende onzekerheid, of een nog onbevestigde twijfel bij toepassen |
| `source_too_large` | 400 | Boven 10 MiB; leg de uren handmatig vast |
| `scan_already_running` | 409 | Deze bron wordt al uitgelezen; er komt geen tweede rekening |
| `scan_reading_unusable` | 502 | Het antwoord was onbruikbaar, maar wel betaald; het kenmerk staat erbij |
| `insufficient_credits` | 402 | Het maandbudget is op; handmatige invoer blijft werken |
| `ai_provider_outcome_unknown` | 503 | Geen volledig providerantwoord; de reservering blijft staan voor controle |
| `scan_unavailable` | 503 | Tijdelijk niet beschikbaar |
| `PT409` | 409 | De week is ondertussen gewijzigd |

## Verificatie

- **135 echte PostgreSQL-tests** (`scripts/hours-scan-db-test.py`): de nieuwe onzekerheidsregels
  plus de volledige vrijgegeven klantweek-, inname-, pagina-, werkmap-, classificatie-,
  foundation- en modulepoortregressies op het nieuwe schema. Alle dertien migraties worden tweemaal
  toegepast. Eén van die tests bewaakt voortaan dat **elke** stabiele urenfunctie in de read-only
  transactie van PostgREST kan draaien; een andere bewaakt dat geen enkele CHECK op de
  voorstellentabel van een projectfunctie afhangt (die wordt bij elke UPDATE opnieuw beoordeeld, en
  deze tabel kent geen verwijderpad — een later versmalde lijst zou bestaande voorstellen voorgoed
  vastzetten).
- **Applicatietests**: `hours-scan.test.ts` (70), `hours-scan-handler.test.ts` (32),
  `hours-scan-gemini.test.ts` (16), `hours-scan-panel.test.tsx` (16),
  `hours-scan-reading-shape.test.ts` (3) plus uitgebreide projectie- en werkmaptests. Totaal 1.792 groen, met lint (0 errors), typecheck en productiebuild.
- **Verbonden demo-QA** (`scripts/e2e-hours-scan-demo.spec.ts`, hergebruikt de fixture van
  `scripts/prepare-hours-pages-demo.mjs`): echte interne en medewerkerlogin tegen de live API, met
  een in de test gerenderde foto van een urenbriefje. Bewezen: een werkmap krijgt geen betaalde
  route, de foto wordt als bron van één pagina bewaard, één betaalde uitlezing geeft de
  aangeleverde regels terug met de prijs erbij en schrijft niets, de hele uitlezing wordt in één
  handeling als voorstellen vastgelegd zonder ook maar één dagrevisie, toepassen schrijft precies
  één dagversie met "pagina 1 · rij 1" als herkomst, en een portaalgebruiker krijgt 403 op zowel de
  context als de uitlezer. **De run claimt bewust precies één onaangeroerde werkdag** — na afloop
  geverifieerd. Nul JavaScript-fouten, nul serverfouten, nul writes naar `timesheets`, nul
  berichten.
- **Kosten van de hele QA**: tien echte aanroepen over alle vier de reviewrondes, samen **€ 0,10**
  afgeschreven op de demo-organisatie; het saldo ging van € 48,78 naar € 48,68 en er bleef geen
  reservering open. Het maandbudget van JA Werkt is niet aangeraakt: nul aanroepen.
  Eén A4-briefje kost ongeveer één cent (circa 1.500 invoer- en 275 uitvoertokens). De eerste twee
  aanroepen zijn de proeven die de read-only-transactie en het ontbrekende totaalveld aan het licht
  brachten; de latere zijn de herhalingen na elke reparatieronde.

Wat deze QA **niet** bewijst is de handschriftkwaliteit van het model. Het briefje is gerenderde
tekst; echte handgeschreven briefjes horen bij de acceptatieset van T14.
