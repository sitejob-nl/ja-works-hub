# Meeting Coverage QA - JA Werkt / VDS

Datum: 2026-05-14

## Bronnen

- `Meetings/Review 30 april.docx`
- `Meetings/04-30 Aangepast Scenario_ Ontwikkeling Softwaremodule Tankpascontrole-transcript.txt`
- `Meetings/04-30 Aangepast Scenario_ Ontwikkeling Softwaremodule Tankpascontrole-Summary.md`
- `Meetings/05-14 Samenvatting_ CRM_ATS Software-ontwikkeling & Systeemmigratie-Summary.md`
- `Meetings/05-14 Samenvatting_ CRM_ATS Software-ontwikkeling & Systeemmigratie-transcript.txt`
- `Meetings/05-14 Systeemanalyse_ Ontwikkeling Recruitmentsoftware en Workflows-Summary.md`
- `Meetings/05-14 Systeemanalyse_ Ontwikkeling Recruitmentsoftware en Workflows-transcript.txt`
- `/Users/kas/Downloads/05-07 Systeemanalyse_ Geintegreerd Beheersysteem en Workflows-Requirements Summary.md`
- `/Users/kas/Downloads/05-07 Systeemanalyse_ Geintegreerd Beheersysteem en Workflows-transcript.txt`

## 05-14 Recruitment / CRM open punten

Zie `docs/meeting-open-points-2026-05-14.md` voor de volledige inventaris. Deze punten zijn besproken op 05-14 maar nog niet als volledig gesloten of end-to-end bewezen gemarkeerd:

- Data cleanup / Carerix SSOT, inclusief deduplicatie, test-vacature cleanup en foutieve historische koppelingen.
- Live Carerix `CRTodo` split naar notities, taken, meetings/e-mails en behoud van historische afspraken.
- Vacature-aanmaak vanuit functie-template met volledige beschrijving/default locatie/tariefkoppeling.
- Skill-based kandidaatfiltering vanuit vacature vóór handmatige "Nieuwe match".
- Urgentie-dashboard of workbench-signaal voor hoge-prioriteit vacatures.
- Centrale recruitment intake funnel met verplichte CV-upload, leadstatus, AI-triage en recruiter-notificatie: gedeployed en production-smoke gevalideerd; lead-promotie acceptatie blijft open.
- Partnerportaal voor externe recruiters/bureaus.
- Bulk kandidaatnotificaties vanuit matchpipeline: code aanwezig, dataflow nog niet staging-bewezen.
- Kandidaatvoorstel met JA Werkt/org-branding en gevalideerde AI-rapportinhoud.
- Screening-call checklist voor ontbrekende data en AI-interviewvragen.
- Navigatiestate bij detailtabs en terugkeren naar vorige context.
- Zoek-/functiefilters op functietitel en opdrachtgever.
- AI e-mail triage bovenop Outlook: code aanwezig, echte mailbox-steekproef nog open.
- Meta/Higgsfield marketing automation.
- Exact scopebesluit: 05-14 noemt Exact out-of-scope, terwijl de bestaande module apart acceptatiebewijs vraagt.

## Browserbewijs

Nieuwe browsercoverage: `scripts/e2e-meeting-coverage.spec.ts`
Gerichte Fase 1 acceptatiecoverage: `scripts/e2e-phase1-acceptance.spec.ts`

Uitgevoerd:

- `npm run test:e2e:meeting`
- `HEADED=1 npm run test:e2e:meeting`
- `npx playwright test --config=scripts/playwright.config.ts e2e-phase1-acceptance.spec.ts` zonder mutatieflag: `2 skipped` als veilige compile/smoke-check.

Laatste resultaat na de 05-14 P3-slice: `6 passed`.

Remote deploycheck 2026-05-19:

- Supabase migraties `20260519123000_0514_recruitment_intake_leads.sql` en `20260519123100_0514_recruitment_intake_indexes.sql` gepusht naar `Ja Werkt - ERP`.
- Edge function `candidate-signup` gedeployed op project `noaupcteygfvlyymqtew`.
- Read-only smoke op onbekende slug geeft gecontroleerd `valid=false`, `reason=not_found`.
- Vercel productie gedeployed en gealiased naar `https://ja-works-hub.vercel.app`.
- Production UI smoke via `/solliciteren/codex-smoke-final-20260519-1452` aangemaakt: kandidaat `f86d612a-3909-432c-808f-e92ceee05570`, status `lead`, `documents=1`, `tasks=1`, `notifications=1`, `current_signups=1`.
- Tijdelijke smoke-links zijn na validatie gedeactiveerd.

De spec opent en controleert in Chromium:

- `/tankpas-analyse`: tab `Voorwaarden`, tankcapaciteit, verbruik, kilometerregels.
- `/kilometeranalyse`: fiscale kilometeranalyse als signalering met marge/private-km context.
- `/transport`: deuren, tankpas, notitie in overzicht.
- `/transport/:id`: aantal deuren, boetes, schade en foto/bewijsvelden.
- `/huisvesting`: woonplaats, straat, kosten/bezetting en export.
- `/huisvesting/:id`: kamers, kosten, schoonmaak, contracten, eigenaar, inhuur/onderhuur en notities.
- `/instellingen`: Exact, Outlook, verjaardagen/punten/rewards en contracttemplates.
- `/exact-online`: relaties, facturen en artikelen.
- `/email`: mailroute en mailboxstaat.
- `/solliciteren/:slug`: publieke intake-route toont veilige ongeldig/gesloten/verlopen staat zonder login.
- `/match-pipeline`: bulkselectie/notificatie-actie is zichtbaar.
- `/portaal/login` en `/klantportaal/login`: portaalroutes renderen.

