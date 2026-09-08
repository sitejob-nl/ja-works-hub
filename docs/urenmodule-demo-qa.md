# Urenmodule: verbonden demo-QA op 8 september 2026

De opgebouwde businessflow is geslaagd in een echte Chromium-browser tegen de
live Supabase-API. De frontend draaide lokaal op poort 8083. Demo Uitzendbureau
Showroom is een afzonderlijke organisatie in hetzelfde Supabase-project; deze
test gebruikte uitsluitend de gecontroleerde demo-accounts en herkenbare
synthetische opdrachtgevers/plaatsingen.

## Bewezen gedrag

- Interne en medewerkeraccounts loggen in via de werkelijke formulieren in lege,
  afzonderlijke browsercontexten; geen gemockte antwoorden of geïnjecteerde sessies.
- Matrix aanmaken, OV1–OV5 expliciet koppelen, opslaan, rekenvoorbeeld uitvoeren en
  publiceren via het scherm.
- Opdrachtgeverdeadlines instellen, week aanmaken en bronuren opslaan. Twee echte
  aanroepen van `hours-classify-day` slagen; minuten, factor 1,25 en vastgelegde
  matrix blijven na herladen behouden.
- Medewerkerdeeplink na inloggen, uitsluitend eigen uren, akkoord op exacte
  revisie, correctie die het akkoord ongeldig maakt, opnieuw akkoord en bezwaar.
- Nederlandse, Engelse en Poolse medewerkerweergave; mobiel zonder horizontale
  overflow. Geen JavaScript-paginafouten.
- Een tweede, onafhankelijk ingelogde interne sessie kan een nieuwere revisie niet
  overschrijven. Het scherm toont een conflict en behoudt de eigen invoer;
  de server retourneert HTTP 409 met `PT409`.
- Een echt medewerker-JWT krijgt HTTP 403 op de interne classificatiefunctie.

De finale run `20260908-gate-r4` eindigde met `business-flow-passed` (één volledige
Playwright-test, 19,1 seconden). De eerdere pogingen blijven in de bewijsmap
bewaard: zij vonden een race bij matrixopslag en een hangende HTTP-aanvraag bij
een oude revisie. Beide fouten zijn gerepareerd en in de finale run gecontroleerd.
De gerichte HTTP-conflictproef retourneerde daarnaast binnen 154 ms en vergeleek
het volledige dagrecord vóór en na de afgewezen write.

## Afbakening en teststatus

De daadwerkelijke SaaS-admin-browsertest van de UIT/AAN-cyclus is **nog niet
uitgevoerd**. Het bestaande QA-account is bewust geblokkeerd en inactief; Kas is
gevraagd om tijdelijke activatie, en het account is ongewijzigd. De schakelaar,
autorisatie, isolatie, behoud van historie en gelijktijdige writes zijn wel met
unit- en echte databasetests gecontroleerd. Live staat JA Werkt UIT en demo AAN.

Er zijn geen berichten of betaalde AI-calls uitgevoerd. De tijdelijke
communicatiepauze van demo is na afloop teruggezet naar de oorspronkelijke
instelling. Synthetische dossiers blijven herkenbaar bewaard voor een vervolgtest.
Dit verslag dekt de huidige weekcontrole/matrix/classificatie, niet de toekomstige
OCR-inname, automatische mailplanning, volledige weekregels of payroll-export.

Volledige lokale kwaliteitscontrole: **1.429 applicatietests**, **106 echte
PostgreSQL-tests**, lint zonder errors, typecheck, productiebuild en Deno-controle
geslaagd. De vijf bronmigraties zijn in de databaseproef ieder tweemaal toegepast.

## Opnieuw uitvoeren

Gebruik `scripts/prepare-hours-demo.mjs seed` met een unieke `HOURS_DEMO_RUN_ID`
en een absoluut `HOURS_DEMO_FIXTURE_PATH`. Deze helper controleert de demo-identiteit
en bewaart de oorspronkelijke communicatie-instelling. Laad `.env` en `.env.local`
via Node `--env-file`; zet nooit wachtwoorden of sessies in commando's of bewijsbestanden.

Start Vite op `http://127.0.0.1:8083` met de gecontroleerde projectconfiguratie.
Voer `scripts/e2e-hours-demo.spec.ts` uit met
`scripts/playwright.hours-demo.config.ts`, `HOURS_DEMO_FIXTURE` naar datzelfde
fixturebestand en `HOURS_DEMO_EVIDENCE_DIR` naar een afzonderlijke bewijsmap.
Zet `HOURS_DEMO_LIVE_READY=1` pas nadat schema, gates en edge-deployment gecontroleerd
zijn; zonder die expliciete gereedmelding worden de verbonden tests overgeslagen.
Zolang het SaaS-QA-account geblokkeerd is, vereist de businessrun
`HOURS_DEMO_SKIP_SUPERADMIN=1`; de rapportage blijft dan expliciet gedeeltelijk.
Na toestemming en tijdelijke activatie kan `HOURS_DEMO_TOGGLE_ONLY=1` de bestaande
bewezen fixture gebruiken; herstel daarna de oorspronkelijke accountblokkering.
Bij een nieuwe bewijsmap wijst `HOURS_DEMO_BUSINESS_RESULT` naar de eerder geslaagde
`result.json`, zodat die oorspronkelijke businessrun behouden blijft.

Herstel na QA de demo-communicatie met
`scripts/prepare-hours-demo.mjs restore-communications` en hetzelfde
`HOURS_DEMO_FIXTURE_PATH`. Sluit eigen browsers en devserver. Verwijder geen
bestaande of historische uren om de omgeving terug te zetten.

De bewijsmap van deze run staat lokaal onder
`/Users/kas/.codex/visualizations/2026/09/07/01a07bd6-9fd4-7440-a463-9fc32ece3f91/JA-Werkt-urenmodule/bouw/`:
`demo-connected-qa/result.json`, de schermafbeeldingen,
`module-gate-quality/final-vitest.json` en
`module-conflict-db-qa/final-conflict-db-qa-verification.json`.
