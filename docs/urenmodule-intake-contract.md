# Urenmodule: interne broninname en invoervoorstellen

**Status: gedeployed op 8 september 2026** (migraties `20260909090000_hours_week_sources_and_proposals.sql`,
`20260910090000_hours_source_pages_and_assignment.sql` en `20260911090000_hours_spreadsheet_sources.sql`).
Alle drie zijn additief en veranderen geen bestaande urenafspraak. `timesheets`, facturatie, urenbrieven, CSV-import en communicatie worden niet
geschreven. **JA Werkt staat UIT, de geverifieerde demo staat AAN** voor `uren-workflow`; die SaaS-poort
geldt ook voor de drie nieuwe tabellen en de privé-bronopslag.

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
`<organisatie>/<week>/<sha256>.<pdf|jpg|png|xlsx|xls>`. Storage zelf dwingt de grens van 25 MiB
(26.214.400 bytes) en de vijf toegestane mediatypen af.

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
broninput (diensten/pauzes/broncategorieën, exact hetzelfde schema als handmatige invoer), een
`page_number` en een vrije `page_label` als vindplaats binnen die pagina. De inhoud is onveranderlijk;
alleen de afwikkeling beweegt één keer van `open` naar `applied` of `discarded`, met actor en tijdstip,
en de toewijzingsbevestiging beweegt hoogstens één keer (zie hieronder). Een CHECK bewaakt dat een
afgewikkeld voorstel altijd actor én uitkomst heeft, en dat een open voorstel die velden juist niet heeft.

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

Alle negen zijn uitvoerbaar voor `authenticated` en autoriseren opnieuw in de functie: actief profiel,
eigen organisatie, `is_internal_user()`, de SaaS-module en `finance.view`/`finance.manage`. Geen enkele
is uitvoerbaar voor `anon` of `service_role`.

| RPC | Parameters | Resultaat |
| --- | --- | --- |
| `hours_get_week_sources` | `p_week_id uuid` | `{week_id, can_manage, open_proposals, undecided_assignments, sources[]}` met per bron zijn pagina's en voorstellen |
| `hours_add_week_source` | `p_week_id uuid`, `p_content_hash text`, `p_file_name text`, `p_content_type text`, `p_page_count integer` | Dezelfde projectie plus `duplicate` en `source_id` |
| `hours_create_source_proposal` | `p_source_id uuid`, `p_day_id uuid`, `p_minutes integer`, `p_no_hours_reason text`, `p_note text`, `p_source_input jsonb`, `p_page_label text`, `p_page_number integer`, `p_assignment_uncertain boolean` | Dezelfde projectie |
| `hours_discard_source_proposal` | `p_proposal_id uuid`, `p_note text` | Dezelfde projectie |
| `hours_apply_source_proposal` | `p_proposal_id uuid`, `p_expected_revision_id uuid` | `WeekDetail` plus `applied_created_revision` en `sources` |
| `hours_set_source_page` | `p_source_id uuid`, `p_page_number integer`, `p_assignment text`, `p_member_id uuid`, `p_note text` | Dezelfde projectie |
| `hours_create_page_proposals` | `p_source_id uuid`, `p_page_number integer`, `p_entries jsonb` | Dezelfde projectie |
| `hours_create_source_proposals` | `p_source_id uuid`, `p_entries jsonb` | Dezelfde projectie |
| `hours_confirm_proposal_assignment` | `p_proposal_id uuid`, `p_note text` | Dezelfde projectie |

De projectie telt daarnaast `open_proposals` en `undecided_assignments` **server-side over de hele
week**, zodat een scherm nooit hoeft op te tellen wat er toevallig op staat.

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

## Pagina's en gecontroleerde toewijzing (T2)

Eén aangeleverd bestand bevat vaak briefjes van meerdere medewerkers. De klantspecificatie is daar
scherp over: **een PDF met meerdere briefjes mag nooit stilzwijgend aan één persoon worden toegewezen.**

### Hoeveel pagina's er zijn

`hours_week_sources.page_count` legt vast hoeveel pagina's de aanlevering had. De browser telt een PDF
met pdf.js (`src/lib/hours-pdf-pages.ts`) op de bytes die hij toch al leest voor de digest; een foto is
per definitie één pagina en de server forceert dat. Een bestand dat de browser niet kan tellen blijft
eerlijk `null` — "aantal pagina's onbekend" — in plaats van te doen alsof het één pagina is. Bronnen van
vóór deze migratie houden `null`.

