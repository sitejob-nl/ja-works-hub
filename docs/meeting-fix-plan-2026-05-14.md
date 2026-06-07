# 05-14 Fix Plan

Datum: 2026-05-14

Bronnen:

- `docs/meeting-open-points-2026-05-14.md`
- `docs/open-meeting-task-registry.md`
- `docs/meeting-coverage-qa-2026-05-14.md`

Doel: de 05-14 open punten terugbrengen tot een aantoonbaar acceptabele recruitment-/CRM-flow, zonder marketing- en partnerportal-scope onbedoeld in de go-live mee te trekken.

## Prioriteiten

| Prioriteit | Registry IDs | Waarom eerst |
|---|---|---|
| P0 Besluiten en dataveiligheid | `0514-EXACT-SCOPE`, `0514-DATA-SSOT` | Zonder scopebesluit en schone Carerix-data blijft acceptatie vaag. |
| P1 Productie-import en kernflow | `0514-CRTODO`, `0514-VACANCY-TEMPLATE`, `0514-SKILL-MATCH`, `0514-SEARCH` | Dit raakt de dagelijkse workflow vacature -> match -> plaatsing. |
| P2 Recruiter ergonomie | `0514-URGENCY`, `0514-PROPOSAL`, `0514-SCREENING`, `0514-NAVSTATE` | Verlaagt frictie voor Tony/Bram en maakt demo/acceptatie overtuigend. |
| P3 Inbound funnel | `0514-INTAKE`, `0514-BULK-NOTIFY`, `0514-EMAIL-TRIAGE` | Belangrijk voor groei, maar bouwt op P1/P2 en communicatie-infra. |
| P4 Nieuwe portals/marketing | `0514-PARTNER`, `0514-MARKETING` | Grote product-scope; eerst apart akkoord op scope, budget en privacy. |

## Fase 0 - Scope Lock En Acceptatiebasis

Deliverables:

- Leg vast of Exact voor deze iteratie **geparkeerd** wordt of als bestaande module apart wordt geaccepteerd.
- Zet een tijdelijke import-freeze afspraak op: geen handmatige bulkimports tijdens Carerix cleanup/validatie.
- Maak een acceptance checklist met concrete tellingen en steekproeven: kandidaten, vacatures, plaatsingen, matches, notities, documenten.
- Leg testdata-cleanup regels vast: wat mag verwijderd, wat moet historisch blijven, en welke records zijn "test".

Acceptatie:

- Scopebesluit staat in `docs/open-meeting-task-registry.md` bij `0514-EXACT-SCOPE`.
- Carerix acceptance checklist kan draaien zonder productiedata te wijzigen.
- Projectteam weet welke datasets bevroren zijn tijdens validatie.

## Fase 1 - Carerix SSOT En Historie

Status 2026-05-19: eerste code-implementatie gestart. `CRTodo` splitst in de live runner naar notes of `recruiter_tasks`, met type/status/datummetadata voor meetings/e-mails; aparte `CRNote`-records worden ook naar gekoppelde notes geïmporteerd. Productiedata-steekproef en cleanup-rapportage blijven open.

Deliverables:

- Breid de live Carerix runner uit zodat `CRTodo` wordt gesplitst in:
  - interne notities voor echte historische notities;
  - `recruiter_tasks` voor taken/deadlines;
  - note metadata voor meetings/e-mails wanneer geen aparte activity-entiteit bestaat.
- Importeer aparte `CRNote`-records naar dezelfde notes-tabel en koppel ze aan kandidaat, opdrachtgever, match, vacature of contact op basis van de Carerix parent-referentie.
- Bewaar Carerix bronmetadata genoeg om later te kunnen herleiden: raw type, datum, subject, parent entity en external mapping.
- Voeg validatie toe voor historische relaties: plaatsing -> kandidaat -> opdrachtgever -> vacature.
- Maak een read-only rapport voor duplicaten, test-vacatures en verdachte relationele koppelingen.

Acceptatie:

- Ovidiu Sarp-achtige kandidaat-steekproef toont oude afspraken/notities in het kandidaatprofiel.
- Geen historische plaatsingen verdwijnen bij deduplicatie of cleanup.
- Verdachte werkgever/matchrelaties worden gerapporteerd in plaats van stil overschreven.

## Fase 2 - Vacature Naar Match

Status 2026-05-19: eerste code-implementatie gestart. Vacature-aanmaak/-bewerken erft functiebeschrijving, opdrachtgeverlocatie, tarief en skills; de matchtab filtert en sorteert kandidaatshortlists nu op vacature-eisen; vacature- en matchpipeline zoeken richt zich nu op functietitel + opdrachtgever. Browser/API-regressies blijven open.

Deliverables:

- Maak vacature-aanmaak sterker vanuit `company_functions`:
  - naam, beschrijving, salarisrange en skills overnemen;
  - default werklocatie tonen met expliciete afwijkende werklocatie;
  - tariefbesluit afdwingen: verplicht tarief kiezen/invullen of bewust "later aanvullen".
- Verander de matchtab van naamzoeker naar skill-first kandidaatlijst:
  - bereken simpele lokale matchscore op skills/certificaten;
  - sorteer beste kandidaten bovenaan;
  - laat niet-matchende kandidaten alleen via expliciete zoekactie zien.
- Corrigeer vacature-/matchfilters naar functietitel + opdrachtgever en voeg een regressietest toe voor de 05-14 zoekbug.

Acceptatie:

- Nieuwe functie bij opdrachtgever -> nieuwe vacature toont de geerfde defaults zonder handmatig kopieren.
- Vacature met skillset toont passende kandidaat bovenaan, en kandidaat zonder skills niet als topresultaat.
- Matchscore en status blijven correct opgeslagen na drag/drop.

## Fase 3 - Recruiter Werkcomfort

Status 2026-05-19: eerste code-implementatie gestart. Workbench toont urgente open vacatures met bezettingsgat, ouderdom en opdrachtgever; kandidaatvoorstelmail gebruikt org-branding plus AI-rapportvelden; screeningtab toont ontbrekende kernvelden, callvragen en kan opvolgtaken aanmaken; detailtabs bewaren `?tab=` voor kandidaat, vacature, opdrachtgever, voertuig en pand. Browservalidatie blijft open.

Deliverables:

- Voeg urgentiesignalen toe aan dashboard/workbench: open vacatures met urgentie hoog, ouderdom en benodigde aantallen.
- Maak kandidaatvoorstel e-mail org-branded:
  - JA Werkt/org-logo en afzendergegevens;
  - AI-samenvatting/rapport in preview;
  - fallback als AI-rapport ontbreekt.
- Maak screening-call ondersteuning:
  - ontbrekende kernvelden tonen;
  - AI-interviewvragen tonen;
  - opvolgtaak kunnen maken vanuit checklist.
- Bewaar tabstate via queryparams voor belangrijkste detailpagina's: vacature, opdrachtgever, kandidaat, pand en voertuig.

Acceptatie:

- Recruiter kan vanuit workbench direct naar urgente vacature en bij terugkeer dezelfde context behouden.
- Voorstelmail preview toont juiste branding en kandidaatrapport.
- Screeningchecklist leidt tot concrete taak of afgeronde checklist-status.

## Fase 4 - Inbound En Communicatie

Status 2026-06-05: code gedeployed en intake production-smoke gevalideerd. Publieke `/solliciteren/:slug` intake valideert `candidate_signup_links`, vereist CV-upload en zet kandidaten als `lead` klaar met recruiter-taak/notificatie; leadpromotie werkt op het bestaande kandidaatrecord met besluitnotitie en sluit intake-opvolgtaken. Matchpipeline gebruikt `match-bulk-notify` voor portal/appmeldingen, e-mailrecords en WhatsApp-concepten met voorkeuren, duplicaatguard en communicatiepauze. Outlook inbox toont triage voor CV/klantvraag/partner/ruis en maakt taken/communicatie-records op bevestiging. Echte kanaalverzending blijft een apart kanaalbesluit.

Deliverables:

- Bouw centrale publieke intake op basis van `candidate_signup_links`:
  - verplichte CV-upload;
  - bron/source-tag;
  - leadstatus of afgeschermde reviewstatus;
  - AI CV-analyse trigger na upload;
  - recruiter-notificatie of taak.
- Voeg bulkactie toe in matchpipeline: geselecteerde kandidaten mailen/WhatsAppen/app-notificeren.
- Start AI e-mail triage klein:
  - classificeer inboxitems als CV, klantvraag, partner, spam/ruis;
  - maak reviewlabel of taak;
  - koppel kandidaat/bedrijf alleen bij hoge zekerheid.

Acceptatie:

- Publieke kandidaat vult formulier in met CV en verschijnt als lead/reviewitem.
- Recruiter kan lead promoveren naar kandidaat zonder dubbel record.
- Bulknotificatie maakt communicatie-records en respecteert kanaalvoorkeur/rate limiting.
- Mailtriage doet niets destructiefs zonder menselijke bevestiging.

## Fase 5 - Apart Scopebesluit

Niet combineren met bovenstaande fases zonder expliciet akkoord:

- Partnerportaal voor externe bureaus.
- Meta/Facebook Ads Library koppeling.
- Higgsfield/video-generatie.
- Automatisch publiceren en optimaliseren van advertentiecampagnes.

Benodigd besluit:

- Wie is eigenaar van partnerrelaties en marketingcontent?
- Welke data mag naar externe AI/marketing APIs?
- Wat is het maandbudget en wie keurt publicatie goed?

## Testplan

- `npm run typecheck`
- `npm run build`
- `npm run test`
- `npm run test:e2e:meeting`
- Gerichte Playwright-specs toevoegen voor:
  - Carerix notities/taken steekproef;
  - vacature-template defaults;
  - skill-based matchlijst;
  - urgentie-workbench;
  - voorstelmail preview;
  - publieke intakeflow;
  - tabstate regressies.
- Muterende full-flow alleen op testorganisatie/staging met `E2E_ALLOW_MUTATING_WORKFLOWS=true`.

## Volgorde Voor Implementatie

1. **Dag 1:** scope lock, acceptance checklist, Exact-besluit, data-freeze afspraak.
2. **Dag 2-4:** Carerix `CRTodo` split, SSOT rapportage, historische steekproeven.
3. **Dag 5-7:** vacature-template defaults, search fix, skill-first matchtab.
4. **Dag 8-10:** urgentie-workbench, voorstelmail branding, screeningchecklist, tabstate.
5. **Dag 11-15:** intake funnel, bulknotificaties en minimale mailtriage.
6. **Na akkoord:** partnerportaal en marketing automation als aparte epic.

## Done Definitie

Een 05-14 item is pas gesloten wanneer:

- het bijbehorende `0514-*` registry item een eigenaar en status heeft;
- er een concrete test of acceptatiecheck staat;
- bestaande data niet stilzwijgend is gemuteerd zonder rapportage;
- de gebruikerflow in browser of API bewijsbaar werkt;
- eventuele scopekeuzes expliciet zijn vastgelegd.
