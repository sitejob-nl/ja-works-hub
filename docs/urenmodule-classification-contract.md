# Urenmodule: brongegevens en vastgelegde classificatie

**Status: lokaal voorbereid; niet gedeployed.** Migratie 20260908140000_hours_day_sources_and_classification.sql volgt op de fundering en matrixopslag. De gedeelde rekenkern deelt opgeslagen bronminuten in via een vertrouwde serverfunctie. De status classified is geen medewerkerakkoord, interne goedkeuring, payrollvrijgave of export. Bestaande timesheets, facturatie en communicatie worden niet geschreven.

## Onveranderlijke broninput

Elke hours_day_revisions-rij krijgt nullable source_input. Bestaande revisies houden null: alleen het expliciete dagtotaal is bekend. Er worden geen diensten, pauzes of broncategorieën afgeleid uit dat totaal.

~~~ts
type HoursSourceInput = null | {
  schemaVersion: 1;
  shifts?: {
    start: string; end: string; endDayOffset: 0 | 1;
    breaks: {
      start: string; end: string;
      startDayOffset?: 0 | 1;
      endDayOffset?: 0 | 1;
    }[];
  }[];
  categories?: { sourceCode: string; minutes: number }[];
};
~~~

Tijden zijn exact HH:MM, van 00:00 tot 23:59. Een dienst vereist expliciete dagovergang en een pauzelijst, ook wanneer deze leeg is. Optionele pauze-offsets blijven letterlijk aanwezig of afwezig. De rekenkern gebruikt de bestaande gedocumenteerde standaard voor een ontbrekende pauze-offset. Uurcategorieën bevatten gehele minuten van 0 tot en met 1440 en een niet-lege broncode van maximaal 200 tekens. Case en betekenisvolle spaties worden niet aangepast.

Opslag accepteert maximaal 64 KiB, 32 diensten, 32 pauzes per dienst en 256 broncategorieën. Onbekende velden en schemaversies, ongeldige tijdnotatie, fracties van minuten of niet ondersteunde JSON-typen worden afgewezen. Werkdatum, dagtotaal, matrix-id's, factoren en berekeningsresultaten mogen niet in de broninput worden meegestuurd.

Structureel geldige maar tegenstrijdige feiten blijven bewaard: overlappende diensten/pauzes, pauzes buiten de dienst, gelijke diensttijden, dubbele broncodes of een bronoptelling die niet overeenkomt met het dagtotaal. Die worden door de gedeelde rekenkern geblokkeerd. Lege bronlijsten blijven lege lijsten. Een object met alleen schemaVersion is niet hetzelfde als null.

hours_save_day_source heeft de bestaande argumenten plus p_source_input:

~~~ts
{
  p_day_id: string;
  p_expected_revision_id: string | null;
  p_minutes: number;
  p_no_hours_reason: string | null;
  p_note: string | null;
  p_source_input: HoursSourceInput;
}
~~~

Het resultaat is de bestaande WeekDetail-projectie met onderstaande toevoegingen. De RPC controleert intern finance.manage, eigen organisatie, ingeschakelde workflow en CAS. Het hele pakket minuten, nulreden, notitie en broninput bepaalt of er een nieuwe revisie nodig is. Een identieke opslag is een no-op. Een echte wijziging bewaart de oude inhoud en reacties. De nieuwe revisie begint zonder actuele classificatie, akkoord of controle.

Nulreden en notitie gebruiken dezelfde whitespace-normalisatie als JavaScript trim, inclusief tabs, NBSP en BOM. Een reden van alleen zulke tekens geldt niet als expliciete nulreden. Broncodebetekenis wordt niet getrimd.

Expliciet null via het nieuwe volledige formulier kan broninput verwijderen, met een nieuwe revisie als auditspoor. De oude hours_save_day-RPC weigert een dag waarvan de actuele revisie rijke broninput bevat. Een oude browser kan die informatie daardoor niet ongemerkt wissen.

## Eén vastgelegde matrixbasis per werkdag

hours_day_matrix_basis bewaart de eerste expliciet geselecteerde geldige matrix voor een urendag, inclusief register, versie, naam, scope, oorspronkelijke publicatie, effectieve definitie, de gekozen CAO-koppeling en de volledige selectiecontext.

De basis hoort bij de **dag**, en blijft ook gelden voor alle latere correcties van die dag. Een nieuwe publicatie, aangepaste CAO-koppeling of gewijzigde bronrevisie kiest niet automatisch een andere matrix. Herclassificatie met een andere basis heeft een aparte expliciete procedure nodig en valt buiten deze stap. De basisrij is onveranderlijk; er bestaat geen override- of resetactie.

