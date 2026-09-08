# SaaS-beschikbaarheid van de urenmodule

De nieuwe urenmodule heeft een eigen recht per SaaS-bedrijf (`organizations`):
`organization_modules.module_name = 'uren-workflow'`. Alleen een expliciete
`enabled = true` geeft toegang. Geen rij, `false` of een bestaande `null` betekent uit.
Een abonnement activeert deze module niet automatisch. Het bestaande recht `uren`
en de bestaande urenregistratie blijven afzonderlijk werken.

Dit is een andere laag dan `hours_company_settings.enabled`: die laatste instelling
activeert de werkwijze voor een opdrachtgever (`companies`) binnen een toegelaten
SaaS-organisatie. Voor schrijven moeten beide instellingen aanstaan. Als alleen de
opdrachtgeverinstelling uitstaat, blijven eerdere weken leesbaar. Als het SaaS-recht
uitstaat, zijn alle nieuwe week-, matrix- en classificatiegegevens ontoegankelijk.
Aan- en uitzetten verwijdert geen uren, revisies, reacties of matrixversies.

## RPC-contract

`hours_get_module_access()` accepteert geen organisatie uit de browser en geeft:

```ts
{ organization_id: string | null; enabled: boolean }
```

De organisatie komt uitsluitend uit het actieve profiel bij de gebruikers-JWT.
Een actief profiel zonder organisatie krijgt `null/false`. Een ontbrekende sessie,
een ontbrekend profiel of een inactief profiel krijgt foutcode `42501`. Een gewone
interne of portaalgebruiker kan hiermee geen rechten van een andere tenant opvragen.
De frontend controleert de geretourneerde organisatie tegen zijn auth-context en
blijft gesloten tijdens laden, fouten of een mismatch.

`sa_set_hours_workflow_enabled(p_organization_id uuid, p_enabled boolean)` geeft
dezelfde vorm terug, met de doelorganisatie. Deze functie is uitsluitend uitvoerbaar
voor `authenticated` en controleert daarnaast de echte SaaS-superadminregistratie
plus de canonieke `private.is_active_user()`-controle. Een tenantadmin heeft dit recht
niet. De bestaande SaaS-only superadmin zonder profiel blijft toegestaan; een
expliciet gedeactiveerd superadminprofiel wordt geweigerd. `null` en onbekende
organisaties worden geweigerd (`22023`). Dezelfde waarde opnieuw instellen is
idempotent en maakt geen extra wijzigingslog.

Een rijtrigger beschermt ook directe inserts, updates, upserts en deletes van
`uren-workflow`, zodat de bestaande modulebeheerroute de controle niet kan omzeilen.
Organisatie, sleutel en rij-ID van deze override kunnen niet worden gewijzigd;
ook omzetten van een andere modulesleutel naar `uren-workflow` is geweigerd. Een
nieuwe waarde moet expliciet `true` of `false` zijn. Andere modules worden door deze
trigger niet gewijzigd.

## Database- en servergrenzen

- `private.hours_require_module(write)` controleert het actieve eigen profiel, de
  organisatie en de expliciete SaaS-override.
- `private.hours_require_internal` roept deze controle aan vóór de bestaande
  `finance.view`/`finance.manage`-controle. Daardoor vallen ook matrixbeheer,
  CAO-koppelingen, opdrachtgeverinstellingen, weekcreatie en classificatiecontext
  onder het recht.
- De actuele week- en lijst-RPC's controleren het recht ook voor medewerkers.
  Dagwijzigingen en reacties gebruiken de controle in `private.hours_lock_day`.
  De batchbevestiging controleert het schrijfrecht vóór het vergrendelen van de week.
- De service-only classificatiefinalisatie blijft de oorspronkelijke actor
  controleren. Haar bestaande dubbele interne controle bevat nu eveneens de
  SaaS-gate. Een context die vóór uitzetten is opgehaald, kan daarna geen resultaat
  meer opslaan.
