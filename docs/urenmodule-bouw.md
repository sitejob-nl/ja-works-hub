# Urenmodule — bouwstand

Start: 8 september 2026. Werkmap `/tmp/ja-works-urenmodule`, branch `codex/urenmodule-bouw`,
base `aedc6dc` (PR #261). De bestaande dirty checkout blijft onaangeraakt.

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
weigert zulke configuratie; er wordt geen CAO geraden. Matrixopslag en het toepassen op persistente
dagrevisies volgen in de volgende bouwstap. De huidige handmatige minuten zijn dus geen bewezen
volledige uursoortenindeling.

`_shared/hours-schedule.ts` berekent onafhankelijke aanlever-/akkoorddeadlines en berichten per partij.
De pure preview houdt rekening met zomer-/wintertijd, late aanlevering, uitgeschakelde berichten,
actuele revisies en eerdere verzendpogingen. Correctieconcepten vereisen goedkeuring van inhoud én
bronrevisie. Deze planner is nog niet aangesloten op een duurzame outbox of Outlook; hij verstuurt
geen berichten. Het huidige opdrachtgeverformulier bewaart de twee deadlines, nog geen volledig
mailprofiel.

## Volgende bouwstappen

1. Matrixversies opslaan en configureren; weekoverwerk en samenloop implementeren op basis van
   bevestigde klant-/CAO-regels. Classificatie en controle aan dezelfde dagrevisie binden.
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

Releasebewijs en testuitslagen worden toegevoegd zodra de volledige eerste bouwstap is gecontroleerd.
Alleen een frontendmerge is onvoldoende: eerst de additieve migratie en gegenereerde types controleren.
Bij deze bouwstap worden geen productieklanten geactiveerd, geen echte uren ingeschreven en geen
klantberichten verstuurd.
