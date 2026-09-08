# Urenmodule: matrixopslag en versiecontract

**Status: lokaal voorbereid; niet gedeployed.** Migratie: `20260908120000_hours_matrix_versions.sql`, na de funderingsmigratie `20260908090000_hours_workflow_foundation.sql`. Deze stap richt expliciete klant- en CAO-matrices in. Er worden geen klantmatrices, CAO-inhoud, plaatsingen of uren automatisch ingevuld. Een gepubliceerde matrix is bevestigde configuratie, geen gecontroleerde urendag en geen payrollvrijgave. De opslag wijzigt geen legacy `timesheets`, dagrevisies, medewerkersreacties, export, AI of berichten.

## Identiteit, versies en geldigheid

`hours_matrices` is een onveranderlijk register per organisatie. Een matrix is `client` met één expliciete opdrachtgever, of `cao` met een zelfgekozen naam en zonder opdrachtgever. Per opdrachtgever bestaat maximaal één klantmatrixregister; wijzigingen worden nieuwe versies daarvan. Een CAO-naam is alleen een naam. Er wordt geen toepasselijkheid, sector, CAO-inhoud of juridische juistheid uit afgeleid.

`hours_matrix_versions` bevat volledige configuraties met oplopende versienummers. Meerdere concepten mogen naast elkaar bestaan. Een concept heeft een bewerkbare inhoud en een integer `revision`. Opslaan vereist de verwachte revisie. Een identieke opslag is een no-op. Publicatie bevestigt precies de opgeslagen revisie, met actor en tijdstip, en bevriest de hele rij inclusief oorspronkelijke datums, inhoud en metadata. Publicatie verandert het revisienummer niet; een herhaalde publicatie van dezelfde bevestigde revisie is een no-op. Concepten en gepubliceerde versies worden in deze stap niet verwijderd of gearchiveerd.

Geldigheid gebruikt werkdatums: de start is inclusief, de einddatum exclusief. Een datum is `YYYY-MM-DD`, van `0001-01-01` tot en met `9999-12-31`; een opgegeven einde ligt strikt na de start. Een ontbrekende einddatum betekent geen zelfgekozen vaste einddatum. Net als in de rekenkern bepaalt de startdatum van een dienst de matrix voor die hele dienst.

Een opvolgende publicatie moet starten **na de startdatum van alle eerder gepubliceerde versies** en **niet vóór vandaag in Europe/Amsterdam**. Daardoor kunnen publicaties niet achteraf tussen bestaande versies worden geschoven of verstreken werkdagen opnieuw indelen. De eerste gepubliceerde versie mag wel een historische startdatum hebben. Een ingeplande toekomstige versie kan dus niet daarna worden ingehaald door een tussentijdse versie; dat vereist een latere expliciete uitbreiding van het versiebeheer.

De effectieve einddatum wordt afgeleid als de vroegste van de oorspronkelijke einddatum en de start van de volgende gepubliceerde versie. Een ontbrekende grens telt als oneindig. Dit gebeurt voor zowel een oorspronkelijk open einde als een vaste einddatum:

| Publicatie | Oorspronkelijke periode | Effectieve periode na beide publicaties |
| --- | --- | --- |
| Versie A | 1 januari, zonder einde | 1 januari tot 1 oktober |
| Versie B | 1 oktober, zonder einde | Vanaf 1 oktober |

Versie A blijft fysiek ongewijzigd. Hetzelfde geldt wanneer A oorspronkelijk tot 1 januari van het volgende jaar liep: B beëindigt de toepasbaarheid van A per 1 oktober. Als A eerder eindigt dan B begint, blijft het gat bestaan; er wordt geen dekking verzonnen. De gepubliceerde effectieve periodes van één register kunnen nooit overlappen. Dit append-only verloop voorkomt dat een gepubliceerde versie met een open einde alle toekomstige wijzigingen blokkeert.

Een registerslot serialiseert conceptnummering, wijzigingen en publicatie. CAS controleert daarna de exacte versie. Twee publicaties kunnen dus niet ongemerkt dezelfde startdatum krijgen of een tegenstrijdige tijdlijn maken. Rijtriggers bewaken onveranderlijkheid, scope en configuratie aanvullend op de RPC's.

## Strikte configuratie en rekenkern

De browser levert alleen de configureerbare velden aan:

```ts
type MatrixConfig = {
  schemaVersion: 1;
  timeBasis: "wall_clock";
  categories: { code: string; factor: string }[];
  categoryMappings: { id: string; sourceCode: string; categoryCode: string }[];
  automaticRules:
    | { kind: "explicit_only" }
    | { kind: "flat"; rule: { id: string; categoryCode: string } }
    | { kind: "time_windows"; rules: {
        id: string; categoryCode: string; daysOfWeek: number[];
        start: string; end: string;
      }[] };
};
```

