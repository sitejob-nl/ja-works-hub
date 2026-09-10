# Urenmodule: duurzame mailinname vanuit de gekoppelde mailbox (T7)

**Status: gedeployed** (migraties `20260916090000_hours_mail_intake.sql`,
`20260916100000_hours_mail_intake_review_fixes.sql` en `20260916110000_hours_mail_intake_cron.sql`,
plus edge function `hours-mail-intake`, 16 september 2026). Additief: drie nieuwe org-gebonden
tabellen, twee nieuwe kolommen op bestaande brontabellen, zestien nieuwe RPC's en één cronjob.
`timesheets`, facturatie, urenbrieven, CSV-import en communicatie worden niet geschreven.
**JA Werkt staat UIT, de geverifieerde demo staat AAN** voor `uren-workflow`.

Dit document legt eerst de koppelingskeuze vast — hoe een binnengekomen antwoord aan precies één
klantweek komt te hangen — en daarna het contract van de inname zelf.

## De uitvraagreferentie: waarom deze er moest komen

De ticketlijst noemt bij T7 "de uitvraagreferentie" alsof die bestaat. Dat is niet zo. Zij komt
nergens in de code voor, en de outbox die haar zou meesturen is T8. Er moest dus eerst worden
besloten wát een antwoord aan een klantweek koppelt, en dat besluit moest zo worden gebouwd dat T8
hem later alleen nog hoeft **mee te sturen** — niet opnieuw hoeft uit te vinden.

### Wat er is gekozen

Eén rij per uitgaande urenuitvraag, in `hours_week_requests`, met scope op **precies één klantweek**
en een korte, leesbare code:

```
UR-7K3M-2XQ9
```

Die code gaat mee in het onderwerp van de uitvraagmail, tussen blokhaken: `[UR-7K3M-2XQ9]`. Een
antwoord houdt het onderwerp (`RE: …`), dus de code reist mee zonder dat de klant iets hoeft te doen.

De rij draagt daarnaast twee velden die **T8 invult** en T7 alleen leest:

| Veld | Wie vult het | Waarvoor |
| --- | --- | --- |
| `outbound_message_id` | T8, na verzending | De RFC-`Message-ID` van de uitvraagmail; het anker van de antwoordketen |
| `conversation_id` | T8, na verzending | Graph's eigen gesprek-id, als derde vangnet |
| `recipients` | T8, bij verzending | Aan wie de uitvraag ging; verbreedt wie als afzender wordt herkend |

T8 hoeft dus alleen: een rij aanmaken (of de bestaande van deze week pakken), de code in het
onderwerp zetten, en na verzending die drie velden bijwerken. De hele herkenning aan de
ontvangstkant staat er al.

### Waarom niet iets anders

- **Alleen de afzender plus de week raden** is precies de gok die dit ticket verbiedt. Eén
  opdrachtgever levert voor meerdere weken tegelijk aan, en een antwoord van vrijdag kan over de
  week ervóór gaan.
- **Alleen `conversationId`** is per mailbox en breekt zodra de klant een nieuw bericht begint in
  plaats van te antwoorden. Het is een goed vangnet, geen fundament.
- **Alleen de `In-Reply-To`-keten** is RFC-net en robuust bij echt antwoorden, maar bestaat pas
  zodra T8 daadwerkelijk verstuurt. Als enige mechanisme zou T7 tot die tijd niets kunnen.
- **De bestaande klantlink van T6 hergebruiken** kan niet: dat is een *geheim*. De database bewaart
  daar alleen de SHA-256 van, en het adres wordt exact één keer getoond. Een geheim in een
  onderwerpregel zetten die geciteerd en doorgestuurd wordt, is een geheim dat geen geheim is.

### De referentie is geen geheim, en dat is met opzet

