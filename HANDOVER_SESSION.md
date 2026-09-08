# Session handover — 2026-09-08

Overdracht voor wie verdergaat (Codex / Claude Code). Lees [AGENTS.md](AGENTS.md) voor harde repo-conventies +
commands, [CLAUDE.md](CLAUDE.md) voor de canonieke codebase-diepte, [HANDOVER.md](HANDOVER.md) voor de formele
projectsamenvatting.

## Voorstellen uit Excel- en tabelbestanden — 8 september 2026 (`feat/urenmodule-excel-uitlezer`)

- Nieuwe duurzame worktree `/Users/kas/dev/ja-works-hub/.worktrees/urenmodule-excel-uitlezer`, branch
  `feat/urenmodule-excel-uitlezer`. **PR #266 (T2) was nog niet gemerged**, dus deze branch staat op
  `origin/feat/urenmodule-bronpaginas` — niet op `origin/main`, dat de T2-frontend nog mist. De stale
  hoofdcheckout en alle overige worktrees zijn ongemoeid gelaten.
- **T3 uit [docs/urenmodule-tickets.md](docs/urenmodule-tickets.md) is gebouwd** — voorstellen uit Excel-
  en tabelbestanden. Alle vijf acceptatiecriteria zijn afgevinkt. Zie de nieuwe sectie
  ["Excel- en tabelbestanden als bron (T3)"](docs/urenmodule-intake-contract.md#excel--en-tabelbestanden-als-bron-t3).
- **Wat er nu kan:** een `.xlsx`/`.xls` wordt als bron aanvaard (Storage, tabel-CHECK en de RPC kennen de
  twee mediatypen), het aantal werkbladen wordt als `page_count` vastgelegd, en de knop **Uitlezen** haalt
  het bewaarde origineel via een kortlopende link terug en leest het **deterministisch** uit. Twee
  indelingen worden herkend: een kruistabel (medewerkers onder elkaar, dagen als kolomkoppen) en een lijst
  (naam/datum/uren, één regel per medewerker/dag). Broncodes uit kolomkoppen (`OV1`…) blijven letterlijk
  staan. Het paneel toont per regel de vindplaats (`blad Week 37 · rij 3`), de gelezen duur, onzekere
  toewijzingen, niet-sluitende optellingen mét het verschil, en de regels waar met opzet niets van gemaakt
  is. De gekozen regels worden in één handeling als voorstellen vastgelegd.
- **De grens is ongewijzigd:** een werkblad is de pagina van dit formaat, dus alle paginaregels van T2
  gelden onveranderd (een beoordeelde bron eist een pagina, een tegensprekend paginabesluit forceert
  `assignment_uncertain`). Alleen `hours_apply_source_proposal` schrijft een dagrevisie. Nul writes naar
  `timesheets`, facturatie of communicatie; **nul betaalde AI-aanroepen** — de uitlezer is pure code.
- **Formules en macro's worden niet uitgevoerd.** De uitlezer leest uitsluitend het in het bestand
  bewaarde resultaat. Dat is bewezen met een echte in-memory `.xlsx` waarin de formule `4+5` een bewaard
  resultaat `7` heeft: de uitlezer geeft 7.
- Migratie `20260911090000_hours_spreadsheet_sources.sql` (SHA256
  `9551c620d76a2d01cd854d35c586fa4acb5f47ada8f5c9f760d44f15c50bea33`) is op 8 september toegepast; de
  bronversie is in dezelfde transactie in `schema_migrations` geregistreerd. Additief: bucket-mediatypen,
  één CHECK, één gewijzigde en één nieuwe RPC. Live types hergenereerd (+4 regels).
  **Geen edge-function-deploy nodig.**
- Verificatie: **157 echte PostgreSQL-tests** (`scripts/hours-workbook-db-test.py` — 12 nieuwe
  werkmapgevallen plus de volledige vrijgegeven pagina-/inname-/foundation-/classificatie-/poortregressies,
  elf migraties elk tweemaal); **1.526 applicatietests**; lint 0 errors, typecheck en productiebuild groen.
  De vrijgegeven harnassen zijn ongewijzigd gelaten; de nieuwe importeert `hours-pages-db-test.py` en
  overschrijft alleen de twee verwachtingen die echt bewogen (bucket-mediatypen, RPC-signaturen).
- **JA Werkt blijft UIT, demo AAN** — vóór de migratie geverifieerd. Het geblokkeerde `QA_SUPERADMIN`-account
  is ongemoeid gelaten. Advisors na DDL: geen ERROR-bevindingen; de nieuwe RPC valt in dezelfde bewuste
  WARN-categorie "SECURITY DEFINER uitvoerbaar door authenticated" als alle bestaande urenfuncties.
- **Vijf codereviewrondes vonden eenentwintig echte defecten, allemaal gerepareerd** met een test die eerst
  rood stond. Ronde 1 (zeven): kolomkoppen op voorvoegsel matchen ("Aantal dagen" won het urentotaal, een
  1 werd een uur); een als tijd opgemaakte cel die als datum werd gelezen waardoor een heel lijstblad stil
  verdween; een tijd-nul zonder reden die de hele uitlezing liet weigeren; dubbele dagen die de server
  weigerde en in het scherm niet los te vinken waren; een opmerkingenkolom die de hele regel liet
  vervallen; een negatief getal dat een reden werd; en de ontbrekende client-side bovengrens van
  vijfhonderd. Ronde 2 (vijf): een periode-banner boven de tabel die als dagkop werd genomen (dinsdag
  verdween, woensdag landde op zondag); een tijdwaarde boven 24 uur die modulo 24 werd afgekapt (40:00 →
  16:00); een lijstblad met een tweede datumkolom dat als kruistabel werd gelezen; elke ongenoemde
  getallenkolom die een uurindeling werd (een uurloon van 15,5 werd 930 minuten); en nul uren met
  brongegevens, een combinatie die de servercontrole nooit kan afhandelen. Ronde 3 (drie): de
  verstreken-tijdnotatie `[h]:mm` komt als kale breuk van een dag binnen en werd als decimaal gelezen
  (12:00 → 0:30, een weektotaal van 36:00 → 1:30) — waar beide lezingen passen weigert de uitlezer nu te
  kiezen; één nul in een broncodekolom liet de hele indeling van het blad vervallen; en een streepje in
  een dagcel werd de letterlijke reden voor "geen uren", vooraf aangevinkt. De testhulp schrijft nu ook
  getalnotaties, zodat het echte bestandspad — waar bevinding 1 zat — meetest. Ronde 4 (vier): een
  eindtotaalregel onderaan een blad nam de aangeleverde broncodes weg uit álle voorstellen; een werkblad
  met een onbekende indeling verdween zonder één woord; dezelfde broncode tweemaal werd niet gemeld
  terwijl handmatige invoer daar wél voor waarschuwt (de uitlezer gebruikt nu letterlijk dezelfde
  controle); en een tabel die buiten de week reikte meldde een weektotaalverschil dat het bestand niet
  had. De vijfde bevinding uit die ronde is **bewust gedrag**: een kolom die maar een deel van de dag
  beschrijft telt per definitie niet op tot het dagtotaal, en juist dat verschil vraagt de
  klantspecificatie te tonen. Ronde 5 (twee): een banner waarvan de datums wél naast elkaar stonden werd
  alsnog als dagkop genomen (maandag landde op dinsdag) — de dagenrij moet nu direct boven de medewerkers
  staan; en één streepje of dubbelzinnig getal onder een broncodekolom liet die kolom voor het hele blad
  vervallen, zonder melding. De derde bevinding van die ronde is dezelfde bewuste ontwerpkeuze.
- **Nog open:** verbonden demo-QA in de browser is voor dit ticket **niet** uitgevoerd — de vier
  `pages`-QA-weken staan klaar (`scripts/prepare-hours-pages-demo.mjs`, dezelfde `HOURS_PAGES_RUN_ID`
  hergebruiken). PR #266 (T2) moet nog gemerged worden vóór deze branch.

## Bronpagina's en gecontroleerde toewijzing — 8 september 2026 (`feat/urenmodule-bronpaginas`)

- Nieuwe duurzame worktree `/Users/kas/dev/ja-works-hub/.worktrees/urenmodule-bronpaginas`, branch
  `feat/urenmodule-bronpaginas` vanaf actuele `origin/main` `95ee94e` (de gemergde T1-release #265). De
  stale hoofdcheckout en alle overige worktrees zijn ongemoeid gelaten.
- **T2 uit [docs/urenmodule-tickets.md](docs/urenmodule-tickets.md) is gebouwd** — bronpagina's en
  gecontroleerde toewijzing bij meerdere medewerkers in één bestand. Alle vijf acceptatiecriteria zijn
  afgevinkt en met echte databasetests én verbonden demo-QA bewezen. Zie de nieuwe sectie
  ["Pagina's en gecontroleerde toewijzing (T2)"](docs/urenmodule-intake-contract.md#paginas-en-gecontroleerde-toewijzing-t2)
  in het innamecontract.
- **Wat er nu kan:** een bron legt zijn paginaaantal vast (de browser telt een PDF met pdf.js; een foto is
  één pagina; een onleesbaar bestand blijft eerlijk onbekend). Per pagina legt een interne gebruiker vast
  of er **één medewerker**, **meerdere medewerkers** of **onduidelijk wie** op staat — append-only met
  actor, een vergissing wordt vervangen en niet herschreven. "Eén medewerker" wordt geweigerd zodra die
  pagina aantoonbaar voorstellen voor meerdere medewerkers draagt. Een pagina die op één naam staat kan in
  één handeling worden overgenomen, maar die verkorte route kan per constructie alleen dagen van precies
  die medewerker raken. Een voorstel kan expliciet "toewijzing onzeker" zijn (een onduidelijke pagina
  forceert dat); toepassen is dan geblokkeerd tot een met naam bekende interne gebruiker bevestigt.
- **De grens is ongewijzigd:** een bron, een paginabesluit en een voorstel zijn geen uren. Alleen
  `hours_apply_source_proposal` schrijft een dagrevisie en neemt het voorstel letterlijk over. Nul writes
  naar `timesheets`, facturatie of communicatie — na afloop in productie geverifieerd.
- Migratie `20260910090000_hours_source_pages_and_assignment.sql` (SHA256
  `8bc39109c66b828dd5aad088db1308d8100b381de9a92c5a04323314e49943c5`) is op 8 september toegepast; de
  bronversie is in dezelfde transactie in `schema_migrations` geregistreerd. Additief: één nieuwe tabel
  (`hours_source_pages`), vier nieuwe kolommen op `hours_source_proposals`, één op `hours_week_sources`,
  drie nieuwe RPC's en twee gewijzigde. Live types hergenereerd (+130 regels).
  **Geen edge-function-deploy nodig.**
- **Uitrolvolgorde is veilig:** de twee gewijzigde RPC's kregen hun nieuwe parameters *met een default*,
  zodat de nog draaiende frontend tussen migratie en merge blijft werken. Een databasetest bewijst dat.
- Verificatie: **137 echte PostgreSQL-tests** (`scripts/hours-pages-db-test.py` — 11 nieuw plus de
  volledige vrijgegeven inname-/foundation-/classificatie-/poortregressies, zeven migraties elk tweemaal,
  poortcontrole van vijftien naar **zestien** tabellen); **1.469 applicatietests**; lint 0 errors,
  typecheck en productiebuild groen. De vrijgegeven harness `scripts/hours-intake-db-test.py` is
  ongewijzigd gelaten; de nieuwe importeert hem en overschrijft alleen de signaturen die echt bewogen.
- **Verbonden demo-QA geslaagd** (`scripts/e2e-hours-pages-demo.spec.ts` +
  `scripts/prepare-hours-pages-demo.mjs`, 4,9 s, `pages-flow-passed`, 48 echte API-oproepen): eigen verse
  QA-opdrachtgever `Urenmodule QA 20260910-pages-r1` met **twee** medewerkers, een synthetische PDF van
  drie pagina's die de browser zelf telt. Bewezen: paginaaantal uit de echte PDF, pagina op één naam,
  overname als uitsluitend voorstellen (nul revisies), overname geweigerd op een dag van een andere
  medewerker (400), onbesliste toewijzing die toepassen blokkeert (400, nul writes) en als openstaand punt
  op de week telt, bevestiging die dat opheft, toepassing als versie 1 met "pagina 2 · onderste blok" als
  herkomst, een pagina met twee medewerkers die op één naam wordt geweigerd maar wel als "meerdere" mag
  worden vastgelegd, en een portaalgebruiker die geen paginabesluiten ziet (403 op de projectie).
  **De run claimt bewust precies één onaangeroerde werkdag** — dat is na afloop geverifieerd.
- **JA Werkt blijft UIT, demo AAN** — na afloop opnieuw geverifieerd. De demo-communicatiepauze staat nog
  op de oorspronkelijke `{email:false, whatsapp:false}`; deze stroom heeft geen verzendpad. Het
  geblokkeerde `QA_SUPERADMIN`-account is ongemoeid gelaten.
- Advisors na DDL: geen ERROR-bevindingen. De drie nieuwe RPC's verschijnen in dezelfde WARN-categorie
  "SECURITY DEFINER uitvoerbaar door authenticated" als alle bestaande urenfuncties — bewuste conventie.
  Alle vijf foreign keys op `hours_source_pages` zijn geïndexeerd.
- **Drie codereviewrondes vonden twaalf echte defecten, allemaal gerepareerd** met een test die eerst rood
  stond. Drie in de eerste ronde (een paginabesluit dat een staand voorstel stil overrulet; de overname die de pagina
  dubbel in de herkomst zette — "pagina 1 · pagina 1"; een bewerkt paginabesluit dat zijn toelichting
  verloor) en vijf in de tweede (een toegepast voorstel dat het besluit voorgoed op slot zette met een
  onuitvoerbare foutmelding; een voorstel zónder paginanummer dat de forcering ontweek; bevestigen dat
  het paginabesluit niet herlas, waardoor dezelfde tegenspraak via een andere volgorde binnenkwam; een
  bewerkformulier waarin een typefout het besluit van een ándere pagina verving; en een tautologische
  bovengrens die een rauwe Postgres-fout doorliet). De derde ronde vond er nog vier: een voorstel **zonder**
  paginanummer dat onzichtbaar was voor de tegenspraakregel (hetzelfde gat als #2, van de andere kant), een
  overname-invoer met expliciete `source_input: null` die de hele overname liet falen, een verworpen
  voorstel dat de rode "onbeslist"-badge hield, en een nieuw paginabesluit dat met de voorgevulde "1" stil
  het bestaande besluit van pagina 1 verving. Reparaties in de aanvullende migraties `20260910100000`,
  `20260910110000` en `20260910120000` — alle drie toegepast op productie — plus de UI.
- Eindstand verificatie: **145 echte PostgreSQL-tests** (negen migraties elk tweemaal), **1.472
  applicatietests**, lint 0 errors, typecheck en build, en **vier verbonden demo-QA-runs** (de laatste twee
  met twaalf controles en 57 echte API-oproepen tegen de verharde code). De runs claimden samen zeven
  werkdagen in vier eigen, verse QA-weken; de oude r3/r4-intakefixtures zijn niet aangeraakt.
- Bewijsmap: `/Users/kas/.codex/visualizations/2026/09/07/01a07bd6-9fd4-7440-a463-9fc32ece3f91/JA-Werkt-urenmodule/bouw/pages-20260910/`
  (vier QA-resultaten + fixtures + README).
- Frontendrelease loopt via [PR #266](https://github.com/sitejob-nl/ja-works-hub/pull/266) op `main`.
  Niet gemerged — merge is een productiedeploy en blijft aan Kas.
- **Volgende actie:** PR #266 reviewen en mergen (alleen frontend; de migraties staan al live). Daarna
  de frontier uit `docs/urenmodule-tickets.md`: **T3** (Excel-/tabelbestanden) en **T4** (scans/foto's via
  de VPS met AI-boekhouding) zijn nu gedeblokkeerd, naast de al open **T6** (klantweekpagina zonder
  inloggen) en de losstaande **T10**.

## Interne broninname urenmodule — 8 september 2026 (`feat/urenmodule-broninname`)

- Nieuwe duurzame worktree `/Users/kas/dev/ja-works-hub/.worktrees/urenmodule-intake`, branch
  `feat/urenmodule-broninname` vanaf actuele `origin/main` `f01be24` (de gemergde release #264). De
  classificatieworktree is ongemoeid gelaten; er stond geen ongepusht werk.
- De resterende urenmodulebouw is eerst als tickets met blokkades vastgelegd in
  [docs/urenmodule-tickets.md](docs/urenmodule-tickets.md) (T1 t/m T14, plus de klantinput die T8/T9/T12/T14
  blokkeert). Daarna is T1 gebouwd.
- **T1 — interne broninname:** urenbriefje uploaden bij een klantweek (PDF/JPG/PNG, privé bucket
  `hours-sources`), bron bekijken via een signed URL van 5 minuten, een **invoervoorstel** vastleggen en
  dat in een aparte handeling **letterlijk** toepassen als nieuwe dagrevisie. Een bron of voorstel is geen
  uur; alleen toepassen schrijft. Zie [innamecontract](docs/urenmodule-intake-contract.md).
- Migratie `20260909090000_hours_week_sources_and_proposals.sql` (SHA256
  `37af2734e9cdd9c9b03e6bc276e8359cf5892031c0e7e31f49b3f74e5c38e270`) is op 8 september toegepast; receipt
  `20260908142509_hours_week_sources_and_proposals`, en de bronversie is expliciet in `schema_migrations`
  geregistreerd. Additief: `hours_save_day_source` is alleen op een gedeelde revisieschrijver aangesloten,
  gedragsgelijk en bewezen door de volledige vrijgegeven regressieset. Live types zijn hergenereerd
  (+207 regels) en de RPC-adapter hangt aan de gegenereerde signatures. **Geen edge-function-deploy nodig.**
- Verificatie: **1.458 applicatietests**, lint 0 errors, typecheck en productiebuild groen;
  **126 echte PostgreSQL-tests** (`scripts/hours-intake-db-test.py`) met zes migraties elk tweemaal
  toegepast, poortcontrole uitgebreid van dertien naar vijftien tabellen en de vijf nieuwe RPC's.
- Verbonden demo-QA geslaagd (`scripts/e2e-hours-intake-demo.spec.ts`, 9,3 s, `intake-flow-passed`) met
  echte interne en medewerkerlogins tegen de live API en uitsluitend synthetische bestanden op een tot dan
  onaangeroerde dag van de bestaande r4-fixture. Bewezen: geweigerd bestandstype vóór opslag, herhaalde
  aanlevering als één bron, publieke URL faalt terwijl de signed URL werkt, voorstel zonder dagwijziging,
  toepassing als versie 1 met de bron als herkomst, geweigerde tweede toepassing, geslaagde
  uursoortenindeling (`classified`) op de toegepaste revisie, medewerkerakkoord met afgeschermde interne
  gegevens, correctie die het akkoord ongeldig maakt, en een verouderde toepassing die niets schrijft.
  Die run vond één echte bug (de bevestiging na toepassen verdween) die is hersteld en opnieuw getest.
- **JA Werkt blijft UIT, demo AAN** — na afloop opnieuw geverifieerd. Nul berichten, nul betaalde
  AI-calls, nul legacy-`timesheets`-writes; deze stroom heeft geen verzendpad, dus de
  communicatie-instelling van de demo is niet aangeraakt (staat nog op de oorspronkelijke false/false).
  Het geblokkeerde `QA_SUPERADMIN`-account is ongemoeid gelaten; deze stroom heeft het niet nodig.
- Advisors na DDL: geen ERROR-bevindingen. De vijf nieuwe RPC's verschijnen in dezelfde WARN-categorie
  "SECURITY DEFINER uitvoerbaar door authenticated" als alle bestaande urenfuncties — bewuste conventie.
  Alle foreign keys op de twee nieuwe tabellen zijn geïndexeerd.
- Bewijsmap: `/Users/kas/.codex/visualizations/2026/09/07/01a07bd6-9fd4-7440-a463-9fc32ece3f91/JA-Werkt-urenmodule/bouw/intake-20260909/`.
- Frontendrelease loopt via [PR #265](https://github.com/sitejob-nl/ja-works-hub/pull/265) op `main`;
  CI `quality` en de Vercel-preview zijn groen. Niet gemerged — merge is een productiedeploy en blijft
  aan Kas.
- **Volgende actie:** PR #265 reviewen en mergen (alleen frontend; de migratie staat al live). Daarna de
  frontier uit `docs/urenmodule-tickets.md`: T2 (bronpagina's en toewijzingscontrole) of T6 (klantweekpagina).

## Actuele uitrol urenmodule — 8 september 2026

- Kas vroeg echte demo-QA en een SaaS-schakelaar per organisatie. De nieuwe key is `uren-workflow`, afzonderlijk van legacy `uren`, standaard UIT. Zes nieuwe routes en beide toegangsknoppen zijn afgeschermd; alle 13 nieuwe tabellen en de interne/portal/service-RPC's controleren hetzelfde recht. Zie [modulecontract](docs/urenmodule-organization-gate.md).
- Actieve worktree blijft `/Users/kas/dev/ja-works-hub/.worktrees/urenmodule-classificatie`, branch `codex/urenmodule-classificatie`. De oudere bouwsnapshots hieronder zijn historisch; de backend is inmiddels wel gedeployed.
- Op 8 september zijn de vier urenmigraties atomisch toegepast met Supabase `apply_migration`; receipt `20260908101415_hours_workflow_guarded_initial_release`. Hun oorspronkelijke versies zijn in dezelfde transactie geregistreerd. `scripts/build-hours-initial-release.py` en de manifest/evidence bevatten bronhashes en uitrolinstellingen.
- Live einddoel en geverifieerde huidige database-instelling: **JA Werkt UIT**, **Demo Uitzendbureau Showroom AAN**, andere drie organisaties UIT. JA Werkt is tijdens deze test niet aangezet. De bestaande urenregistratie blijft bestaan.
- Edge `hours-classify-day` via CLI gedeployed met eigen sessievalidatie (`verify_jwt=false`). Live database-types via CLI gegenereerd (+999 regels voor de urenmodule); tijdelijke RPC-casts verwijderd en op de gegenereerde signatures aangesloten. Negen nieuwe RPC-contracttests en typecheck geslaagd.
- Predeploy: 1.402 applicatietests, lint 0 errors, typecheck/build/Deno geslaagd; **100 echte PostgreSQL-tests** (74 regressies +26 gategevallen), vier migraties tweemaal en finale gatehash `e0661385b35b39f72854e4144f94307813ff9dd46b9e7fda2a86c67362d0d14a`. Onafhankelijke securityreview en transactionele bundelreview GO.
- Verbonden browser-QA is geslaagd via echte interne en portal-login, localhost:8083 tegen de geverifieerde demo-tenant. Demo is een organisatie in hetzelfde Supabase-project, geen apart testproject. Alleen unieke synthetische opdrachtgevers `Urenmodule QA 20260908-gate` (plus r2/r3/r4-herhaalfixtures) en bijbehorende demo-plaatsingen zijn toegevoegd. Zie [QA-verslag](docs/urenmodule-demo-qa.md).
- Verbonden QA reproduceerde een matrixrace: opgeslagen concept verscheen tijdens nog lopende refetches; een latere editorreset wiste het rekenvoorbeeld. Fix houdt selectie vast en blokkeert de editor tot de gehele save klaar is. Nieuwe regressietest bewezen rood vóór fix en groen erna; 12 gerichte matrixtests, lint en typecheck geslaagd. Runtime bevroren voor een schone r3-herhaling.
- R3 bewees echte matrixpublicatie, week-/bronopslag, twee serverclassificaties, portal-login/deeplink, akkoord → correctie → herakkoord → betwisting en mobiele NL/EN/PL-schermen. De laatste stale-browsercontrole vond een tweede fout: businessconflicten met SQLSTATE `40001` werden door PostgREST eindeloos herhaald. Eigen achtergebleven QA-aanvragen zijn gericht gestopt; daarna nul actieve urenwrites geverifieerd.
- Additieve reparatie `20260908180000_hours_conflict_http_status.sql` is live (receipt `20260908110800_hours_conflict_http_status_release`): uitsluitend 13 expliciete business-errcodes in 12 functies zijn `PT409` geworden, zodat HTTP409 direct terugkomt. Andere functie-inhoud, ACLs en gates zijn gelijk. De aangepaste `hours-classify-day` is opnieuw gedeployed. JA UIT/demo AAN opnieuw geverifieerd. Oude vijf bronmigraties niet herschrijven.
- Laatste lokale checks: **1.429 applicatietests**, lint 0 errors, build, typecheck en Deno groen. **106 echte PostgreSQL-tests** met vijf migraties elk tweemaal, waaronder volledige catalogus/ACL-vergelijking, conflict zonder writes en behoud van native PostgreSQL-fouten. Nieuwe migratiehash `521eb713e62b540445d9c364bc3e5113f472515a7f6ca8bae3590c9ba8b1c97e`.
- Finale browserrun `20260908-gate-r4`: **business-flow-passed**, één volledige Playwright-flow in 19,1 seconden. Matrixpublicatie, opdrachtgeverdeadlines, twee echte classificaties, reload, portalreacties en mobiele NL/EN/PL-weergave geslaagd. Twee onafhankelijk ingelogde sessies bewijzen HTTP409/PT409 zonder overschrijven; gerichte eerdere HTTP-proef gaf binnen 154 ms antwoord. Portal-classificatie terecht 403; geen browserfouten, berichten of betaalde AI-calls.
- **Open testafhankelijkheid:** opgeslagen `QA_SUPERADMIN` is bewust inactief en geblokkeerd. Tijdelijke activatie is aan Kas gevraagd, nog niet toegestaan; account niet wijzigen zonder antwoord. De businessflow kan met `HOURS_DEMO_SKIP_SUPERADMIN=1` door. Een latere `HOURS_DEMO_TOGGLE_ONLY=1` test gebruikt hetzelfde bewezen dossier.
- **Demo-opruiming voltooid:** tijdelijke communicatiepauze teruggezet naar de oorspronkelijke false/false met `scripts/prepare-hours-demo.mjs restore-communications`. Synthetische QA-dossiers blijven herkenbaar behouden; geen historische uren gewist. QA-browsers en eigen PostgreSQL-testcontainers zijn gesloten/verwijderd.
- Duurzame bewijsmap: `/Users/kas/.codex/visualizations/2026/09/07/01a07bd6-9fd4-7440-a463-9fc32ece3f91/JA-Werkt-urenmodule/bouw/`; onderdelen `module-gate-quality`, `module-gate-db-qa` en `demo-connected-qa`.
- Frontendrelease loopt uitsluitend via [PR #264](https://github.com/sitejob-nl/ja-works-hub/pull/264), rechtstreeks op `main`, met de volledige afgeschermde module. De actuele PR-/Vercel-status en bewijsmap zijn leidend voor voltooiing. PR #262 en #263 zijn hiermee vervangen en mogen niet afzonderlijk worden gemerged. Resterende modulebouw (OCR/inname, mailprofielen/outbox, volledige weekregels, vrijgave/export) blijft open; dit is geen volledige klantoplevering.

## Historische bouw urenmodule — 8 september 2026

- Vaste worktree `/Users/kas/dev/ja-works-hub/.worktrees/urenmodule-bouw`, branch `codex/urenmodule-bouw`, vanaf `aedc6dc` (#261). Eerste codecheckpoint `3530bcd`.
- Klantweken, handmatige dagrevisies, exacte medewerkerreacties, interne controle, Nederlandse deadlines, pure minuten-/matrixkern en mailplanningpreview gebouwd. Dit is een ontwikkelversie zonder vrijgave/export of automatische inname. Geen productieklanten geactiveerd en geen migratie gedeployed.
- [Bouwstand](docs/urenmodule-bouw.md) en [databasecontract](docs/urenmodule-db-contract.md) beschrijven grenzen, checks en volgende stappen. De vaste prijs/specificatie blijft de klantafspraak; deze bouwstand is geen volledige opleverclaim.
- Tijdelijke werkmap verdween vóór commit; succesvol uitgevoerde bestandsedits zijn uit sessielogs hersteld. Migratiehash exact behouden, 43 DB-tests opnieuw geslaagd; vervolgwerk blijft in vaste worktrees en krijgt Git-checkpoints.
- Fundering is opgeslagen tot `47c408f`, draft PR #262; CI quality en Vercel preview geslaagd. Nog geen productiemigratie.
- Afhankelijke matrixbouw: `/Users/kas/dev/ja-works-hub/.worktrees/urenmodule-matrix`, branch `codex/urenmodule-matrix`, vanaf `47c408f`. Matrixeditor, expliciete CAO-koppelingen, conceptpublicatie en immutable versies gebouwd. Opslag: 30 echte PG-tests + 85 pariteitsgevallen geslaagd; migratiehash `cee82deced978525e0d92544f6e8d25b027c0cc21e7a97ec97ecaffdd146a0fe`. Zie [matrixcontract](docs/urenmodule-matrix-contract.md). Eerst basiswijzigingen integreren vóór merge naar main.
- Brongegevens en servermatige dagclassificatie zijn in de vervolgbranch gebouwd: nieuwe revisies bewaren diensten, pauzes en broncodes; de eerste vastgelegde matrixbasis van een dag blijft bij correcties behouden. De browser stuurt alleen dag/revisie naar de self-auth serverfunctie; de service-only finalisatie controleert opnieuw actor, revisie en context. Zie [classificatiecontract](docs/urenmodule-classification-contract.md).
- Matrixcheckpoint `da7dbaa` staat als draft in PR #263 (base `codex/urenmodule-bouw`). Inclusief matrixbouw: 1.234 tests, typecheck, lint en build groen; 7 offline browsercontroles zonder API-aanroepen geslaagd.
- Actieve classificatieworktree: `/Users/kas/dev/ja-works-hub/.worktrees/urenmodule-classificatie`, branch `codex/urenmodule-classificatie`, vanaf `69aee12`. Hier verdergaan; niet opnieuw vanaf main beginnen.
- Classificatiecheckpoint `773f3d0` staat als draft in [PR #264](https://github.com/sitejob-nl/ja-works-hub/pull/264), base `codex/urenmodule-matrix`. De drie draft-PR's zijn afhankelijk en nog niet gemerged. De code is in vaste worktrees en op remote branches opgeslagen.
- Classificatievalidatie: 1.349 applicatietests, lint/typecheck/build en Deno groen; 74 echte PG-tests (inclusief 43 foundationregressies), 91 brongevallen en 9 offline browsercontroles geslaagd. Drie migraties elk tweemaal toegepast. Classificatiehash `722e850c895e9cb876a44050c8d2aeaacf78dd2011f91c30677fe22f09c6a484`. Geen productie-DDL, echte uren of berichten gewijzigd.
- Resterende bouw: volledige weekoverwerk-/samenloopregels, fijnere tijdprecisie waar nodig, klantlinks/upload/mailinname, VPS/OCR/Vision, mailprofielen/outbox, vrijgave/export en pilotacceptatie. Voor definitieve inrichting zijn bevestigde klantmatrices en het payrollvoorbeeld nodig. Schema 1 geeft daarvoor geen standaardwaarden of volledige opleverclaim.

## Correctie 2026-09-07 — vast AI-maandbudget (`codex/ai-monthly-budget-reset`)

- Expliciete klantcorrectie: **€50 budget per maand, geen cumulatief tegoed**. Ongebruikt budget vervalt bij de volgende Nederlandse kalendermaand.
- Werkmap `/tmp/ja-works-ai-monthly-cap`, vanaf `origin/main` `3e3735c` (PR #260). De registratie van alle elf betaalde AI-functies blijft intact; bestaande RPC-signatures blijven compatibel.
- Nieuwe migratie corrigeert de maandregeling met herleidbare boekingen. Het huidige maandverbruik telt mee: op het controlemoment €0,01 in september, dus €49,99 beschikbaar. Oude boekingen worden niet gewijzigd of verwijderd.
- Open aanvragen uit een vorige maand behouden hun reservering apart. Late afrekening of vrijgave verandert de ruimte voor de nieuwe maand niet. Er is geen inhaal of stapeling van gemiste maanden; handmatige top-ups zijn geblokkeerd bij een actief maandbudget.
- De huidige afspraak en het databasecontract staan in [docs/ai-accounting.md](docs/ai-accounting.md) en [docs/ai-accounting-db-contract.md](docs/ai-accounting-db-contract.md). De oudere sessie hieronder documenteert de eerste, inmiddels gecorrigeerde interpretatie.

## Sessie 2026-09-07 — eerste AI-accountingrelease (`codex/ai-ledger-monthly-credits`, maandinterpretatie gecorrigeerd)

- Nieuwe worktree `/tmp/ja-works-ai-ledger`, vanaf actuele `origin/main` `cd0ba7d`. De oude dirty checkout is ongemoeid gelaten.
- Eerste implementatie interpreteerde het maandbedrag als €50 extra met behoud van restant. Kas heeft dit expliciet gecorrigeerd naar een vast maandbudget zonder stapeling; zie de correctie hierboven.
- Alle elf betaalde endpoints gebruiken `_shared/ai-accounting.ts`: vooraf reserveren, één providercall, daarna atomair aanvraag/verbruik/boeking afrekenen. Dry-runs tellen mee; cachehits niet. Onbekende uitkomsten houden hun reservering en worden zichtbaar gemeld.
- Migratie `20260907201512_ai_accounting_ledger.sql` voegt onveranderlijke boekingen en een idempotente maandcron toe. Andere organisaties hebben standaard geen maandregeling. Het historische verschil van €0,22 wordt zichtbaar behouden, zonder extra afschrijving.
- Instellingen en superadmin tonen saldo, reserveringen, maandtoelage, providerkosten en volledige historie. Handmatige correcties zijn idempotent.
- Validatie: volledige quality-gate, Deno voor alle elf functies, gemockte provider/handler-tests, echte concurrerende PostgreSQL/pg_cron-tests en desktop/mobiele mock-UI. Geen betaalde testcalls of klantcommunicatie.
- Release vereist migratie, alle elf edge functions via CLI en frontendmerge; alleen de frontend deployt automatisch. Zie [docs/ai-accounting.md](docs/ai-accounting.md) en [databasecontract](docs/ai-accounting-db-contract.md) voor beheer, inschrijving, controles en herstel. De PR/releasecontrole is leidend voor de actuele uitrolstatus.
- De oudere AI/VPS-beschrijvingen verderop zijn historisch; de AI-sectie in `CLAUDE.md` is nu bijgewerkt. Qwen is uitgefaseerd. Documentvoorbewerking op de JA Werkt-VPS en de toekomstige urenfotoherkenning vallen buiten deze accountingrelease.

## Sessie 2026-09-03 — mailhistorie-filter + mailboxrechten (`fix/mail-history-filter-en-rechten`)

- **Worktree:** `.claude/worktrees/fix-mail-history-rechten`, branch `fix/mail-history-filter-en-rechten` vanaf `origin/main` `cdcc248` (#244).
- **Aanleiding:** op de opdrachtgever-tab (Bax Metaal) stond mail van derden, en een admin (Kas) zag de mailbox
  van Jeroen ondanks `can_read_mail = false` in `mail_account_user_access`.
- **Oorzaak 1:** `outlook-mail` plakte per adres een quoted KQL-term met OR aan elkaar; Graph leest dat niet als
  filter en geeft de hele mailbox terug (live bewezen tegen de demo-mailbox: 1 adres → 0 treffers, 2 fictieve adressen → 50).
- **Oorzaak 2:** `adminOrgAccess` in `_shared/outlook-accounts.ts` gaf elke admin lees/verzend op alle
  org-mailboxen, óók bij expliciete `false`-grants.
- **Fix:** `_shared/outlook-mail-filter.ts` (+ Deno-test) → één KQL-string + server-side nafilter op
  from/to/cc/bcc per pagina; client stuurt `participant_emails` ook bij `next_link`; admin-override verwijderd
  op alle drie de plekken. Grants zijn nu leidend.
- **Prod-data:** grants van Jeroen (profiel `35af6e91`, jeroen@jawerkt.nl) op zijn eigen mailbox volledig gezet en
  `can_send_mail` op Algemeen aan, zodat hij na de deploy niets verliest. Kas heeft géén grant op Algemeen —
  zelf aanvinken in Instellingen → Outlook.
- **Deploy:** `outlook-mail`, `outlook-accounts`, `outlook-calendar`, `outlook-send-mail` via CLI vanuit deze worktree.
- **Volgende actie:** PR reviewen + mergen (frontend-deel: `participant_emails` bij vervolgpagina's).

## ⚠️ Eerst dit: lokale checkout is stale

- Deze werkkopie staat op branch **`docs/claude-md-session-refresh`** en loopt **~73 commits achter `origin/main`**.
- `origin/main` HEAD = **`2013eab`** (PR #124, perf-indexes), 2026-06-28.
- **Begin elke nieuwe taak met `git fetch origin main` en branch vanaf `origin/main`** (worktree per sessie).
  Niet doorcoderen op deze branch — je base mist alle #111-124-werk hieronder.
- Dirty working tree op deze branch (mag je negeren / niet committen):
  - `package.json` / `package-lock.json` — Sentry-deps; zitten al in `origin/main` via #120, dus lokaal redundant.
  - `test vacatures/` — lokale test-DOCX'en, **bewust buiten git** houden.
  - `CLAUDE.md` — 9 regels lokale diff t.o.v. origin/main (los van de gemergde #110/#119-docupdates).

## Productiestatus

- Frontend productie: `https://ja-works-hub.vercel.app` (Vercel-project `ja-works-hub`; merge naar `main` = auto-deploy frontend).
- Supabase project: `noaupcteygfvlyymqtew`.
- Edge functions + DB-migrations worden **handmatig** gedeployed (geen edge/migratie-CI). Frontend gaat via GitHub/Vercel.
- Verdict laatste readiness-ronde (2026-06-25): **opleverbaar**; kernflow staat op `main`. Resterende blockers zijn
  klant/acceptatie-werk (browser-QA + definitieve juridische template-inhoud), geen code-blockers.

## Wat er sinds de vorige handover (2026-06-17) is geland

### Tech-debt programma — 4 tracks, volledig gemerged (#111-#120)
- **Tests/coverage (#111-112):** v8-coverage zonder gate, goedkope pure-lib unit-tests + compliance-domeintest (`checkCompliance`) met supabase-mockpatroon.
- **Data-laag (#113-117):** gedeelde query-key helper (`qk`) + `unwrap`, ESLint-**warn**-guard tegen rauwe supabase-boilerplate, conventiedoc; heavy pages, transport, housing, employees omgezet. **Volg dit patroon in nieuwe data-code.**
- **De-silo MatchRow (#105, #118, #119):** `VacancyMatchesTab` pipeline op gedeelde `MatchRow`; ongebruikte `MatchCard` verwijderd; gedeelde status-meta + skill-badges. Raakt de live plaatsing-pipeline — voorzichtig bij wijzigingen hier.
- **Observability / Sentry (#120):** frontend Sentry, env-gated + PII-veilig (replay + tracing UIT i.v.m. AVG). Org `sitejob` op EU (`de.sentry.io`), projectslug `ja-werkt`. Activeert via `VITE_SENTRY_*` env-vars in Vercel PROD.

### AI-screening: Gemini als enige provider (#116)
- `analyze-cv` screent nu via **Gemini** (`_shared/gemini-cv.ts`). ⚠️ **CLAUDE.md's AI-sectie is hierdoor deels achterhaald** — die beschrijft nog "default VPS, optioneel Cloud/Anthropic". Vertrouw bij AI-werk de **huidige `analyze-cv/index.ts` op origin/main**, niet de CLAUDE.md-providerdefault.

### Performance (#124, open #125)
- **#124 (gemerged):** covering indexes voor 44 ongeïndexeerde foreign keys (advisor Pri 4, tier A).
- **#125 (OPEN):** drop dode name-trgm index + fix `cv_fts` expressie-mismatch. **Enige open PR** — check/merge als eerste kandidaat.

### Communicatie & operations
- **COM1 (#87, #108):** bedrijfs-communicatie-inbox + realtime; inkomende e-mail auto-persisteren naar `communications` (match-gated). Inkomende WhatsApp koppelt aan bedrijfscontact via telefoon-lookup (kandidaat houdt voorrang).
- **EM1 (#88):** `mail_accounts.reply_to_email` als Graph `replyTo` (antwoorden landen op ingesteld adres, bv. info@); instelbaar per mailaccount.
- **Exact hardening (#107):** 503-poll + suspended-actie via SiteJob Connect.
- **Recruiter-taken (#106):** `recruiter_tasks.created_by` → onderscheid "door mij gemaakt" vs "aan mij toegewezen".
- **Belscreening (#109):** stappen-overzicht scrollt sticky mee.
- **Fuelcard refactor (#121-123):** `FuelCardAnalysis` opgesplitst — pure helpers → `lib/fuel-analysis.ts`, datalaag → `useFuelCardData`-hook, sub-componenten → `src/components/fuel/`.

## Bekende restpunten / divergenties

- **CLAUDE.md AI-providersectie** is stale t.o.v. #116 (Gemini-only screening) — niet blind volgen.
- **`src/integrations/supabase/types.ts`** blijft auto-generated en kan stale zijn; nooit handmatig editen, verifieer live schema vóór schema-werk.
- **Supabase advisors:** security schoon (alle SECURITY DEFINER-fns intern gegate). Perf-hoofditem = unindexed FKs (#124 pakte 44 aan, tier A); resterende tiers + multiple-permissive-policies = post-live hardening, per domein testen.
- **Sentry-creds in Vercel PROD** zijn de resterende klant-/ops-actie om Sentry echt live te laten loggen (MCP/CI-token kon zelf geen Sentry-project/token aanmaken).
- **docs/-gapbestanden** (`open-gaps.md` e.a.) zijn zwaar verouderd — veel daarvan is inmiddels gebouwd (#86-#124). Behandel ze als indicatief, niet als waarheid.
- GitHub Actions toont nog een Node-versie-annotation (`actions/checkout@v4`/`setup-node@v4` → v6); kleine workflow-update vereist een token met `workflow`-scope.

## Verificatie vóór een PR

```bash
git diff --check
npm run lint        # over src/ ÉN supabase/functions/ — edge lint-error faalt CI
npm run typecheck   # dekt geen Deno
npm run test
npm run build
deno check supabase/functions/<gewijzigde-fn>/index.ts   # Deno los
```

UI/a11y-kernroutes (env uit `.env` + `.env.local`, print nooit waarden):

```bash
set -a; source .env; source .env.local; set +a
npx playwright test --config=scripts/playwright.config.ts scripts/e2e-a11y-core.spec.ts
```

QA/demo-toegang via env-keys: `DEMO_ORG_*` (interne admin in demo-org `6dedabe4-…`), `QA_SUPERADMIN_*`
(superadmin, geen org-context). Zet de org **outbound kill-switch** aan vóór flows die mail/WhatsApp sturen, en revert daarna.

## Directe aanbevelingen (next actions)

1. **`git fetch origin main` + branch/worktree vanaf `origin/main`** — niet vanaf deze stale branch.
2. **Open PR #125** (dode index + `cv_fts`-fix) reviewen/mergen; daarna advisors opnieuw draaien.
3. Bij AI-werk: lees de huidige `analyze-cv` op `main` (Gemini-only, #116); werk CLAUDE.md's AI-sectie bij als je daar toch zit.
4. Klant-/acceptatieblockers oppakken: browser-QA kernflow + juridische goedkeuring van actieve contracttemplates.
5. Na elke DDL: live toegepaste migration ook in `supabase/migrations/` zetten + `get_advisors` opnieuw draaien.