- Alle dertien nieuwe `hours_*`-tabellen krijgen een beperkende SELECT-policy
  bovenop hun bestaande tenant- en rolpolicies. Een rechtstreekse tabelquery kan
  de RPC-gate niet omzeilen.
- Alleen de nieuwe, argumentloze leeshulp `private.hours_module_enabled()` is voor
  `authenticated` uitvoerbaar ten behoeve van deze policies. Zij geeft uitsluitend
  de boolean voor het eigen actieve profiel terug. De overige private schrijfhulpen
  blijven onuitvoerbaar voor clients en service_role.

Schrijvers nemen eerst een gedeelde rijvergrendeling op de eigen organisatie, daarna
de bestaande week-, dag- of matrixvergrendelingen. Een modulewijziging neemt een
exclusieve vergrendeling op dezelfde organisatie. Een bevestigde UIT-wijziging wacht
daarom op eerder toegelaten urenwrites; daarna gestarte of wachtende schrijvers
worden geweigerd. De schrijfhulp is bewust `VOLATILE`, zodat zij na wachten bij
`READ COMMITTED` de nieuwste override leest. Zij vergrendelt de module-rij niet.
Schrijven vanuit `REPEATABLE READ` of `SERIALIZABLE` wordt expliciet geweigerd
(`25001`), zodat een langer bestaande snapshot geen oude AAN-vlag kan blijven
gebruiken. Dit wijzigt het gebruikelijke `READ COMMITTED`-gedrag van PostgREST niet.
De modulemutaties vergrendelen eerst de module-rij en daarna de organisatie: bij
updates/verwijderen in de BEFORE-trigger, bij inserts in de AFTER-trigger vóór de
commit. Zo vormt een directe update geen omgekeerde lockvolgorde met een upsert.
Een nog niet vastgelegde insert is niet zichtbaar voor andere sessies.
Lopende leestransacties kunnen hun bestaande snapshot afronden; nieuwe aanvragen
en directe URL's leveren bij UIT geen nieuwe toegang.

Werkelijke veranderingen worden servermatig opgenomen in `audit_log`, met de
modulesleutel, oude/nieuwe waarde en actor-ID. Een profiel-loze SaaS-superadmin wordt
via `actor_id` vastgelegd en laat de profiel-FK `user_id` leeg. Tijdens een toegelaten
cascadeverwijdering van een organisatie wordt geen verweesde auditregel toegevoegd.

## Uitrol en controle

De migratie `20260908160000_hours_workflow_organization_gate.sql` volgt op de drie
urenmigraties en is herhaalbaar. Ze bevat geen organisatie-ID's en zet geen enkele
tenant automatisch aan. Voor de eerste uitrol bouwt
`scripts/build-hours-initial-release.py` één transactie met de vier migraties.
Binnen die transactie zet een expliciete, door Kas gevraagde bootstrap JA Werkt op
UIT en de geverifieerde demo op AAN, vóór installatie van de moduletriggers.
Er ontstaat daardoor geen tijdelijk ongecontroleerde uren-API. De migratie-receipt
legt deze twee begininstellingen, de volledige SQL en bronhashes vast; volgende
wijzigingen lopen via de actieve SaaS-adminsessie en krijgen een auditregel.
De vier bronversies worden binnen dezelfde transactie in de migratiehistorie
geregistreerd, zonder bestaande versies te overschrijven.

Een volledige controle omvat echte login, week- en matrixbeheer, een medewerkerreactie,
een nieuwe revisie, classificatie via de edge function en UIT/AAN in SaaS-beheer.
Controleer tijdens UIT zowel nieuwe routebezoeken als bestaande sessies en directe
RPC's, en controleer na AAN dat historie en revisies bewaard zijn. Geïsoleerde
PostgreSQL-tests controleren aanvullend rechten, alle dertien policies, audit,
herhaalbaarheid en gelijktijdig schrijven/uitzetten. De actuele bewijsbestanden en
uitrolstatus staan in de bouwstand; deze contracttekst op zichzelf claimt geen deploy.
