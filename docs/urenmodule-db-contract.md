# Urenmodule: databasecontract van de eerste bouwstap

**Status: NIET GEDEPLOYED.** Migratie: `20260908090000_hours_workflow_foundation.sql`. Deze migratie is additief. De bestaande `timesheets`, urenbrief-, facturatie-, CSV- en portaalstromen worden niet geschreven of aangepast. Er is geen export, vrijgave, AI-aanroep, klanttoken, upload of mailplanner in deze bouwstap. Een interne controle met status `checked` is nadrukkelijk geen matrixcontrole of payrollvrijgave. `release_available` is altijd `false`.

Elke opdrachtgever begint uitgeschakeld: een ontbrekende instelling is `enabled=false`, `version=0`. Alleen een bevoegde interne gebruiker kan instellen en inschakelen. De migratie activeert geen opdrachtgever. Uitschakelen blokkeert nieuwe weken en alle dagmutaties; bestaande weken blijven leesbaar.

## Rollen en toegang

De live helpers zijn op 8 september 2026 alleen gelezen: `get_user_org_id()`, `get_user_role()`, `is_internal_user()`, `get_employee_candidate_id()` en `has_role_permission(text)`. Zij gebruiken een actief profiel; het medewerkerhulpmiddel controleert bovendien `candidates.auth_user_id`, rol `medewerker` en gelijke organisatie.

| Actie | Vereiste toegang |
| --- | --- |
| Interne lijsten en week/instellingen lezen | Actief profiel, eigen organisatie, `is_internal_user()`, `finance.view` of `finance.manage` |
| Instellingen, week aanmaken, dag corrigeren en intern controleren | Dezelfde controle met verplicht `finance.manage` |
| Portaalweek lezen of eigen revisie bevestigen/betwisten | Actief profiel met rol `medewerker`, eigen organisatie en kandidaat via `get_employee_candidate_id()` |
| Direct lezen van nieuwe tabellen | Alleen bovenstaande interne leesrechten via RLS |
| Direct insert/update/delete/truncate | Geen rechten voor `anon`, `authenticated` of `service_role` |
| Write-RPC via anon, publieke of service-key-route | Geen EXECUTE-recht; alle publieke RPC's vereisen een echt geautoriseerd profiel |

Portaaldata loopt uitsluitend via de eigen projectie van de RPC. Een portalgebruiker krijgt geen interne `settings_snapshot`, revisiehistorie of interne reviewnotities. Er is geen brede portaalpolicy op de nieuwe tabellen. Een medewerker kan nooit iemand anders bevestigen, ook niet door een dag-, week-, plaatsing- of kandidaat-id aan te passen. Interne gebruikers kunnen niet namens de medewerker bevestigen.

## Opslag en invarianten

`hours_company_settings` bevat de opdrachtgever, organisatie, uitgeschakelde opt-in, configuratieversie, aanlever- en akkoorddeadline en vaste tijdzone `Europe/Amsterdam`. Tijdstippen hebben precisie op hele minuten. De offsets zijn kalenderdagen vanaf de maandag van de werkweek; 7 betekent de maandag erna. Instellingen hebben nog geen mailontvangers of berichtschema's. De berekende deadlines maken dus geen verzending aan.

`hours_weeks` legt opdrachtgevernaam, ISO-maandag, effectieve instellingen en de twee UTC-deadlines vast. De combinatie organisatie, opdrachtgever en week is uniek. Instellingenwijzigingen veranderen een bestaande snapshot niet; een aparte expliciete herplanning is later nodig. Snapshotdatums worden met `AT TIME ZONE 'Europe/Amsterdam'` omgerekend. Een niet-bestaand of dubbel lokaal tijdstip tijdens de overgang wordt afgewezen: alleen een lokale deadline die naar precies één UTC-tijdstip leidt is toegestaan. Er wordt geen vaste UTC-offset gebruikt.

`hours_week_members` legt een relevante plaatsing met de kandidaat vast. Datumoverlap bepaalt deelname, ook bij een inmiddels afgeronde plaatsing. Alleen op de huidige status `actief` filteren zou historische medewerkers missen. Bronrijen worden tijdens de snapshot vastgehouden. Eén gematerialiseerde plaatsings-/kandidaatset wordt gevalideerd en exact die set wordt ingevoegd; een tussentijds gewijzigde plaatsing kan geen lege of afwijkende week opleveren. Een ontbrekende of organisatievreemde kandidaatkoppeling blokkeert het aanmaken; de medewerker wordt niet stil overgeslagen. Er wordt geen legacy `employees`-id gebruikt of aangemaakt. Twee plaatsingen van één kandidaat blijven twee afzonderlijke weekleden; `member_count` telt die plaatsingen, geen unieke personen.

