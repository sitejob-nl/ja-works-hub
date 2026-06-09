# UI/UX analyse: matching, vacatures en kandidaten

**Datum:** 2026-06-09
**Status:** productvisie + builder handoff
**Scope:** kandidaten, vacatures, matching, screening, communicatie en matchpipeline voor zover ze matchbaarheid of recruiterbesluitvorming raken.
**Bronnen:** `HANDOVER_SESSION.md`, `HANDOVER.md`, `CLAUDE.md`, `docs/open-gaps.md`, `docs/ux-design-2026-06-03.md`, plus inspectie van de huidige React/Supabase UI-code.

---

## 1. Executive summary

De huidige matchingmodule is functioneel al veel rijker dan een klassieke kandidatenlijst: er is whole-pool ranking, reverse matching, score-uitleg, screening, statusmutaties, voorstelmail-preview, bulkacties en feedbackregistratie. Het probleem is daardoor niet dat er niets kan. Het probleem is dat de recruiter nog te vaak zelf moet reconstrueren wat de logische volgende stap is.

De centrale productthese:

> JA Werkt moet geen verzameling gegevensschermen zijn, maar een recruiter-cockpit waarin elke kandidaat, vacature en match duidelijk maakt: hoe matchbaar is dit, wat weten we zeker, wat weten we niet, wat blokkeert, en wat moet ik nu doen?

De grootste UX-frictie zit in versnippering. Matching bestaat nu op ten minste vier plekken: vacaturematches, kandidaatmatches, kandidaat-vacaturematches en de globale matchpipeline. Die plekken gebruiken deels dezelfde data, maar niet hetzelfde mentale model. De vacaturekant is rijk, de kandidaatkant is compacter, en de pipeline is operationeel maar mist uitleg, urgentie, ouderdom en "next action".

De aanbevolen richting is een gedeeld **Match Card / Match Inspector**-model. Elke match moet overal dezelfde kern tonen: fit-score, kandidaatkwaliteit, datavertrouwen, harde blokkades, onbekenden, bewijs, status, laatste activiteit en primaire vervolgstap. Dan maakt het niet meer uit of de recruiter start vanuit een vacature, kandidaat of pipeline: hetzelfde besluit voelt hetzelfde.

Daar hoort ook een hard operationeel contract bij: matchstatussen, externe communicatie en gevoelige kandidaatdata mogen niet per scherm anders worden afgehandeld. Een recruiter mag snel kunnen werken, maar de UI mag nooit onbedoeld een kandidaat voorstellen, een WhatsApp sturen, BSN/IBAN lekken of een terminale status zonder feedback vastleggen.

---

## 2. Methode en reviewrollen

Deze analyse gebruikt vijf lenzen:

- **UX-audit:** Nielsen-heuristieken, feedback, foutpreventie, herkenning boven herinnering, mobile-first en toegankelijkheid.
- **UX-designer:** informatiearchitectuur, recruiterflows, schermstates, empty states en handoff-specificaties.
- **Senior frontend:** componentconsistentie, responsive gedrag, state management, performance en haalbaarheid binnen React/TanStack/shadcn.
- **Multi-agent brainstorming:** primaire ontwerper, scepticus, constraint guardian, user advocate en arbiter.
- **Multi-advisor board:** productvisie, recruiteroperatie, AI-uitlegbaarheid, frontendkwaliteit en privacy/communicatie-risico.

Beperkingen: dit is geen live usability-test met JA Werkt-recruiters en geen nieuwe databasemigratie. De analyse is gebaseerd op repo-inspectie, bestaande meetingdocumenten en bekende productcontext.

---

## 3. Wat al sterk is

Er staat al een stevige basis:

- **Vacaturematching is inhoudelijk rijk.** `VacancyMatchesTab` combineert bestaande matchpipeline, shortlist uit `rank-candidates`, statusfilters, bulkselectie, "Waarom?"-uitleg, voorstelmail-preview en plaatsingsactie.
- **Reverse matching bestaat al.** `CandidateVacancyMatchesTab` toont open vacatures voor een kandidaat via `rank-vacancies`, inclusief minimumscore, harde blokkades, skill/cert-filter en afstandsfilter.
- **Score-uitleg is technisch uitlegbaar.** `MatchBreakdown` bevat `matchPercent`, `candidateQuality`, `hardBlocks`, `positives`, `missing`, `bonuses`, `skillMatches`, `certificationMatches`, `distance`, `componentScores` en `reasoning`.
- **Rijbewijs en onbekende data worden voorzichtig behandeld.** De matching-core maakt rijbewijs geen harde blokkade en bestraft onbekende afstand/beschikbaarheid niet automatisch.
- **Screening is inmiddels een echte callflow.** Er is status, staplogica, autosave, concept opslaan, profieldata aanvullen en validatie bij afronden.
- **Kandidaatprofiel is inline bewerkbaar.** De aparte bewerkpagina is niet meer het UX-hoofdpad; velden zoals BSN, IBAN, geboortedatum, talen, rijbewijs en beschikbaarheid zijn direct in de profielcontext te wijzigen.
- **Unsaved guard bestaat als primitive.** `UnsavedChangesGuard` toont de juiste melding: "Hé, je hebt het nog niet opgeslagen."

