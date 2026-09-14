# Bugs en verbeterideeën melden

Interne rollen (`admin`, `intercedent`, `backoffice`, `finance`) krijgen in de bovenbalk **Bug of idee melden**.
De portalzones en de aparte facility-rol vallen in deze eerste versie buiten deze toegang, overeenkomstig
`is_internal_user()`. De gebruiker vult een onderwerp en omschrijving in, bij een bug optioneel stappen en
verwacht resultaat. Screenshots kunnen worden geplakt, geüpload of via de Screen Capture API vastgelegd.

Een screenshot wordt lokaal naar PNG omgezet (geen oorspronkelijke afbeeldingsmetadata), begrensd op
2560 pixels per zijde / 2 MB. **Omcirkelen** tekent een rode cirkel met transparant midden; **Zwartmaken**
bedekt gevoelige gegevens. **Ongedaan maken** herstelt de laatste bewerking. Elke bewerking trekt de
deelbevestiging in. De gebruiker bevestigt expliciet het zichtbare voorbeeld. Alleen dat bewerkte beeld
wordt verstuurd. Automatische detectie van gevoelige
gegevens in afbeeldingen is niet ingebouwd. Browser-schermopname vereist toestemming; upload/plakken
blijven beschikbaar waar deze API ontbreekt. De opname stelt het huidige tabblad voor via
[`preferCurrentTab` en `displaySurface`](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia);
de gebruiker blijft zelf de bron kiezen. Het meldformulier is tijdens de opname gesloten. Na toestemming
en videostart wacht de opname één seconde, gevolgd door een nieuw gedecodeerd videoframe. Zo wordt het
eerste beeld met het nog wegfadende browserdeelvenster overgeslagen. De videotracks stoppen direct na
de screenshot, ook bij fouten of timeout. Er is geen browser-API die het sluiten van elk native deelvenster
bevestigt; de wachttijd en voorkeur voor tabbladopname vangen het gemelde timingprobleem op.

## Opslag, debuggegevens en bezorging

- `feedback_reports` bevat de melding, melder, organisatie, een meldingsnummer en bezorgstatus.
  Er wordt altijd opgeslagen voordat een screenshot of e-mail wordt verwerkt.
- Technische context heeft een vaste allowlist: pad zonder query/hash, tijdstip, browser, schermgrootte,
  appversie, online-status en bij bugs maximaal vijf fouten uit de afgelopen tien minuten in deze sessie.
  `ErrorBoundary` en de bestaande globale foutlogger vullen deze korte geheugenbuffer. Sentry-event-ID's
  worden waar beschikbaar toegevoegd. Sentry hoeft niet actief te zijn om feedback te kunnen melden.
  Herkende tokens, e-mailadressen, BSN, IBAN en Nederlandse telefoonnummers worden in debugtekst verwijderd.
  Vrije tekst kan nog namen bevatten; de gebruiker kan de debugcontext vóór verzending bekijken.
- Geen console-, netwerkbody-, cookie-, localStorage-, dossier- of formulierdump; geen session replay.
- `feedback-screenshots` is een private bucket zonder browserpolicies. Alleen de edge function schrijft;
  een geauthenticeerde superadmin of de actieve interne melder krijgt voor een afbeelding een signed URL
  van vijf minuten. `my-detail` controleert gebruiker én organisatie vóór het ondertekenen van het opgeslagen
  pad; andere gebruikers krijgen 404. Opslagpaden worden niet meegestuurd in het persoonlijke detailantwoord.
- De ontvanger staat uitsluitend server-side vast op `info@sitejob.nl`. De organisatie-default Outlook-
  afzender verstuurt via de bestaande merk-wrapper; Reply-To is het accountadres van de melder.
  De mail bevat de beschrijving en geschoonde debugcontext, en linkt naar `/superadmin/feedback/:id`.
  De screenshot-link vereist inloggen als SiteJob-superadmin. De login bewaart het bestemmingspad.
