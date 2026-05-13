# Go-live Acceptatie JA Werkt / VDS Automotive

Datum: 2026-05-13  
Scope: meeting 2026-05-07, productie-precheck na release `21ccc60`

## Doel

Deze acceptatiesessie bepaalt of JA Werkt operationeel kan overstappen voor de besproken blokken:

- Carerix migratie en historische plaatsingen
- Tankpas- en kilometeranalyse
- Outlook mailboxrechten en privacy
- Contracten, signing en documentbewijs
- Fleet incidenten, huisvesting en schoonmaak

De sessie is geen demo. Elk onderdeel eindigt met `GO`, `GO met restpunt`, of `NO-GO`.

## Productie-precheck

Uitgevoerd tegen Supabase productieproject `noaupcteygfvlyymqtew`.

### Release-status

- Frontend production deployment: `READY`
- Productie URL: `https://ja-works-hub.vercel.app/`
- Commit: `21ccc60950e1e3439c6fec8b809ddf5324039158`
- Lokale checks voor push:
  - `npm run lint`: groen, met bestaande waarschuwingen
  - `npm run typecheck`: groen
  - `npm run test`: groen, 8 tests
  - `npm run build`: groen, met bestaande chunk-size waarschuwing

### Carerix

Productiestatus JA Werkt:

| Check | Waarde | Acceptatie-impact |
|---|---:|---|
| Carerix gekoppeld | ja | GO voor technische connectie |
| Laatste Carerix test | 2026-05-07, succesvol | GO, opnieuw testen in sessie |
| Totaal Carerix mappings | 13.259 | Informatief |
| Kandidaten | 1.994 | Valideren tegen export |
| Carerix kandidaat mappings | 1.978 | Verschil verklaren |
| Bedrijven | 65 | Valideren tegen export |
| Carerix bedrijf mappings | 60 | Verschil verklaren |
| Contactpersonen | 80 | Valideren tegen export |
| Carerix contact mappings | 73 | Verschil verklaren |
| Plaatsingen in app | 583 | Verschil met 578 verklaren |
| Carerix plaatsing mappings | 578 | Matcht meetingverwachting |
| Vacatures in app | 661 | NO-GO tot scope/filter verklaard |
| Carerix vacature mappings | 657 | Verwachting meeting was 139 |
| Carerix documenten | 3.874 | GO mits steekproef klopt |
| Carerix documenten zonder bestand | 9 | Foutlijst afhandelen |

Belangrijkste conclusie: plaatsing-migratie lijkt inhoudelijk goed te zitten omdat de Carerix mapping exact `578` is. Het app-totaal `583` moet worden verklaard als handmatig/test/duplicaat/andere bron. Vacatures zijn nog niet geaccepteerd: waarschijnlijk gaat `139` over actieve of business-relevante vacatures, terwijl `657/661` historische of technische records bevat.

Update werkstart 2026-05-13: de 5 extra plaatsingen zijn app-records zonder Carerix mapping en met gekoppelde uren/productiedata. Niet verwijderen zonder expliciet akkoord. De acceptatiecheck in `/carerix-import` telt daarom voortaan Carerix mappings voor de meetingverwachting `578`. De vacaturetelling `139` is reproduceerbaar als vacatures uit kalenderjaar 2023; productie bevat daarnaast historische jaren 2020-2026.

### Tankpas / voertuigen

| Check | Waarde | Acceptatie-impact |
|---|---:|---|
| Voertuigen | 22 | Informatief |
| Voertuigen zonder tankpasreferentie | 21 | NO-GO voor goede tankpascontrole |
| Voertuigen zonder tankinhoud | 21 | NO-GO voor tankcapaciteitsregel |
| Voertuigen zonder gemiddeld verbruik | 19 | NO-GO voor verbruiksregel |
| Tankpastransacties | 19 | Testdataset aanwezig |
| Transacties zonder voertuigmatch | 1 | Foutlijst afhandelen |
| Geflagde tankpastransacties | 9 | Review met klant nodig |

Conclusie: de analysefunctie staat klaar, maar de stamdata is nog onvoldoende. Eerst voertuigen aanvullen met tankpas, tankinhoud en gemiddeld verbruik.

Update werkstart 2026-05-13: `/tankpas-analyse` toont nu een datakwaliteit-kaart met ontbrekende tankpasreferentie, tankinhoud, verbruik, kilometerstand, aantal deuren, zitplaatsen en transacties zonder voertuigmatch. Daarmee is direct zichtbaar waarom regels wel of niet betrouwbaar afgaan.

### Outlook / mailboxen

| Check | Waarde | Acceptatie-impact |
|---|---:|---|
| Mail accounts | 2 | Informatief |
| Gedeelde mailboxen | 1 | Moet hertest worden |
| Connected organisatie-user mailbox | 1 | GO voor basiskoppeling |
| Shared mailbox status | failed | NO-GO voor infomail-flow |
| Mailbox grants | 2 | Rechtenmatrix valideren |
| Mail delete capability | 0 accounts | Besluit nodig: wie mag verwijderen? |