`start_date` en `end_date` op een weeklid zijn de inclusieve overlap met de gekozen week; `end_date` is altijd aanwezig. De oorspronkelijke plaatsingsdatums en status staan in de onveranderlijke `placement_snapshot`. `hours_days` maakt één verwachte dag voor elke kalenderdatum in die overlap, inclusief weekend. Een dag zonder revisie is onbekend. Nul minuten is expliciet en vereist een reden; er wordt geen automatisch nul ingevuld.

`hours_day_revisions` is append-only en bevat een exact geheel aantal minuten (0–1440), reden bij nul, notitie en bronverwijzingen. De server registreert in deze stap uitsluitend `[{"kind":"manual","label":"Handmatige invoer"}]`; een client kan geen willekeurige bron-id of betrouwbare OCR-herkomst claimen. Fracties van minuten worden niet automatisch afgerond; de invoerlaag moet ze afwijzen. De toekomstige dienst-/matrixlaag zal complexere bronwaarden exact moeten ondersteunen.

`hours_days.current_revision_id` verwijst met een samengestelde foreign key naar een revisie van precies die dag. Een wijziging gebruikt compare-and-swap op de verwachte revisie-id. De oude inhoud blijft bestaan. Een identieke opslag op de actuele revisie is een no-op en behoudt eerdere reacties.

`hours_day_confirmations` en `hours_day_reviews` zijn afzonderlijke append-only gebeurtenissen op een exacte revisie. Alleen de laatste gebeurtenis van de actuele revisie wordt als huidige reactie getoond. Een nieuwe dagrevisie heeft dus opnieuw geen medewerkerakkoord en geen interne controle; andere dagen behouden hun reactie. Een betwisting of interne blokkade vereist een toelichting. Een nieuwe reactie overschrijft de oude niet. Geen reactie geldt nooit als akkoord.

Alle dagmutaties vergrendelen eerst de klantweek en vervolgens de betreffende dag. Bevestigen en corrigeren kunnen daardoor niet ongezien tegelijk slagen op verschillende inhoud. Een batch controleert vooraf de eigen weekscope, vergrendelt de week, verwerkt dag-id's in vaste volgorde en draait volledig terug zodra één revisie onjuist is.

## Publieke RPC's

Alle onderstaande functies retourneren JSONB en zijn uitvoerbaar voor `authenticated`; autorisatie gebeurt opnieuw in de functie. Geen organisatie- of kandidaat-id kan door de client worden gekozen.

| RPC | Parameters | Resultaat |
| --- | --- | --- |
| `hours_list_weeks` | `p_week_start date default null` | `{weeks: WeekSummary[], can_manage: boolean}`; bij medewerker alleen eigen weken en eigen aantallen |
| `hours_get_week` | `p_week_id uuid` | `WeekDetail` |
| `hours_get_company_settings` | `p_company_id uuid` | `CompanySettings`, inclusief veilige defaults als nog niet ingesteld |
| `hours_set_company_settings` | `p_company_id uuid`, `p_expected_version integer`, `p_enabled boolean`, `p_submission_day_offset integer`, `p_submission_time time`, `p_confirmation_day_offset integer`, `p_confirmation_time time` | Actuele `CompanySettings`; verwachte versie 0 voor de eerste opslag |
| `hours_create_week` | `p_company_id uuid`, `p_week_start date` | `WeekDetail`; herhaald aanmaken van dezelfde week geeft dezelfde snapshot en dagen |
| `hours_save_day` | `p_day_id uuid`, `p_expected_revision_id uuid`, `p_minutes integer`, `p_no_hours_reason text`, `p_note text` | `WeekDetail`; verwachte id is uitsluitend `null` bij de eerste invoer |
| `hours_confirm_day` | `p_day_id uuid`, `p_expected_revision_id uuid`, `p_decision text`, `p_note text` | `WeekDetail`; decision is `confirmed` of `disputed` |
| `hours_confirm_days` | `p_week_id uuid`, `p_revisions jsonb`, `p_note text` | `WeekDetail`; een niet-lege array van unieke `{day_id, revision_id}`, maximaal 1.000, uit precies de eigen opgegeven week |
| `hours_review_day` | `p_day_id uuid`, `p_expected_revision_id uuid`, `p_status text`, `p_note text` | `WeekDetail`; status is `checked` of `blocked` en blijft los van akkoord/matrix/vrijgave |

Alle tekstparameters zijn verplicht als argument maar mogen `null` zijn waar een opmerking niet nodig is. Lege of alleen uit spaties bestaande tekst wordt `null`. Bij nul uren is `no_hours_reason` verplicht (maximaal 500 tekens); bij positieve minuten moet die reden `null` zijn. Notities zijn maximaal 2.000 tekens. Een batch bevestigt uitsluitend de expliciet meegegeven actuele revisies; ontbrekende of niet ingevulde dagen worden nooit impliciet meegenomen. Een bevestigingsbatch mag bestaande betwistingen alleen vervangen als de medewerker die revisies expliciet in de bevestigingsselectie opneemt.