Bij een toepasselijke klantmatrix gaat die vóór de expliciet gekoppelde CAO. Er wordt geen andere CAO geprobeerd. Alleen gepubliceerde effectieve definities uit het eigen opdrachtgever-/CAO-bereik worden aangeboden aan de serverrekenkern. De oorspronkelijke publicatie blijft aanvullend in het auditspoor staan.

Een succesvolle matrixselectie wordt ook vastgelegd wanneer de daaropvolgende berekening blokkeert, bijvoorbeeld vanwege een verkeerd broncontroletotaal. Een poging zonder toepasselijke matrix blijft blocked zonder basis. Nadat de ontbrekende inrichting is toegevoegd, kan die dag opnieuw worden berekend.

Nul minuten met een expliciete reden en source_input=null geeft no_hours, zonder nieuwe matrixselectie of basis. Nul met rijke broninput wordt blocked met INVALID_ZERO_SOURCE: positieve of tegenstrijdige bronfeiten mogen niet door een nulclaim worden genegeerd. De bron moet dan expliciet worden herzien. Een al eerder vastgelegde dagbasis blijft bestaan, ook bij een latere nulcorrectie.

## Vertrouwde servergrens

De browser stuurt alleen dag-id en verwachte revisie-id naar de edge function hours-classify-day. Deze valideert het JWT en de interne finance.manage-bevoegdheid, haalt context met dat gebruikers-JWT op en draait uitsluitend _shared/hours-calculation.ts. Er is geen AI-aanroep, externe provider of tweede SQL-rekenkern.

hours_get_day_classification_context(p_day_id uuid, p_expected_revision_id uuid) is alleen uitvoerbaar voor een bevoegde ingelogde interne gebruiker. De context bevat invoer, kandidaatdefinities of de vastgelegde basis en een serverberekende SHA-256-hash:

~~~ts
type MatrixSource = {
  matrix_id: string;
  matrix_name: string;
  matrix_version_id: string;
  scope: "client" | "cao";
  definition: HoursMatrixVersion;
  original_definition: HoursMatrixVersion;
  binding_snapshot: { company_id: string; version: number; cao_matrix_id: string | null };
};
type ClassificationContext = {
  day_id: string; revision_id: string; week_id: string;
  company_id: string; organization_id: string;
  work_date: string; total_minutes: number;
  no_hours_reason: string | null; source_input: HoursSourceInput;
  context_hash: string;
  client_matrices: HoursMatrixVersion[];
  cao_matrices: HoursMatrixVersion[];
  pinned_matrix: MatrixSource | null;
  binding_snapshot: MatrixSource["binding_snapshot"];
  matrix_sources: MatrixSource[];
};
~~~

definition bevat de effectieve periode; original_definition de oorspronkelijke publicatie. Bij een vastgelegde basis bevatten de matrixlijsten uitsluitend die definitie in de juiste scope. De actuele matrixinstellingen en CAO-koppeling worden niet opnieuw geselecteerd. De oorspronkelijke volledige selectiecontext blijft in de hashberekening zitten. Daardoor blijft de hash gelijk bij de overgang van eerste selectie naar vastgelegde basis; een volledige herhaalde edge-aanroep maakt geen extra resultaat.

Finaliseren verloopt uitsluitend met de servercredential:

~~~ts
hours_finalize_day_classification({
  p_actor_id: string;
  p_day_id: string;
  p_expected_revision_id: string;
  p_expected_context_hash: string;
  p_engine_version: "hours-calculation-v1";
  p_result: {
    status: "classified" | "blocked" | "no_hours";
    matrix_version_id: string | null;
    allocations: HoursAllocation[];
    issues: HoursIssue[];
  };
});
~~~

De vier resultaatvelden zijn exact. De database maakt input-, matrix- en koppelingssnapshots zelf. Alleen service_role heeft EXECUTE op finaliseren. PUBLIC, anon en authenticated hebben dat recht niet; directe writes naar de resultaat- en basistabellen zijn ook voor service_role ingetrokken.

Finaliseren controleert opnieuw het echte actieve profiel, de eigen organisatie, interne rol en actuele finance.manage-bevoegdheid. Het gebruikt de bestaande autorisatiehelpers inclusief rolmatrix en individuele uitzonderingen. De tijdelijke actorcontext vervangt alle drie JWT-GUC's die de live auth.uid()/auth.role()-helpers lezen. Alle drie worden bij succes en fouten hersteld; de browser krijgt geen RPC waarmee die context kan worden gezet. Profiel- en machtigingsrijen worden tijdens de controle vastgehouden.