Net als de digest is dit een **feit over de aanlevering, geen vertrouwensgrens**: de beoordelaar ziet
altijd de werkelijke pagina's voordat een voorstel wordt toegepast. Wat de server wél afdwingt is de
samenhang: `page_number` op een voorstel of paginabesluit moet binnen `page_count` vallen zodra dat
bekend is.

### Wie op een pagina staat

`hours_source_pages` bewaart per pagina van een bron het besluit van een interne gebruiker:

| `assignment` | Betekenis | `member_id` |
| --- | --- | --- |
| `single` | Op deze pagina staat één medewerker | verplicht, lid van dezelfde week |
| `multiple` | Op deze pagina staan meerdere medewerkers | leeg |
| `unclear` | Onduidelijk wie hierop staat | leeg |

De rij is append-only met actor en tijdstip, zoals elk ander urenfeit. Een besluit wijzigen betekent dat
`hours_set_source_page` het oude in dezelfde transactie op `withdrawn` zet en een nieuw besluit vastlegt;
een partiële unieke index houdt precies één actief besluit per pagina over. Zo blijft zichtbaar wie ooit
zei dat een pagina bij één persoon hoorde.

**`single` wordt geweigerd zodra de pagina aantoonbaar meerdere medewerkers draagt** — dat wil zeggen:
er staan al niet-verworpen voorstellen voor meer dan één medewerker op die pagina (`22023`). Dat is geen
mening maar een feit uit de eigen administratie, en het is niet te omzeilen door harder te klikken.

**Een besluit mag geen voorstel tegenspreken dat al staat.** Dat is het spiegelbeeld van de forcering
hieronder: `single` op een andere medewerker dan waarvoor er al een zeker voorstel op die pagina ligt, en
`unclear` op een pagina die al zulke voorstellen draagt, worden geweigerd (`22023`). Zonder die regel zou
een later besluit een eerder voorstel stil overrulen: de inhoud van een voorstel is onveranderlijk, dus
het kan achteraf niet alsnog als onzeker worden gemarkeerd en zou gewoon toepasbaar blijven. Wie het
besluit wél juist vindt, verwerpt eerst die voorstellen — dezelfde weg als overal elders in deze module.
Een voorstel dat zelf nog onbeslist is blokkeert niets, want het kan toch al niet worden toegepast, en
een **toegepast** voorstel telt hier evenmin mee: dat is historie die niet meer verworpen kán worden, dus
zou het het besluit voorgoed op slot zetten. Voor de vraag of een pagina aantoonbaar meerdere mensen
draagt telt een toegepast voorstel juist wél mee — dat is bewijs, geen blokkade.
(`20260910100000` en `20260910110000`.)

Bij die regel horen twee sluitstukken, want anders is hij om te lopen:

- **Een bron die per pagina is beoordeeld eist een pagina op elk nieuw voorstel** (`22023`). Zonder
  paginanummer is er geen besluit dat het voorstel kan sturen, en zou een `unclear`-pagina alsnog een
  zeker, direct toepasbaar voorstel opleveren.
- **Bevestigen leest het paginabesluit opnieuw.** Een onleesbare pagina is precies waarvoor bevestigen
  bestaat, dus die blijft werken; maar een pagina die expliciet op een **andere** medewerker staat
  blokkeert de bevestiging (`22023`). Anders zou de volgorde "onduidelijk → voorstel → pagina op iemand
  anders → bevestigen" dezelfde tegenspraak alsnog binnenlaten.
- **Het eerste paginabesluit op een bron eist dat openstaande voorstellen zónder pagina eerst zijn
  afgehandeld** (`22023`). Vanaf dat moment vraagt de bron een pagina op elk nieuw voorstel; de oudere
  paginaloze voorstellen zouden anders een uitzondering blijven die geen enkel besluit kan bereiken.
  (`20260910120000`.)

### Een pagina in één handeling overnemen

`hours_create_page_proposals` maakt uit één pagina in één handeling een voorstel per werkdag. Dit is de
handeling waar het risico van criterium 4 zit, en daarom is hij dubbel begrensd:

- er moet een **actief `single`-besluit** voor die pagina zijn, anders `22023`;
- elke opgegeven dag moet bij **precies die medewerker** horen, anders `22023` en niets geschreven.

De verkorte route kan dus per constructie geen andere persoon raken. Wat eruit komt zijn nog steeds
voorstellen: toepassen blijft per dag een aparte handeling.