Deze sterke punten moeten behouden blijven. De volgende stap is samenhang, niet opnieuw beginnen.

---

## 4. Centrale diagnose

### 4.1 De recruiter ziet objecten, maar denkt in werk

De huidige UI is georganiseerd rond objecten:

- kandidaat
- vacature
- match
- pipeline
- screening
- communicatie
- taken

Een recruiter denkt echter in werkvragen:

- Welke vacature moet vandaag gevuld worden?
- Welke kandidaten moet ik nu bellen?
- Waarom is deze kandidaat wel/niet passend?
- Welke informatie moet ik nog uitvragen?
- Kan ik deze kandidaat veilig voorstellen?
- Welke matches liggen stil?
- Welke communicatie is al gedaan?

Daarom voelt de module soms alsof de gebruiker veel kan, maar steeds zelf de context moet vasthouden.

### 4.2 Score is zichtbaar, vertrouwen is nog niet zichtbaar genoeg

Een score van 82 procent lijkt hard, maar kan gebaseerd zijn op goede skills met onbekende beschikbaarheid, onbekende afstand en onbetrouwbare AI-bronnen. De matching-core kent dit onderscheid al deels via `candidateQuality`, `missing`, `distance.status` en `componentScores`, maar de UI presenteert dat nog niet overal als een apart besluitssignaal.

Aanbeveling: maak drie signalen expliciet:

- **Match-fit:** past kandidaat inhoudelijk op deze vacature?
- **Dossierkwaliteit:** hoe betrouwbaar/volledig is het kandidaatprofiel?
- **Besluitbaarheid:** kan de recruiter nu handelen of moet eerst iets worden uitgezocht?

### 4.3 Ontbrekende data moet werk worden, geen ruis

Ontbrekende taal, rijbewijs, beschikbaarheid, locatie, certificaten en werkervaring zijn nu vaak tekst in `missing` of een leeg veld. Voor recruiters is dat eigenlijk een takenlijst: dit zijn belvragen, screeningpunten of profielaanvullingen.

Aanbeveling: behandel onbekenden als first-class workflow-items. Een matchkaart moet kunnen zeggen: "Sterke match, maar eerst rijbewijs en beschikbaarheid bevestigen."

### 4.4 De vier matchingplekken moeten hetzelfde verhaal vertellen

Nu:

- vacaturedetail toont de rijkste matching-workspace;
- kandidaatmatches toont bestaande matches als tabel;
- kandidaat-vacatures toont reverse matching als kaarten;
- matchpipeline toont statuskolommen zonder dezelfde score-uitleg.

Straks:

- elke context gebruikt dezelfde matchkaarttaal;
- elke context heeft een eigen startvraag;
- de details en acties blijven consistent.

### 4.5 Status en communicatie zijn nu UX-risico's

Statussen, terminale feedback, voorstelmail, WhatsApp-interesseberichten en bulknotificaties zitten verspreid over meerdere schermen. Daardoor kunnen kleine UI-verschillen echte operationele verschillen worden: de ene plek vraagt feedback, de andere plek verplaatst bulk; de ene plek previewt mail, de andere plek stuurt WhatsApp in een loop; de ene plek gebruikt conceptnotificaties, de andere plek voelt als directe verzending.

Aanbeveling: trek dit terug naar twee gedeelde contracten: `MatchStatusContract` en `MatchOutboundDialog`. Elk scherm gebruikt dezelfde statusovergangen, feedbackplicht, plaatsingsside-effects, outbound preflight, kill-switch-afhandeling en resultaatweergave.

---

## 5. Current-state map

| Gebied | Huidige rol | Sterk | Frictie |
|---|---|---|---|
| Kandidatenlijst | zoeken, filteren, instroom, in dienst | operationeel, bulkselectie, profielstatus, CV-zoekingang | weinig prioritering op matchbaarheid of "wie moet ik vandaag bellen" |
| Kandidaatprofiel | centrale kandidaatwerkplek | inline editing, sensitive fields via decrypt hook, screening en matches dichtbij | veel tabs; match-readiness is niet direct bovenaan zichtbaar |
| Screening | belproces en profielaanvulling | stapsgewijs, autosave, dirty guard, ontbrekende velden | moet sterker doorwerken naar matchkaart en taken |
| Kandidaatmatches | bestaande matches van kandidaat | status wijzigen, voorstelmail, feedback bij afwijzen | tabel is compacter dan vacaturematching; mist rijke "waarom/unknowns/next action" inline |
| Passende vacatures | reverse matching | goede kaarten, filters, waarom-modal | filters zijn technisch ("hard blocks", "skill signal") en minder recruiter-taal |
| Vacaturelijst | overzicht open/vervuld | urgentie, startdatum, overdue, status inline | geen synthese van fulfillment-prioriteit of matchbaarheid |
| Vacaturedetail | vacaturewerkplek | header met status, bezetting, zoeken, AI-skills, tabs | primaire CTA is niet state-based; details/matches/pipeline blijven gescheiden |
| Vacaturematches | rijkste matchomgeving | ranking, shortlist, bulk, status, voorstel, plaatsing, uitleg | veel functies in een lange pagina; mentale lagen lopen door elkaar |
| Matchpipeline | globale statusboard | kanban, filters, bulk notify/status | kaart mist uitleg, ouderdom, blokkades, volgende actie, feedbackevents en keyboard-alternatief voor drag/drop |