De code zegt alleen *bij welke week* een aanlevering hoort. Zij geeft geen toegang en maakt geen
uren. Wie een code raadt, kan hooguit veroorzaken dat een bericht als **bron** bij een week wordt
gearchiveerd — en zelfs dat lukt alleen als de afzender ook wordt herkend als contactpersoon van
diezelfde opdrachtgever. Er ontstaat nooit een dagversie: alleen
`hours_apply_source_proposal` schrijft die, en die eist nog steeds een met naam bekende interne
gebruiker die het voorstel letterlijk overneemt.

De code is 40 bits uit een alfabet zonder verwarbare tekens (`23456789ABCDEFGHJKLMNPQRSTUVWXYZ`, dus
geen `0`/`O` en geen `1`/`I`), uniek binnen de organisatie.

## Hoe een bericht aan een week wordt gekoppeld

De volgorde is vast en deterministisch. Elke stap die niet sluit, stopt — er wordt nooit
doorgeraden naar de volgende.

1. **Handmatige toewijzing.** Heeft iemand van kantoor dit bericht in de controlebak zelf aan een
   week gehangen, dan is dat het antwoord. Een mens die kijkt wint van elk mechanisme.
2. **De referentiecode**, gelezen uit het **onderwerp** en uit de **nieuwe** tekst van het bericht.
   Nooit uit de geciteerde geschiedenis: daar staat de code van vorige week ook in, en die kiezen
   zou een gok zijn.
3. **De antwoordketen.** `In-Reply-To` en `References` worden vergeleken met
   `hours_week_requests.outbound_message_id`.
4. **Het gesprek.** `conversationId` tegen `hours_week_requests.conversation_id`.

Levert dat precies één uitvraag op, dan volgt de afzenderscontrole. De afzender wordt herkend als
zijn adres hoort bij de opdrachtgever van die week: een contactpersoon (`company_contacts.email`),
het bedrijfsadres, het factuuradres, of een adres waar de uitvraag naartoe is gestuurd
(`recipients`).

Alles wat daar niet doorheen komt gaat **zichtbaar** naar de interne controlebak, met een reden:

| Reden | Wanneer |
| --- | --- |
| `geen_uitvraag` | Geen code, geen antwoordketen, geen gesprek — niets om aan te koppelen |
| `onbekende_uitvraag` | Er stond een code in, maar die hoort bij geen enkele uitvraag |
| `dubbele_uitvraag` | Onderwerp en tekst noemen twee verschillende codes |
| `uitvraag_gesloten` | De uitvraag is ingetrokken of verlopen |
| `onbekende_afzender` | Het adres hoort bij niemand van deze opdrachtgever |
| `tegenstrijdige_koppeling` | De code wijst naar week A, de afzender hoort bij opdrachtgever B |
| `week_gesloten` | De opdrachtgever staat uit, of de urenmodule staat uit voor deze organisatie |
| `geen_werkdagen` | De week kent geen werkdagen om aan te wijzen |
| `niet_leesbaar` | Het bericht kon niet als MIME worden gelezen |
| `te_vaak_geprobeerd` | De verwerking is vaker mislukt dan de wachtrij toestaat |

Een bericht in de controlebak is **niet verwerkt**: er staat geen bron, geen voorstel en zeker geen
dagversie tegenover. Kantoor kan het van de lijst halen met een notitie, of het alsnog aan een week
hangen — dan pakt de eerstvolgende run het op en telt de menselijke toewijzing als de koppeling.

## De inname is strikt lezend

De mailbox wordt **alleen gelezen**. Er wordt niets als gelezen gemarkeerd, niets verplaatst, niets
verwijderd en niets verstuurd. Dat is geen belofte in proza maar een vorm in de code: de enige twee
poorten naar Microsoft Graph heten `graphJson` en `graphBytes`, er is geen derde, en geen van beide
heeft een methode-parameter om iets anders mee te doen dan ophalen. De implementatie stuurt letterlijk
`GET`, en weigert bovendien elk absoluut adres dat niet van `graph.microsoft.com` komt — een verzoek
draagt immers het token van die postbus.

Dat is bewust streng. De gekoppelde postbussen zijn echte zakelijke mailboxen van mensen — bij JA
Werkt drie, waaronder een gedeelde. Een innamefout mag daar hooguit niets doen.