- `communications.feedback_report_id` koppelt één concept/verzendlog aan de melding. Dit org-brede log
  bevat uitsluitend een verwijzing; de privéfeedback staat in de afgeschermde melding.
  De bestaande `chk_comm_target` is uitgebreid met dit expliciete supportdoel; bestaande kandidaat- en
  bedrijfsmails behouden hun gedrag. Een samengestelde FK bewaakt de organisatiegrens.
- Alleen de server kan feedback aanmaken of de bezorgstatus wijzigen. RLS laat een actieve interne melder
  zijn eigen melding lezen, en SiteJob-superadmins alle meldingen. Andere gebruikers kunnen niet lezen.
- `create_feedback_report` is service-role-only, gebruikt een lock per melder en begrenst nieuwe meldingen
  op tien per uur. Een UUID en SHA-256 van de gevalideerde aanvraag voorkomen dubbele meldingen bij retries.

De verzendpauze wordt gerespecteerd. `paused` blijft als concept beschikbaar. `failed` betekent dat de
voorbereiding mislukte vóór een mailpoging; opnieuw proberen is veilig. `sending` / `unknown` worden nooit
automatisch opnieuw verstuurd: een provider-timeout kan betekenen dat de mail toch verzonden is. SiteJob
ziet zulke meldingen in **Superadmin → Bugs & ideeën** en kan de mailbox controleren. Een afgebroken
edge-runtime kan een melding in `preparing` of `sending` achterlaten; inspecteer die handmatig voordat de
status wordt vrijgegeven. Er is geen cron voor automatische mailretries. De bezorgstatus van de e-mail
staat los van de hieronder beschreven behandelstatus; meldingen blijven bewaard.

## Oplossen en de melder informeren

SiteJob kan in **Superadmin → Bugs & ideeën → melding** kiezen voor **Oplossen en melder informeren**
(bij een idee: **Doorvoeren en melder informeren**), met optioneel een toelichting van maximaal 2.000 tekens.
De melding krijgt status `resolved`, een datum, de behandelaar en een revisienummer.

De melder krijgt een persoonlijke terugkoppeling onder het notificatiebelletje. Klikken opent
`/feedback/:id` met de oorspronkelijke melding en de uitleg van SiteJob. Vanuit het meldformulier leidt
**Mijn meldingen en terugkoppeling** naar `/feedback`. Alleen de actieve interne eigenaar heeft toegang;
dit breidt de portalrollen niet uit. De bel haalt persoonlijke berichten elke 30 seconden en bij openen op.
Dit is een melding in de app; er wordt bij oplossen geen e-mail of browser-push verstuurd.

De opgeloste feedbackrij zelf is de notificatie: status en bericht bestaan in één database-write.
`resolution_read_at` en `resolution_dismissed_at` bewaren gelezen/verwijderd voor deze melder. Er komt geen
rij in het organisatiebrede `employee_notifications`, zodat collega's geen privéfeedback zien.
Een herhaalde statusactie verandert geen tijdstip en maakt een gelezen bericht niet opnieuw ongelezen.
Optimistische revisiecontrole voorkomt dat een oude retry een later heropende melding opnieuw sluit,
of dat een oud gelezen/verwijderd-verzoek een nieuwere terugkoppeling wegwerkt.

**Melding heropenen** zet de status terug naar `open` en trekt de bijbehorende afgerond-notificatie in.
Opnieuw afronden geeft een nieuwe revisie en een nieuw ongelezen bericht. Deze compacte workflow bewaart
de huidige status en laatste toelichting; er is geen aparte behandelgeschiedenis.

Migratie `20260914093855_feedback_resolution.sql` voegt de velden en indexen toe; bestaande RLS en het
verbod op directe browserwrites blijven gelden. Edge action `set-status` is alleen voor Superadmin.
`mine`, `my-detail`, `my-notifications` en `acknowledge` gebruiken organisatie en gebruiker uit de geverifieerde
sessie. Persoonlijke query-caches zijn per organisatie en gebruiker gescheiden.

De detailpagina toont ook de bijgevoegde screenshot, inclusief reeds opgeslagen afbeeldingen. Klikken
opent het volledige beeld in een nieuw tabblad. **Screenshot opnieuw laden** haalt een verse tijdelijke
link op. Een ontbrekende upload of opslagstoring laat de melding leesbaar en toont bij de afbeelding een
herstelknop. Er is geen schemawijziging of bredere storagepolicy nodig voor deze weergave.

