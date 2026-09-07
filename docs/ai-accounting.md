# AI-verbruik en vast maandbudget

## Afspraak

JA Werkt heeft vanaf september 2026 een AI-budget van €50 per kalendermaand. Ongebruikt budget vervalt bij de maandwisseling; het wordt niet opgeteld bij de volgende maand. De periodegrens is Europe/Amsterdam. Herhaalde verwerking van dezelfde maand geeft geen extra budget. Andere organisaties krijgen niet automatisch dezelfde regeling: hun maandbedrag blijft standaard nul.

De eerste release interpreteerde de afspraak verkeerd als cumulatief tegoed en bracht het saldo op €67,21. De correctie maakt daarvan €50 minus het geregistreerde septemberverbruik: op het controlemoment €0,01 verbruikt en dus €49,99 beschikbaar. Een expliciete boeking legt het verschil vast; bestaande boekingen en verbruik worden niet herschreven. Het historische verschil van €0,22 blijft een afzonderlijke historische toelichting.

## Eén route voor betaalde AI

Alle betaalde AI-verzoeken van de applicatie lopen door `_shared/ai-accounting.ts`. Dit geldt voor CV-analyse, batchanalyse, CV-veldextractie, vacatureverrijking, belvragen, vacatureteksten, match-herrangschikking, CV-herschrijven, recruiterprioriteiten, urencontrole en Exa-zoekopdrachten. Voorvertoningen die echt een model aanroepen tellen mee. Een cachehit zonder providerverzoek kost niets. Het uitgefaseerde lokale Qwen-batchpad geeft een duidelijke foutmelding.

Nieuwe functies, waaronder urenfotoherkenning, moeten dezelfde transportlaag gebruiken met een vertrouwde organisatie, gebruiker en functienaam. Rechtstreekse betaalde `fetch`-aanroepen naast deze laag zijn niet toegestaan. Dit werk voegt de urenfotoherkenning zelf niet toe.

## Verwerking

1. De server valideert provider, model, tarief en maximale uitvoer. Onbekende tarieven of niet ondersteunde extra betaalde tools blokkeren het verzoek.
2. De database reserveert vóór de betaalde aanroep een bovengrens. Reserveringen van gelijktijdige aanroepen worden onder één organisatielock verrekend. Ook handmatige negatieve correcties mogen geen gereserveerd saldo opmaken.
3. De server voert één providerverzoek uit. De verbruiksgegevens worden vastgelegd vóór het verwerken van de gegenereerde inhoud. Een onbruikbaar modelantwoord kan daardoor wel geregistreerde providerkosten hebben.
4. Eén database-transactie verwerkt de aanvraag, gebruiksregel, creditboeking en vrijgave van de resterende reservering. Herhaling met dezelfde aanvraag en afrekening schrijft niet opnieuw af.

Bij een time-out of ontbrekende verbruiksgegevens blijft de uitkomst zichtbaar als onbekend, met de reservering intact. Een onzekere uitkomst wordt niet automatisch een gratis retry. Mislukte registratie wordt met dezelfde afrekening herhaald; het providerverzoek wordt daarbij niet opnieuw uitgevoerd. Als de database onbereikbaar blijft, bevat het serverlog de minimale afrekengegevens voor herstel: ID, tokens, kosten en status, zonder broninhoud of API-sleutel. Oude open reserveringen worden als afwijking getoond en vragen onderzoek.

Iedere aanvraag houdt de budgetmaand waarin zij is gestart. Open reserveringen uit een eerdere maand blijven apart vaststaan. Als zo'n aanvraag later wordt afgerekend, vervalt het ongebruikte deel van die oude reservering. Het nieuwe maandbudget wordt daarmee niet groter of kleiner. Het technische totaalsaldo kan zulke oude reserveringen bevatten; het scherm toont voor maandorganisaties de maandlimiet en de daadwerkelijk beschikbare ruimte.

De bovengrens voorkomt overschrijding van het beschikbare klanttegoed. Een onverwachte afwijking tussen reservering en werkelijk gerapporteerd verbruik wordt afzonderlijk getoond; deze maakt geen klantenschuld en wordt niet uit de reservering van een andere aanvraag betaald.

## Kosten en tegoed

Klantcredits zijn eurocenten volgens het ingestelde creditcontract. Providerkosten blijven afzonderlijk in Amerikaanse dollars, met tokenaantallen en tariefversie. De bestaande afronding op hele klantcenten blijft behouden. Dit is geen valutaconversie en geen kopie van een leveranciersfactuur: kortingen, belastingen of contractafspraken bij de provider kunnen afwijken. Exa's door de provider gemelde kosten worden als zodanig vastgelegd. Onbekende kosten worden niet als nul gepresenteerd.

Het instellingenpaneel en het superadminpaneel tonen beschikbaar maandbudget, reserveringen, maandlimiet, volgende periode, maandverbruik, historie en afwijkingen. Historische gebruiksregels blijven apart beschikbaar. Bij een actief maandbudget zijn handmatige top-ups geblokkeerd; een beheerder kan de maandlimiet aanpassen. Organisaties zonder maandregeling houden hun bestaande prepaidtegoed en idempotente handmatige correcties.

## Beheer en controle

Zie [het databasecontract](ai-accounting-db-contract.md) voor de RPC's en kolommen. De maandelijkse taak roept SQL rechtstreeks aan en heeft geen webhook of API-sleutel nodig. Zij controleert elk uur of de huidige maand actief is; een nieuwe AI-reservering doet dezelfde controle. Bij een gemiste uitvoering wordt uitsluitend het budget van de huidige maand geactiveerd. Overgeslagen maanden leveren geen extra tegoed op.

`get_ai_credit_summary` toont onder meer het verschil tussen saldo en boekingen en tussen gereserveerd saldo en open aanvragen. Beide horen vanaf de overgang nul te zijn. Het historische verschil blijft afzonderlijk zichtbaar en wordt niet weggemoffeld in nieuwe bedragen.

SQL-tests draaien uitsluitend op een eigen lokale PostgreSQL-testcontainer. Provider- en handler-tests gebruiken mocks en veroorzaken geen echte AI-kosten of klantcommunicatie. De elf AI-endpoints zijn centraal aangesloten in PR #260. De maandcorrectie houdt hun RPC-contract compatibel en vereist een database- en frontendrelease; de providerlaag hoeft hiervoor niet opnieuw uitgerold te worden.

## Herstel

Een onbekende aanvraag mag pas worden afgerond als de provideruitkomst of aantoonbaar ontbreken van een providerverzoek is vastgesteld. Een servicebeheerder gebruikt daarna dezelfde `finalize_ai_usage`-RPC met de oorspronkelijke aanvraag-ID en de gecontroleerde gegevens. Doe geen directe updates aan saldo of boekingen. Een betwiste boeking wordt met een expliciete, herleidbare correctie hersteld.

De boekingen zijn onveranderlijk en bewaren het oorspronkelijke organisatie-ID. Het opruimen van een mislukte, pas begonnen registratie blijft mogelijk; de openingsboeking blijft als audit bewaard. Verwijderen van organisaties met gekoppelde AI-aanvragen of top-ups blijft door de referenties beschermd. Gebruik voor normale beëindiging de bestaande inactief-status.