## Duurzame cursor per gevolgde map

Per gevolgde map (`hours_mail_folders`) staat één cursor: de `deltaLink` die Graph teruggeeft aan
het eind van een delta-doorloop. De volgende run begint daar.

- **Onderbreking.** De cursor wordt pas bijgewerkt als de hele doorloop klaar is. Valt een run
  halverwege om, dan begint de volgende run opnieuw bij de laatst voltooide cursor: berichten worden
  hooguit opnieuw *gezien*, nooit overgeslagen.
- **Verlopen cursor.** Graph antwoordt `410` op een verlopen delta-token. Dan wordt de cursor
  weggegooid en begint de map volledig opnieuw. Dat levert álle berichten van die map op — en dus
  **geen** tweede bron, want de ontdubbeling hieronder houdt dat tegen.
- **Te grote map.** Een eerste volledige doorloop van een bestaande map is duizenden berichten, ver
  voorbij wat één run mag doen. Elke pagina wordt daarom meteen in de wachtrij gezet, in stukken van
  hoogstens tweehonderd, en wanneer de run zijn paginalimiet raakt wordt de **vervolglink** van Graph
  als cursor bewaard. De volgende run gaat daar verder in plaats van opnieuw bij pagina één te
  beginnen; zo loopt ook een map die niet in één run past uiteindelijk bij.
- **Mislukt vastleggen.** Gaat het wegschrijven van wat is gezien mis, dan blijft de cursor staan.
  Eroverheen stappen zou precies die berichten voorgoed verliezen, wat een duurzame cursor moet
  voorkomen.

## Stabiele bericht-id's

De sleutel is de RFC-`Message-ID` van het bericht (`internetMessageId`), niet Graph's eigen `id`.
Dat is de enige identiteit die een **verplaatsing overleeft**: Graph geeft een bericht een nieuw
`id` zodra het naar een andere map gaat, terwijl de `Message-ID` dezelfde blijft. Een bericht dat
van Postvak IN naar een gevolgde submap wordt gesleept is daardoor één bericht, geen twee.

Een bericht zonder `Message-ID` — dat komt voor bij kapotte verzenders — krijgt `graph:<id>` als
sleutel. Dat is minder stabiel en dat wordt niet verzwegen: zo'n bericht kan bij een verplaatsing
alsnog een tweede keer verschijnen. Het levert dan wel een tweede *bericht*, maar geen tweede
*bron*: het opslagpad is de SHA-256 van de bytes, en dat is voor hetzelfde bericht hetzelfde pad.

Ontdubbeling is `unique (organization_id, mail_account_id, message_key)`. Hetzelfde bericht tweemaal
ophalen levert dus één rij, één claim en één bron.

## Verwijderd of verplaatst: geen halve verwerking

- Een delta-doorloop die een bericht als **verwijderd** meldt, sluit dat bericht af zolang het nog
  in de wachtrij staat (`verdwenen`). Was het al verwerkt, dan blijft de bron staan: die is een feit
  over een aanlevering die echt heeft plaatsgevonden, en dat feit wordt niet teruggedraaid.
- Een bericht dat tussen zien en ophalen verdwijnt, geeft `404` op het ophalen van de bytes. Dan
  wordt het als `verdwenen` afgesloten en is er **niets** geschreven: geen bron, geen voorstel.
- Het vastleggen zelf is **één transactie**: bron, bijlagen en voorstellen landen samen of niet.
  Er bestaat geen tussentoestand waarin een bericht half in de administratie staat.

## De wachtrij: claim, lease en begrensde hernieuwingen

Dezelfde vorm als `hours_claim_source_reading` uit T4, maar voor werk in plaats van geld.

- **Claim.** `hours_mail_claim_messages` pakt per aanroep hoogstens een handvol wachtende berichten,
  zet een `claim_token`, een `lease_expires_at` en verhoogt `attempt_count`.