### Een toewijzing die openlijk onbeslist blijft

Een voorstel draagt `assignment_uncertain`. De interne gebruiker kan dat zelf aanvinken, en de server
forceert het wanneer het actieve paginabesluit het voorstel tegenspreekt: een `unclear`-pagina, of een
`single`-pagina die op een andere medewerker staat.

Zolang een onzeker voorstel niet is bevestigd, **blokkeert `hours_apply_source_proposal` met `22023` en
schrijft niets**. `hours_confirm_proposal_assignment` heft die blokkade op: het zet
`assignment_confirmed_by`/`_at` (eenmalig, bewaakt door de trigger) en laat het voorstel verder
ongemoeid — status blijft `open`, toepassen blijft een aparte handeling.

De bevestigingstoelichting staat bewust in een **eigen** kolom `assignment_note` en niet in `note`:
`note` is voorgestelde inhoud die letterlijk wordt toegepast, en die mag door een bevestiging niet
veranderen. De onveranderlijkheidstrigger dwingt dat af.

Klopt de medewerker niet? Dan geldt de bestaande regel ongewijzigd: verwerp het voorstel en leg een
nieuw voorstel vast. Bevestigen kan alleen instemmen met de voorgestelde medewerker, nooit een andere
kiezen.

### Herkomst en openstaande punten

De herkomst op de dagrevisie noemt nu ook de pagina:
`[{"kind":"upload","label":"<bestandsnaam>","reference":"pagina 2 · <vindplaats>"}]`, server-side
opgebouwd. Nog steeds zonder interne identificatoren.

`hours_get_week_sources` levert `undecided_assignments`: het aantal open voorstellen met een onbesliste
toewijzing. Het scherm toont dat als blokkerend openstaand punt op de week.

### Uitrolvolgorde

De twee gewijzigde RPC's kregen hun nieuwe parameters **met een default**, zodat een aanroep met de oude
parameterset geldig blijft. De migratie kan daardoor vóór de frontend live: de nog draaiende versie blijft
werken en levert dan simpelweg geen paginanummer. Een databasetest bewijst dat expliciet.

## Excel- en tabelbestanden als bron (T3)

Een `.xlsx`- of `.xls`-bestand wordt als bron aanvaard en kan **deterministisch** worden uitgelezen. Er is
geen model en geen betaalde aanroep in het spel: de uitlezer leest wat er staat.

### Een werkblad is de pagina van dit formaat

`page_count` is het aantal werkbladen; `page_number` op een voorstel is het werkbladnummer en `page_label`
noemt blad en regel (`blad Week 37 · rij 3`). Daardoor gelden **alle paginaregels van T2 ongewijzigd**: een
beoordeelde bron eist een pagina op elk nieuw voorstel, een tegensprekend paginabesluit forceert
`assignment_uncertain`, en een werkblad met meerdere medewerkers kan niet op één naam worden gezet.

### Wat de uitlezer wel en niet doet

- **Formules worden niet uitgevoerd.** Er wordt uitsluitend het bewaarde resultaat gelezen dat in het
  bestand staat; een werkmap met macro's wordt gelezen zonder die macro's te draaien. Een databestand is
  geen programma.
- **Twee indelingen worden herkend.** Een *kruistabel* (medewerkers onder elkaar, dagen als kolomkoppen)
  en een *lijst* (kop met naam, datum en uren, één regel per medewerker/dag). Elke andere indeling levert
  een blokkade en **géén halve voorstellen**.
- **Kolomkoppen worden exact herkend, niet op voorvoegsel.** Een voorvoegselregel lijkt behulpzaam tot een
  kolom "Aantal dagen" de wedstrijd om het urentotaal wint en een `1` een uur wordt. Een onbekende kop
  maakt van het blad simpelweg geen lijstblad, wat op een eerlijke blokkade uitkomt in plaats van op
  verkeerde uren.
- **Een lijstblad blijft een lijstblad.** Draagt een blad de koppen naam, datum en uren, dan wordt het als
  lijst gelezen — ook wanneer een regel toevallig een tweede datum bevat (een geboorte- of ingangsdatum).
  Levert die lezing niets op, dan krijgt een kruistabel op datzelfde blad alsnog zijn beurt, zodat een blad
  nooit als "gelezen" geldt terwijl er niets uit komt.
  Voor een kruistabel moeten de dagkolommen bovendien **naast elkaar** staan; een banner als
  "Periode: 07-09-2026 t/m 13-09-2026" draagt óók twee datums, maar met iets ertussen, en die als kop
  lezen zou elke kolom op de verkeerde dag boeken. Staan de datums van zo'n banner tóch naast elkaar, dan
  helpt de tweede eis: de dagenrij staat **direct boven de medewerkers**, dus de regel eronder moet een
  medewerker van deze week noemen.