---

## 6. Screen-by-screen audit

### 6.1 Kandidatenlijst

**Huidige ervaring**
De lijst heeft tabs voor alle kandidaten, instroomfunnel en in dienst. Er zijn filters op status/compliance, zoekvelden, CV text search, selectie en bulkacties.

**UX-probleem**
De lijst helpt goed bij vinden, maar minder bij prioriteren. Een recruiter die wil matchen ziet niet direct welke kandidaten "match-ready" zijn, welke screening incompleet is, welke kandidaat recent activiteit had, of welke kandidaten op urgente vacatures passen.

**Heuristieken**
Zichtbaarheid van systeemstatus, herkenning boven herinnering, flexibiliteit voor power users.

**Aanbeveling**

- Voeg een compacte readiness-kolom toe: profiel compleet, screeningstatus, matchbare signalen, kritieke onbekenden.
- Maak "Belbaar vandaag" of "Match-ready" een opgeslagen view naast de huidige tabs.
- Laat search modes expliciet kiezen: naam/contact, CV-inhoud, skill/certificaat, beschikbaarheid.
- Toon bij bulkselectie niet alleen aantal geselecteerd, maar ook: hoeveel hebben telefoon, hoeveel zijn match-ready, hoeveel missen toestemming/contactkanaal.

**Prioriteit:** Next. Eerst de matchkaart en vacatureworkspace uniformeren.

### 6.2 Kandidaatprofiel

**Huidige ervaring**
Het profiel is nu een echte werkplek met inline editing, sensitive fields, profiellink, screening, matches, passende vacatures, communicatie en taken.

**UX-probleem**
De informatie is rijk, maar de bovenkant van de pagina zegt nog vooral wie de kandidaat is. Voor matching moet de eerste viewport ook vertellen: is deze kandidaat klaar om te matchen, waarop scoort hij/zij, wat ontbreekt, en wat is de beste volgende actie?

**Heuristieken**
Zichtbaarheid van systeemstatus, consistentie, foutpreventie.

**Aanbeveling**

- Voeg boven de tabs een **Kandidaat readiness strip** toe: screening, profieldata, documenten, beschikbaarheid, vervoer/huisvesting, talen/skills.
- Geef per strip-item een klik naar de juiste plek om het direct te verbeteren.
- Houd BSN/IBAN zichtbaar als administratie/compliance, maar nooit als matching-signaal; readiness mag deze velden ook niet via directe SELECT of truthiness-check uitlezen.
- Maak inline velden visueel nog duidelijker als "klik om te bewerken"; dit patroon moet platformbreed worden.

**Prioriteit:** Now voor readiness strip, Later voor bredere dashboarding.

### 6.3 Screening

**Huidige ervaring**
Screening heeft de juiste belstappen: voorbereiding, contact/identiteit, mobiliteit, werkprofiel, voorwaarden, persoonlijk en besluit. Er is autosave, handmatig opslaan, profielaanvulling, AI-context en afrondvalidatie.

**UX-probleem**
Screening is inhoudelijk goed, maar de output moet nog sterker landen in matching. Een recruiter moet na een call niet opnieuw lezen; de matchmodule moet meteen weten welke onbekenden opgelost zijn en welke nog openstaan.

**Heuristieken**
Feedback, foutpreventie, herkenning boven herinnering.

**Aanbeveling**

- Maak "kritieke onbekenden" uit screening zichtbaar op matchkaarten.
- Laat "Maak taak" niet alleen een taak maken, maar ook teruglinken naar exacte screeningstap.
- Toon na afronden een korte "Match-impact": welke velden zijn nu verbeterd en welke matches worden opnieuw betrouwbaarder?
- Gebruik dezelfde unknown-labels als matching: rijbewijs, taal, afstand, beschikbaarheid, certificaat, werkervaring.
- Maak autosave technisch latest-write-only: een oudere debounce-save mag een latere handmatige afronding niet overschrijven.

**Prioriteit:** Now.

### 6.4 Kandidaatmatches

**Huidige ervaring**
Een tabel met vacature, bedrijf, score, status, voorgesteld-datum en mailactie. Scoreformatting is gecorrigeerd voor 0-100 versus 0-1.

**UX-probleem**
Deze tab voelt als administratie van bestaande matches, terwijl een recruiter hier juist wil beslissen: "Welke vacature past nu het best bij deze kandidaat?" De rijke score-uitleg uit de vacaturematching is hier minder zichtbaar.

**Heuristieken**
Consistentie, herkenning boven herinnering, efficiëntie.

**Aanbeveling**

- Vervang de tabelrichting geleidelijk door dezelfde matchkaart als bij reverse matching.
- Toon per match: score, status, blokkades, eerste onbekende, volgende actie.
- Maak "Waarom?" overal beschikbaar, niet alleen in de reverse matching context.
- Statuswijziging blijft inline, maar terminale statussen vragen altijd feedback; `geplaatst` loopt via de plaatsingsflow en niet als losse dropdownwaarde.

