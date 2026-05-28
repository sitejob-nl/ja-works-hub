# Meeting open points 2026-05-27

Bronbestanden:

- `Meetings/05-27 Analyse_ Recruitment Software en Workflow Optimalisatie-transcript.txt`
- `Meetings/05-27 Analyse_ Recruitment Software en Workflow Optimalisatie-Summary.md`
- `Meetings/05-27 Analyse_ Recruitment Software en Workflow Optimalisatie-Requirements Summary.md`

Disposition: **REVISE**. De basis bestaat, maar de meeting vraagt een duidelijker kandidaatinstroommodel: een instroom-/leadfunnel voor nieuwe leads, een schonere gekwalificeerde kandidatenpool, AI-verrijking van bestaande kandidaten en een compacter kandidaatprofiel als centrale werkplek.

## Belangrijkste besluiten

- Eén persoon blijft één kandidaatrecord met één unieke ID; lead/kandidaat/medewerker zijn statussen of weergaven, geen dubbele persoonsrecords.
- Nieuwe website-instroom moet eerst door een lead-/kwalificatiefunnel voordat deze als bruikbare kandidatenpool wordt gebruikt.
- AI ondersteunt screening en matching, maar menselijke controle blijft nodig.
- Er moet onderscheid komen tussen algemene kandidaatkwaliteitsscore en vacature-specifieke matchscore.
- Afwijzen mag niet verwijderen betekenen; afgewezen leads moeten via globale zoekfunctie vindbaar blijven.
- Notities zijn standaard intern en niet zichtbaar voor kandidaat/medewerker.
- Officiële waarschuwingen horen in een apart proces, niet tussen normale interne notities.
- AI-analyse hoort als sectie bovenaan Screening; de losse AI-tab moet vervallen.
- Communicatievoorkeur hoort op Profiel, niet in een losse tab.
- Datakwaliteit-tab is geen eindgebruikers-tab en moet verdwijnen.
- Huisvesting en vervoer/auto moeten direct vanuit ieder kandidaatprofiel beschikbaar zijn.
- Taken blijven bestaan en moeten aan collega's kunnen worden gedelegeerd.
- Oude Carerix-taken worden niet als operationele taken gebruikt; historische notities/activiteiten blijven wel belangrijk.
- Bestaande database van circa 1.900 kandidaten moet met AI worden verrijkt op basis van CV én interne notities.
- Functiegroepen/functieniveaus moeten door de klant worden aangeleverd en daarna als taxonomie worden ingericht.

## P0 / Direct

- **Notities intern by default**: nieuwe notities standaard afgeschermd.
- **Kandidaatprofiel opschonen**: notities naast profiel, communicatievoorkeur naar profiel, datakwaliteit weg, AI onder Screening.
- **Huisvesting/vervoer vanuit kandidaat**: tab altijd tonen en later uitbreiden met toewijsacties.
- **Taakdelegatie**: taken vanuit kandidaat aan een medewerker kunnen toewijzen.
- **AI-analyse foutpad**: Edge Function-fouten inzichtelijk houden en providerconfiguratie valideren.
- **Documentformaten**: AI-upload moet PDF, DOC, DOCX, JPG/JPEG, PNG en ODT ondersteunen.

## P1 / Funnel & Matching

- Leadkanban/statussen definitief maken, bijvoorbeeld: Nieuw, Link verstuurd, Profiel ingevuld, Gecontacteerd, Beoordeeld, Gekwalificeerd, Geen kandidaat.
- Dashboard/Workbench uitbreiden met dagelijkse nieuwe sollicitaties.
- Website-sollicitaties op specifieke vacatures als snellere route modelleren: direct naar "Nieuwe match" of hybride lead-route.
- Bronlabels tonen: website-sollicitatie, brede aanmelding, Carerix, handmatig, eigen database.
- Matchkanban vereenvoudigen: Nieuwe match, Gescreend, Voorgesteld bij klant, In gesprek, Geaccepteerd, Afgewezen.
- Afwijzing altijd verplicht met feedbackreden/notitie.
- Vanuit vacature geschikte kandidaten uit de database kunnen zoeken/filteren op skills, afstand en eisen.

## P1 / AI & Dataverrijking

- AI-scorecriteria vastleggen: baanwisselingen, duur dienstverband, stabiliteit, skills, profielvolledigheid en afstand.
- AI-score uitlegbaar maken in UI.
- Batchplan maken voor circa 1.900 bestaande kandidaten.
- AI moet interne notities meenemen, inclusief contra-indicaties zoals "nooit meer aannemen".
- Fallback bepalen voor kandidaten zonder CV of met onvolledige documenten.
- Functiegroepen/importlijst toevoegen zodra de klant deze aanlevert.

## P2 / Data & Compliance

- Datamigratie controleren op nationaliteit, BSN, taal/Engels, beoordeling en profielvelden.
- Oude leads/medewerkers gelijkzetten met nieuw statussysteem.
- Duplicaatdetectie op e-mail en telefoon uitbreiden met historie/waarschuwing.
- ICE-telefoonnummer verplicht maken; EU/NL-telefoonnummers als aparte velden uitwerken.
- AVG-besluit nodig voor AI-scoring, nationaliteit, BSN, noodcontacten, bewaartermijnen, WhatsApp en zichtbaarheid van notities.

## Open besluiten

- Definitieve terminologie: lead, kandidaat, niet beoordeeld, gekwalificeerd, medewerker, match.
- Wat gebeurt er als een eerder afgewezen lead opnieuw solliciteert?
- Welke communicatiebelofte komt in automatische mails: geen termijn, 24 uur of 48 uur?
- Welke velden triggeren status "incompleet"?
- Betekenis/workflow van "kiezerinhouding".
- Wie mag taken aan wie delegeren op langere termijn?