Na validatie en bescherming van de actieve actor begint de schrijfvergrendeling bij de organisatie, gevolgd door werkweek → dag → opdrachtgever → matrixregisters in UUID-volgorde. De organisatievergrendeling synchroniseert met de SaaS-schakelaar; zie het [modulecontract](urenmodule-organization-gate.md). Instellingen en CAO-koppeling delen het opdrachtgever-slot; publicatie deelt het matrixregister-slot. Vóór opslag worden huidige revisie, workflowstatus en de context-hash opnieuw gecontroleerd. Een wijziging tussen ophalen en finaliseren leidt tot PT409 en vereist een nieuwe berekening. De reeds vastgelegde dagbasis blijft daarbij de bron van waarheid.

De database valideert resultaatstructuur, begrensde hele minuten, de som van de verdeling, uurcodes, letterlijk gelijke factorwaarden, regel-id's en expliciete bronverwijzingen tegen de vertrouwde context. Zij berekent geen tijdvensters of overwerk opnieuw. Een blokkade bevat bevindingen en geen definitieve verdeling. Een definitieve indeling vereist een toepasselijke matrix, positieve minuten, een sluitend controletotaal en geen blokkades.

## Resultaten, herhaling en schermprojecties

hours_day_classifications bewaart append-only pogingen met input- en contextsnapshot, eventuele matrixbasis, actor, tijdstip en rekenkernversie. De combinatie (revision_id, context_hash, engine_version) is uniek. Een identieke finalisatie retourneert dezelfde poging. Een ander resultaat voor exact dezelfde context wordt als conflict afgewezen. Een nieuwe rekenkernrelease moet de vaste serverversiegrens expliciet aanpassen.

Finaliseren retourneert:

~~~ts
type ClassificationSummary = {
  id: string; revision_id: string;
  status: "classified" | "blocked" | "no_hours";
  matrix_version_id: string | null;
  matrix_name: string | null;
  matrix_scope: "client" | "cao" | null;
  engine_version: "hours-calculation-v1";
  created_at: string;
  allocations: HoursAllocation[];
  issues: HoursIssue[];
  basis_pinned: boolean;
};
~~~

basis_pinned betekent dat er een blijvende basis voor deze dag bestaat. hours_get_week voegt source_input toe aan de actuele revisie en interne revisiehistorie. Iedere dag krijgt classification: ClassificationSummary|null, uitsluitend de laatste poging van de actuele revisie. Een interne historierevisie krijgt de laatste poging die precies bij die revisie hoort. Oude pogingen blijven in de auditopslag bestaan.

Een portaalgebruiker ziet de eigen brongegevens, maar classification is altijd null en interne geschiedenis blijft leeg. Matrixfactoren, definities, koppelingshistorie en interne classificatiebevindingen lekken niet via die projectie of directe tabeltoegang.

De interne hours_list_weeks.blocked_day_count telt een dag zodra de actuele medewerkerreactie betwist is, de actuele interne controle blokkeert óf de laatste classificatie van de actuele revisie blokkeert. Een dag telt maximaal eenmaal. Een oude blokkade na een correctie telt niet meer als actuele blokkade. Het portaal houdt de bestaande eigen reactie-/controleprojectie; interne classificaties worden daar niet toegevoegd.

## Fouten en verificatie

| SQLSTATE | Betekenis |
| --- | --- |
| 42501 | Geen bevoegdheid, ontoegankelijke tenant/dag of poging de vertrouwde servergrens/historie te omzeilen |
| 22023 | Ongeldige bronstructuur, uitgeschakelde workflow, ongeldige resultaatreferenties of niet ondersteunde engineversie |
| PT409 | Revisie, relevante context of resultaat van dezelfde berekening conflicteert |

De aanvullende [conflictmigratie](urenmodule-conflicts.md) vervangt hiervoor de vroegere `40001`, zodat PostgREST direct HTTP 409 retourneert. De bijgewerkte edge-handler ondersteunt beide foutcodes.

De rekenkern produceert inhoudelijke blokkades zoals ontbrekende matrices, niet sluitende totalen, overlappende diensten, ontbrekende mappings en klokwisseldagen. Deze worden als append-only blocked-pogingen bewaard en niet als geslaagde indeling gepresenteerd.

De migratie wordt uitsluitend in een geïsoleerde PostgreSQL-testdatabase gevalideerd, inclusief funderingsregressies, claimsherstel, rolgrenzen, bronpariteit, gelijktijdige correcties, matrixopvolging, CAO-wijzigingen en volledige herhaalde context-/finalisatiestromen. Deze voorbereiding activeert geen productieopdrachtgever en verwerkt geen echte uren of klantcommunicatie.