**Prioriteit:** Now.

### 6.5 Passende vacatures voor kandidaat

**Huidige ervaring**
Sterke reverse matching: kaarten, scorebadge, vacaturecontext, filters en "Waarom?"-modal.

**UX-probleem**
Sommige filterlabels zijn technisch: "Zonder harde blokkades", "Skill/cert-match vereist", "Afstand bekend". Recruiters kunnen dit leren, maar het is geen natuurlijke werktaal.

**Heuristieken**
Match tussen systeemtaal en echte wereld, minimalisme.

**Aanbeveling**

- Vertaal filters naar recruiter-taal:
  - "Alleen direct voorstelbaar"
  - "Ook twijfelgevallen tonen"
  - "Eerst afstand controleren"
  - "Alleen bewezen skill-match"
- Toon boven de resultaten een korte uitleg van de huidige selectie: "Je ziet 12 vacatures waar deze kandidaat zonder harde blokkade op past."
- Maak onbekende afstand/beschikbaarheid geen filter dat alleen data wegdrukt, maar een taak/label op de kaart.

**Prioriteit:** Next.

### 6.6 Vacaturelijst

**Huidige ervaring**
Tabel met titel, opdrachtgever, locatie, aantal, salaris, urgentie, startdatum en status. Overdue startdatum krijgt visuele waarschuwing.

**UX-probleem**
Urgentie en startdatum bestaan, maar worden nog niet samengevat tot een vervulprioriteit. Een open vacature met urgentie 3, startdatum in het verleden, 0/5 gevuld en weinig matches zou bovenaan als brandpunt moeten voelen.

**Heuristieken**
Zichtbaarheid van systeemstatus, efficiëntie.

**Aanbeveling**

- Voeg een **Vervulstatus** toe: open plekken, dagen tot start/overdue, aantal sterke matches, aantal kandidaten in gesprek.
- Maak standaard sortering recruiter-gedreven: urgentie + startdruk + open plaatsen + matchvoorraad.
- Voeg saved views toe: "Vandaag vullen", "Geen sterke matches", "Wacht op klant", "Bijna vervuld".

**Prioriteit:** Next.

### 6.7 Vacaturedetail

**Huidige ervaring**
De header toont status, urgentie, bezetting en acties: sollicitatielink, zoek kandidaten, AI-skills, bewerken en status.

**UX-probleem**
De header heeft veel knoppen, maar geen duidelijke state-based primaire actie. Een nieuwe vacature, een rijke vacature met 30 matches, en een bijna vervulde vacature vragen om verschillende hoofdfocus.

**Heuristieken**
Aesthetic and minimalist design, user control, feedback.

**Aanbeveling**

- Maak van de vacaturedetailpagina een **vacature-vervulworkspace**.
- Toon bovenaan de state-based CTA:
  - vacature incompleet: "Maak vacature matchbaar"
  - geen matches: "Zoek kandidaten"
  - sterke shortlist: "Bel shortlist"
  - kandidaten voorgesteld: "Volg klantreactie op"
  - geaccepteerd: "Plaats kandidaat"
- Hernoem "AI-skills" naar recruiter-taal zoals "Vacature-eisen verrijken".
- Laat tabs blijven, maar geef de Matches-tab een overzichtsheader met readiness, shortlist, pipeline en plaatsingen.

**Prioriteit:** Now.

### 6.8 Vacaturematches

**Huidige ervaring**
Dit is de krachtigste matchingplek. Recruiters kunnen bestaande matches beheren, nieuwe kandidaten ranken, scorefilteren, bulk voorstellen, WhatsApp-interesseberichten sturen, voorstelmails previewen en plaatsingen maken.

**UX-probleem**
De pagina doet drie verschillende taken op een lange verticale canvas: pipeline beheren, shortlist ontdekken en communicatie/plaatsing uitvoeren. Daardoor is de cognitieve belasting hoog, vooral bij veel kandidaten.

**Heuristieken**
Recognition rather than recall, minimalism, error prevention.

**Aanbeveling**

- Splits binnen dezelfde tab in drie zones:
  - **Vervulstand:** open plekken, sterke matches, risico's, laatste activiteit.
  - **Shortlist:** kandidaten die nog geen match zijn.
  - **Pipeline:** bestaande matches met status en next action.
- Maak de "Waarom?"-modal een herbruikbare Match Inspector.
- Toon onbekenden en blokkades inline als badges, niet alleen in modaltekst.
- Bulk WhatsApp/e-mail krijgt een preflight: geselecteerd, met telefoon/e-mail, outbound status, ontbrekende toestemming, statusimpact en per-ontvanger-resultaat.
- Directe frontend-loops voor externe berichten moeten verdwijnen achter een gedeeld outbound-pad.

**Prioriteit:** Now.

### 6.9 Matchpipeline

**Huidige ervaring**
Globale kanban met kolommen van nieuwe match tot afgewezen, drag/drop, filters, bulk notify en bulk status.

**UX-probleem**
De pipeline toont waar matches staan, maar niet waarom ze daar staan of welke actie nodig is. Zonder ouderdom, laatste activiteit, blokkade en next action wordt dit snel een statusbord in plaats van een werkbord.