`src/test/feedback-detail.test.ts` bewaakt eigenaar-/organisatiegrenzen, private veldselectie en opslagfouten.
`scripts/e2e-feedback-screenshot.spec.ts` test mobiel tonen, vernieuwen, een verlopen/mislukte afbeeldingslink,
ontbrekende upload en meldingen zonder screenshot met onderschepte reacties. De opt-in controle
`scripts/test-feedback-screenshot-live.mjs` gebruikt `RUN_LIVE_FEEDBACK_QA=1`, `E2E_BASE_URL` en de bestaande
demo-/Supabase-omgeving: tijdelijke demo-PNG opslaan, eigenaar-API en echte mobiele browser controleren,
anonieme/niet-eigenaar/directe/publieke toegang weigeren en uitsluitend de eigen fixture opruimen.
Deze controle verstuurt geen mail en verandert geen organisatie-instellingen of bestaande meldingen.

De regressietest `src/test/feedback-resolution.test.ts` test dubbele acties, ownership, heropenen en stale
revisies. `scripts/e2e-feedback-resolution.spec.ts` bewijst de beheerknop en mobiele notificatieflow met
onderschepte beheerreacties. `scripts/test-feedback-resolution-live.mjs` heeft expliciete opt-in via
`RUN_LIVE_FEEDBACK_QA=1`: hij maakt alleen een tijdelijke eigen demo-melding, test de statushelper met een
serviceclient tegen de echte DB, en controleert de gedeployde lees-/acknowledgement-routes. Met
`E2E_BASE_URL` controleert hij ook het echte mobiele belletje en de detailpagina. De publieke beheerroute
moet voor demo `403` geven. Het bewust geblokkeerde QA-superadminaccount wordt nooit geactiveerd; deze test
is geen positieve HTTP-login-/autorisatietest voor Superadmin. Er gaat geen mail uit en de fixture wordt
in `finally` verwijderd.

## Implementatie en livegang

Frontend: `src/components/feedback/`, `src/lib/feedback-*`, `SuperAdminFeedback.tsx`.
Backend: `supabase/functions/feedback/`, pure grensdefinities in `_shared/feedback-contract.ts`.
Migraties: `20260914090151_feedback_reports.sql` en `20260914090236_feedback_communication_index.sql`.

De live kolommen, functie-definities, `chk_comm_target`, afzenderbeschikbaarheid en storagepolicies zijn
gelezen bij het bouwen. Documentatiedrift: `communications` accepteert vóór deze migratie uitsluitend
een kandidaat/bedrijf; daarom kon de oude concept-helper een dossierloze supportmelding niet opslaan.

Livegang vereist de migratie, daarna types regenereren, Supabase advisors controleren en
`supabase functions deploy feedback --project-ref noaupcteygfvlyymqtew`. De CLI bundelt de gedeelde
Outlook-/auth-/mailbestanden en neemt `verify_jwt=false` uit config over; de functie controleert zelf auth.
De nieuwe optionele `replyToEmail` in de Outlook-helper verandert andere mailers niet. De frontend kan
daarna via de PR worden gemerged. Geen extra geheimen vereist: de bestaande Supabase-/Outlook-inrichting
volstaat. Optioneel `APP_URL` op de edge-runtime; default is de bestaande Vercel-productie-URL.

De frontend gebruikt geen directe queries naar de nieuwe tabel en heeft daarom geen handmatige aanpassing
van de gegenereerde Supabase-types nodig. Regeneratie hoort bij het toepassen van de migratie.

## Verificatie

`npm run lint`, `npm run typecheck`, `npm run test`, `npm run build` en
`deno check supabase/functions/feedback/index.ts`.

`node scripts/test-feedback-db.mjs` start een tijdelijke PostgreSQL-container zonder netwerk en verwijdert
die na afloop. De test past de migratie tweemaal toe en controleert tenant-/portalafscherming, ownership,
RPC-rechten, conceptreferenties, idempotentie en de meldingslimiet. Hij gebruikt een minimale, op het live
schema gebaseerde fixture en raakt productie niet.

