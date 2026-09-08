# Urenmodule — bouwstand

Start: 8 september 2026. Werkmap `/Users/kas/dev/ja-works-hub/.worktrees/urenmodule-bouw`, branch `codex/urenmodule-bouw`,
base `aedc6dc` (PR #261). De bestaande dirty checkout blijft onaangeraakt.

De eerdere fundering (#262), matrixbouw (#263) en classificatie zijn samengebracht in
[PR #264](https://github.com/sitejob-nl/ja-works-hub/pull/264), inmiddels rechtstreeks gericht op main.
Actieve werkmap: `/Users/kas/dev/ja-works-hub/.worktrees/urenmodule-classificatie`, branch
`codex/urenmodule-classificatie`. Het SaaS-gatecheckpoint is `221b554`.

De vier oorspronkelijke databasewijzigingen zijn op 8 september als één afgeschermde transactie
gedeployed, gevolgd door de additieve HTTP-conflictreparatie. `hours-classify-day` is opnieuw
gedeployed en de database-types zijn uit het live schema gegenereerd.
**JA Werkt staat UIT, uitsluitend de geverifieerde demo staat AAN** voor `uren-workflow`.
De nieuwe module werkt los van legacy `uren` en abonnementen. De SaaS-schakelaar bewaart historie
en blokkeert bij UIT zowel schermen als RPC's en directe tabellezing.
Zie [modulecontract](urenmodule-organization-gate.md) voor rechten en gelijktijdige wijzigingen.

**1.429 applicatietests, 106 echte PostgreSQL-tests en de verbonden demo-businessflow zijn geslaagd.**
Ook lint (0 errors), typecheck, productiebuild en Deno-controle zijn groen. De echte browserrun
gebruikte interne en medewerkerlogins, de live API en synthetische gegevens in de demo-organisatie.
Die QA vond en verifieerde reparaties voor een race bij matrixopslag en een hangende opslag vanuit
een verouderde browsertab. Zie [QA-verslag](urenmodule-demo-qa.md).

De SaaS-schakelaar staat onder **SaaS-admin → Organisaties → Modules beheren →
Urenmodule — weekcontrole en matrices**. De werkelijke SaaS-admin-browsertest van UIT/AAN staat
nog open: het bestaande QA-account is geblokkeerd/inactief en is niet gewijzigd; toestemming voor
tijdelijke activatie is gevraagd. De switch en blokkering zijn wel met unit- en databasetests
gecontroleerd. De frontend wordt als één afgeschermde release via PR #264 gepubliceerd; de PR- en
Vercel-status bepalen of publicatie voltooid is.

Deze eerste bouwstap voert de handmatige weekcontrole uit de specificatie van 7 september uit.
Het is de basis voor de volledige urenmodule; geen volledige oplevering of payrollpilot.

## Eerste werkende stroom

- Opdrachtgeverinstellingen staan standaard uit. Na expliciete inrichting kan intern een klantweek
  worden aangemaakt. Nederlandse deadlines worden bij die week vastgelegd.
- Verwachte medewerkers en dagen komen uit plaatsingen die de gekozen week overlappen. Kandidaten
  zijn de identiteit; meerdere plaatsingen blijven afzonderlijk herkenbaar.
- Een onbekende dag heeft geen revisie. Geen uren vereist expliciet nul en een reden. Decimale
  komma, punt en H:MM worden exact verwerkt als hele minuten. Subminuten worden geblokkeerd en
  nooit ongemerkt afgerond; ondersteuning van fijnere precisie vereist een volgende versie.
- Iedere wijziging maakt een onveranderlijke dagrevisie. Tegelijk wijzigen leidt tot een
  versieconflict. Oude medewerkerreacties en controles gelden niet voor gewijzigde uren.
- Medewerkers lezen uitsluitend de eigen weken via ingelogde, afgeschermde RPC's. Een maillink
  behoudt de week na inloggen. De urenweergave ondersteunt Nederlands, Engels en Pools.
- Medewerkerreacties en interne handmatige controle zijn afzonderlijke gegevens. Handmatige
  controle geeft geen payrollvrijgave. Er bestaat in deze bouwstap geen vrijgave- of exportactie.

Nieuwe schermen: `/uren/weken`, `/uren/weken/:weekId`, `/portaal/uren/weken` en
`/portaal/uren/week/:weekId`. De bestaande dagadministratie en facturatie blijven legacy; er is nog
geen projectie van nieuwe weekrevisies naar `timesheets` en dus geen dubbele payrolllevering.
De bestaande urenpagina's bevatten nu een link naar de weekcontrole.

## Gedeelde berekening en planning

`_shared/hours-calculation.ts` bevat de minutenparser, expliciete diensten en pauzes, optelcontrole,
effectieve matrixselectie, categorie-mapping en exclusieve tijdvensters. Expliciete broncategorieën
zoals OV1–OV5 blijven behouden. Ontbrekende en tegenstrijdige regels blokkeren.

Automatische dag-/weekoverwerkgrenzen, samenloop van toeslagen, feestdagen en berekening van echte
verstreken diensttijd tijdens een klokwisseling zijn nog niet geïmplementeerd. De eerste matrixvorm
weigert zulke configuratie; er wordt geen CAO geraden. Matrixopslag en servermatige indeling van
dagrevisies zijn nu gebouwd voor deze ondersteunde regels. Een ingevuld dagtotaal is niet automatisch
een volledige uursoortenindeling: ontbrekende tijdinformatie blijft een blokkade.

## Matrixinrichting

`/uren/matrices` en `/uren/matrices/:matrixId` bieden een opdrachtgevermatrix of expliciet benoemde
CAO-basis, concepten, broncodes (waaronder OV1–OV5), factoren en vaste of exclusieve tijdvensterregels.
Nieuwe matrices zijn leeg; er zijn geen standaardfactoren of veronderstelde CAO-afspraken.

Opslaan gebruikt een revisiecontrole. Publiceren vereist een opgeslagen concept, een geslaagd actueel
rekenvoorbeeld en een expliciete bevestiging. Het voorbeeld kan een dagtotaal, broncategorieën of een
dienst met bevestigde pauzes bevatten. Een geslaagd voorbeeld bevestigt alleen die geteste invoer.

Een gepubliceerde versie is onveranderlijk. Een opvolger sluit de effectieve periode van zijn voorganger
af, terwijl de oorspronkelijke publicatie bewaard blijft. De start is inclusief en het einde exclusief.
Opvolgers beginnen later dan bestaande publicaties en niet vóór de huidige Nederlandse datum. Reeds
ingeplande toekomstige publicaties kunnen in deze versie nog niet worden vervangen of ingehaald.

Een CAO-basis wordt per opdrachtgever expliciet gekozen, met revisiecontrole en historie. Dit is nog
geen historische koppeling met een eigen ingangsdatum. De servermatige dagindeling legt de gekozen
koppeling en matrix aan de exacte dagrevisie vast. Het matrixformulier wijzigt geen bestaande uren.
Zie [matrixcontract](urenmodule-matrix-contract.md) voor het volledige opslag- en selectiecontract.

## Brongegevens en servermatige dagindeling

De interne daginvoer bewaart meerdere diensten met expliciete dagovergangen en bevestigde pauzes,
broncategorieën of beide. Uren blijven hele minuten; subminuten worden zonder afronding afgewezen.
Een tegenstrijdig aangeleverd totaal blijft zichtbaar als brongegeven en krijgt een blokkade bij de
servercontrole. De invoer verwijdert bestaande details uitsluitend na expliciete bevestiging.

Elke inhoudelijke wijziging maakt een nieuwe dagrevisie, ook wanneer alleen een dienst of broncategorie
verandert. Het eerdere medewerkerakkoord en de eerdere controle gelden daarvoor niet meer. De oude
eenvoudige opslag-RPC kan bestaande dienstgegevens niet ongemerkt wissen. Medewerkers zien de eigen
bronfeiten in Nederlands, Engels of Pools; interne matrixfactoren en classificatiegegevens blijven afgeschermd.

De browser stuurt bij **Uurindeling controleren** alleen dag-id en verwachte revisie-id naar
`hours-classify-day`. De functie controleert de actieve interne gebruiker en `finance.manage`, leest
canonieke gegevens en rekent met dezelfde gedeelde kern als het matrixvoorbeeld. Een afzonderlijke
service-RPC controleert bevoegdheid, actuele dagrevisie en matrixcontext opnieuw voordat iets wordt bewaard.
Gelijktijdige wijzigingen leveren een versieconflict op; er wordt geen achterhaald resultaat opgeslagen.

De eerste geldige matrixselectie wordt onveranderlijk aan de werkdag gebonden, ook als ontbrekende
bronfeiten de berekening vervolgens blokkeren. Latere correcties op die dag erven dezelfde basis.
Een eerste ontbrekende matrix wordt niet vastgepind: na expliciete inrichting kan de controle opnieuw
worden uitgevoerd. Opzettelijk wisselen van de vastgelegde basis vereist een latere, afzonderlijk
gecontroleerde correctieprocedure en is in deze bouwstap niet beschikbaar.

Resultaten blijven per revisie, rekenkernversie en context herleidbaar. Dezelfde volledige aanvraag,
ook na het eerste vastpinnen, maakt geen dubbel resultaat. Het resultaat is een uurcodeverdeling,
een blokkade met concrete redenen of expliciet geen uren. Nul uren met reden krijgt geen verzonnen
looncode; tegenstrijdige dienstgegevens bij nul blijven geblokkeerd. Een geslaagde indeling is geen
medewerkerakkoord, interne vrijgave of payrolllevering.

Zie [classificatiecontract](urenmodule-classification-contract.md) voor de vertrouwensgrens en snapshots.

`_shared/hours-schedule.ts` berekent onafhankelijke aanlever-/akkoorddeadlines en berichten per partij.
De pure preview houdt rekening met zomer-/wintertijd, late aanlevering, uitgeschakelde berichten,
actuele revisies en eerdere verzendpogingen. Correctieconcepten vereisen goedkeuring van inhoud én
bronrevisie. Deze planner is nog niet aangesloten op een duurzame outbox of Outlook; hij verstuurt
geen berichten. Het huidige opdrachtgeverformulier bewaart de twee deadlines, nog geen volledig
mailprofiel.

## Interne broninname en invoervoorstellen

Sinds 8 september kan een interne gebruiker met `finance.manage` bij een klantweek een urenbriefje als
PDF, JPG of PNG uploaden. Het origineel gaat naar de niet-publieke bucket `hours-sources` onder
`<organisatie>/<week>/<sha256>`; Storage dwingt daar zelf 25 MiB en de drie mediatypen af, en de
SaaS-modulepoort plus `finance`-rechten gelden ook op die opslag. Er is geen update- of delete-policy:
een origineel kan niet worden vervangen of verwijderd. Dezelfde bijlage opnieuw aanleveren binnen
dezelfde week levert één bron op, geen tweede verwerking en geen tweede voorstel. Bekijken gebeurt met
een ondertekende link van vijf minuten; de bucket is niet publiek benaderbaar.

Uit een bron legt de beoordelaar een **invoervoorstel** vast: medewerkerdag, uren of expliciete
nulreden, eventuele diensttijden en broncategorieën, en een vindplaats in de bron. Een voorstel is
uitdrukkelijk nog geen uur. Toepassen is een aparte handeling die eerst toont wat er aan de dag
verandert, en die het voorstel daarna **letterlijk** overneemt. Wijzigen betekent verwerpen en een
nieuw voorstel vastleggen, zodat de toegepaste versie altijd precies is wat een met naam bekende
persoon heeft beoordeeld. Dat is de grens waarop automatische uitlezers later aansluiten.

Toepassen gebruikt dezelfde revisieregels als handmatige invoer: één gedeelde schrijver bepaalt of de
feiten verschillen, een verouderde verwachte dagversie geeft `PT409` zonder iets te schrijven, en een
al afgewikkeld voorstel kan geen tweede revisie maken. Een voorstel dat gelijk is aan de huidige
dagversie wordt afgewikkeld zonder nieuwe versie, zodat een bestaand medewerkerakkoord geldig blijft.
De dagrevisie draagt de herkomst (`kind: upload`, bestandsnaam, vindplaats) in plaats van "handmatige
invoer"; interne identificatoren staan er bewust niet in en blijven op het voorstel. Medewerkers zien
de bron van hun eigen dag, maar geen bronnen, voorstellen of interne classificaties.

Zie het [innamecontract](urenmodule-intake-contract.md) voor tabellen, RPC's, opslagpolicies en fouten.

## Volgende bouwstappen

De volledige resterende bouw staat als tickets met blokkades in [urenmodule-tickets.md](urenmodule-tickets.md);
hieronder de inhoudelijke volgorde.

1. Weekoverwerk, samenloop en eventuele fijnere tijdprecisie implementeren op basis van bevestigde
   klant-/CAO-regels. Een expliciete procedure voor het corrigeren van een reeds vastgelegde matrixbasis
   toevoegen voordat zulke uitzonderingen operationeel nodig zijn.
2. Paginasplitsing en toewijzingscontrole bij meerdere medewerkers in één bestand, daarna persoonlijke
   klantweeklinks en duurzame mailinname op dezelfde bron-/voorstelgrens.
3. Bestandslezers en OCR/Vision aansluiten op de JA Werkt-VPS en centrale AI-accounting. Het vaste
   budget blijft €50 per Nederlandse kalendermaand zonder stapeling. Geen Qwen-terugval.
4. Mailprofielen per partij, conceptgoedkeuring, outbox, deadlines en opvolgtaken aansluiten.
5. Transactionele vrijgave, vaste exportbatches en vervolgcorrecties volgens payrollafspraken.
   Pas dan de gecontroleerde koppeling met legacy uren/facturatie invoeren.
6. Praktijkset en volledige weekcyclus met JA Werkt doorlopen; pas na acceptatie productiegebruik
   per opdrachtgever activeren.

Benodigde klantinput: bevestigde matrices inclusief pauze-/afrondings- en samenloopregels, het
exportvoorbeeld met payrollcodes en correctieprocedure, ontvangers/verantwoordelijken, exacte
mailmomenten/deadlines en keuze van pilotklanten. Deze input blokkeert de fundering niet, maar wel
de definitieve indeling en payrollacceptatie.

## Verificatie en uitrol

De databasecontracten staan in [urenmodule-db-contract.md](urenmodule-db-contract.md).
Regressies draaien met synthetische data in een eigen PostgreSQL-testcontainer; de echte
praktijkbronnen met persoonsgegevens worden niet in Git opgenomen.

Gecontroleerd: 43 echte PostgreSQL-tests (migratie tweemaal toegepast), 133 reken-/planningtests,
22 componenttests, 49 portaltests en 6 offline browsercontroles op desktop en mobiel. De volledige
controle is geslaagd: 1.194 applicatietests, lint (nul errors), typecheck en productiebuild. Geen productie-DDL toegepast.

De matrixopslag is aanvullend gecontroleerd met 30 echte PostgreSQL-tests en 85 validatiegevallen
vergeleken met de gedeelde rekenkern. Beide migraties zijn tweemaal toegepast in een verse testdatabase.
De matrixmigratie heeft SHA256 `cee82deced978525e0d92544f6e8d25b027c0cc21e7a97ec97ecaffdd146a0fe`.
Inclusief de matrixbouw slagen 1.234 applicatietests, typecheck, lint (nul errors) en de productiebuild.
Zeven offline browsercontroles toetsen de echte schermen met synthetische data op desktop en mobiel:
conceptopslag, actuele publicatiebevestiging, historie, versieconflicten, leesrechten en CAO-koppeling.
Er zijn geen API-aanroepen of browserfouten; Google Fonts is in deze controle geblokkeerd.

Inclusief brongegevens en serverclassificatie slagen 1.349 applicatietests, volledige lint (nul errors),
typecheck en productiebuild. De Edge Function is apart met Deno gecontroleerd. De derde bouwstap heeft
74 echte PostgreSQL-tests (waaronder 43 foundationregressies), 91 brongevallen en 9 offline
browsercontroles doorstaan. De echte keten databasecontext → TypeScript-rekenkern → databasefinalisatie
is getest, inclusief herhaling na de eerste vastgelegde matrixbasis. Alle drie migraties zijn tweemaal
toegepast. De classificatiemigratie heeft SHA256
`722e850c895e9cb876a44050c8d2aeaacf78dd2011f91c30677fe22f09c6a484`.

Na verlies van de tijdelijke werkmap zijn de bestanden uit succesvolle sessie-edits hersteld in de
vaste worktree en vastgelegd in Git. De migratiehash bleef exact
`29db2584671ae0ea7feb1c73de94c0128fda984de765a9b79c6c065e93dd3c3a`.

Inclusief de interne broninname slagen **1.458 applicatietests**, lint (nul errors), typecheck en de
productiebuild. De databaseproef `scripts/hours-intake-db-test.py` draait **126 echte PostgreSQL-tests**:
25 nieuwe innamegevallen plus de volledige vrijgegeven foundation-, classificatie- en
modulepoortregressies op het nieuwe schema, met alle zes migraties tweemaal toegepast. De poortcontrole
dekt nu vijftien tabellen en de vijf nieuwe RPC's. De innamemigratie heeft SHA256
`37af2734e9cdd9c9b03e6bc276e8359cf5892031c0e7e31f49b3f74e5c38e270`.

De verbonden demo-QA (`scripts/e2e-hours-intake-demo.spec.ts`) is geslaagd met echte interne en
medewerkerlogins tegen de live API en uitsluitend synthetische bestanden: geweigerd bestandstype vóór
opslag, privé bewaard origineel, herhaalde aanlevering als één bron, ondertekende link terwijl de
publieke URL faalt, voorstel zonder dagwijziging, expliciete toepassing als versie 1 met de bron als
herkomst, geweigerde tweede toepassing, geslaagde uursoortenindeling op de toegepaste revisie,
medewerkerakkoord met afgeschermde interne gegevens, correctie die dat akkoord ongeldig maakt, en een
verouderde toepassing die niets schrijft. Nul JavaScript-fouten, nul berichten, nul betaalde AI-calls.
Die run vond en verifieerde één reparatie: de bevestiging na toepassen verdween omdat zij alleen bij
open voorstellen werd getoond.

Inclusief de Excel-uitlezer slagen **1.497 applicatietests**, lint (nul errors), typecheck en de
productiebuild. De databaseproef `scripts/hours-workbook-db-test.py` draait **156 echte PostgreSQL-tests**:
de nieuwe werkmapgevallen plus de volledige vrijgegeven pagina-, inname-, foundation-, classificatie- en
modulepoortregressies op het nieuwe schema, met alle elf migraties tweemaal toegepast. De
spreadsheetmigratie heeft SHA256
`9a82838ef0108f7637b52ed3eee7a56e9f843445a199994748222eee7e12495c`.

Een `.xlsx`/`.xls` wordt als bron aanvaard en deterministisch uitgelezen — geen model, geen betaalde
aanroep. Een werkblad is de pagina van dit formaat, dus alle paginaregels van T2 gelden ongewijzigd. De
uitlezer voert **geen formules of macro's uit**: hij leest uitsluitend het bewaarde resultaat. Een
onverwachte indeling levert een blokkade en géén halve voorstellen. Zie het
[innamecontract](urenmodule-intake-contract.md#excel--en-tabelbestanden-als-bron-t3).

De frontend gebruikt voorlopig een expliciet getypte en met Zod gecontroleerde RPC-grens in
`hours-workflow-api.ts` en `hours-matrices.ts`. De auto-generated types blijven die van productie. Vóór merge/uitrol:
migratie toepassen, live types regenereren, adapter op de gegenereerde RPC-types aansluiten en
smoketest uitvoeren.
Alleen een frontendmerge is onvoldoende: eerst de additieve migratie en gegenereerde types controleren.
Voor classificatie is daarnaast de nieuwe `hours-classify-day` Edge Function via de CLI vereist
(`verify_jwt=false` uit `config.toml`; de functie valideert zelf de actieve gebruikerssessie).
Bij deze bouwstap worden geen productieklanten geactiveerd, geen echte uren ingeschreven en geen
klantberichten verstuurd.