- **Broncategorieën blijven letterlijk staan.** In een lijstblad wordt elke overige kolomkop als broncode
  overgenomen (`OV1`, `OV3`, …) met de duur uit die cel. Er wordt niets naar een interne uursoort vertaald;
  dat is het werk van de matrix, later en op de vastgelegde dagrevisie. Een kolom telt alleen als broncode
  wanneer **elke** waarde eronder een duur is die in het dagtotaal van diezelfde regel past — een deel is
  nooit groter dan het geheel. Een nul in zo'n kolom is een aangeleverd feit (nul overuren op dinsdag) en
  geen reden om de hele indeling te laten vervallen. Een opmerkingen- of referentiekolom wordt met rust gelaten in plaats van de
  hele regel te laten vervallen, en een uurloon- of bedragkolom wordt nooit een stuk van de werkdag.
  Op een dag zónder uren wordt helemaal geen indeling voorgesteld: die combinatie kan de servercontrole
  niet afhandelen, en de RPC weigert haar dan ook. Een kolom wordt beoordeeld op de regels die de uitlezer
  werkelijk leest, zodat een eindtotaalregel onderaan het blad geen aangeleverde broncode wegneemt.
  Eén ontbrekende of onleesbare cel bewijst niets over de kolom en laat die staan; de cel zelf wordt naast
  het voorstel gemeld. Een kolom die aantoonbaar géén duren bevat wordt bij naam apart gezet. Kolommen die
  geld of een verwijzing dragen (uurloon, tarief, bedrag, kilometers, project, kostenplaats, ploeg,
  opmerking) worden op hun kop herkend en nooit als deel van de werkdag overgenomen — ook niet wanneer de
  waarde toevallig onder het dagtotaal past. Datzelfde geldt voor **diensttijden** (begin, eind, pauze):
  die zijn geen indeling van de dag, en deze module heeft er een eigen vorm voor die deze uitlezer niet
  vult.
  **Let op:** een kolom die een *deel* van de dag beschrijft (bijvoorbeeld alleen overwerk) telt per
  definitie niet op tot het dagtotaal en levert dus altijd een zichtbaar verschil. Dat is bedoeld gedrag —
  de klantspecificatie vraagt juist om dat verschil — maar het betekent dat zo'n kolom om beoordeling
  vraagt en niet om wegklikken.
- **Eén werkdag draagt hoogstens één voorstel uit één aanlevering.** Staat dezelfde medewerker tweemaal
  op dezelfde dag, dan is het bestand over die dag dubbelzinnig; de uitlezing **blokkeert** met de beide
  vindplaatsen erbij. Een van de twee kiezen zou precies de gok zijn die deze module vermijdt.
- **Ontbrekende tijden worden niet verzonnen.** Een lege cel levert geen voorstel; de regel wordt met reden
  benoemd. Alleen **tekst** in een urenkolom wordt de letterlijke reden voor "geen uren" — een getal dat
  niet als duur te lezen is (negatief, buiten bereik, subminuut) is een probleem en geen reden. Een nul,
  ook een als tijd opgemaakte `0:00`, levert bewust géén voorstel: daar hoort een reden bij.
- **Een als tijd opgemaakte cel is een duur, nooit een werkdatum.** Een spreadsheet bewaart `8:30` als een
  breuk van een dag op zijn eigen jaartelling; dat als datum lezen zou een lijstblad op een kruistabel doen
  lijken en het hele blad stil laten verdwijnen. De dagcomponent telt mee, zodat een weektotaal van `40:00`
  ook veertig uur blijft en niet zestien.
- **Een kaal getal dat twee dingen kan betekenen wordt niet gekozen.** De verstreken-tijdnotatie `[h]:mm`
  komt niet als tijd maar als kale breuk van een dag binnen. `0,5` is dan óf een half uur decimaal, óf
  12:00 — en niets in het bestand zegt welk van de twee. Een kaal getal **onder de 1** is daarom
  dubbelzinnig: de uitlezer meldt beide lezingen en maakt geen voorstel, in plaats van stilzwijgend door
  vierentwintig te delen. Een getal van 1 of hoger wordt als decimale uren gelezen; wijkt dat af van de
  gelezen dagen, dan is dat zichtbaar in het controlegetal. Voor een **weektotaal** beslissen de dagen van
  diezelfde regel mee: past precies één van de twee lezingen bij wat er gelezen is, dan is dat de
  aangeleverde waarde. Dat is geen gok maar het bestand dat zichzelf uitlegt. Een decimaal die als
  tekst staat is niet dubbelzinnig en wordt gewoon gelezen.
