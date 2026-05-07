# Carerix integratie-audit

Datum: 2026-05-07

## Aanleiding

De Carerix-koppeling is geen simpele lijst-import. Voor JA Werkt moet de import een keten doorlopen van bedrijven, contactpersonen, kandidaten, vacatures/jobs, matches, werkhistorie/plaatsingen, documenten en notities/taken. De meeting van 2026-04-10 noemt expliciet dat de Carerix/CarreraX-data volledig ingeladen moet worden voordat de echte acceptatietest kan starten. De meeting van 2026-04-30 gaat niet over Carerix maar over Q8/On-track tankpascontrole; die scope blijft apart acceptatiekritisch.

## Huidige keten in code

De live API-sync bestaat uit:

- `carerix-config`: OAuth2 client-credentials opslaan en testen.
- `carerix-test`: verbindingstest; vanaf nu test deze ook of de rijke `CR*`-scope beschikbaar is.
- `carerix-introspect`: GraphQL schema zichtbaar maken voor tenant-specifieke veldcontrole.
- `carerix-sync-start`: admin start een job en maakt entity-runs aan.
- `carerix-sync-worker`: interne service-role worker die pagina's verwerkt.
- `carerix-sync-cancel`: admin kan lopende jobs stoppen.
- `carerix-attachment-download`: haalt bytes per Carerix-document op en zet ze in Supabase Storage.

De runners verwerken nu:

- `companies` via publieke `companyPage`.
- `contacts` via publieke `contactPage`.
- `candidates` via `crEmployeePage`.
- `vacancies` via `crJobPage`.
- `matches` via `crMatchPage`.
- `placements` via `crWorkHistoryPage`.
- `documents` via `crEmployee(_id).attachments`, daarna bytes via `crAttachment(_id) { content }`.
- `notes` via `crToDoPage`.

`employment` is bewust geen aparte runner: in deze tenant is werkhistorie gemodelleerd als `CRWorkHistory` en komt die in JA Werkt terecht als `placements`.

## Wat goed staat

- De OAuth-scope staat standaard op `urn:cx/cx5Wrapper:data:manage`, precies de scope die nodig is voor het rijke Carerix-schema.
- De importvolgorde respecteert afhankelijkheden: bedrijven en kandidaten eerst, daarna vacatures/matches/plaatsingen/documenten/notities.
- `external_mappings` houdt Carerix-ID's apart van JA Werkt-ID's, waardoor reruns idempotent kunnen zijn.
- De documentflow is correct in twee stappen gesplitst: metadata eerst, bytes daarna. Dat past beter bij Supabase Edge soft deadlines.
- Attachment-discovery loopt door alle attachment-pages per kandidaat, niet alleen de eerste 100.
- `norestrict: true` staat aan in de `CR*`-queries, waardoor historie en soft-deleted records niet stilletjes buiten beeld vallen.
- `carerix-introspect` is belangrijk en aanwezig; Carerix-velden verschillen per tenant.

## Gaten en risico's

1. `companies` en `contacts` gebruiken nog het minimale publieke schema.
   Daardoor ontbreken waarschijnlijk KVK, adressen, telefoons, rollen, contactstatussen en branche/custom fields. Voor volledige migratie moeten `crCompanyPage` en `crContactPage` erbij.

2. Er is nog geen REST fallback.
   GraphQL `crAttachment(_id) { content }` is goed als het werkt, maar Carerix' legacy REST `/CRAttachment/{id}?show=content` en `/CREmployee/{id}/attachment?tag=cv` zijn nuttig als GraphQL-content of tagfiltering tenant-specifiek hapert.

3. Notities en taken worden nog samengevoegd als notes.
   `CRToDo` bevat `isNote`, `isTask`, `isMeeting`, `isEmail`. Nu komt alles als interne note terecht. Taken met deadline/status horen deels naar `recruiter_tasks`.

4. `CRMatch` en `CRWorkHistory` moeten businessmatig nog worden gevalideerd.
   De code zet `CRMatch` in `matches` en `CRWorkHistory` in `placements`. Dat is logisch, maar de eerdere migratie-designnotitie noemde `CRMatch -> placements`. De juiste interpretatie moet met echte JA Werkt-data worden bevestigd.

5. CV-documenten krijgen alleen PDF-nabehandeling.
   Carerix CV-bijlagen als PDF vullen na byte-download `candidates.cv_file_url`, zodat de AI-backfill ze kan oppakken. Niet-PDF CV's blijven gewone documenten en vragen nog OCR/conversie of handmatige verwerking.

6. Delta-sync is nog polling/watermark, geen webhook.
   Voor productie na bulkimport is een `carerix-webhook` met `Cx-Signature` validatie de nette route, aangevuld met daily watermark-fallback.

## Concrete herstelvolgorde

1. Draai met echte JA Werkt-credentials `carerix-test` en `carerix-introspect`. Zonder actieve `CR*`-scope is volledige import niet acceptatieklaar.
2. Voeg `crCompanyPage` en `crContactPage` runners toe en map adressen, KVK, telefoons, contactrollen en status/custom fields.
3. Handel niet-PDF CV's expliciet af via conversie/OCR of handmatige taak.
4. Split `CRToDo`: notities naar `notes`, taken met deadline/status naar `recruiter_tasks`, meetings eventueel naar activity/notes met type metadata.
5. Valideer met productiedata of `CRWorkHistory` echt de plaatsing-SSOT is en of `CRMatch` alleen pipeline moet blijven.
6. Voeg REST fallback toe voor attachments en eventueel `describe`-metadata.
7. Bouw `carerix-webhook` pas na succesvolle bulkimport; anders debug je tegelijk bulk en realtime.

## Meetingcontext

- 2026-04-10: Carerix/CarreraX-data volledig inladen is een voorwaarde voor echte test/acceptatie. Daarnaast kwamen onboardinglink, profiel-flow, match/voordragen en preview/UI-flow terug als acceptatiepunten.
- 2026-04-30: niet Carerix maar Q8/On-track. Belangrijk: Q8 en GPS moeten exact dezelfde periode gebruiken, verbruik wordt vergeleken met een configureerbare marge rond 10-15%, en afwijkingen zijn een signaaltool, geen harde fraude-uitspraak.

## AI-afspraak

De offerte noemt alleen AI op eigen EU-server. De code ondersteunt inmiddels twee paden:

- Default: Hetzner VPS met Qwen3-14B via Ollama, async en gratis voor de klant.
- Optioneel: Anthropic Claude Haiku 4.5 via Cloud, sneller, met server-side pseudonimisering en credit-afschrijving.

Het €50-budget is technisch aanwezig als starterbudget in `organization_credits` (`balance_cents = 5000`). Dat maakt de cloud-route uitlegbaar, maar contractueel moet expliciet worden vastgelegd dat cloudverwerking opt-in is, dat CV-data vooraf gepseudonimiseerd wordt en dat usage/costs gelogd worden.