- **Lease.** Een claim vervalt vanzelf. Valt een edge-instantie om, dan komt het bericht na afloop
  van de lease weer in aanmerking — met de poging al geteld, zodat een bericht dat structureel
  omvalt niet eeuwig rondgaat.
- **Begrensde hernieuwingen.** `hours_mail_renew_lease` verlengt hoogstens een vast aantal keren.
  Daarna wordt niet meer verlengd: wie zó lang bezig is, is vastgelopen.
- **Begrensde pogingen.** Boven het maximum gaat het bericht naar de controlebak met
  `te_vaak_geprobeerd`. Geen verloren opdrachten, en ook geen stille eeuwige lus.
- Elke afronding eist het `claim_token`. Een instantie waarvan de lease is verlopen kan dus niets
  meer afsluiten dat inmiddels door een ander is opgepakt.

## Wat er van een bericht wordt gemaakt

Precies wat T5 al vastlegt, en door precies dezelfde code:

1. De **ruwe MIME** van het bericht (`/messages/{id}/$value`) wordt bewaard als bron van type
   `message/rfc822` — hetzelfde artefact dat ontstaat als iemand een `.eml` in het weekscherm sleept.
2. `decodeEmailMessage` haalt kopregels, nieuwe tekst, geciteerde geschiedenis en bijlagen uit elkaar.
3. `readHoursFromMailText` leest de **nieuwe** tekst regel voor regel tot voorstellen.
4. Elke aanvaarde bijlage wordt een bron van zichzelf en noemt via `received_with_source_id` het
   bericht waaruit hij komt. **Eén ontvangst**, precies zoals T5.

Beide lezers zijn hiervoor verhuisd van `src/lib/` naar `supabase/functions/_shared/`, met een
doorgeefluik op de oude plek. Het is dus dezelfde lezer, niet een tweede: één stel regels beoordeelt
een mail die iemand uploadt en een mail die vanzelf binnenkomt.

### Deze route betaalt nooit

Een bijlage wordt **bewaard**, niet uitgelezen. De betaalde scanroute van T4 blijft een bewuste
handeling van een mens, achter dezelfde knop en dezelfde maandblokkade in `_shared/ai-accounting.ts`.
Een onbeheerde baan die per binnenkomende mail een provider aanroept, is een rekening die niemand
heeft goedgekeurd.

Het gevolg is dat een gemailde bijlage `page_count = null` krijgt: er is geen browser die de
pagina's telt, en een verzonnen aantal is erger dan een eerlijk onbekend aantal. Paginabesluiten
blijven mogelijk — een onbekend aantal accepteert elk paginanummer.

## De grens is ongewijzigd

Een binnengehaalde mail landt als **bron met voorstel**, nooit als dagversie. Alleen
`hours_apply_source_proposal` schrijft een dagrevisie en neemt het voorstel letterlijk over, na een
expliciete handeling van een bevoegde interne gebruiker. Er wordt niets geschreven naar `timesheets`,
facturatie, urenbrieven, CSV-import of communicatie.

Een bron uit de mail heeft geen interne auteur en geen klantlink: hij noemt het **bericht** waar hij
uit komt. Dat is de derde herkomst naast "kantoor uploadde dit" en "de opdrachtgever leverde dit
aan", en de administratie zegt dat ook in plaats van iemand te crediteren die er niet bij was.

## De onbeheerde run

Edge function `hours-mail-intake` (`verify_jwt = false`, self-auth), met twee ingangen:

- **Cron.** `x-cron-secret` tegen `CRON_SECRET`, precies zoals de vier bestaande cronjobs. Loopt over
  de organisaties waar de urenmodule aanstaat en per organisatie over de ingeschakelde mappen. JA
  Werkt staat uit, dus daar gebeurt niets — dat is een feit van de poort, geen discipline.
- **Handmatig.** Een interne gebruiker met `finance.manage` haalt de eigen organisatie nu op. Zelfde
  code, zelfde grenzen, alleen een andere aanleiding.

## Fouten