**Heuristieken**
Zichtbaarheid van systeemstatus, flexibiliteit, toegankelijkheid.

**Aanbeveling**

- Voeg per kaart toe: leeftijd in status, laatste communicatie, eerste open blokkade/onbekende, volgende actie.
- Voeg kolom-WIP en aging-signalen toe: "3 langer dan 5 dagen bij klant".
- Bied naast drag/drop altijd een statusmenu en keyboardpad.
- Gebruik hetzelfde feedback- en terminale-statuscontract als vacaturematches.
- Maak pipeline-scope niet alleen actueel/archief/alles, maar ook werkviews: "Mijn opvolging", "Klant wacht", "Kandidaat bellen", "Plaatsing maken".

**Prioriteit:** Next.

---

## 7. Drie kernflows

### Flow A: vacature zoekt kandidaat

```text
Vacature open
  -> vacature-readiness check
  -> shortlist uit volledige database
  -> matchkaart beoordeelt fit + vertrouwen + onbekenden
  -> recruiter belt / vult screening aan
  -> kandidaat akkoord?
  -> voorstel naar opdrachtgever
  -> klantfeedback
  -> plaatsing
```

**Succescriterium:** recruiter kan bij een urgente vacature binnen 2 minuten zien wie de beste belkandidaten zijn, waarom, en wat nog gecontroleerd moet worden.

### Flow B: kandidaat zoekt vacature

```text
Kandidaatprofiel
  -> readiness strip
  -> passende vacatures
  -> filter direct voorstelbaar / twijfelgevallen
  -> matchkaart + inspector
  -> match aanmaken
  -> status volgen in pipeline
```

**Succescriterium:** recruiter kan vanaf een kandidaat direct passende open vacatures beoordelen zonder de vacaturelijst handmatig te doorzoeken.

### Flow C: recruiter beheert lopende matches

```text
Matchpipeline
  -> werkview op volgende actie
  -> matchkaart met statusleeftijd + blokkade
  -> communicatie of statusmutatie
  -> feedback verplicht bij terminale statussen
  -> plaatsing of afwijzing
```

**Succescriterium:** geen match blijft stil liggen zonder zichtbare reden, eigenaar of vervolgstap.

---

## 8. UX-contracten voor implementatie

Deze analyse vraagt geen directe schemawijziging. Wel moet vervolgwerk rond onderstaande UI-contracten worden gebouwd.

### 8.1 `MatchCard`

Doel: een uniforme matchweergave in vacature, kandidaat en pipeline.

Minimale velden:

- kandidaatnaam + link
- vacaturetitel + link
- opdrachtgever
- status + statusleeftijd
- `matchPercent` als fit-score
- `candidateQuality` als dossierkwaliteit, los van fit-score
- datavertrouwen: compleet / deels onbekend / te onzeker
- belangrijkste positieve signalen
- harde blokkades
- kritieke onbekenden
- afstand/reistijd indien bekend
- volgende actie
- primaire CTA
- laatste communicatie of activiteit

### 8.2 `ScoreExplanation`

Doel: de huidige "Waarom?"-modal wordt een consistente Match Inspector.

Moet tonen:

- score-opbouw uit `componentScores`
- verschil tussen match-fit en kandidaatkwaliteit
- pluspunten uit `bonuses`
- harde blokkades uit `hardBlocks`
- aandachtspunten uit `missing`
- gebruikte vacaturecontext
- gebruikte kandidaatdata
- expliciete melding als data onbekend is en niet als "nee" is behandeld

### 8.3 `ReadinessSignal`

Doel: kandidaat en vacature krijgen een compacte matchbaarheidssamenvatting.

Voor kandidaat:

- profieldata
- screening
- beschikbaarheid
- skills/certificaten
- taal
- rijbewijs/vervoer
- locatie/huisvesting
- communicatiekanaal

Voor vacature:

- functieprofiel
- skills/certificaten
- locatie/coordinaten
- startdatum
- aantal plaatsen
- opdrachtgever/contact
- salaris/tarief
- publicatie/sollicitatielink

### 8.4 `NextAction`

Doel: elke matchkaart kiest een primaire actie.

Voorbeelden:

- "Bel kandidaat"
- "Vul rijbewijs aan"
- "Beschikbaarheid bevestigen"
- "Voorstellen aan opdrachtgever"
- "Wacht op klantreactie"
- "Feedback vastleggen"
- "Plaats kandidaat"
- "Afwijzen met reden"

### 8.5 `UnknownDataPrompt`

Doel: onbekende data wordt omgezet naar een belvraag, taak of profielveld.

Voorbeelden:

- Rijbewijs onbekend -> vraag in Screening/Mobiliteit.
- Afstand onbekend -> adres of geocode controleren.
- Taal onbekend -> taalniveau en bewijs vastleggen.
- Beschikbaarheid onbekend -> beschikbaar vanaf + ploegendienst/overwerk vragen.
- Certificaat onbekend -> certificaatnaam + verloopdatum/document vragen.

### 8.6 `MatchStatusContract`