De database genereert `id`, `scope`, `validFrom`, `validUntil` en `confirmed` uit de opgeslagen identiteit, periode en status. Ingestuurde identiteitsvelden, bevestigingsclaims, onbekende sleutels, alternatieve schemaversies en niet ondersteunde CAO-regels worden afgewezen. Ook concepten moeten een volledige geldige configuratie bevatten; een lege nieuwe registeridentiteit is wel toegestaan.

`private.hours_validate_matrix_config` controleert dezelfde ondersteunde vorm als `_shared/hours-calculation.ts`: niet-lege unieke uurcodes, expliciete positieve decimale factoren als tekst, unieke broncodes en regel-id's, verwijzingen naar bestaande uurcodes, geldige weekdagen en exacte tijdvensters. Regel-id's zijn uniek over mappings en automatische regels samen. Tijdvensters worden over een hele week op minuutniveau gecontroleerd, inclusief de overgang zondag–maandag en nachtdiensten. Starttijden lopen van `00:00` tot `23:59`; bij een einde mag ook `24:00`. Gelijke start- en eindtijden zijn ambigu en worden afgewezen. Een hele dag wordt expliciet `00:00`–`24:00`.

Opslag begrenst de configuratie aanvullend op maximaal 128 KiB, 128 uurcodes, 256 categorie-mappings en 128 tijdvensterregels. Codes en regel-id's bevatten 1–200 tekens na toetsing op niet-lege tekst. Een factor heeft maximaal 20 tekens en gebruikt een punt als decimaalscheiding. Geen normalisatie verandert de betekenis van een code of factor.

Weekoverwerkgrenzen, cumulatieve daggrenzen, feestdagen, samenloop en toeslagen bovenop dezelfde minuten vallen nog buiten schema 1. Zij kunnen niet via extra JSON-velden alsnog worden gepubliceerd. Ontbrekende dekking tussen tijdvensters mag bestaan, maar een berekening voor ongedekte minuten blokkeert in de rekenkern. Publicatie beweert dus niet dat alle denkbare diensten zijn afgedekt. De nog benodigde bevestigde klantregels bepalen wanneer een volgende schemaversie nodig is.

## Toegang en expliciete CAO-koppeling

Lezen vereist een actief intern profiel binnen de eigen organisatie en `finance.view` of `finance.manage`. Schrijven vereist `finance.manage`. Dezelfde gecontroleerde helper uit de fundering wordt gebruikt. Organisatie en actor worden uitsluitend uit de sessie afgeleid. Een meegegeven opdrachtgever, matrix, versie of CAO-koppeling wordt binnen die scope gecontroleerd.

Nieuwe tabellen hebben RLS met alleen interne leesrechten. Een medewerker of opdrachtgever in het portaal kan geen matrixdefinities, concepten of koppelingen direct lezen. `PUBLIC`, `anon`, `authenticated` en `service_role` hebben geen recht op directe writes of truncate. Alleen `authenticated` kan de publieke RPC's uitvoeren; elke RPC controleert opnieuw het echte profiel. Private helpers zijn voor al deze API-rollen ingetrokken. Een service key biedt geen schrijfroute zonder deze controle.

`hours_company_cao_bindings` bewaart een **expliciet gekozen huidig CAO-register** per opdrachtgever, of `null` wanneer geen CAO is geselecteerd. De ontbrekende standaard is versie 0 en geen koppeling. Het register moet `scope='cao'` hebben en uit dezelfde organisatie komen. Een klantmatrix kan niet als CAO worden gekoppeld. Wijzigingen gebruiken CAS en maken atomair een append-only rij in `hours_company_cao_binding_history`. Een identieke opslag op de actuele versie is een no-op.

Deze koppeling heeft nog geen historische ingangsdatum en verandert geen uren. Een toekomstige persistente dagclassificatie moet de gekozen koppeling én de exacte effectieve matrixversie vastleggen bij de dagrevisie; actuele instellingen mogen bestaande beoordelingen niet stil herschrijven. Selectie voor een preview gebruikt uitsluitend de gepubliceerde `definition`-projecties van het ene klantregister en de expliciet gekoppelde CAO. Een toepasselijke klantmatrix gaat voor de CAO; ontbrekende toepasselijke configuratie blokkeert. Andere CAO-registers worden nooit als mogelijke terugval meegestuurd.

