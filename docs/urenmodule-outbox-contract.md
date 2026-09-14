# Urenmodule: mailprofielen, deadlines en een outbox met conceptgoedkeuring

**Status: gebouwd, nog niet uitgerold.** Dit is ticket T8 uit
[de ticketlijst](urenmodule-tickets.md#t8--mailprofielen-deadlines-en-outbox-met-conceptgoedkeuring).
De bronbestanden zijn `20260918090000_hours_outbox.sql` (schema en RPC's),
`20260918100000_hours_outbox_cron.sql` (de onbewaakte run) en edge function `hours-outbox`.
Er is op deze route **geen betaalde aanroep**, geen export, geen schrijfactie naar de legacy
`timesheets`-route en geen enkele aanraking van het vrijgaveregister `hours_day_releases` (dat blijft
leeg en zonder schrijfroute tot T12).

## De helft die er al was

`_shared/hours-schedule.ts` bestaat sinds de eerste release en beslist **wat** er uitgaat en **wanneer**.
Hij zegt het zelf in zijn eerste regel: *"Pure planning only. A sender must recheck the current revision,
recipient and outbound pause."* Er was alleen nooit iets dat hem aanriep — de
[bouwstand](urenmodule-bouw.md) noemde dat expliciet: *"Deze planner is nog niet aangesloten op een
duurzame outbox of Outlook; hij verstuurt geen berichten."*

T8 bouwt precies die andere helft, en verplaatst **geen enkele beslissing** naar de database:

| Waar | Wat daar wordt beslist |
|---|---|
| `_shared/hours-schedule.ts` | Welk moment een regel oplevert, of een ontvanger nog iets moet doen, of een correctie goedkeuring nodig heeft, en welke `dedupKey` een actie draagt. Ongewijzigd. |
| `public.hours_mail_profiles` | Welke regels er per opdrachtgever zijn. Bewaart de **regelvorm van de planner zelf**, letterlijk — geen tweede dialect. |
| `public.hours_mail_templates` | De woorden van één bericht per taal, geadresseerd met de `templateId` die een regel al droeg. |
| `public.hours_outbox_messages` | Eén rij per geplande boodschap, met de `dedupKey` als sleutel. |
| `_shared/hours-outbox.ts` | Het samenstellen van de mail (merk-wrapper, uitvraagcode in het onderwerp) en het afhandelen van wat de mailserver antwoordt. |
| `_shared/outlook-send.ts` | De enige uitgang. |

## De vijf acceptatiecriteria, en waar ze afgedwongen worden

**Twee opdrachtgevers met verschillende schema's krijgen hun berichten op de juiste momenten.**
Elk profiel hoort bij één `company_id`. De twee deadlines komen niet uit de huidige instellingen maar uit
`hours_weeks.settings_snapshot` — de **bevroren** instelling van die week — zodat een latere wijziging een
oude week niet verschuift. `private.hours_deadline_moment()` zet dagnummer plus tijd om in de weekvorm die
de planner verwacht; `hours_weeks.submission_deadline_at` is ooit uit precies diezelfde getallen berekend.

**Een uitgeschakelde berichtsoort verstuurt niets.** `enabled: false` levert bij de planner een
`disabledRuleId` en géén actie, dus er wordt niets gepland, niets opgeslagen en niets verstuurd. Een week
waarvan géén enkele regel aanstaat komt niet eens in `hours_outbox_due_weeks` terug. Een profiel dat niet
bestaat betekent hetzelfde: er gaat niets uit.

**Een concept wordt pas verzonden na expliciete goedkeuring; een gewijzigde bronrevisie ongeldigt het.**
Drie sloten, in oplopende hardheid:

1. `hours_outbox_claim` geeft alleen rijen met status `gereed` of `goedgekeurd` terug.
2. `goedgekeurd` is alleen bereikbaar via `hours_approve_outbox_message` — een interne gebruiker met
   `finance.manage`, die de **inhoudsvingerafdruk én de bronrevisie** meestuurt die hij op het scherm zag.
   Wijkt één van beide af, dan is het `PT409` en geen goedkeuring van iets wat niemand gelezen heeft.
3. Een `approval_required`-rij kan de database-CHECK `status <> 'gereed'` nooit passeren. Een ingestelde
   verzendtijd kan de goedkeuring dus niet omzeilen, ook niet als een RPC zich zou vergissen.

Ongeldig maken gebeurt bij elke planning opnieuw: `hours_outbox_sync` vergelijkt de bewaarde
`approved_content_hash` en `approved_source_revision` met de verse waarden. Verschilt er één, dan wordt de
goedkeuring gewist, valt de rij terug op `concept` met `goedkeuring_vervallen`, en verdwijnt hij uit de
verzendbare verzameling. De bronrevisie is `private.hours_week_source_revision()`: de vingerafdruk van de
actuele dagversies van de week.

**Een herhaalde cron-run verstuurt niets dubbel; een provider-5xx leidt niet tot ongecontroleerde retry.**
`unique (organization_id, dedup_key)` op de sleutel die de planner zelf al maakte. Een verzonden rij is
bovendien onveranderlijk: de trigger `hours_outbox_sent_immutable` weigert elke UPDATE en DELETE, ook voor
de database-eigenaar. Een tweede run ziet de rij als `completed` terugkomen in `existing_actions` en plant
er niets nieuws voor.
Een claim telt meteen een poging, dus een run die halverwege omvalt kost één poging en niet het bericht.
Een 5xx of 429 is `transient`: de claim gaat terug, `next_attempt_at` schuift op (3, 9, 27, 81, 240
minuten) en bij de vijfde mislukking wordt de rij `mislukt` met `te_vaak_geprobeerd`. Alles wat géén 5xx
of 429 is, is `permanent` en wordt helemaal niet opnieuw geprobeerd — een verkeerd adres wordt door
herhalen niet beter.

**Bij actieve outbound-pauze wordt als concept gelogd, niet stil weggegooid.** De enige uitgang is
`sendViaOutlookAccount`, en dáár zit `isOutboundPaused()`: bij pauze gaat het bericht als
`message_type='concept'` in `communications` en komt `communicationPaused: true` terug. De outbox
behandelt dat als uitkomst `paused` en **niet** als mislukking: de claim gaat terug, de goedkeuring blijft
staan, `block_reason` wordt `uitgaande_pauze`, en de poging wordt **teruggegeven** (`attempt_count - 1`).
Een operationele pauze mag het retourbudget niet opeten.

## De uitvraagreferentie

`hours_week_requests` bestond al (T7) met de code `UR-XXXX-XXXX`. T8 doet er precies wat het
[mailinnamecontract](urenmodule-mail-intake.md) beschrijft en niets meer:

- de code reist mee in het onderwerp, tussen blokhaken, **alleen bij een bericht aan de opdrachtgever**;
- na verzending worden `outbound_message_id`, `conversation_id` en `recipients` bijgewerkt.

Dat gebeurt **exact één keer**, bij het eerste bericht aan de opdrachtgever. T7 heeft die velden namelijk
al bevroren: `private.hours_request_guard` weigert het bericht-id, het gesprek, de ontvangers én het
tijdstip te verplaatsen zodra `sent_at` staat. Een latere herinnering laat de uitvraag daarom met rust —
een klant antwoordt op het bericht dat hij ziet, en het anker verzetten zou juist die draad breken.
T8 schikt zich daarnaar in plaats van eromheen te werken.

Graph's `sendMail` geeft niets terug, dus `outlook-send.ts` heeft er één additieve stand bij gekregen:
`captureIdentifiers`. Die maakt het bericht eerst aan (`POST /messages`, dat wél `internetMessageId` en
`conversationId` teruggeeft) en verstuurt het daarna. Zonder die vlag is het pad byte voor byte wat het
was. Elke andere afzender blijft dus ongewijzigd.

## Ontvangers

De planner kent alleen ondoorzichtige `recipientIds`. `private.hours_outbox_recipients()` lost ze op
binnen de eigen organisatie: een contactpersoon van **deze** opdrachtgever, een kandidaat, of een actief
intern profiel. Een id dat van iemand anders is komt gewoon niet terug — het bericht landt dan zichtbaar
als concept met `onbekende_ontvanger` en gaat nooit naar een geraden adres.

Eén jokerwaarde bestaat, en alleen voor medewerkers: `"*"` betekent *alle medewerkers van deze week*.
`private.hours_outbox_expand_rules()` vouwt hem per week uit vóórdat er gepland wordt, zodat elke
`dedupKey` nog steeds één echt persoon noemt. Voor een klantcontact of een interne eigenaar is hij
geweigerd: dat zijn mensen die iemand gekozen heeft, geen verzameling.

## Wat deze route bewust niet doet

- **Deadlinetaken.** De planner kent `submission_deadline` en `approval_deadline` als taak voor de
  verantwoordelijke. Die horen bij T11 (intern weekoverzicht), niet bij een postbus.
  `hours_save_mail_profile` weigert ze met een melding die dat zegt, en `hours_outbox_messages` kent de
  twee soorten niet eens. Zo kan er geen bericht worden opgeslagen dat nergens heen kan.
- **Zelf herberekenen, vrijgeven of exporteren.** Niets hier raakt een dagrevisie, een matrixbasis of het
  vrijgaveregister.
- **Een tekst verzinnen.** Zonder `hours_mail_templates`-rij voor de gekozen `templateId` + taal landt het
  bericht als concept met `ontbrekende_tekst`. Er is geen ingebouwde standaardtekst.

## Publieke RPC's

| RPC | Rol | Resultaat |
| --- | --- | --- |
| `hours_get_mail_profile(uuid)` | `finance.view` | profiel + teksten van de organisatie |
| `hours_save_mail_profile(uuid, integer, jsonb, text, integer)` | `finance.manage` | CAS op `version`; `PT409` bij gelijktijdige wijziging |
| `hours_save_mail_template(text, text, text, text)` | `finance.manage` | upsert van één tekst |
| `hours_outbox_overview(uuid, uuid, integer)` | `finance.view` | de outbox van de eigen organisatie |
| `hours_approve_outbox_message(uuid, text, text)` | `finance.manage` | de enige weg naar `goedgekeurd` |
| `hours_withdraw_outbox_message(uuid, text)` | `finance.manage` | `vervallen`; een verzonden bericht wordt geweigerd |

Zes verdere RPC's (`hours_outbox_due_weeks`, `_sync`, `_claim`, `_record_sent`, `_record_failure`,
`_release`) zijn **alleen voor `service_role`** en worden uitsluitend door edge function `hours-outbox`
aangeroepen. `anon` heeft op geen van de twaalf `EXECUTE`.

## Statussen

| Status | Betekenis |
| --- | --- |
| `concept` | Nog niet verzendbaar. `block_reason` zegt waarom, in de woorden van de planner of van het profiel |
| `gereed` | Gepland en verzendbaar; het schema is hier de autorisatie. Nooit bereikbaar voor een bericht dat goedkeuring vereist |
| `goedgekeurd` | Een mens heeft precies deze woorden en deze uren goedgekeurd |
| `verzonden` | Onveranderlijk. Draagt zijn bericht-id of gesprek-id |
| `mislukt` | Definitief geweigerd of te vaak geprobeerd; vraagt een mens |
| `vervallen` | Niet meer gepland of ingetrokken |

## Verificatie

De databaseproef is `scripts/hours-outbox-db-test.py`. Die erft de volledige
basisvervangings-, mailinname-, Word/mail-, scan-, klantweek-, werkblad-, pagina-, inname-, modulepoort-,
classificatie- en funderingsregressies en overschrijft expliciet wat is verschoven: de poortlijst
(nu **zevenentwintig** tabellen), de functiesignaturen (twaalf erbij), de service-role-lijst en de
migratielijst (nu **eenentwintig**). De migraties worden elk tweemaal toegepast.

De handler heeft zijn eigen suite (`src/test/hours-outbox.test.ts`): de hele run zonder postbus, sessie of
klok, met elke poort geïnjecteerd. De schermen staan in `src/test/hours-outbox-ui.test.tsx`.

## Openstaand

- **Het schema per partij is nog klantinput.** De module gaat leeg live: zonder ingevuld mailprofiel gaat
  er niets uit. Welke berichten JA Werkt per opdrachtgever wil, naar wie en op welk moment, is de
  ontbrekende uitvraag uit [de ticketlijst](urenmodule-tickets.md) en wordt invoer in het scherm, geen code.
- **Niet uitgerold.** De migraties, de cron en de edge function staan nog niet op productie, en
  `src/integrations/supabase/types.ts` kent de zes nieuwe RPC's daarom nog niet. Zolang dat zo is loopt de
  frontend via `src/lib/hours-outbox-api.ts`; dat bestand beschrijft zichzelf en verdwijnt zodra de types
  opnieuw gegenereerd zijn.