Doel: alle matchstatussen en statusovergangen komen uit één UI-contract.

Moet vastleggen:

- statuslabels, kleuren en sortering;
- toegestane overgangen per huidige status;
- terminale statussen die feedback vereisen;
- wanneer `match_feedback_events` verplicht is;
- wanneer `status_changed_at` wordt bijgewerkt;
- wanneer plaatsing verplicht via `PlacementSheet`/plaatsingsflow loopt;
- welke querykeys na mutatie worden geïnvalideerd.

### 8.7 `MatchOutboundDialog`

Doel: alle externe matchcommunicatie gebruikt één preflight/confirm/resultaatpatroon.

Moet tonen:

- geselecteerde ontvangers;
- kanaal per ontvanger;
- ontbrekende telefoon/e-mail;
- communicatievoorkeuren;
- gekoppeld Outlook/WhatsApp-account;
- `outbound_paused` status;
- preview waar relevant;
- idempotency/duplicaatwaarschuwing;
- resultaat per ontvanger na actie.

### 8.8 `SaveStateContract`

Doel: elke flow met autosave of inline editing heeft dezelfde status- en verliespreventie.

Moet regelen:

- zichtbaar opgeslagen/niet-opgeslagen/pending/fout;
- `beforeunload` en route-guard met dezelfde tekst;
- queued latest-write-only saves;
- pending-save blokkade op definitieve acties zoals "Screening afronden";
- conflictmelding als serverdata nieuwer is dan lokale draft.

---

## 9. Communicatie-UX

Uitgaande communicatie is een risicogebied omdat een knop buiten het systeem effect heeft. Daarom moet communicatie in matching niet voelen als een gewone statusmutatie.

Aanbevelingen:

- Elke e-mail/WhatsApp-bulkactie krijgt een preflight-dialog.
- Preflight toont geselecteerd aantal, kanaalbeschikbaarheid, kandidaten zonder telefoon/e-mail, outbound-pauzestatus en statusimpact.
- `organizations.settings.outbound_paused` is de enige bron voor de kill-switch; oudere namen zoals `communication_pause` zijn stale en mogen niet terugkomen.
- App-managed e-mail/WhatsApp mag nooit direct naar Graph/Meta. Gebruik `outlook-send-mail`, `sendViaOutlookAccount()`, `whatsapp-send` of een edge function die `isOutboundPaused()` respecteert.
- Als outbound gepauzeerd is, wordt niets extern verstuurd; bewaakte paden loggen een concept of geven een expliciete paused/skipped-status terug.
- `send-match-proposal` mag status alleen opschuiven na succesvolle verzending; dit is een technisch en UX-contract.
- Preview blijft verplicht voor voorstelmail aan opdrachtgever.
- Bulknotificatie en directe voorstelacties moeten dezelfde pause-taal tonen, ook als de ene route concepten logt en de andere route kanalen als skipped telt.

---

## 10. Mobile en toegankelijkheid

De huidige module is primair desktop-operational. Dat past bij backofficewerk, maar recruiters zullen ook bellen, checken en opvolgen op laptop/tablet/mobiel.

Risico's:

- brede tabellen in kandidaatmatches en vacaturelijsten;
- horizontale tablijsten met veel items;
- kanban/drag-drop zonder duidelijke keyboard-equivalent;
- icon-only acties met beperkte tekst op mobiel;
- bulkacties die op smalle schermen veel context verliezen.

Aanbevelingen:

- Gebruik op mobiel kaarten in plaats van brede tabellen voor matches.
- Maak tabs scrollbaar, maar voeg prioriteit toe: profiel, screening, matches/vacatures, communicatie, taken.
- Drag/drop mag blijven, maar statusselectie moet volledig toetsenbord- en screenreader-bruikbaar zijn.
- Elke icon-only actie krijgt een accessible name en tooltip; `title` alleen is niet genoeg.
- Formulierlabels gebruiken `htmlFor`/`id`; checkboxrijen hebben een echte tekstlabelrelatie.
- Touch targets minimaal 44px voor status, bulkselectie, mail/WhatsApp en "Waarom?".
- Statuskleur nooit als enige informatiedrager gebruiken; altijd label tonen.

---

## 11. Roadmap

### Nu: 1-2 sprints

- Bouw het gedeelde `MatchCard` + `ScoreExplanation`-patroon en gebruik het minimaal in kandidaatmatches, passende vacatures en vacaturematches.
- Introduceer `MatchStatusContract`, `MatchFeedbackDialog`, `MatchOutboundDialog` en bij voorkeur één `useMatchActions()`-laag.
- Maak vacaturedetail state-based: "Maak matchbaar", "Zoek kandidaten", "Bel shortlist", "Volg klantreactie op", "Plaats kandidaat".
- Voeg kandidaat- en vacature-readiness strips toe die onbekende data klikbaar maken.
- Laat screening-output direct terugkomen als match-onbekenden en follow-up taken.
- Voeg communicatie-preflight toe voor bulk interesseberichten en voorstelacties.
- Audit publieke match-response tokenroutes voordat klant/kandidaatfeedback zwaarder op die route gaat leunen.

### Daarna

