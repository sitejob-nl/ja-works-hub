# 05-14 Openstaande Punten Analyse

Datum: 2026-05-14

Bronnen:

- `Meetings/05-14 Samenvatting_ CRM_ATS Software-ontwikkeling & Systeemmigratie-Summary.md`
- `Meetings/05-14 Samenvatting_ CRM_ATS Software-ontwikkeling & Systeemmigratie-transcript.txt`
- `Meetings/05-14 Systeemanalyse_ Ontwikkeling Recruitmentsoftware en Workflows-Summary.md`
- `Meetings/05-14 Systeemanalyse_ Ontwikkeling Recruitmentsoftware en Workflows-transcript.txt`

Disposition: **REVISE**. De basis van CRM, vacatures, matching, AI CV-analyse, Outlook, portals en Carerix-import bestaat, maar meerdere 05-14 meetingpunten zijn nog niet end-to-end bewezen of missen de besproken workflowlaag.

## Openstaande Punten

| Spoor | Besproken wens | Huidige status | Openstaand werk |
|---|---|---|---|
| Data cleanup / Carerix SSOT | Import bevriezen, deduplicatie, test-vacatures opschonen en foutieve historische koppelingen corrigeren. | Carerix-import en acceptatiechecks bestaan, maar productieacceptatie blijft apart open. | Maak een expliciete cleanup/acceptatie-run met rapportage voor dubbele bedrijven/kandidaten, test-vacatures en foutieve werkgever/matchrelaties. |
| Carerix notities/taken | Historische notities en afspraken exact behouden, zonder verwarring met systeemactiviteiten. | Live runner splitst `CRTodo` naar notes/tasks en importeert aparte `CRNote`-records naar gekoppelde notes; productie-inhoud is nog niet steekproefsgewijs bewezen. | Valideer met Ovidiu Sarp-achtige cases dat echte notities, afspraken en taken compleet en op de juiste kandidaat/parent staan. |
| Vacature vanuit functie-template | Functieprofiel moet beschrijving, salarisindicatie, skills en locatie-defaults doorgeven aan vacature. | Functie, salarisrange en skills worden deels overgenomen. | Beschrijving/default locatie meenemen, afwijkende werklocatie expliciet maken en tariefkoppeling functioneel afdwingen of bewust loslaten. |
| Skill-based matching | Recruiter werkt vanuit vacature; database wordt automatisch gefilterd op functie-skills. | Matchpipeline bestaat, maar kandidaatzoeken in vacature-tab filtert vooral op status/naam. | Kandidaatlijst scoren/filteren op vacature-skills voordat de recruiter handmatig een nieuwe match maakt. |
| Urgentie-dashboard | Tony/Bram moeten direct zien welke vacatures "gas erop" zijn. | Urgentieveld en badges bestaan. | Centraal team-dashboard of workbench-signaal maken/bevestigen voor urgente open vacatures. |
| Recruitment intake funnel | Alle inbound kandidaten via centraal formulier met verplichte CV-upload, leadstatus, AI-triage en recruiter-notificatie. | Candidate profile tokens en signup-link schema bestaan, maar geen bewezen publieke leadfunnel. | Publieke intake-route of webhook flow bouwen, CV-upload verplicht maken, leadstatus/routering toevoegen en AI-triage triggeren. |
| Partnerportaal | Externe bureaus moeten kandidaten invoeren en eigen statussen volgen. | Als missing feature genoteerd; klantportaal is voor opdrachtgevers, niet voor recruiters/bureaus. | Afgeschermd partnerportaal/RBAC ontwerpen en bouwen met bronisolatie per bureau. |
| Bulk kandidaat-notificaties | Vanuit nieuwe matches meerdere kandidaten tegelijk mailen/app-notificeren. | Campaigns/WhatsApp bestaan los, matchtab heeft geen bulk kandidaatactie. | Selectie-acties in vacancy matches toevoegen en koppelen aan e-mail/WhatsApp/app-notificatiekanaal. |
| Kandidaat voorstellen | One-click kandidaatvoorstel met AI-rapport en bedrijfslogo. | Voorstelmail bestaat, maar generieke branding en beperkte rapportinhoud. | JA Werkt/org-branding toepassen, AI-rapportinhoud valideren en preview/testbewijs toevoegen. |
| Screening-call ondersteuning | Tijdens screening ontbrekende data en te stellen vragen zichtbaar maken. | AI-analyse bevat interviewvragen; geen duidelijke call-checklist in de screeningflow. | Screeningchecklist koppelen aan kandidaat/vacature, ontbrekende velden tonen en opvolgtaken vastleggen. |
| Navigatiestate | Terugkeren naar detailpagina moet tab/view behouden. | Alleen sommige lijsten gebruiken queryparams; veel detailtabs hebben `defaultValue`. | Tabs/query-state standaardiseren voor vacature, opdrachtgever, kandidaat, voertuig en pand details. |
| Zoek/functiefilters | Zoeken/filteren moet draaien om functietitel en opdrachtgever, niet verkeerde bedrijfsnaamlogica. | Meerdere zoekschermen bestaan, maar 05-14 bug is niet als acceptatiecase vastgelegd. | Reproduceerbare QA-case maken en filters corrigeren waar vacature/matchoverzichten verkeerde entiteit zoeken. |
| E-mail triage | Inkomende mail/CV's/klantvragen automatisch classificeren en routeren. | Outlook UI en rechtenlaag bestaan; triage staat al als open gap. | AI-classificatie + assignment + reviewstate bovenop Graph-mailboxen bouwen. |
| Marketing automation | Meta Ads Library, Higgsfield-video, campagnepublicatie en performance feedbackloop. | WhatsApp/e-mail campaigns bestaan; Meta/Higgsfield workflow ontbreekt. | Als Fase 2/3 scopebesluit behandelen; eerst APIs, ownership en privacy/costs vastleggen. |
| Exact scopebesluit | 05-14 noemt Exact out-of-scope, terwijl bestaande app Exact-schermen heeft. | Exact config/UI bestaat, maar echte data-sync is nog niet operationeel bewezen. | Besluit vastleggen: tijdelijk buiten scope parkeren of expliciet accepteren als bestaande module met aparte acceptatie. |

## Bijna Afgedekt

- KVK-zoekveld bij opdrachtgever-aanmaak.
- Basis company-functions met salarisrange en skills.
- Vacature-urgentie, matchkolommen, drag/drop en AI-matchscore.
- AI CV-analyse en handmatige overname van skills naar kandidaatprofiel.
- Outlook mail UI, accountrechten en handtekeningbeheer.
- Medewerkerportaal en klantportaal routes.
- Beëindigingsredenenbeheer, met kanttekening dat 05-14 soft-delete/ID-stabiliteit noemt terwijl hard delete nog in de UI zit.

## Decision Log

- "Open" betekent: besproken op 05-14 en niet end-to-end bewezen of niet volledig volgens de besproken nuance aanwezig.
- Gedeeltelijke implementatie telt niet als gesloten wanneer de meeting een extra workflowlaag vraagt.
- Marketing automation en partnerportaal blijven open punten, maar zijn geen automatische go-live blocker zonder apart scopebesluit.
- Exact blijft een scope-conflict totdat klant/project expliciet kiest tussen "bestaande module apart accepteren" of "voor deze iteratie parkeren".