- **Een werkblad dat de uitlezer niet kan indelen wordt bij naam genoemd.** Het blijft ongelezen — er
  worden geen halve voorstellen uit gemaakt — maar het scherm meldt welk blad het betreft, zodat een
  aanlevering niet stilzwijgend halveert.
- **Een aangeleverd weektotaal wordt alleen vergeleken als de hele regel gelezen is.** Reikt de tabel
  buiten deze week, of is één dagcel onleesbaar, dan zou een vergelijking een verschil melden dat het
  bestand niet heeft.
- **Dezelfde broncode tweemaal levert dezelfde waarschuwing als bij handmatige invoer.** De uitlezer
  gebruikt letterlijk dezelfde controle (`sourceControlIssues`), zodat een mens en een machine over
  dezelfde aanlevering hetzelfde te zien krijgen.
- **Een streepje of kruisje is geen reden.** `-`, `x`, `.` en `n.v.t.` in een urencel betekenen "hier staat
  niets"; die worden als overgeslagen regel benoemd en niet als reden voor "geen uren" overgenomen.
  Hetzelfde geldt voor elke foutwaarde van het rekenblad zelf (`#N/A`, `#REF!`, `#DIV/0!` en varianten):
  die zegt niets over de gewerkte tijd en wordt nooit de bewering dat iemand niet heeft gewerkt.
- **Twee kolommen die dezelfde rol claimen maken het blad dubbelzinnig.** Staan er bijvoorbeeld zowel een
  "Totaal"- als een "Uren"-kolom, dan wordt er niet gekozen — dat zou een weektotaal als dagtotaal kunnen
  voorstellen — maar blokkeert de uitlezing net als bij een onbekende kop.
- **Lege dagen worden bij een afwijkend weektotaal benoemd.** Een verschil dat door een leeggelaten dag
  komt is iets anders dan een verschil in de aangeleverde cijfers, en het scherm zegt welke dagen leeg
  waren. Een streepje of een kale nul telt daarbij als "niets aangeleverd voor die dag" en houdt de
  vergelijking dus overeind; alleen een waarde die de uitlezer helemaal niet kan lezen maakt vergelijken
  zinloos. Zo'n cel wordt hoe dan ook als overgeslagen regel benoemd, ook wanneer er geen totaal is dat
  om uitleg vraagt.
- **Het mediatype is geen bewijs.** Windows meldt `application/vnd.ms-excel` voor een gewone `.csv`, en
  ook voor een moderne `.xlsx`. De browser controleert daarom de eerste bytes: een werkmap is een
  zip-container (`.xlsx`) of een OLE-document (`.xls`). Iets anders wordt geweigerd vóór het wordt bewaard,
  en een werkmap wordt bewaard als wát hij is — anders zou een perfect leesbare `.xlsx` voorgoed als
  onleesbare `.xls` in de opslag staan.
- **Een aangeleverd totaal is een controlegetal.** Klopt het weektotaal van een rij niet met de dagen
  eronder, of tellen de broncodes niet op tot het dagtotaal, dan blijft alles staan zoals aangeleverd en
  wordt **het verschil getoond**. Er wordt niets weggerekend en toepassen wordt niet stil geblokkeerd; de
  bestaande servercontrole beoordeelt de vastgelegde dagrevisie.
- **De uitlezer beslist niet wie iemand is.** Een exact geschreven naam (ook `Achternaam, Voornaam`) is
  zeker. Een gedeeltelijke maar unieke naam (`J. Kowalski`) levert een voorstel met
  `assignment_uncertain`; een naam die bij niemand of bij meerdere mensen past levert **geen** voorstel en
  wordt als overgeslagen regel benoemd. Een gedeelde achternaam is daarbij niet genoeg: wat er vóór de
  achternaam staat moet bij die persoon passen. "J." past bij Jan, "Piet" niet — en juist een gedeelde
  achternaam nodigt uit tot die verwisseling. Een datum die niet in deze week valt, idem.