- Herwerk de matchpipeline naar werkviews met statusleeftijd, laatste activiteit, blokkade en volgende actie.
- Maak de vacaturelijst prioriteitgedreven met vervulstatus, sterke matches en open plekken.
- Vertaal technische matchfilters naar recruiter-taal en voeg saved views toe.
- Voeg mobile card-layouts toe voor kandidaatmatches, vacaturematches en pipeline.
- Verplaats pipeline-fetching naar server-side pagination per status voordat het volume verder groeit.

### Later

- Bouw een recruiter workbench: "vandaag vullen", "kandidaten bellen", "klant wacht", "matches zonder opvolging".
- Maak matchingcriteria en wegingen configureerbaar per organisatie of vacaturetype, zonder de shared matching-core te omzeilen.
- Voeg analytics toe: time-to-first-call, time-in-stage, reden van afwijzing, bronnen met beste plaatsingsratio.
- Gebruik Carerix alleen als benchmark voor assisted matching, uitleg, recruitercontrole en thresholds.

---

## 12. Test- en validatiescenario's

### Scenario 1: urgente vacature

Een recruiter opent een urgentie-3 vacature met startdatum in het verleden en 0/5 gevuld.

Acceptatie:

- de pagina toont direct dat dit prioriteit heeft;
- primaire CTA is kandidaten zoeken/bellen;
- shortlist komt uit de volledige eligible pool en sluit bestaande matches uit;
- shortlist toont sterke kandidaten met reden en onbekenden;
- recruiter kan vanuit de kaart naar screening of profielveld.

### Scenario 2: kandidaat met incomplete data

Een kandidaat heeft goede skills, maar rijbewijs, beschikbaarheid en afstand zijn onbekend.

Acceptatie:

- de score behandelt onbekend niet als automatisch "nee";
- onbekenden staan zichtbaar op de matchkaart;
- elke onbekende heeft een actie: belvraag, profielveld of taak.

### Scenario 3: kandidaat naar passende vacatures

Een recruiter opent een kandidaat en zoekt passende vacatures.

Acceptatie:

- reverse matching toont open vacatures met score, context en next action;
- filters gebruiken recruiter-taal;
- "Waarom?" toont dezelfde inspector als vacaturematching.

### Scenario 4: pipeline opvolging

Een match staat zeven dagen in "Bij klant" zonder reactie.

Acceptatie:

- pipelinekaart toont ouderdom en laatste activiteit;
- kaart krijgt next action "Klant opvolgen";
- status kan zonder drag/drop worden gewijzigd;
- feedback wordt vastgelegd bij afwijzing.
- globale pipeline en vacaturematches gebruiken hetzelfde feedbackevent-contract.

### Scenario 5: outbound gepauzeerd

Outbound e-mail of WhatsApp staat gepauzeerd.

Acceptatie:

- bulk of voorstelactie toont blokkade/preflight;
- er wordt niets verzonden;
- status schuift niet door alsof verzending gelukt is;
- UI benoemt of het resultaat concept, paused of skipped is.

### Scenario 6: mobiel/tablet

Recruiter bekijkt een kandidaat op tablet tijdens bellen.

Acceptatie:

- profiel, screening en matches zijn zonder horizontale tabelstress bruikbaar;
- belangrijkste acties zijn binnen bereik;
- wijzigingen hebben autosave of duidelijke unsaved guard.

### Scenario 7: toegankelijkheid

Recruiter gebruikt toetsenbordnavigatie.

Acceptatie:

- matchstatus kan zonder drag/drop worden aangepast;
- focusvolgorde is logisch;
- knoppen hebben labels;
- modal sluit en focus keert correct terug.

### Scenario 8: publieke match-response

Een kandidaat of opdrachtgever opent een publieke matchrespons-link.

Acceptatie:

- tokenlookup en statusupdate werken alleen via het bedoelde tokenpad;
- anon/public route kan geen willekeurige `matches` of `match_proposal_tokens` lezen;
- statusupdate schrijft feedback/status alleen binnen de token-scope;
- misbruikte, verlopen of onbekende tokens geven een veilige foutmelding.

---

## 13. Guardrails voor builders

- Pas scoring aan in `supabase/functions/_shared/matching-core.ts`, niet in losse UI-componenten.
- Frontend mag `MatchBreakdown` tonen en `criteria_options` doorgeven, maar geen eigen score- of thresholdlogica dupliceren.
- Houd `matchPercent` 0-100; vermenigvuldig scores in UI niet nogmaals met 100.
- Houd `candidateQuality` zichtbaar gescheiden van match-fit.
- Selecteer BSN/IBAN nooit direct, ook niet voor truthiness; gebruik decrypt-hooks/RPC's of een server-side boolean die geen ciphertext lekt.
- Laat outbound communicatie altijd langs `organizations.settings.outbound_paused` lopen; `communication_pause` is oud en mag niet terugkomen.
- App-managed mail/WhatsApp mag niet direct Graph/Meta aanroepen; gebruik bewaakte edge/shared sendpaden.
- Queryparams, `location.state` en entity-id's zijn UX-hints, geen autorisatie. Server/RLS valideert altijd tenant- en token-scope.
- Gebruik `useOrganizationId()` alleen in hoofd-app-routes, niet in portal/clientportal/public tokenroutes.
- SECURITY DEFINER write-RPC's mogen niet `anon`-uitvoerbaar zijn.
- Maak onbekende data geen impliciete afwijzing; behandel het als follow-up.
- Gebruik bestaande shadcn/Tailwind-patronen en vermijd nieuwe UI-systemen.
- Geen schema-normalisatie voor screening/matching zonder expliciet vervolgbesluit.
- Als schema/RPC/edge changes nodig zijn: live schema verifieren, `types.ts` niet handmatig editen, Deno-check draaien en edge functions handmatig deployen.

