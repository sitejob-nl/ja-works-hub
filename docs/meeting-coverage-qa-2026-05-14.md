# Meeting Coverage QA - JA Werkt / VDS

Datum: 2026-05-14

## Bronnen

- `Meetings/Review 30 april.docx`
- `Meetings/04-30 Aangepast Scenario_ Ontwikkeling Softwaremodule Tankpascontrole-transcript.txt`
- `Meetings/04-30 Aangepast Scenario_ Ontwikkeling Softwaremodule Tankpascontrole-Summary.md`
- `/Users/kas/Downloads/05-07 Systeemanalyse_ Geintegreerd Beheersysteem en Workflows-Requirements Summary.md`
- `/Users/kas/Downloads/05-07 Systeemanalyse_ Geintegreerd Beheersysteem en Workflows-transcript.txt`

## Browserbewijs

Nieuwe browsercoverage: `scripts/e2e-meeting-coverage.spec.ts`

Uitgevoerd:

- `npm run test:e2e:meeting`
- `HEADED=1 npm run test:e2e:meeting`

Resultaat headed browserrun: `5 passed`.

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
- `/portaal/login` en `/klantportaal/login`: portaalroutes renderen.

Playwright hangt screenshots aan de testrun voor elk hoofdblok.

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