- **Een oud binair `.xls` blijft een eerlijke blokkade.** Het bestand wordt wel als bron bewaard — de
  beoordelaar kan het openen en handmatig een voorstel vastleggen — maar er wordt geen tekstgok op
  losgelaten. De knop **Uitlezen** verschijnt daar dan ook niet: een handeling aanbieden die altijd
  mislukt is geen eerlijke blokkade maar een omweg.
- **Het uitlezen gebeurt in de browser, op het moment dat iemand erom vraagt.** Dat is dezelfde plek waar
  een PDF zijn pagina's telt. Een zeer groot bestand kost dus even tijd in het tabblad; dat is bewust
  gekozen boven een serveraanroep, omdat er geen betaalde dienst en geen extra vertrouwensgrens aan te
  pas komt.

### Eén uitlezing, één handeling

`hours_create_source_proposals` legt een hele uitlezing in één transactie vast: één tot vijfhonderd
voorstellen, elke werkdag hoogstens één keer, vaste vergrendelvolgorde over de dagen. Het scherm toetst
diezelfde bovengrens vóór het verzenden, zodat een grote uitlezing wordt versmald in plaats van achteraf
in zijn geheel geweigerd. Wordt één regel
geweigerd, dan wordt er **niets** vastgelegd — een halve uitlezing is erger dan geen. Wat eruit komt zijn
nog steeds voorstellen: toepassen blijft per dag een aparte handeling.

De interne gebruiker ziet vóór het bewaren precies wat gelezen is, per regel met vindplaats, en vinkt uit
wat niet mee moet. Een dag die al een openstaand voorstel uit dezelfde bron heeft staat standaard uit.

## Portaalgrens

Een medewerker ziet de bronherkomst van de eigen dag, maar:

- `hours_week_sources`, `hours_source_proposals` en `hours_source_pages` leveren via directe
  tabeltoegang nul rijen;
- `hours_get_week_sources` weigert een portaalgebruiker met `42501` (HTTP 403);
- interne revisiehistorie en classificaties blijven leeg in de portaalprojectie.

## Fouten

| SQLSTATE | Betekenis |
| --- | --- |
| `42501` | Geen bevoegdheid, verkeerde organisatie, ontoegankelijke week/dag/bron, of poging historie te wijzigen |
| `22023` | Ongeldige invoer, niet-ondersteund bestandstype, ontbrekend of afwijkend opslagobject, uitgeschakelde opdrachtgever, al afgewikkeld voorstel, pagina buiten het bereik van de bron, "één medewerker" op een pagina die er aantoonbaar meerdere draagt, een overname die een dag van een andere medewerker raakt, dezelfde werkdag tweemaal in één uitlezing, of een nog onbesliste toewijzing bij toepassen |
| `PT409` | De dagversie is ondertussen gewijzigd; opnieuw laden en het voorstel opnieuw beoordelen |

## Verificatie

- **145 echte PostgreSQL-tests** (`scripts/hours-pages-db-test.py`): 19 nieuwe paginagevallen plus de
  volledige vrijgegeven inname-, foundation-, classificatie- en modulepoortregressies op het nieuwe
  schema. Alle negen migraties worden tweemaal toegepast. De poortcontrole is uitgebreid van vijftien
  naar **zestien** tabellen en van de vijf inname-RPC's naar de acht van nu. De voorloper
  `scripts/hours-intake-db-test.py` blijft ongewijzigd; de nieuwe harness importeert hem.
- **Applicatietests**: `src/test/hours-sources.test.ts` en `src/test/hours-week-sources-ui.test.tsx`;
  totaal 1.472 groen, met lint (0 errors), typecheck en productiebuild.
- **Verbonden demo-QA** (`scripts/e2e-hours-pages-demo.spec.ts` + `scripts/prepare-hours-pages-demo.mjs`):
  echte interne en medewerkerlogin tegen de live API, met een synthetische PDF van drie pagina's die de
  browser zelf telt, in een eigen QA-week met **twee** medewerkers. De run claimt bewust precies één
  onaangeroerde werkdag. Deze stroom verstuurt niets en doet geen betaalde AI-aanroepen, dus de
  communicatie-instelling van de demo is niet aangeraakt.

Nog niet gebouwd: uitlezers voor Word, PDF-tekst en OCR/Vision, mailinname, de klantpagina zonder
inloggen, en vrijgave of export. Zie [de ticketlijst](urenmodule-tickets.md).