---

## 14. Multi-agent review

### Primary designer

Besluit: ontwerp rond een gedeelde matchkaart en recruiter-cockpit, niet rond aparte schermoptimalisaties. De huidige module heeft genoeg losse functionaliteit; de winst zit in samenhang.

### Skeptic / challenger

Bezwaar: "Een extra matchkaartlaag kan nog meer UI toevoegen aan een al volle module."

Resolutie: de matchkaart moet juist reduceren. Hij vervangt verschillende tabel/kaart/modalvarianten door een compact, herbruikbaar patroon. De inspector blijft secundair.

### Constraint guardian

Bezwaar: "Als de UI zelf scorelogica gaat interpreteren, ontstaat drift met edge functions."

Resolutie: UI mag alleen bestaande `MatchBreakdown` presenteren en vertaalt onbekenden naar acties. Scoring en filters blijven server-side in de shared matching-core/rank-functions. Het document noemt expliciet dat threshold- en statuslogica niet per component mag worden gekopieerd.

Tweede bezwaar: "Communicatie-UX kan security omzeilen als builders directe Graph/Meta calls toevoegen."

Resolutie: outbound communicatie krijgt een hard contract: bewaakte paden, `outbound_paused`, preview/preflight en geen externe verzending bij pauze.

### User advocate

Bezwaar: "Recruiters willen snelheid. Te veel uitleg vertraagt."

Resolutie: uitleg wordt gelaagd. De kaart toont alleen de eerste reden, eerste blokkade en volgende actie. Detail blijft achter "Waarom?".

### Arbiter

Besluit: richting is acceptabel mits de eerste implementatiefase klein blijft: matchkaart, statuscontract, outboundcontract, readiness strip en state-based next action. Geen complete rebuild van kandidaten/vacatures tegelijk.

---

## 15. Multi-advisor synthese

**Productvisie:** de module moet voelen als een werkplek voor vacaturevervulling, niet als een databaseviewer.

**Recruiteroperatie:** prioriteer belwerk, opvolging en plaatsing. Alles wat geen beslissing helpt, moet naar de tweede laag.

**AI/matching-uitlegbaarheid:** AI mag ondersteunen, maar de recruiter moet altijd zien welke feiten, aannames en onbekenden de match bepalen.

**Frontendkwaliteit:** standaardiseer componenten voordat je meer features toevoegt. Anders blijven kandidaat-, vacature- en pipelinecontext uit elkaar groeien.

**Privacy/communicatie:** gevoelige data en outbound acties moeten conservatief blijven. Snelheid mag nooit betekenen dat BSN/IBAN of WhatsApp/e-mail buiten bestaande guards vallen.

**QA-risico:** publieke matchresponse, pipeline-statusmutaties en outbound-pauze zijn acceptatiecriteria, geen polish. Deze flows moeten in regressietests terechtkomen zodra de UX wordt gebouwd.

---

## 16. Decision log

| Besluit | Alternatief | Reden |
|---|---|---|
| Gedeelde matchkaart als kernpatroon | Per scherm eigen optimalisatie | voorkomt inconsistentie tussen kandidaat, vacature en pipeline |
| Onbekende data als workflow-item | Onbekend alleen in score-uitleg tonen | recruiters moeten weten wat ze moeten vragen/doen |
| State-based CTA op vacaturedetail | vaste knoppenrij houden | vacaturestatus bepaalt het echte hoofdpad |
| Eén matchstatuscontract | statussen per component laten bestaan | voorkomt dat pipeline, kandidaatmatches en vacaturematches andere regels krijgen |
| Eén outboundcontract | per scherm eigen mail/WhatsApp-flow | voorkomt kill-switch, preview en statusdrift |
| Pipeline naar werkbord evolueren | kanban alleen visueel verbeteren | status zonder next action lost opvolging niet op |
| Geen nieuwe DB in analyse | direct normaliseren | v1 kan voort op bestaande `MatchBreakdown`, `matches`, `screening_data` |
| Carerix als benchmark | Carerix als kernsysteem | JA Werkt-platform vervangt Carerix; alleen goede patronen meenemen |

---

## 17. Einddispositie

**Disposition: APPROVED WITH GUARDRAILS**

De productrichting is sterk genoeg om door te zetten: maak matching, vacatures en kandidaten tot één recruiter-cockpit met gedeelde matchkaarten, readiness-signalen en volgende acties. De belangrijkste voorwaarden zijn discipline en veiligheid: geen nieuwe losse matchingvarianten, statusflows of outboundpaden bouwen voordat het gedeelde UX-contract staat.
