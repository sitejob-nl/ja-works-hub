# Session handover — 2026-09-16

Overdracht voor wie verdergaat (Codex / Claude Code). Lees [AGENTS.md](AGENTS.md) voor harde repo-conventies +
commands, [CLAUDE.md](CLAUDE.md) voor de canonieke codebase-diepte, [HANDOVER.md](HANDOVER.md) voor de formele
projectsamenvatting.

## Duurzame mailinname — 16 september 2026 (`feat/urenmodule-mailinname`)

- Duurzame worktree `/Users/kas/dev/ja-works-hub/.worktrees/urenmodule-mailinname`, branch
  `feat/urenmodule-mailinname` vanaf `origin/main` (`f6d15bc`, de gemergde T5-release #271). De stale
  hoofdcheckout en alle overige worktrees zijn ongemoeid gelaten.
- **T7 uit [docs/urenmodule-tickets.md](docs/urenmodule-tickets.md) is gebouwd** — duurzame mailinname
  vanuit de gekoppelde Outlook-postbus. Alle vijf acceptatiecriteria zijn afgevinkt. Zie het
  [mailinnamecontract](docs/urenmodule-mail-intake.md).
- **De uitvraagreferentie bestond niet en is hier ontworpen.** Het ticket noemt hem alsof hij er is;
  hij kwam nergens in de code voor. Gekozen is `hours_week_requests`: één rij per uitgaande uitvraag,
  scope op precies één klantweek, met een korte code (`UR-XXXX-XXXX`) die in het onderwerp meereist.
  **Bewust géén geheim** — hij zegt alleen bij welke week een antwoord hoort, geeft geen toegang en
  maakt geen uren. T8 hoeft hem alleen mee te sturen en na verzending drie velden bij te werken
  (`outbound_message_id`, `conversation_id`, `recipients`); de hele herkenning aan de ontvangstkant
  staat er al. De afweging tegen de alternatieven staat in het contract.
- **De grens is ongewijzigd.** Een binnengehaalde mail landt als bron met voorstel, nooit als
  dagversie. Alleen `hours_apply_source_proposal` schrijft een dagrevisie en neemt het voorstel
  letterlijk over. Nul writes naar `timesheets`, facturatie of communicatie — na afloop op productie
  geverifieerd.
- **Strikt lezend, en nooit betaald.** De enige twee poorten naar Graph zijn `graphJson`/`graphBytes`;
  er is geen derde en geen methode-parameter. Niets wordt gemarkeerd, verplaatst, gewist of verstuurd,
  en een absoluut adres dat niet van `graph.microsoft.com` komt krijgt het token niet. Een bijlage
  wordt **bewaard**, niet uitgelezen: de betaalde scanroute blijft een bewuste handeling van een mens
  achter dezelfde maandblokkade.
- **Eén lezer, verhuisd — geen tweede.** `hours-eml.ts` en `hours-mail-text.ts` zijn van `src/lib/`
  naar `supabase/functions/_shared/` gegaan, met een doorgeefluik op de oude plek, zodat een geüploade
  `.eml` en een vanzelf binnengekomen bericht door precies dezelfde regels worden gelezen. Idem voor
  de bijlagesniffer (`hours-attachment-type.ts`) en de twijfelregel (`readingEntryDoubt`).
- **Live:** migraties `20260916090000_hours_mail_intake.sql`,
  `20260916100000_hours_mail_intake_review_fixes.sql` en `20260916110000_hours_mail_intake_cron.sql`,
  plus edge function `hours-mail-intake`. `hours-read-scan` is opnieuw gedeployd omdat de gedeelde
  begrenzing (`readBounded`) naar `_shared/bounded-read.ts` verhuisde — een openstaand T4-restpunt.
  JA Werkt UIT, demo AAN — ongewijzigd en na afloop opnieuw geverifieerd.
- **Productie is gedragsmatig identiek aan de bewezen testcontainer.** De genormaliseerde
  vingerafdruk van alle 113 `hours_*`-functies en van kolommen/constraints/indexen/policies van alle
  `hours_*`-tabellen is na elke apply vergeleken; beide zijn identiek. Twee vrijgegeven functies
  (`hours_create_source_proposals`, `hours_get_source_reading_context`) verschillen alleen in een
  SQL-**commentaarregel**: die zijn ooit zonder commentaar toegepast. Gedrag identiek.
- **Vier codereviewrondes vonden dertien echte defecten**, elk gerepareerd met een test die eerst rood
  stond. De zwaarste:
  - **Twee vrijgegeven service-role-routes stonden open terwijl de module uit stond.**
    `hours_claim_source_reading` en `hours_finish_source_reading` schreven met de servicesleutel nog
    steeds in een gepoorte tabel. Gevonden doordat de poortproef ze voor het eerst met de júiste rol
    aanriep.
  - **Een mislukt vastleggen liet de cursor doorlopen**, waardoor precies de berichten die niet
    waren weggeschreven voorgoed verloren gingen — het tegendeel van wat een duurzame cursor is.
  - **Een map groter dan één run kon nooit bijlopen.** Een eerste volledige doorloop van een
    bestaande map is duizenden berichten; die gingen in één te grote schrijfactie, en na de
    paginalimiet begon de volgende run weer bij pagina één. Nu gaat elke pagina meteen in stukken de
    wachtrij in en wordt de vervolglink als cursor bewaard.
  - **Volgen van een map was een omweg om de mailboxrechten.** `hours_mail_set_folder` keek alleen of
    de postbus van de eigen organisatie was; `mail_account_user_access` is leidend. Een
    `finance.manage`-gebruiker kon de inname op elke gekoppelde postbus richten, ook een persoonlijke.
  - **Een lezer schreef in `note`**, het veld dat letterlijk op een dagrevisie wordt toegepast.
  - **De lijst met te pollen mappen liet alles na de tiende verhongeren** en kon niet om één
    organisatie vragen, wat een handmatige run nodig heeft.
  - Verder: een te groot bericht bleef eeuwig herhalen in plaats van zichtbaar te stranden; één
    kapotte postbus of één kapot bericht nam de hele run mee; een onleesbare datum of een te lange
    Graph-id liet een hele doorloop vallen; de twijfel van de lezer kon op deze route niet meereizen;
    en de hele functie was **onbereikbaar vanuit de UI** — er was geen manier om een map te gaan
    volgen, en handmatig toewijzen bestond alleen in de database.
- Verificatie: **312 echte PostgreSQL-tests** (`scripts/hours-mail-intake-db-test.py` — nieuwe
  mailinnamegevallen plus de volledige vrijgegeven Word/mail-, scan-, klantweek-, werkmap-, pagina-,
  inname-, classificatie-, poort- en foundationregressies; zeventien migraties elk tweemaal,
  poortcontrole van achttien naar **tweeëntwintig** tabellen); **1.897 applicatietests**; lint 0
  errors, typecheck en productiebuild groen; `deno check` op de nieuwe edge function.
- **Verbonden demo-QA geslaagd** (`scripts/e2e-hours-mail-demo.spec.ts` +
  `scripts/playwright.hours-mail.config.ts`, 4,6 s, 69 API-oproepen waarvan 6 echte postbusaanroepen)
  op een verse fixture `20260916-mail-r1`. Bewezen tegen de echte Microsoft Graph: het bewaarde token
  wordt ontsleuteld en gebruikt, de delta-vraag antwoordt, de cursor die Graph teruggeeft wordt
  bewaard én door de tweede doorloop geaccepteerd zonder hersynchronisatie, geen enkele map van een
  andere organisatie wordt bevraagd, en **alle acht mappen van de postbus hebben na afloop exact
  hetzelfde aantal items en ongelezen items als ervoor**. Nul dagrevisies, nul werkdagen verbruikt,
  nul betaalde aanroepen, nul JavaScript-fouten, nul serverfouten. Dev-server op eigen poort 8096 met
  `PLAYWRIGHT_SKIP_WEBSERVER=1`.
- **De cronjob draait**: `hours-mail-intake-quarterly`, `*/15 * * * *`, dezelfde vorm als de vier
  bestaande. Handmatig geverifieerd: juiste `x-cron-secret` → `200 {"mode":"cron",…}`, geraden sleutel
  → `403`.
- Advisors na DDL: geen ERROR-bevindingen. De zes nieuwe interne RPC's vallen in dezelfde bewuste
  WARN-categorie "SECURITY DEFINER uitvoerbaar door authenticated" als alle bestaande urenfuncties;
  de tien service-role-only functies staan daar juist **niet** in.

### Restpunten

- **Twee QA-berichten staan nog in de demo-postbus** (Postvak IN: "Onbestelbaar: QA uren
  20260916-mail-r1 …", Verzonden items: hetzelfde onderwerp). Een eerste QA-opzet stuurde een
  testmail naar het demo-**loginadres** in plaats van naar het postbusadres; die bounceerde. Ze zijn
  niet weg te halen omdat de demo-postbus bewust op lezen-en-versturen staat: `mail_delete_enabled`
  is uit, dus zowel verplaatsen als verwijderen wordt geweigerd. **Handmatig weggooien in Outlook.**
- **Een echt bericht dat tot een voorstel wordt gelezen is niet tegen de echte Graph bewezen**, om
  precies dezelfde reden: er kan geen bericht in een testmap worden klaargezet zonder in een echte
  mailbox te schrijven. Die weg is gedekt door 35 handlertests met gefixeerde Graph-antwoorden en
  door de databaseproef.
- **Retentie van `hours_mail_messages`.** Van elk bericht in een gevolgde map worden onderwerp en
  afzender bewaard, ook van mail die niets met uren te maken heeft. Het scherm waarschuwt daarvoor en
  adviseert een aparte map, maar er is nog geen opruimbaan. Hoort bij dezelfde retentievraag als de
  opslagrest van T6.
- `hours_mail_file_message` leest de week uit de bewaarde koppeling van het bericht in plaats van uit
  zijn eigen parameters. Dat is bewust — een aanroeper kan hem zo niet ergens anders op richten —
  maar het betekent ook dat vastleggen zonder een voorafgaande match in dezelfde claim op een oudere
  koppeling zou kunnen leunen. De handler doet dat nooit; een expliciete claim-generatie zou het
  onmogelijk maken.

## Wat hiervoor kwam

## Scans en foto's uitlezen — 9 september 2026 (`feat/urenmodule-scanuitlezer`)

- Duurzame worktree `/Users/kas/dev/ja-works-hub/.worktrees/urenmodule-scanuitlezer`, branch
  `feat/urenmodule-scanuitlezer` vanaf `origin/main` (`751d0a4`).
- **De host is Gemini, niet de VPS.** Het ticket noemde de JA Werkt-VPS; dat is tegen productie
  nagegaan en onjuist gebleken. Elke betaalde aanroep van de afgelopen zestig dagen liep via Gemini,
  de centrale transportlaag kent geen VPS-provider, beeldinvoer mag daar alleen op Gemini, het
  Qwen-pad antwoordt 410, geen enkele regel code roept `OLLAMA_BASE_URL` aan, en de host zelf geeft
  een verbindingstime-out. Vastgelegd in [docs/urenmodule-scan-reading.md](docs/urenmodule-scan-reading.md).
  Documentvoorbewerking blijft waar zij al stond: in de browser, bij het uploaden.
- **Live:** migratie `20260913090000_hours_scan_reading.sql` (plus de correctieronde uit de codereview)
  en edge function `hours-read-scan`. JA Werkt UIT, demo AAN — ongewijzigd.
- **De grens is ongewijzigd.** Een uitlezing landt als voorstel; alleen `hours_apply_source_proposal`
  schrijft een dagrevisie en neemt het voorstel letterlijk over. Nieuw is `uncertain_fields`: wat de
  uitlezing onzeker las blokkeert toepassen tot `hours_confirm_proposal_values`, precies zoals
  `assignment_uncertain` dat doet voor de vraag wie.
- **De verbonden QA vond twee echte fouten** vóór ze konden schaden: PostgREST draait een `STABLE`
  functie read-only, waar de schrijfpoort van deze module een rijvergrendeling neemt (kale 405); en
  Gemini's gestructureerde uitvoer vult alleen verplichte velden, dus een optioneel totaalveld kwam
  niet terug en elke regel werd eerlijk overgeslagen. Beide gerepareerd met een test die eerst rood
  stond; een databasetest bewaakt de eerste regel nu voor elke stabiele urenfunctie tegelijk.
- **Kosten:** twee echte aanroepen in de hele QA, samen € 0,02 op de demo-organisatie (48,78 → 48,76),
  geen openstaande reservering. Eén A4-briefje kost ongeveer één cent.
- **Vier codereviewrondes** leverden samen ruim vijftig echte bevindingen op, elk gerepareerd met een test die eerst rood stond. De zwaarste: een pauze na
  middernacht landde op de verkeerde dag en maakte de dag voorgoed onclassificeerbaar; structurele
  tegenspraken reisden niet mee naar het voorstel en waren dus blind toepasbaar; een enkele slecht
  ingevulde regel liet een hele betaalde uitlezing vallen; en een mislukking ná afrekening kwam terug
  als kale 503 met een uitnodiging om nóg een keer te betalen. Ronde drie en vier vonden nog een kaal
  pauzegetal dat als uren werd gelezen, een claim die een bron voorgoed op slot kon zetten, en een
  uitlezing die ongevalideerd van de server werd overgenomen.
- **Nieuw in ronde twee:** `hours_source_readings` (migratie `20260914090000`) claimt elke uitlezing
  vóór de betaling. Dat is tegelijk de single-flight (één lopende uitlezing per bron, als
  databasefeit) en het AVG-spoor: welk document, welke week, wie, wat het kostte — geen inhoud.
- **Restpunten:**
  - Het QA-briefje is gerenderde tekst, dus de handschriftkwaliteit van het model is niet bewezen.
    Dat hoort bij de acceptatieset van T14.
  - `HoursScanReading` en `HoursWorkbookReading` zijn voor ongeveer driekwart hetzelfde. Eén gedeeld
    beoordelingspaneel is de juiste vorm, maar dat raakt de live T3-component en verdient een eigen
    ronde.
  - `_shared/hours-classification.ts` leest zijn verzoekbody nog met een header-check in plaats van
    begrensd; `readBounded` hoort in `_shared/http.ts` en dan ook daar gebruikt. Dat vraagt een deploy
    van `hours-classify-day`, buiten dit ticket.
  - Vier andere edge functions houden hun eigen kopie van de base64-helper. Consolideren vraagt vier
    deploys op functies die dit werk verder niet raakt.

## Persoonlijke klantweekpagina zonder inloggen — 9 september 2026 (`feat/urenmodule-klantweek`)

- Nieuwe duurzame worktree `/Users/kas/dev/ja-works-hub/.worktrees/urenmodule-klantweek`, branch
  `feat/urenmodule-klantweek` vanaf `origin/main` `f8b80c8` (de gemergde T3-release #267). De stale
  hoofdcheckout en alle overige worktrees zijn ongemoeid gelaten.
- **T6 uit [docs/urenmodule-tickets.md](docs/urenmodule-tickets.md) is gebouwd** — de persoonlijke
  klantweekpagina zonder inloggen. Alle vijf acceptatiecriteria zijn afgevinkt en met echte
  databasetests én verbonden demo-QA bewezen. Zie de nieuwe sectie
  ["Persoonlijke klantweekpagina zonder inloggen (T6)"](docs/urenmodule-intake-contract.md#persoonlijke-klantweekpagina-zonder-inloggen-t6).
- **Wat er nu kan:** een interne gebruiker met `finance.manage` geeft bij een klantweek een persoonlijke
  link uit. De opdrachtgever opent die op `/urenweek/:token` zonder inloggen, ziet de verwachte
  medewerkers en werkdagen, vult per dag uren in of kiest "geen uren" met reden, kan zijn eigen
  urenbriefje meesturen (PDF, foto of Excel), levert gedeeltelijk aan, en meldt dat er later meer volgt
  of dat dit alles is. Het kantoor ziet per link hoeveel van de week is aangeleverd, beoordeelt elke dag
  als voorstel, en kan de link intrekken zonder te wissen wat al is doorgegeven.
- **De grens is ongewijzigd:** klantinvoer landt als **voorstel**, nooit als dagversie. Alleen
  `hours_apply_source_proposal` schrijft een dagrevisie, neemt het voorstel letterlijk over en eist nog
  steeds een met naam bekende interne gebruiker. Nul writes naar `timesheets`, facturatie of
  communicatie — na afloop in productie geverifieerd.
- **Veiligheid:** de database bewaart **alleen de SHA-256** van het geheim; dat wordt exact één keer
  getoond bij uitgifte. De week komt uit de link, dus er is geen parameter waarmee een klant een andere
  week of werkdag kan noemen. De vijf `hours_client_week_*`-RPC's zijn **service-role-only** en
  controleren `auth.role()` zelf; edge function `hours-client-week` (`verify_jwt=false`) is de enige
  houder van die sleutel en autoriseert zelf niets. Een meegestuurd bestand gaat naar een eigen deelmap
  `<org>/<week>/client/<link>/` — bewust niet de padruimte van het kantoor — en de digest wordt
  server-side geverifieerd vóór registratie.
- Migratie `20260912090000_hours_client_week_links.sql` (SHA256
  `5a404360ea393bc9001e35f356187d9893076a657814e0f9dc84a60efc041336`) is op 9 september toegepast,
  inclusief vijf opvolgende reparatiemigraties uit de codereviewrondes; de bronversie is in
  `schema_migrations` geregistreerd. Additief: twee nieuwe org-gebonden tabellen
  (`hours_client_week_links`, `hours_client_week_reports`), één service-role-only toegangslog
  (`hours_client_link_attempts`), twee nieuwe kolommen op bestaande brontabellen, zeven nieuwe RPC's en
  vier gewijzigde. Live types hergenereerd (+217 regels).
- **Productie is byte-voor-byte gelijk aan de bewezen testcontainer.** Na elke productie-apply is de
  genormaliseerde vingerafdruk van alle 80 `hours_*`-functies vergeleken met de container waarin de
  volledige databaseproef groen draaide; ze zijn identiek (`1b7e1c01…`, laatst gecontroleerd na de
  projectiereparatie).
- Verificatie: **205 echte PostgreSQL-tests** (`scripts/hours-client-week-db-test.py` — nieuwe
  klantweekgevallen plus de volledige vrijgegeven werkmap-/pagina-/inname-/foundation-/classificatie-/
  poortregressies, twaalf migraties elk tweemaal, poortcontrole van zestien naar **achttien** tabellen);
  **1.648 applicatietests**; lint 0 errors, typecheck en productiebuild groen; `deno check` op de nieuwe
  edge function. De vrijgegeven harnassen zijn ongewijzigd gelaten; de nieuwe importeert
  `hours-workbook-db-test.py` en overschrijft alleen de verwachtingen die echt bewogen.
- **Verbonden demo-QA geslaagd** (`scripts/e2e-hours-client-week-demo.spec.ts` +
  `scripts/playwright.hours-client-week.config.ts`, 7,9 s, `client-week-flow-passed`, 49 echte
  API-oproepen) op de bestaande QA-week `Urenmodule QA 20260910-pages-r2`, met de klantkant in een
  **eigen browsercontext zonder enige sessie**. Bewezen: uitgifte via het echte formulier met het adres
  precies één keer in beeld en het geheim in geen enkele projectie; de pagina opent zonder sessie; 8,5 en
  8:30 landen als dezelfde duur en schrijven **nul** dagrevisies; een correctie vervangt alleen de eigen
  staande aanlevering van diezelfde link en dag; een melding "ik lever later aan" maakt de week niet
  compleet; een dag van een andere week en een geraden token openen niets; toepassen door het kantoor
  levert precies één dagversie met de **opdrachtgever** als herkomst en zonder het interne linklabel;
  intrekken sluit de link zonder te wissen wat al was doorgegeven; en de publieke RPC is zonder de
  service-sleutel onbereikbaar. Nul JavaScript-fouten, nul serverfouten, nul writes naar `timesheets`,
  nul berichten, nul betaalde AI-aanroepen. Dev-server op eigen poort 8091 met `PLAYWRIGHT_SKIP_WEBSERVER=1`.
- **De run claimde precies één onaangeroerde werkdag.** Over alle QA-weken staan er nog **51** klaar
  (was 56; vijf runs, waarvan vier die op een selectorfout strandden ná het toepassen). JA Werkt UIT,
  demo AAN, na afloop opnieuw geverifieerd. Het geblokkeerde `QA_SUPERADMIN`-account is ongemoeid gelaten.
- Advisors na DDL: geen ERROR-bevindingen. De nieuwe RPC's vallen in dezelfde bewuste WARN-categorie
  "SECURITY DEFINER uitvoerbaar door authenticated" als alle bestaande urenfuncties; de vijf publieke
  functies staan daar juist **niet** in, want die zijn service-role-only. `hours_client_link_attempts`
  geeft de verwachte INFO `rls_enabled_no_policy`, net als `match_response_attempts`.
- **Dertien codereviewrondes vonden vijfenveertig echte defecten, allemaal gerepareerd** met een test die
  eerst rood stond. De zwaarste vier: een **vergrendelvolgorde-inversie** waardoor een klant die opsloeg
  terwijl het kantoor diezelfde dag toepaste kon vastlopen (40P01); een **race met intrekken**, waarbij
  een aanlevering nog landde op een link die zojuist was ingetrokken omdat niemand na de weeklock opnieuw
  keek; een **gedeelde opslagruimte** waarin een linkhouder vervalste bytes kon parkeren onder de digest
  van een bestand dat het kantoor daarna zou uploaden, waarna die upload als duplicaat werd weggedeeld en
  de beoordelaar het bestand van de klant las onder de naam van het kantoor; en een **rate-limit die open
  faalde** doordat een mislukte telling als nul werd gelezen. Verder onder meer: servermeldingen die de
  bezoeker nooit bereikten, rauwe databasemeldingen (deadlocktekst, indexnamen) die juist wél op de
  publieke pagina belandden, een melding die alles wiste wat de klant had getypt, een week groter dan één
  aanlevering die zichzelf blokkeerde, het interne linklabel dat naar de browser van de bezoeker reisde,
  en een klantlink die op de terugvalhost werd gebouwd terwijl het adres maar één keer te zien is. De
  verbonden QA vond er zelf nog twee: identieke veldlabels bij twee medewerkers op dezelfde dag (een
  toegankelijkheidsdefect), en een net-toegepast voorstel dat samen met zijn bevestiging uit beeld
  verdween.
- **Bekende restpost (bewust, gedocumenteerd):** opslagretentie. Een klant kan een upload-adres vragen en
  weglopen, en levert het kantoor hetzelfde bestand aan dat de klant al stuurde, dan dedupliceert de bron
  op inhoud terwijl er twee objecten staan. Beide objecten zijn onbereikbaar voor buitenstaanders (de
  bucket is privé); het gaat om bucketruimte, niet om correctheid of toegang. De zelfopruiming dekt het
  gewone geval; de sluitende oplossing is een retentiebaan, die buiten dit ticket valt. Bewust **niet**
  gekozen: een verwijderrecht op de bucket openen — het contract sluit dat uit.
- **[PR #268](https://github.com/sitejob-nl/ja-works-hub/pull/268) is gemerged** op 9 september
  (`aa05a37`); CI op `main` groen, Vercel-productiedeploy geslaagd. De edge function is daarna opnieuw
  gedeployd vanaf de gemergde stand, zodat runtime en `main` gelijk lopen. Rooktest op productie:
  `/urenweek/<token>` laadt en de edge function weigert een geraden token met `{"status":"invalid"}`.
- **Volgende actie:** de frontier uit `docs/urenmodule-tickets.md`: **T5** (Word/e-mail) en de
  losstaande **T10** zijn open; **T7** (duurzame mailinname) is nu alleen nog door T5 geblokkeerd.

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
  elf migraties elk tweemaal); **1.555 applicatietests**; lint 0 errors, typecheck en productiebuild groen.
  De vrijgegeven harnassen zijn ongewijzigd gelaten; de nieuwe importeert `hours-pages-db-test.py` en
  overschrijft alleen de twee verwachtingen die echt bewogen (bucket-mediatypen, RPC-signaturen).
- **JA Werkt blijft UIT, demo AAN** — vóór de migratie geverifieerd. Het geblokkeerde `QA_SUPERADMIN`-account
  is ongemoeid gelaten. Advisors na DDL: geen ERROR-bevindingen; de nieuwe RPC valt in dezelfde bewuste
  WARN-categorie "SECURITY DEFINER uitvoerbaar door authenticated" als alle bestaande urenfuncties.
- **Veertien codereviewrondes vonden negenenveertig echte defecten, allemaal gerepareerd** met een test die eerst
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
  vervallen, zonder melding. De derde bevinding van die ronde is dezelfde bewuste ontwerpkeuze. Ronde 6 (vijf): een
  uurtarief dat toevallig onder het dagtotaal paste werd een broncode in de brongegevens; een blad met
  lijstkoppen bleef "gelezen" terwijl er niets uit kwam en de kruistabel eronder geen beurt kreeg; de
  dubbelzinnigheidsgrens schaalde mee met de weekgrens waardoor een weektotaal van 6 werd geweigerd; een
  punt als plaatshouder werd een reden voor "geen uren"; en tijdens een lopende uitlezing kon een tweede
  paneel op dezelfde bron worden geopend. Ronde 7 (vijf): een foutwaarde van het rekenblad (`#N/A`) werd de
  bewering dat iemand niet had gewerkt; twee kolommen die allebei het urentotaal claimden lieten de meest
  linkse stil winnen; een leeggelaten dag in een kruistabel verklaarde een weektotaalverschil zonder dat
  het scherm dat zei; boven vijfhonderd regels was er geen manier om in één keer uit te vinken; en een
  `.csv` glipt op Windows binnen als `application/vnd.ms-excel` — de bytes worden nu gecontroleerd vóór
  opslag. Ronde 8 (één): de herkenning van foutwaarden was te nauw — `#DIV/0!` bevat een cijfer en de
  uitlezer levert `#ERROR_#DIV/0!` — waardoor die alsnog een reden voor "geen uren" werden. Dat geval
  wordt nu door een echt bestand mét foutcel getest, niet door de tekst rechtstreeks in te voeren. Ronde 9
  (twee): begin-, eind- en pauzekolommen belandden als broncode in de brongegevens terwijl ze diensttijden
  zijn; en een weektotaal dat als verstreken tijd was opgeslagen (42:00 = 1,75) werd als 1:45 gelezen en
  meldde een verschil op een bestand dat gewoon klopte — de dagen van diezelfde regel beslissen nu welke
  lezing de aangeleverde waarde is. Ronde 10 (twee): de knop "Uitlezen" verscheen ook bij een oud binair
  `.xls`, dat per definitie niet uitgelezen kan worden; en tijdens één uitlezing toonden álle
  werkmapregels "Uitlezen…". De derde bevinding van die ronde — het uitlezen gebeurt in de browser en kost
  bij een zeer groot bestand tijd — is een bewuste keuze en staat als zodanig in het contract. Ronde 11 (vier): een `.xlsx` die de browser als
  het legacy-mediatype aanbood werd als `.xls` bewaard en was daarmee voorgoed onleesbaar; een weektotaal
  links van de dagkolommen verdween zonder melding; een werkblad met gaten in de rijenlijst liet de
  uitlezer struikelen in plaats van "indeling niet herkend" te melden; en een mislukte codelading werd als
  "dit bestand is geen werkmap" gemeld. Ronde 12 (drie): een streepje of nul in een dagcel zette de
  weektotaalcontrole voor die hele regel uit — juist het gewone geval, dus de controle stond praktisch
  altijd uit; bij een onzekere toewijzing toonde het scherm niet wát er in het bestand stond, terwijl dat
  precies het bewijs is dat de beoordelaar moet wegen; en een "Aantal dagen"-kolom belandde als broncode
  in de brongegevens. Ronde 13 (drie): een gedeelde achternaam volstond voor een (onzekere) toewijzing, dus
  "Piet Kowalski" landde bij Jan Kowalski; een kruistabel die met een datumkolom begint las de namen als
  uren in plaats van te blokkeren; en na het toepassen van een voorstel stond diezelfde dag bij een nieuwe
  uitlezing weer standaard aangevinkt. Ronde 14 (drie, alle klein): een streepje in een kruistabel werd
  alleen genoemd wanneer er een afwijkend weektotaal was; een gat in de rijenlijst bóven de kopregel liet
  de uitlezer struikelen; en boven de vijfhonderd regels was er geen praktische weg vooruit (nu een knop
  "Beperk tot de eerste 500"). Een intermitterende testflake is opgespoord en verholpen: de paneeltest rende
  501 rijen om de bovengrens te toetsen, wat in jsdom soms boven de vijf seconden uitkwam. De grens is nu
  injecteerbaar, de test klein (92 ms), en tien volledige runs op rij zijn schoon.
- **[PR #267](https://github.com/sitejob-nl/ja-works-hub/pull/267)** staat klaar, **basis
  `feat/urenmodule-bronpaginas`** (niet `main`). Merge #266 eerst; daarna kan #267 erachteraan.
- **Verbonden demo-QA geslaagd** (`scripts/e2e-hours-workbook-demo.spec.ts` +
  `scripts/playwright.hours-workbook.config.ts`, 4,8 s, `workbook-flow-passed`, 41 echte API-oproepen) op
  de bestaande QA-week `Urenmodule QA 20260910-pages-r2` met twee medewerkers, met een in de test gebouwde
  `.xlsx` van twee werkbladen. Bewezen: een als Excel aangeboden `.csv` geweigerd vóór opslag; werkbladaantal
  uit het echte bestand (2); uitlezen via een ondertekende link met de gelezen regels én het overgeslagen
  werkblad bij naam; een weektotaal dat als verstreken tijd was opgeslagen (`0,354166…`) door de dagen van
  diezelfde regel opgelost tot 8:30 — géén onterecht verschil, en géén doorgerekende formule; de hele
  uitlezing in één handeling als twee voorstellen vastgelegd met **nul** dagrevisies; toepassen als precies
  één dagversie van 510 minuten met herkomst "pagina 1 · blad Week · rij 2"; een onbekende indeling die
  blokkeert zonder halve voorstellen; en 403 voor een portaalgebruiker op zowel de innameprojectie als de
  uitlezer-RPC. Nul JavaScript-fouten, nul serverfouten, nul writes naar `timesheets`, nul berichten, nul
  betaalde AI-aanroepen. Dev-server op eigen poort 8089 met `PLAYWRIGHT_SKIP_WEBSERVER=1`.
- **De run claimde precies één onaangeroerde werkdag** — na afloop geverifieerd (r2: 12 → 11). Over alle
  QA-weken staan nog **56 onaangeroerde dagen** klaar. JA Werkt UIT, demo AAN, opnieuw geverifieerd na
  afloop. Het geblokkeerde `QA_SUPERADMIN`-account is ongemoeid gelaten.
- **Nog open:** PR #266 (T2) moet gemerged worden vóór deze branch; #267 heeft `feat/urenmodule-bronpaginas`
  als basis. Merge blijft een productiedeploy en dus aan Kas.

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
