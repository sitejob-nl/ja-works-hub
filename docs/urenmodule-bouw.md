# Urenmodule — bouwstand

Start: 8 september 2026. Werkmap `/Users/kas/dev/ja-works-hub/.worktrees/urenmodule-bouw`, branch `codex/urenmodule-bouw`,
base `aedc6dc` (PR #261). De bestaande dirty checkout blijft onaangeraakt.

De fundering staat als draft in [PR #262](https://github.com/sitejob-nl/ja-works-hub/pull/262), met geslaagde CI.
De afhankelijke matrixbouw staat in `/Users/kas/dev/ja-works-hub/.worktrees/urenmodule-matrix`, branch
`codex/urenmodule-matrix`, vanaf fundering `47c408f`. Beide bouwstappen zijn nog niet naar productie uitgerold.
Matrixcheckpoint `da7dbaa` staat in afhankelijke draft [PR #263](https://github.com/sitejob-nl/ja-works-hub/pull/263).

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

## Gedeelde berekening en planning

`_shared/hours-calculation.ts` bevat de minutenparser, expliciete diensten en pauzes, optelcontrole,
effectieve matrixselectie, categorie-mapping en exclusieve tijdvensters. Expliciete broncategorieën
zoals OV1–OV5 blijven behouden. Ontbrekende en tegenstrijdige regels blokkeren.

Automatische dag-/weekoverwerkgrenzen, samenloop van toeslagen, feestdagen en berekening van echte
verstreken diensttijd tijdens een klokwisseling zijn nog niet geïmplementeerd. De eerste matrixvorm
weigert zulke configuratie; er wordt geen CAO geraden. Matrixopslag is nu gebouwd; het toepassen op persistente
dagrevisies volgt in de volgende bouwstap. De huidige handmatige minuten zijn dus geen bewezen
volledige uursoortenindeling.

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
geen historische koppeling met een eigen ingangsdatum. Persistente classificatie moet later de gekozen
koppeling en matrix aan de exacte dagrevisie vastleggen. Het actuele formulier wijzigt geen uren.
Zie [matrixcontract](urenmodule-matrix-contract.md) voor het volledige opslag- en selectiecontract.

`_shared/hours-schedule.ts` berekent onafhankelijke aanlever-/akkoorddeadlines en berichten per partij.
De pure preview houdt rekening met zomer-/wintertijd, late aanlevering, uitgeschakelde berichten,
actuele revisies en eerdere verzendpogingen. Correctieconcepten vereisen goedkeuring van inhoud én
bronrevisie. Deze planner is nog niet aangesloten op een duurzame outbox of Outlook; hij verstuurt
geen berichten. Het huidige opdrachtgeverformulier bewaart de twee deadlines, nog geen volledig
mailprofiel.

## Volgende bouwstappen

1. Diensten en expliciete broncategorieën aan dagrevisies toevoegen, servermatige classificatie met
   een vaste matrixsnapshot opslaan en blokkades zichtbaar maken. Daarna weekoverwerk en samenloop
   implementeren op basis van bevestigde klant-/CAO-regels.
2. Persoonlijke klantweeklinks, upload en duurzame mailinname. Originele bronnen privé bewaren,
   dedupliceren en gecontroleerde correctievoorstellen aanmaken.
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

Na verlies van de tijdelijke werkmap zijn de bestanden uit succesvolle sessie-edits hersteld in de
vaste worktree en vastgelegd in Git. De migratiehash bleef exact
`29db2584671ae0ea7feb1c73de94c0128fda984de765a9b79c6c065e93dd3c3a`.

De frontend gebruikt voorlopig een expliciet getypte en met Zod gecontroleerde RPC-grens in
`hours-workflow-api.ts` en `hours-matrices.ts`. De auto-generated types blijven die van productie. Vóór merge/uitrol:
migratie toepassen, live types regenereren, adapter op de gegenereerde RPC-types aansluiten en
smoketest uitvoeren.
Alleen een frontendmerge is onvoldoende: eerst de additieve migratie en gegenereerde types controleren.
Bij deze bouwstap worden geen productieklanten geactiveerd, geen echte uren ingeschreven en geen
klantberichten verstuurd.