`CompanySettings`:

```ts
{
  company_id: string; enabled: boolean; version: number;
  submission_day_offset: number; submission_time: string; // HH:mm:ss, offset 0–27
  confirmation_day_offset: number; confirmation_time: string; // offset 0–34
  timezone: "Europe/Amsterdam";
}
```

De akkoorddeadline moet strikt na de aanleverdeadline liggen. Deze bouwstap sluit invoer niet automatisch na de deadline; er is geen scheduler of automatische afwijzing. Het moment is zichtbaar voor opvolging. Deadlineoverschrijding geeft nooit fictief akkoord of automatische vrijgave.

`WeekSummary`:

```ts
{
  id: string; company_id: string; company_name: string; week_start: string;
  submission_deadline_at: string; confirmation_deadline_at: string;
  member_count: number; day_count: number; received_day_count: number;
  confirmed_day_count: number; blocked_day_count: number;
}
```

`blocked_day_count` telt actuele medewerkerbetwistingen of interne blokkades. Dit aantal alleen bepaalt geen vrijgave: ontbrekende dagrevisies, akkoorden en controles zijn afzonderlijk zichtbaar, en matrix/exportvalidatie ontbreekt nog geheel.

`WeekDetail`:

```ts
{
  id: string; company_id: string; company_name: string; week_start: string;
  submission_deadline_at: string; confirmation_deadline_at: string;
  settings_snapshot: CompanySettings | {}; // {} in het medewerkersportaal
  workflow_enabled: boolean; // actuele instelling, niet de historische snapshot
  can_manage: boolean; // actief + intern finance.manage
  can_confirm: boolean; // actief + eigen medewerkerrol; geen deadline- of akkoordclaim
  release_available: false;
  members: {
    id: string; placement_id: string; candidate_id: string; candidate_name: string;
    start_date: string; end_date: string;
    days: {
      id: string; work_date: string;
      current_revision: Revision | null;
      confirmation: { id: string; revision_id: string; decision: "confirmed" | "disputed"; note: string | null; created_at: string } | null;
      review: { id: string; revision_id: string; status: "checked" | "blocked"; note: string | null; created_at: string } | null;
      history: RevisionHistory[]; // nieuw naar oud, alleen intern; anders []
    }[];
  }[]; // portaal: alleen de eigen kandidaat, alle eigen plaatsingen in deze week
}
type Revision = {
  id: string; revision_number: number; minutes: number;
  no_hours_reason: string | null; note: string | null;
  source_references: { kind: "manual"; label: "Handmatige invoer" }[];
  created_at: string;
};
type RevisionHistory = Revision & {
  created_by: string;
  confirmations: {id: string; decision: string; note: string | null; created_at: string}[];
  reviews: {id: string; status: string; note: string | null; created_at: string}[];
};
```

Bij een portalprojectie is `review.note` altijd `null`. Notities die de medewerker zelf bij de dag of reactie hoort te zien blijven wel onderdeel van de eigen dag; vrije tekst is gebruikersdata en wordt door de frontend als tekst weergegeven.

## Fouten en vervolgbouw

| SQLSTATE | Betekenis |
| --- | --- |
| `42501` | Ontbrekende bevoegdheid, verkeerde organisatie/kandidaat, ontoegankelijke id of poging tot wijziging van historie |
| `22023` | Ongeldige invoer/configuratie, uitgeschakelde workflow, geen relevante plaatsingen of ongeldige kandidaatkoppeling |
| `PT409` | Revisie of instellingen zijn gewijzigd; opnieuw laden en de nieuwe inhoud laten beoordelen |

De aanvullende [conflictmigratie](urenmodule-conflicts.md) vervangt hiervoor de vroegere `40001`, zodat PostgREST direct HTTP 409 retourneert en de oude invoer niet blijft herhalen.

Voor fysieke tabelconstraints kan PostgreSQL een specifieke constraintcode teruggeven; de RPC's valideren de normale gebruikersinvoer eerder. Ongeldige SQL-argumenttypen worden door PostgreSQL/PostgREST vóór de functie afgewezen.

Nog te bouwen: herplanning met audit, mailprofielen en jobs per partij, intake en echte bronregisters, klanttokenpagina, matrixversies en dienstsegmenten, volledige deterministische controles, review van OCR-voorstellen, gegarandeerde export/release en correcties na export. De bestaande financiële verwerking ontvangt vanuit deze tabellen niets. Deze afbakening voorkomt dat onvolledige urencontrole toch payroll kan aansturen.

De migratie is in deze bouwstap uitsluitend lokaal voorbereid. Toepassing op productie vereist de gezamenlijke releasecontrole, typegeneratie en Supabase-advisors. SQL-integratietests staan afzonderlijk onder `tests/db/hours-workflow-*` en worden via `scripts/hours-workflow-db-test.py` op een tijdelijke PostgreSQL-database uitgevoerd.