`scripts/e2e-feedback.spec.ts` test het echte formulier met de demo-login, inclusief de zwarte pixels in
het verzonden screenshot, mobiele layout en identieke retries na een weggevallen verbinding. Alle
feedbackrequests worden onderschept; er wordt geen echte melding of e-mail aangemaakt. Geef een preview-
URL mee via `E2E_BASE_URL`, `PLAYWRIGHT_SKIP_WEBSERVER=1` bij een eigen devserver, en de bestaande
`DEMO_ORG_EMAIL` / `DEMO_ORG_PASSWORD` via de omgeving. Testmails zijn niet verstuurd.

`scripts/e2e-feedback-editor.spec.ts` controleert de rode cirkel, transparant midden, ongedaan maken,
herbevestiging en de combinatie met zwarte vlakken in de daadwerkelijk verzonden PNG. De tweede test
simuleert een deelvenster dat na 500 ms verdwijnt in een echte videostream: de screenshot moet het latere
schone beeld bevatten, het meldformulier moet verborgen zijn en alle tracks moeten stoppen. Annuleren
behoudt de concepttekst en bijlage. Dit is een gecontroleerde browserregressie; native Windows/Edge-
deelvensters zijn niet bediend op deze macOS-testomgeving.

`scripts/test-feedback-live.mjs` controleert de uitgerolde backend met synthetische demo-meldingen.
Expliciete opt-in: `RUN_LIVE_FEEDBACK_QA=1`, de bestaande demo-/Supabase-env en de ingelogde Supabase CLI.
Het script pauzeert demo-verzending, controleert opslag, identiteit, debugfiltering, retries, privéopslag en
conceptlogging, en verwijdert daarna alleen zijn eigen testgegevens. Het oorspronkelijke pauzebeleid wordt
hersteld. `FEEDBACK_QA_SKIP_SUPERADMIN=1` slaat de echte beheerlogin over: het opgeslagen QA-superadminaccount
is bewust geblokkeerd en wordt door deze test nooit geactiveerd. Met een toegelaten QA-account en
`E2E_BASE_URL` kan dezelfde test ook de echte beheerpagina openen.

### Releasecontrole 14 september 2026 — PR #273

- Beide migraties zijn toegepast met versies die gelijk zijn aan de lokale bestandsnamen; types zijn
  gegenereerd uit productie. De samengestelde communicatie-index dekt de nieuwe FK.
- Edge function `feedback` is actief (versie 1, `verify_jwt=false`, eigen gebruikersauthenticatie).
- Live demo-QA geslaagd: bug en idee opgeslagen; screenshot geüpload en via een tijdelijke URL gelezen;
  anonieme toegang, directe browserwrites en screenshotdownloads geweigerd; identiteitsvelden niet te
  spoofen; debuggegevens geschoond; retry idempotent; mail als concept onder de kill-switch.
  Testmeldingen, communicatielogs en afbeeldingen zijn daarna aantoonbaar verwijderd; instellingen hersteld.
- 1.915 unit-tests, volledige lint (nul fouten), typecheck, build en Deno-check geslaagd. Beide migraties
  tweemaal getest op geïsoleerde PostgreSQL, inclusief tenant-/portalafscherming en de meldingslimiet.
- Drie browserflows geslaagd: screenshotcontrole/zwartmaken, mobiel idee met verbindingsverlies/retry,
  en detail-link na beheerlogin met onderschepte beheerreacties. De laatste test vond en verifieert de fix
  voor de race tussen login en de asynchrone controle in `SuperAdminContext`.
- Geen nieuwe security-advisors voor feedback. De performance-advisor meldt alleen dat de pas aangemaakte
  feedback-indexen nog niet gebruikt zijn. Bestaande projectmeldingen vallen buiten deze release.
- Beperking: geen echte Superadmin-login met het bewust geblokkeerde QA-account en geen echte testmail
  verstuurd. JA Werkt heeft een verbonden standaardmailbox en e-mailverzending staat aan. De provider-
  verzendtak is met injecteerbare mailer getest; inboxontvangst is niet geverifieerd.