| Code | HTTP | Betekenis |
| --- | --- | --- |
| `42501` | 403 | Geen bevoegdheid, verkeerde organisatie, of een ontoegankelijke map |
| `22023` | 400 | Ongeldige invoer, uitgeschakelde opdrachtgever, of een onbekende reden |
| `mail_intake_unavailable` | 503 | Tijdelijk niet beschikbaar |
| `PT409` | 409 | De week is ondertussen gewijzigd |


## De onbeheerde run, ingepland

pg_cron-job `hours-mail-intake-quarterly`, elk kwartier:

```
*/15 * * * *  →  POST /functions/v1/hours-mail-intake   (header x-cron-secret)
```

Zelfde vorm als de vier bestaande cronjobs: pg_cron stuurt `public.get_cron_secret()` mee en de
functie vergelijkt die met `CRON_SECRET`. Een geraden sleutel krijgt `403`.

Een run blijft klein — hoogstens tien mappen en vijf berichten per map. Een map die groter is dan
één run onthoudt waar zij gebleven was, dus zij loopt over een paar doorlopen bij in plaats van
telkens dezelfde eerste pagina's te lezen.

## Wat een gevolgde map van de postbus vastlegt

Van **elk** bericht in een gevolgde map worden onderwerp, afzender en ontvangstmoment vastgelegd,
ook van mail die niets met uren te maken heeft. Dat is de prijs van een wachtrij die weet wat zij al
gezien heeft. Het scherm zegt het bij het kiezen van een map met zoveel woorden, met het advies om
een **aparte map** te volgen waar een postbusregel de urenmail naartoe verplaatst — en niet Postvak
IN zelf.

Wat er níet wordt vastgelegd is de inhoud: alleen een bericht dat aan een klantweek kon worden
gekoppeld wordt als bron bewaard, en dan als het hele oorspronkelijke bericht in de privébucket, net
als een `.eml` die iemand zelf uploadt.

## Verificatie (T7)

- **312 echte PostgreSQL-tests** (`scripts/hours-mail-intake-db-test.py`): de nieuwe uitvraag-,
  cursor-, wachtrij-, koppelings- en controlebakgevallen plus de volledige vrijgegeven Word/mail-,
  scan-, klantweek-, werkmap-, pagina-, inname-, classificatie-, modulepoort- en
  foundationregressies op het nieuwe schema. Alle zeventien migraties worden tweemaal toegepast; de
  poortproef dekt nu **tweeëntwintig** tabellen.
- **Applicatietests**: `hours-mail-intake.test.ts` (35 gevallen over de hele innamegrens, met
  gefixeerde Graph-antwoorden), `hours-mail-link.test.ts` (11), `hours-mail-intake-ui.test.tsx` (16)
  en `hours-week-requests-ui.test.tsx` (7). Totaal 1.897 groen, met lint (0 errors), typecheck en
  productiebuild.
- **Verbonden demo-QA** (`scripts/e2e-hours-mail-demo.spec.ts`): echte interne login, één echte
  gevolgde map in de demo-postbus, twee echte doorlopen tegen Microsoft Graph. Bewezen: het bewaarde
  token wordt ontsleuteld en gebruikt, de delta-vraag antwoordt, de cursor die Graph teruggeeft wordt
  bewaard én door de tweede doorloop geaccepteerd zonder hersynchronisatie, er wordt geen enkele map
  van een andere organisatie bevraagd, en **alle acht mappen van de postbus hebben na afloop
  exact hetzelfde aantal items en ongelezen items als ervoor**. Nul dagrevisies, nul writes naar
  `timesheets`, nul betaalde aanroepen, nul JavaScript-fouten, nul serverfouten.

Wat deze QA **niet** bewijst is een echt bericht dat tot een voorstel wordt gelezen. Daarvoor zou een
bericht in een testmap moeten worden klaargezet, en de demo-postbus staat bewust op lezen en
versturen — verplaatsen en verwijderen zijn er uitgeschakeld. Die weg wordt gedekt door gefixeerde
Graph-antwoorden over dezelfde handler en door echte PostgreSQL in de databaseproef.