## Publieke RPC's

Alle resultaten zijn JSONB. Alle hieronder genoemde argumenten zijn verplicht, behalve het standaardargument van de lijstfunctie. Nullable argumenten moeten expliciet als `null` worden verstuurd.

| RPC | Argumenten | Resultaat |
| --- | --- | --- |
| `hours_list_matrices` | `p_company_id uuid default null` | `{ matrices: MatrixSummary[], can_manage: boolean }` |
| `hours_get_matrix` | `p_matrix_id uuid` | `MatrixDetail` |
| `hours_create_matrix` | `p_scope text`, `p_company_id uuid/null`, `p_name text` | `MatrixDetail`, initieel zonder versies |
| `hours_create_matrix_draft` | `p_matrix_id uuid`, `p_valid_from date`, `p_valid_until date/null`, `p_config jsonb` | `MatrixDetail` |
| `hours_save_matrix_draft` | `p_version_id uuid`, `p_expected_revision integer`, `p_valid_from date`, `p_valid_until date/null`, `p_config jsonb` | `MatrixDetail` |
| `hours_publish_matrix_version` | `p_version_id uuid`, `p_expected_revision integer`, `p_confirmed boolean` | `MatrixDetail`; bevestiging moet `true` zijn |
| `hours_get_company_matrix_binding` | `p_company_id uuid` | `CompanyMatrixBinding` |
| `hours_set_company_matrix_binding` | `p_company_id uuid`, `p_expected_version integer`, `p_cao_matrix_id uuid/null` | `CompanyMatrixBinding` |

Zonder opdrachtgeverfilter geeft de lijst alle registers uit de eigen organisatie. Met filter geeft de lijst alleen het ene klantregister voor die opdrachtgever plus de CAO-registers waaruit de gebruiker expliciet kan kiezen. Een organisatievreemde opdrachtgever wordt afgewezen, ook wanneer er nog geen instellingen voor bestaan. De lijst geeft geen matrixdefinities terug.

```ts
type MatrixSummary = {
  id: string;
  name: string;
  scope: "client" | "cao";
  company_id: string | null;
  company_name: string | null;
  version_count: number;
  published_version_count: number;
};

type MatrixDetail = MatrixSummary & {
  can_manage: boolean;
  versions: MatrixVersion[]; // versievolgnummer aflopend, niet op ingangsdatum
};

type MatrixVersion = {
  id: string;
  matrix_id: string;
  version_number: number;
  status: "draft" | "published";
  revision: number;
  valid_from: string;
  valid_until: string | null;          // oorspronkelijke gekozen grens
  effective_valid_until: string | null;
  definition: HoursMatrixVersion;     // effectieve grens, confirmed volgens status
  published_definition: HoursMatrixVersion | null; // originele immutable publicatie
  created_at: string;
  updated_at: string;
  published_at: string | null;
  published_by: string | null;
};

type CompanyMatrixBinding = {
  company_id: string;
  version: number;
  cao_matrix_id: string | null;
  can_manage: boolean;
};
```

`HoursMatrixVersion` is het bestaande schema 1-type uit de gedeelde rekenkern. Voor concepten is `confirmed=false`, `published_definition=null` en de effectieve einddatum gelijk aan de gekozen einddatum. Een lokale testberekening mag een concept expliciet als testsnapshot bevestigen; dat publiceert of bewaart niets en is geen productieclassificatie. Productieselectie mag concepten nooit meenemen, ook niet wanneer een browser `confirmed` probeert te wijzigen.

## Fouten en controles

| SQLSTATE | Betekenis |
| --- | --- |
| `42501` | Geen bevoegdheid, verkeerde organisatie/scope, ontoegankelijke identiteit of poging gepubliceerde historie te wijzigen |
| `22023` | Ongeldige of niet ondersteunde configuratie, ontbrekende bevestiging, dubbele klantmatrix of ongeldige publicatietijdlijn |
| `40001` | Concept- of koppelingsversie gewijzigd; opnieuw ophalen en de nieuwe inhoud beoordelen |

PostgreSQL/PostgREST valideert ongeldige SQL-argumenttypen vóór uitvoering. Directe constraints kunnen specifieke PostgreSQL-codes teruggeven; de RPC's valideren normale invoer eerder. Er zijn geen productie-DDL, voorbeeld-CAO's of automatische koppelingen uitgevoerd door deze migratievoorbereiding. Database-integratietests toetsen de echte migratie, rolgrenzen, gelijktijdige CAS/publicatie, configuratiepariteit en effectieve opvolging in een geïsoleerde database.
