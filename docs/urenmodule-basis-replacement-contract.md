# Urenmodule: expliciete vervanging van een vastgelegde matrixbasis

**Status: gebouwd; de database staat op productie, de frontend wacht op merge.** Het bronbestand is
`20260917090000_hours_matrix_basis_replacement.sql`; dat ene bestand levert de volledige eindtoestand
op, inclusief de indexen op de tenant-gebonden foreign keys. Op productie is diezelfde eindtoestand in
vier stappen via de Supabase-MCP aangebracht (basismigratie, de twee indexen, de hercontrole van de
werkwijzeschakelaar uit reviewronde 1, en de datumgetypeerde geldigheidsregel plus het stempelen van
`basis_version` uit reviewronde 2). Daarna is de bestandsversie `20260917090000` zelf in
`supabase_migrations.schema_migrations` geregistreerd, zoals bij de zustermigraties, zodat een latere
`db push` het bestand niet opnieuw uitvoert. De definities zijn identiek. Dit is ticket T10 uit
[de ticketlijst](urenmodule-tickets.md#t10--expliciete-vervanging-van-een-vastgelegde-matrixbasis).
Er is op deze route **geen betaalde aanroep**, geen export, geen bericht en geen schrijfactie naar de
legacy `timesheets`-route.

De grens uit het [classificatiecontract](urenmodule-classification-contract.md) blijft staan:
`hours_day_matrix_basis` is onherroepelijk. Deze stap voegt daar geen uitzondering aan toe, maar een
aparte, gecontroleerde procedure die de **werkende** basis vooruitschuift zonder de vastgelegde basis
of een eerdere uitkomst aan te raken.

## Wat een vervanging is, en wat niet

Een vervanging is één append-only rij in `hours_day_matrix_basis_replacements`. Die rij bevat de
gekozen matrixversie, de versie die hij vervangt, de volledige selectiecontext van dat moment, de
actor, het tijdstip en een verplichte reden. De rij rekent niets uit en wijzigt geen enkele bestaande
rij.

**Geen tweede waarheid.** Op elk moment geldt precies één basis: de vervanging met het hoogste
`basis_version`, of — als er geen vervanging is — de oorspronkelijk vastgelegde basis met
`basis_version` 0. `private.hours_effective_day_basis()` is de enige plek waar die keuze wordt gemaakt,
en zowel de rekencontext als het scherm lezen hem daar.

**De oude basis blijft zichtbaar.** `hours_day_matrix_basis` wordt nooit gewijzigd of verwijderd; de
rijtrigger `hours_history_immutable` blokkeert dat ook voor de database-eigenaar. De hele keten staat
in de weekprojectie onder `matrix_basis.entries`, oudste eerst, met per schakel de matrix, de scope,
de actor, het tijdstip en de reden. De eerste schakel heeft bewust géén reden: die basis is niet
vervangen, hij is ontstaan.

**De oude uitkomsten blijven bestaan.** `hours_day_classifications` blijft append-only. Een vervanging
verandert de rekencontext — de identiteit van de vervanging reist mee in het selectiemateriaal — dus de
herberekening krijgt een eigen `context_hash` en dus een eigen poging. De unieke sleutel
`(revision_id, context_hash, engine_version)` botst daardoor nooit, en de oude poging blijft
ongewijzigd naast de nieuwe staan. In de weekprojectie staan die oudere pogingen van dezelfde
dagversie onder `previous_classifications` (nieuwste eerst); de laatste poging blijft `classification`.
Een **oudere dagversie** in `history` draagt alleen haar laatste poging — dat is een samenvatting, en
de volledige auditketen blijft in de append-only tabel.
Elke poging draagt sinds deze stap `basis_version`: welke schakel de rekencontext van die poging
bepaalde. 0 voor de eerste vastgelegde basis, N voor de N-de vervanging — ook voor een `no_hours`- of
matrixloze uitkomst op een dag die al een basis had, want die context is onder die basis gebouwd.
`null` betekent dat de dag op dat moment geen enkele basis had, of dat de poging van vóór deze
migratie stamt.

**Een vervanging herberekent niet.** De RPC verzet alleen de basis. Herberekenen blijft het werk van
de bestaande vertrouwde route (`hours-classify-day` → `hours_finalize_day_classification`). Tussen
vervangen en herberekenen hoort de getoonde uitkomst dus nog bij de vorige basis; het scherm zegt dat
met zoveel woorden, afgeleid uit `classification.matrix_version_id <> matrix_basis.matrix_version_id`.

## Bevoegdheid en reden

Vervangen vereist wat elke andere urenmutatie vereist: een actief intern profiel binnen de eigen
organisatie, de SaaS-module `uren-workflow`, een ingeschakelde urenwerkwijze bij die opdrachtgever en
`finance.manage`. Dat loopt via dezelfde `private.hours_lock_day(..., true)` als een dagcorrectie, dus
een medewerker, een opdrachtgever, een organisatievreemde beheerder, `anon` en `service_role` worden
alle vijf geweigerd met `42501`.

De reden is verplicht: minimaal één teken na dezelfde whitespace-normalisatie als elders in de module
(tabs, NBSP en BOM tellen niet mee), maximaal 500 tekens. Hij staat in een **eigen kolom**
(`reason`) en wordt nergens anders naartoe gekopieerd. Hij komt niet in `no_hours_reason`, niet in
`note`, niet in een snapshot en niet in een classificatieresultaat. Dat onderscheid is hetzelfde als bij
`assignment_note` in het [innamecontract](urenmodule-intake-contract.md): een toelichting verklaart een
besluit, een veld dat letterlijk wordt toegepast is inhoud. De databaseproef toetst dit door een
herkenbare merktekst als reden te gebruiken en daarna te eisen dat die tekst in precies één tabel en in
geen enkele snapshot voorkomt.

## Welke matrix een vervanging mag kiezen

De keuze komt uit precies dezelfde verzameling als de automatische selectie: gepubliceerde versies uit
het klantregister van de opdrachtgever van deze dag plus het **expliciet gekoppelde** CAO-register, en
alleen versies waarvan de effectieve periode de werkdatum dekt. `private.hours_day_matrix_candidates()`
bouwt die verzameling en wordt gedeeld door de rekencontext, de vervangings-RPC en het
optie-eindpunt — één waarheid, zodat het scherm nooit iets aanbiedt dat de server weigert.

Of een versie op de werkdatum geldt, beslist `private.hours_matrix_effective_on(definition, work_date)`:
één regel, als **datums** vergeleken, gedeeld door het optie-eindpunt en de vervangings-RPC. Een sessie
met een andere `DateStyle` kan die vergelijking dus niet omdraaien; de databaseproef draait beide RPC's
onder `SQL, DMY`.

Geweigerd worden daarom: een concept, een versie uit een ander register, een CAO die niet gekoppeld is,
een versie die op deze werkdatum niet geldt, en de versie die de dag al als basis heeft. Alle vijf
geven `22023`.

**Een CAO mág boven een toepasselijke klantmatrix worden gekozen.** De automatische selectie geeft de
klantmatrix voorrang; juist die keuze corrigeren is waarvoor deze procedure bestaat. De vervanging is
expliciet, met reden en actor, dus hier wordt niets geraden.

## Gelijktijdigheid

De RPC neemt eerst het week- en dagslot van `hours_lock_day`, precies zoals een dagcorrectie en de
rekencontext. Daarna gelden twee compare-and-swaps: de actuele dagrevisie moet `p_expected_revision_id`
zijn, en de actuele basisversie moet `p_expected_basis_version` zijn. Beide mismatches geven `PT409`
(HTTP 409) zonder iets te schrijven. Twee sessies die tegelijk vervangen leveren dus één vervanging en
één conflict, niet twee schakels.

Vlak vóór de schrijfactie neemt de RPC ook het opdrachtgeversslot (`companies … for update`) — het slot
dat `hours_set_company_settings` neemt — en leest daarna de werkwijzeschakelaar **opnieuw**.
`hours_lock_day` las die schakelaar al, maar vóórdat de rij van ons was; een uitschakeling die
tussendoor committe wint alsnog met `22023`. De databaseproef forceert die tussenkomst door het
opdrachtgeversslot vast te houden en de schakelaar in diezelfde transactie om te zetten. T12 moet op
zijn beurt het dagslot (`hours_lock_day`) nemen vóór hij een vrijgave schrijft; dan serialiseert de
vrijgavecontrole hierboven vanzelf tegen een lopende vervanging.

Het maximum is vijftig vervangingen per dag. Dat begrenst de auditketen en de projectie; de eenenvijftigste
geeft `22023` met die reden.

## Hoe "al vrijgegeven" nu wordt herkend

Het derde acceptatiecriterium van T10 eist dat een vervanging op een **al vrijgegeven** dag geblokkeerd
is tot de correctieroute bestaat. Vrijgave zelf is T12 en bestaat nog niet, en de correctieroute is T13.
De keuze die hier is gemaakt, en waar T12 en T13 op mogen bouwen:

- **Er is precies één register waarin een vrijgave mag worden vastgelegd: `public.hours_day_releases`**,
  één rij per vrijgegeven dagrevisie, met `batch_id` om een leveringsbatch te groeperen. De tabel
  bestaat vanaf deze migratie en is leeg.
- **Er is geen schrijfroute.** `anon`, `authenticated` en `service_role` hebben geen INSERT, UPDATE,
  DELETE of TRUNCATE; RLS staat aan met alleen intern leesrecht en dezelfde restrictieve SaaS-poort als
  de rest van de module; de rijtrigger `hours_history_immutable` blokkeert wijzigen en verwijderen. T12
  voegt zijn eigen vertrouwde SECURITY DEFINER-RPC toe die hier schrijft.
- **De blokkade is nu al aan, niet later.** `private.hours_require_day_not_released()` draait bij elke
  vervanging. Omdat er vandaag geen route bestaat waarlangs een rij in dat register had kunnen komen,
  is voor iedere dag met zekerheid vast te stellen dat hij niet is vrijgegeven — dat is geen aanname,
  maar het ontbreken van elke mogelijkheid. T12 hoeft de blokkade dus niet aan te zetten; hij hoeft
  alleen zijn vrijgave in dit register te schrijven, en vanaf dat moment blokkeert T10 vanzelf.
- **Bij twijfel blokkeren.** `private.hours_day_released()` is de enige functie die het register mag
  noemen. Hij leest met `into strict` en geeft `coalesce(..., true)` terug: een `null`, een ontbrekend
  register of een leesfout telt als vrijgegeven en dus als geblokkeerd. Alleen een gelukte lezing die
  niets vindt laat een vervanging door.
- **Vrijgave hoort bij de dag, niet bij de dagversie.** Elke rij voor die dag blokkeert, ongeacht welke
  revisie is vrijgegeven. Een latere correctie maakt een vrijgegeven dag niet opnieuw vrij.
- **Een stille omweg faalt zichtbaar.** De geërfde databaseproef bewaakt twee dingen: dat
  `hours_day_releases` de enige `hours_%`-tabel is waarvan de naam naar vrijgave, export, batch of
  payroll verwijst, en dat `private.hours_day_released` de enige functie is die de tabel noemt. Bouwt
  T12 zijn vrijgave ergens anders, dan valt die proef om in plaats van dat de blokkade stil ophoudt te
  werken.

Het scherm leest dezelfde waarheid: `hours_get_day_matrix_options` geeft `released` terug, en bij `true`
biedt het paneel geen vervangingsformulier maar de melding dat dit via de correctieroute loopt. De
server blokkeert onafhankelijk daarvan; de knop is een beleefdheid, niet de grens.

## Publieke RPC's

| RPC | Argumenten | Resultaat |
| --- | --- | --- |
| `hours_get_day_matrix_options` | `p_day_id uuid` | `DayMatrixOptions` |
| `hours_replace_day_matrix_basis` | `p_day_id uuid`, `p_expected_revision_id uuid`, `p_expected_basis_version integer`, `p_matrix_version_id uuid`, `p_reason text` | de bestaande `WeekDetail`-projectie |

Beide zijn alleen uitvoerbaar voor `authenticated` en controleren opnieuw het echte profiel; `anon` en
`service_role` hebben geen EXECUTE. Lezen vereist `finance.view` of `finance.manage`; vervangen vereist
`finance.manage`.

```ts
type DayMatrixOptions = {
  day_id: string; work_date: string;
  released: boolean;            // vandaag altijd false; T12 maakt dit waar
  can_manage: boolean;
  basis: null | {
    basis_version: number; matrix_id: string; matrix_version_id: string;
    matrix_name: string; scope: "client" | "cao";
    entries: {
      basis_version: number; matrix_id: string; matrix_version_id: string;
      matrix_name: string; scope: "client" | "cao";
      reason: string | null;    // null op de eerste schakel
      revision_id: string; created_by: string; created_at: string;
    }[];                        // oudste eerst
  };
  options: {
    matrix_id: string; matrix_version_id: string; matrix_name: string;
    scope: "client" | "cao"; valid_from: string; valid_until: string | null;
    is_current: boolean;
  }[];
};
```

De weekprojectie krijgt per dag `matrix_basis` (dezelfde vorm als `basis` hierboven) en
`previous_classifications` voor de actuele dagversie; een interne historierevisie houdt alleen haar
laatste `classification`. `ClassificationSummary` krijgt `basis_version`.

Het scherm houdt bij het openen van het vervangingsformulier zowel de dagversie als de basisversie vast
en stuurt precies die mee; een week die ondertussen ververst (een andere gebruiker verving de basis)
maakt het formulier ongeldig in plaats van stilzwijgend een versere waarde naar de server te sturen.
De waarschuwing "uitkomst hoort nog bij een eerdere matrixbasis" vergelijkt op `basis_version`, niet op
matrix: een keten die naar een eerdere matrix terugkeert (A → B → A) vraagt nog steeds om een
herberekening op de nieuwste schakel. Een portaalgebruiker ziet `matrix_basis: null` en een
lege lijst, en kan de ketentabellen ook niet direct lezen.

## Fouten

| SQLSTATE | Betekenis |
| --- | --- |
| `42501` | Geen bevoegdheid, verkeerde organisatie of ontoegankelijke dag |
| `22023` | Geen vastgelegde basis, ontbrekende of te lange reden, niet-kiesbare matrixversie, dezelfde versie als de huidige basis, maximum bereikt, uitgeschakelde urenwerkwijze, of een al vrijgegeven dag |
| `PT409` | Dagversie of basisversie is gewijzigd; opnieuw ophalen en beoordelen |

## Verificatie

De databaseproef is `scripts/hours-basis-replacement-db-test.py`. Die erft de volledige mailinname-,
Word/mail-, scan-, klantweek-, werkblad-, pagina-, inname-, modulepoort-, classificatie- en
funderingsregressies en overschrijft expliciet wat is verschoven: de poortlijst (nu **vierentwintig**
tabellen), de functiesignaturen, de migratielijst (nu **twintig**) en de gate-voorbereiding. De
migraties worden elk tweemaal toegepast in een geïsoleerde PostgreSQL-container zonder netwerk, poorten
of host-mounts. Onveranderlijkheid wordt bewezen met een volledige rijvergelijking vóór en ná zowel de
vervanging als de herberekening, niet met een steekproef op één kolom.