Playwright hangt screenshots aan de testrun voor elk hoofdblok.

De gerichte Fase 1 acceptatiespec bewijst, wanneer bewust gedraaid met `E2E_ALLOW_MUTATING_WORKFLOWS=true` en testcredentials:

- Mobiele echte tokenflow voor `/profiel/:token`: kandidaat opent Pixel 5 viewport, vult gegevens/skills/certificaten/CV in, ziet successcherm, en de kandidaatrij wordt via REST gecontroleerd.
- Mobiele echte tokenflow voor `/onboarding/:token`: kandidaat opent Pixel 5 viewport, vult fallback-onboarding in, accepteert reglement, ziet successcherm, en `onboarding_tokens.used_at` wordt gecontroleerd.
- Vacaturegestuurde matching: testdata bevat één passende en één niet-passende kandidaat; de vacaturematchtab toont de passende kandidaat met `100% match`, verbergt de niet-passende kandidaat, maakt een match aan en controleert dat score/onderbouwing opgeslagen zichtbaar kan worden.

## Technische fixes uit QA-review

- Birthday-cron gebruikt nu het meegegeven datumargument bij Amsterdam-datumconversie. Dit fixeert de vorige-dag fallback bij cronruns rond middernacht.
- Carerix CV-bijlagen worden als `cv` gemapt in plaats van `overig`.
- Recent items bar gebruikt geen geneste buttons meer, waardoor React DOM-nesting warnings verdwijnen.
- Muterende full-workflow E2E is beveiligd met `E2E_ALLOW_MUTATING_WORKFLOWS=true`, zodat productie niet per ongeluk testdata krijgt.

## Productiedata-check

Read-only Supabase query op linked project:

| Metric | Waarde |
|---|---:|
| Kandidaten | 2020 |
| Plaatsingen | 587 |
| Vacatures | 686 |
| Voertuigen | 47 |
| Schademeldingen | 14 |
| Boetes | 8 |
| Actieve contracttemplates | 6 |
| Gefaalde mail accounts | 1 |
| Actieve Exact config | 1 |

Eerdere datakwaliteitscheck voertuigen:

| Metric | Waarde |
|---|---:|
| Voertuigen zonder tankpasreferentie | 43 |
| Voertuigen zonder tankcapaciteit | 21 |
| Voertuigen zonder verbruik | 19 |
| Voertuigen zonder kilometerstand | 19 |
| Voertuigen zonder deuren | 21 |
| Voertuigen zonder zitplaatsen | 25 |

## Status per meetingspoor

| Spoor | Technisch | Browser | Productieacceptatie |
|---|---|---|---|
| Tankpasvoorwaarden | Aanwezig | Groen | Nog afhankelijk van voertuigmasterdata. |
| Fiscale kilometeranalyse | Signalering aanwezig | Groen | Beleidskeuzes blijven nodig voor definitieve fiscale toepassing. |
| Fleet incidenten | Schade/boete/foto zichtbaar | Groen | 1 oude schademelding zonder foto blijft datakwaliteitspunt. |
| Deuren/notities voertuig | Aanwezig | Groen | Masterdata ontbreekt nog bij deel voertuigen. |
| Huisvesting kolommen/detail | Aanwezig | Groen | Kostenperspectief per kamer blijft klantkeuze. |
| Contracten inhuur/onderhuur | Aanwezig | Groen | Definitieve juridische teksten moeten klantdefinitief blijven. |
| Templates/signing | Templatebeheer aanwezig | Groen | 6 actieve templates, nog controleren tegen finale klantteksten. |
| Verjaardag/loyalty/shop MVP | Aanwezig | Groen via instellingen/portaalroute | Device-push hangt af van device-tokenkanaal. |
| Outlook | UI en rechtenlaag aanwezig | Groen | 1 mailaccount staat nog `failed`; shared mailbox moet opnieuw gekoppeld/getest. |
| Exact | Config en module aanwezig | Groen | Sync naar relaties/facturen nog niet operationeel bewezen met echte Exact-data. |
| Carerix migratie | Import/mapping aanwezig | Niet browser-mutatief getest | Plaatsingmapping 578 matchte verwachting; vacaturetelling blijft acceptatiepunt. |
| Portalen | Routes renderen | Groen | Muterende portalflows vereisen testaccounts/tokens op staging. |

## No-go Voor Volledige Go-live Acceptatie

- Voertuigmasterdata moet worden aangevuld voordat tankpas/verbruiksanalyse betrouwbaar is.
- Outlook shared mailbox moet uit `failed` en met read/send/delete rechtenmatrix worden geaccepteerd.
- Exact moet met echte administratiedata aantonen dat relaties/facturen/items worden gelezen of gesynchroniseerd.
- Vacaturetelling moet functioneel worden besloten: meetingverwachting 139 versus hogere technische importtelling.
- Volledige muterende E2E moet op testorganisatie/staging draaien met `E2E_ALLOW_MUTATING_WORKFLOWS=true` en de benodigde `TEST_*`/`E2E_*` credentials.
