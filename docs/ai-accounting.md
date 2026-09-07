# AI-verbruik en maandelijkse credits

## Afspraak

JA Werkt krijgt vanaf september 2026 iedere kalendermaand €50 extra AI-tegoed. Het ongebruikte saldo blijft staan. De periodegrens is Europe/Amsterdam; dezelfde maand kan per organisatie maar eenmaal worden bijgeschreven. Andere organisaties krijgen niet automatisch dezelfde regeling: hun maandbedrag blijft standaard nul.

De bestaande €17,21 wordt bij de overgang behouden. De eerste maandelijkse aanvulling brengt dit op €67,21, afgezien van eventueel tussentijds AI-gebruik. Er worden geen eerdere maanden bijgeboekt. Het historische verschil van €0,22 tussen het oude saldo en de oude gebruikslog is als onverklaarde historische afwijking vastgelegd; er wordt geen fictieve AI-aanroep of extra klantafschrijving voor gemaakt.

## Eén route voor betaalde AI

Alle betaalde AI-verzoeken van de applicatie lopen door `_shared/ai-accounting.ts`. Dit geldt voor CV-analyse, batchanalyse, CV-veldextractie, vacatureverrijking, belvragen, vacatureteksten, match-herrangschikking, CV-herschrijven, recruiterprioriteiten, urencontrole en Exa-zoekopdrachten. Voorvertoningen die echt een model aanroepen tellen mee. Een cachehit zonder providerverzoek kost niets. Het uitgefaseerde lokale Qwen-batchpad geeft een duidelijke foutmelding.

Nieuwe functies, waaronder urenfotoherkenning, moeten dezelfde transportlaag gebruiken met een vertrouwde organisatie, gebruiker en functienaam. Rechtstreekse betaalde `fetch`-aanroepen naast deze laag zijn niet toegestaan. Dit werk voegt de urenfotoherkenning zelf niet toe.

## Verwerking

1. De server valideert provider, model, tarief en maximale uitvoer. Onbekende tarieven of niet ondersteunde extra betaalde tools blokkeren het verzoek.
2. De database reserveert vóór de betaalde aanroep een bovengrens. Reserveringen van gelijktijdige aanroepen worden onder één organisatielock verrekend. Ook handmatige negatieve correcties mogen geen gereserveerd saldo opmaken.
3. De server voert één providerverzoek uit. De verbruiksgegevens worden vastgelegd vóór het verwerken van de gegenereerde inhoud. Een onbruikbaar modelantwoord kan daardoor wel geregistreerde providerkosten hebben.
4. Eén database-transactie verwerkt de aanvraag, gebruiksregel, creditboeking en vrijgave van de resterende reservering. Herhaling met dezelfde aanvraag en afrekening schrijft niet opnieuw af.

Bij een time-out of ontbrekende verbruiksgegevens blijft de uitkomst zichtbaar als onbekend, met de reservering intact. Een onzekere uitkomst wordt niet automatisch een gratis retry. Mislukte registratie wordt met dezelfde afrekening herhaald; het providerverzoek wordt daarbij niet opnieuw uitgevoerd. Als de database onbereikbaar blijft, bevat het serverlog de minimale afrekengegevens voor herstel: ID, tokens, kosten en status, zonder broninhoud of API-sleutel. Oude open reserveringen worden als afwijking getoond en vragen onderzoek.

De bovengrens voorkomt overschrijding van het beschikbare klanttegoed. Een onverwachte afwijking tussen reservering en werkelijk gerapporteerd verbruik wordt afzonderlijk getoond; deze maakt geen klantenschuld en wordt niet uit de reservering van een andere aanvraag betaald.

## Kosten en tegoed

Klantcredits zijn eurocenten volgens het ingestelde creditcontract. Providerkosten blijven afzonderlijk in Amerikaanse dollars, met tokenaantallen en tariefversie. De bestaande afronding op hele klantcenten blijft behouden. Dit is geen valutaconversie en geen kopie van een leveranciersfactuur: kortingen, belastingen of contractafspraken bij de provider kunnen afwijken. Exa's door de provider gemelde kosten worden als zodanig vastgelegd. Onbekende kosten worden niet als nul gepresenteerd.

Het instellingenpaneel en het superadminpaneel tonen beschikbaar, gereserveerd en totaal saldo, de maandelijkse aanvulling, volgende periode, maandverbruik, historie en afwijkingen. Historische gebruiksregels blijven apart beschikbaar. Handmatige bijboekingen gebruiken een unieke sleutel zodat een onzekere herhaling geen dubbele aanvulling oplevert.

## Beheer en controle

Zie [het databasecontract](ai-accounting-db-contract.md) voor de RPC's en kolommen. De maandelijkse taak roept SQL rechtstreeks aan en heeft geen webhook of API-sleutel nodig. Zij probeert elk uur opnieuw; bij een gemiste uitvoering worden verschuldigde maanden alsnog één keer toegevoegd. Een nieuwe reservering voert dezelfde idempotente controle uit.

`get_ai_credit_summary` toont onder meer het verschil tussen saldo en boekingen en tussen gereserveerd saldo en open aanvragen. Beide horen vanaf de overgang nul te zijn. Het historische verschil blijft afzonderlijk zichtbaar en wordt niet weggemoffeld in nieuwe bedragen.

SQL-tests draaien uitsluitend op een eigen lokale PostgreSQL-testcontainer. Provider- en handler-tests gebruiken mocks en veroorzaken geen echte AI-kosten of klantcommunicatie. Voor productie zijn de migration, alle elf gewijzigde edge functions en de frontend één release; alleen de frontend wordt automatisch via Vercel uitgerold.

## Herstel

Een onbekende aanvraag mag pas worden afgerond als de provideruitkomst of aantoonbaar ontbreken van een providerverzoek is vastgesteld. Een servicebeheerder gebruikt daarna dezelfde `finalize_ai_usage`-RPC met de oorspronkelijke aanvraag-ID en de gecontroleerde gegevens. Doe geen directe updates aan saldo of boekingen. Een betwiste boeking wordt met een expliciete, herleidbare correctie hersteld.

De boekingen zijn onveranderlijk en bewaren het oorspronkelijke organisatie-ID. Het opruimen van een mislukte, pas begonnen registratie blijft mogelijk; de openingsboeking blijft als audit bewaard. Verwijderen van organisaties met gekoppelde AI-aanvragen of top-ups blijft door de referenties beschermd. Gebruik voor normale beëindiging de bestaande inactief-status.