Conclusie: persoonlijke/organisatiekoppeling bestaat, maar de gedeelde mailbox is nog niet acceptatieklaar. Infomail moet opnieuw gekoppeld en getest worden. Persoonlijke inbox/agenda privacy blijft een harde test.

### Contracten / signing

| Check | Waarde | Acceptatie-impact |
|---|---:|---|
| Actieve contracttemplates | 0 | NO-GO voor contractproces |
| Property contracts | 0 | Nog vullen/uploaden |
| Template type support | aanwezig | GO technisch |
| Signing evidence velden | aanwezig | GO technisch |

Conclusie: techniek staat klaar, maar templates en echte documenten ontbreken nog.

Update werkstart 2026-05-13: contracttemplate-instellingen tonen nu een operationele documentenset-check voor plaatsingsbevestiging, algemene voorwaarden, inhuur, onderhuur, huisregels en voertuigovereenkomst. Er wordt geen juridische voorbeeldinhoud aangemaakt; de klant moet de echte teksten leveren of accorderen.

### Fleet incidenten / schoonmaak

| Check | Waarde | Acceptatie-impact |
|---|---:|---|
| Schademeldingen zonder foto | 1 | Oude data/restpunt; nieuwe UI blokkeert zonder foto |
| Boetes zonder foto | 0 | GO op bestaande data |
| Schoonmaaktaken | 0 | Workflow nog niet operationeel getest |

## Benodigd Voor De Sessie

Client levert of opent tijdens de sessie:

- Carerix export kandidaten
- Carerix export vacatures, inclusief filterdefinitie voor de `139`
- Carerix export plaatsingen met uniek plaatsingsnummer
- Carerix export opdrachtgevers en contactpersonen
- Carerix factuur-/documentexport indien beschikbaar
- Q8/tankpas export van dezelfde periode als de besproken import
- Voertuigmasterlijst met kenteken, tankpasnummer, tankinhoud, gemiddeld verbruik, deuren en zitplaatsen
- Microsoft testgebruiker met toegang tot infomail en zonder toegang tot administratie/persoonlijke mailboxen
- Documenttemplates: algemene voorwaarden, plaatsingsbevestiging, inhuur, onderhuur, huisregels, voertuigovereenkomst

## Acceptatie Agenda

### 1. Carerix Migratie

Acties:

- Open `/carerix-import`
- Draai Carerix test opnieuw
- Controleer acceptatietab op verwachte tellingen
- Vergelijk:
  - plaatsingen: verwacht `578`
  - vacatures: verwacht `139`, maar productie toont `657/661`
  - kandidaten, bedrijven, contactpersonen: tegen export
- Open 5 willekeurige kandidaten en verifieer:
  - contactgegevens
  - documenten
  - volledige historische plaatsingen
  - beëindigde plaatsingen blijven zichtbaar

GO:

- Plaatsinghistorie is per kandidaat volledig zichtbaar
- Afwijkende tellingen zijn verklaard en vastgelegd
- Documenten-foutlijst van 9 stuks is geaccepteerd of opgelost

NO-GO:

- Historische plaatsingen ontbreken
- Vacaturefilter `139` kan niet worden gereproduceerd
- Documentdownload ontbreekt voor bedrijfskritische kandidaten

### 2. Tankpas / Kilometeranalyse

Acties:

- Vul voertuigstamdata aan voor minimaal alle voertuigen in testperiode
- Koppel tankpas aan voertuig via kaartnummer/tankpasreferentie
- Vul tankinhoud en gemiddeld verbruik in
- Open `/tankpas-analyse`
- Controleer tab `Voorwaarden`
- Zet marges expliciet:
  - tankcapaciteit: default 10%
  - verbruik: default 50%
  - kilometerafwijking: default 300 km
- Importeer Q8/tankpasbestand
- Review alle afwijkingen en markeer minimaal 3 verklaringen

GO:

- Ongekoppelde transacties verdwijnen of zijn verklaard
- Tankcapaciteit gebruikt voertuigspecifieke waarde
- Regels zijn aanpasbaar zonder codewijziging
- False positives zijn acceptabel voor operatie

NO-GO:

- Meerderheid voertuigen mist tankpas/tankinhoud
- Analyse kan niet verklaren waarom een regel afgaat
- Klant kan afwijkingen niet beoordelen of afhandelen

### 3. Outlook Mailrechten

Acties:

- Koppel of herstel infomail als gedeelde mailbox
- Controleer rechten per gebruiker:
  - lezen
  - verzenden
  - verwijderen
  - agenda lezen/schrijven
- Test met admin en beperkte gebruiker
- Test dat persoonlijke mailbox en persoonlijke agenda niet zichtbaar zijn voor anderen
- Verstuur testmail vanuit infomail
- Test verwijderactie alleen voor gebruiker met delete-recht

GO:

- Beperkte gebruiker ziet alleen toegestane mailboxen
- Infomail kan verzenden
- Persoonlijke inbox/agenda blijft afgeschermd
- Verzend- en verwijderacties landen in audit/communicatiehistorie

NO-GO:

- Persoonlijke mailbox of agenda wordt zichtbaar voor andere gebruikers
- Administratie-mailbox is zichtbaar voor onbevoegden
- Shared mailbox blijft `failed`

### 4. Contracten En Signing

Acties:

- Maak actieve templates aan:
  - algemene voorwaarden
  - plaatsingsbevestiging
  - inhuurcontract
  - onderhuurcontract
  - huisregels
  - voertuigovereenkomst
- Upload bij een pand:
  - 1 inhuurcontract
  - 1 onderhuurcontract
- Open eigenaar/panddetail en controleer zichtbaarheid
- Verstuur een testcontract ter ondertekening
- Onderteken via publieke link
- Controleer bewijsmetadata:
  - signed_by_name
  - signed_ip
  - signature_request_id
  - signature_evidence

GO:

- Inhuur en onderhuur zijn apart zichtbaar
- Bestanden openen via veilige URL
- Signing evidence is terugvindbaar
- Algemene voorwaarden kunnen mee met plaatsingsbevestiging

NO-GO:

- Templates ontbreken
- Contracttypes worden door elkaar gehaald
- Ondertekenbewijs ontbreekt

### 5. Fleet Incidenten

Acties:

- Maak boete aan met foto
- Maak schademelding zonder foto en verifieer blokkade
- Maak schademelding met foto
- Test schade-mail naar garage of testadres
- Leg contactroute vast:
  - wie belt bij stilstand?
  - welke bestuurdergegevens mogen naar garage?
  - welk intern nummer staat in de mail?

GO:

- Foto is verplicht voor nieuwe schademelding
- Boetefoto wordt opgeslagen en getoond
- Garage-mail bevat juiste voertuig- en contactgegevens

NO-GO:

- Schade zonder foto kan toch worden opgeslagen
- Contactroute is onduidelijk voor operatie

### 6. Huisvesting / Schoonmaak

Acties:

- Controleer pandenlijst:
  - straat apart
  - woonplaats apart
  - sorteren op woonplaats
- Controleer kostenperspectieven:
  - per capaciteit
  - per kamer
- Maak schoonmaaktaak aan
- Wijs taak toe
- Probeer afronden zonder foto
- Rond af met foto

GO:

- Klant begrijpt kostenoverzicht
- Lege notities/contractsecties zijn vindbaar
- Schoonmaakafronding vereist foto

NO-GO:

- Kostenperspectief is niet bruikbaar voor sturing
- Schoonmaakflow kan niet worden toegewezen of afgerond

## Beslissingen Die Tijdens Sessie Vast Moeten

- Definitie vacaturetelling `139`: actief, historisch, publiceerbaar of handmatig gefilterd?
- Definitieve tankpasmarges:
  - tankcapaciteit
  - verbruik
  - kilometerafwijking
- Wie mag Outlook mail verwijderen?
- Welke mailboxen zijn gedeeld, en welke zijn strikt privé?
- Contactroute bij schade/stilstand
- Welke contracttemplates zijn verplicht voor go-live?
- Kostensturing huisvesting: per capaciteit, per kamer, of beide?

## Go/No-Go Scorecard

| Domein | Status na precheck | Blokkerend? | Volgende actie |
|---|---|---|---|
| Frontend productie | GO | nee | Monitor Vercel |
| Database schema | GO | nee | Geen |
| Carerix plaatsingen | GO met restpunt | nee | 5 niet-Carerix plaatsingen laten accorderen |
| Carerix vacatures | GO met scope-besluit | ja | Bevestigen of go-live op 2023-filter of volledige historie draait |
| Carerix documenten | GO met restpunt | mogelijk | 9 missende bestanden afhandelen |
| Tankpasanalyse | NO-GO | ja | Voertuigstamdata aanvullen |
| Outlook shared mailbox | NO-GO | ja | Infomail herkoppelen |
| Contracttemplates | NO-GO | ja | Templates aanmaken |
| Signing bewijs | GO technisch | nee | End-to-end test |
| Schade/boetes | GO met restpunt | nee | Contactroute vastleggen |
| Huisvesting | GO met restpunt | nee | Contracten uploaden, kosten testen |
| Schoonmaak | Open | nee | Eerste taakflow testen |

## Directe Werkvolgorde

1. Laat klant bevestigen of vacaturetelling `139` het 2023-filter is of dat een andere businessfilter leidend is.
2. Laat klant de 5 niet-Carerix plaatsingen met uren/productiedata accorderen.
3. Voertuigen aanvullen: tankpas, tankinhoud, gemiddeld verbruik, kilometerstand en aantal deuren.
4. Infomail opnieuw koppelen en mailboxrechtenmatrix nalopen.
5. Contracttemplates vullen en 1 signing-test uitvoeren.
6. Q8-import opnieuw draaien met gevulde voertuigdata.
