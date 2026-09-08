# Urenmodule: conflicten beantwoorden met HTTP 409

Een browser met een oudere dag-, matrix- of instellingenversie krijgt een
herstelbare conflictmelding. De server schrijft daarbij niets en de gebruiker kan
de actuele versie opnieuw laden. Vanaf migratie
`20260908180000_hours_conflict_http_status.sql` gebruiken deze expliciete
businessconflicten SQLSTATE `PT409`: PostgREST retourneert HTTP 409 met `code: PT409`.
De classificatiefunctie geeft dezelfde status en code door met een veilige melding.

De eerdere urenmigraties gebruikten hiervoor `40001`, de PostgreSQL-code voor een
serialization failure. PostgREST probeert deze fout opnieuw uit te voeren. Bij een
onveranderde, verouderde verwachte revisie kan dat niet slagen. In echte demo-QA
bleef daardoor een opslagaanvraag vanuit een oude browsertab zonder antwoord,
terwijl gewone leesaanvragen bleven werken. De retry-interactie is ook beschreven
in [PostgREST issue 3673](https://github.com/PostgREST/postgrest/issues/3673).

De reparatie vervangt dertien expliciete conflictfouten in twaalf actuele
functie-definities. De bestaande migraties blijven ongewijzigd. Autorisatie,
SaaS-gate, vergrendelingen, verwachte revisies, matrixbasis en service-only
finalisatie blijven exact gelijk; `CREATE OR REPLACE` behoudt de bestaande grants.
Werkelijke PostgreSQL-serialization failures krijgen nog steeds hun oorspronkelijke
code. De bijgewerkte frontend en classificatie-handler herkennen zowel `PT409` als
de eerdere `40001`, zodat zij met beide databaseversies kunnen werken. De SQL-fix en
bijgewerkte classificatiefunctie horen bij dezelfde release.

De conflictcontroles gelden voor:

- opdrachtgeverinstellingen en een onvolledige plaatsingssnapshot;
- daginvoer, broninvoer en individuele of gezamenlijke medewerkerreacties;
- interne dagcontrole;
- matrixconcepten, publicatie en CAO-koppelingen;
- classificatiecontext en vertrouwde finalisatie.

De regressiecontrole moet zowel de echte database als de HTTP-grens afdekken:
dezelfde oude verwachte revisie moet één concrete HTTP 409 opleveren, de aanvraag
moet afronden, en het actuele dagrecord moet ongewijzigd blijven. De browser moet
vervolgens de conflictmelding tonen en de ingevoerde correctie behouden. Alleen
een SQL-test van de foutcode zou het oorspronkelijke PostgREST-probleem missen.

De actuele QA-bewijzen en uitrolstatus worden in de bouwstand vastgelegd; dit
contractdocument op zichzelf claimt geen deployment of afgeronde HTTP-controle.
