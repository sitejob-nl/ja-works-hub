# Bugs en verbeterideeën melden

Interne rollen (`admin`, `intercedent`, `backoffice`, `finance`) krijgen in de bovenbalk **Bug of idee melden**.
De portalzones en de aparte facility-rol vallen in deze eerste versie buiten deze toegang, overeenkomstig
`is_internal_user()`. De gebruiker vult een onderwerp en omschrijving in, bij een bug optioneel stappen en
verwacht resultaat. Screenshots kunnen worden geplakt, geüpload of via de Screen Capture API vastgelegd.

Een screenshot wordt lokaal naar PNG omgezet (geen oorspronkelijke afbeeldingsmetadata), begrensd op
2560 pixels per zijde / 2 MB, en kan met zwarte vlakken worden bewerkt. De gebruiker bevestigt expliciet
het zichtbare voorbeeld. Alleen dat bewerkte beeld wordt verstuurd. Automatische detectie van gevoelige
gegevens in afbeeldingen is niet ingebouwd. Browser-schermopname vereist toestemming; upload/plakken
blijven beschikbaar waar deze API ontbreekt. De opname wordt direct na één frame gestopt.

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
  een geauthenticeerde superadmin krijgt voor een afbeelding een signed URL van vijf minuten.
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
status wordt vrijgegeven. Er is in deze eerste versie geen cron voor automatische mailretries en geen
workflow voor productstatussen zoals 'in behandeling' of 'opgelost'. Meldingen blijven wel bewaard.

## Implementatie en livegang

Frontend: `src/components/feedback/`, `src/lib/feedback-*`, `SuperAdminFeedback.tsx`.
Backend: `supabase/functions/feedback/`, pure grensdefinities in `_shared/feedback-contract.ts`.
Migratie: `20260914120000_feedback_reports.sql`.

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
