# Boetes, plaatsingen en dubbele opdrachtgevers — 14 september 2026

Deze drie punten vallen onder de fixes, niet onder de apart te offreren uitbreidingen.

- **Boetes verwijderen** bestaat en werkt live, zowel via Transport → Boetes als via een voertuig → Boetes.
  De bevestiging noemt de boete en bijlagen. Ook het verwijderen van de bijlage is gecontroleerd.
- **Testplaatsingen verwijderen** bestaat en werkt live vanuit het opdrachtgeverdossier → Plaatsingen,
  het plaatsingenoverzicht en de plaatsingsdetailpagina. De bestaande grens blijft gelden: gekoppelde
  uren, urenweken, urenbrieven, ziekmeldingen of factuurregels blokkeren definitief verwijderen; daarvoor is beëindigen.
- **Dubbele opdrachtgevers samenvoegen** bestaat via Opdrachtgevers → Duplicaten. Bij QA bleek dat de RPC
  voor notities en taken alleen het oude label `bedrijf` herkende, terwijl het dossier `opdrachtgever` gebruikt.
  Daardoor bleven die records bij de verdwenen opdrachtgever hangen. De fix hangt de labels `opdrachtgever`,
  `bedrijf` en `company` om en normaliseert ze naar `opdrachtgever`, binnen dezelfde organisatie.

Op verzoek mogen **admin, backoffice en intercedent** boetes verwijderen. Voor testplaatsingen geldt daarnaast
het bestaande recht `placements.edit`; een individuele intrekking blijft werken. Alle drie de ingangen gebruiken
dezelfde server-RPC. Die controleert de actieve gebruiker, rol, organisatie en permissie, vergrendelt de plaatsing,
telt gekoppelde historie buiten de beperkte leesrechten van de gebruiker en verwijdert de plaatsing en schrijft
het auditlog in één transactie. De dialoog toont dezelfde telling. Directe tabelverwijdering blijft admin-only.

De merge-RPC behoudt zijn bestaande interne tenantcontrole en financiële schrijfrechten. Een medewerker zonder
`finance.manage` kan geen opdrachtgever met facturen samenvoegen; de hele samenvoeging wordt dan teruggedraaid.
Er zijn geen algemene financiële rechten toegekend. Geen van de nieuwe write-RPC's is anoniem uitvoerbaar.

## Verificatie en deployment

- Migraties `20260914113835_merge_company_dossier_references` en `20260914115421_operational_record_deletion`
  toegepast op productie; security- en performance-advisors na beide DDL-stappen gecontroleerd. De twee nieuwe
  meldingen over authenticated SECURITY DEFINER zijn verwacht: beide RPC's controleren rol, organisatie,
  actief profiel en `placements.edit`. De Supabase-types zijn officieel opnieuw gegenereerd.
- De eerste isolatierun maakte een eigen lege testorganisatie aan. De standaardmap blokkeerde normale
  opruiming; onderhoudsmigratie `20260914121029_cleanup_record_deletion_qa_tenant` heeft uitsluitend die lege
  testorganisatie verwijderd en de mapbeveiliging binnen dezelfde transactie hersteld. Geen testaccounts of
  testorganisatie blijven achter. De herhaalbare isolatietest gebruikt daarom nu `ROLLBACK`.
- De oude fout is gereproduceerd in een teruggedraaide productietransactie. Na de fix slaagt
  `scripts/qa-company-merge.sql`: contacten, plaatsingen, documenten, notities, taken, herkomst en audit blijven
  gekoppeld; afwijkende entiteitstypen blijven onaangeraakt. Alle SQL-fixtures worden teruggedraaid.
- Browser-QA controleert zeven flows per rol: beide boeteschermen (inclusief bijlage), drie ingangen voor
  plaatsingsverwijdering, geblokkeerde factuurhistorie en samenvoegen. Bij admin wordt het samengevoegde document
  opnieuw gedownload en worden notities/taken in het behouden dossier bekeken. Bij backoffice/intercedent wordt
  de bestaande financiële grens en het terugdraaien van een geweigerde samenvoeging gecontroleerd.
- De live API-tests controleren verwijdering, cascades van uurtypes, server-audit, factuurregels die door RLS
  verborgen zijn, het blokkeren van directe DELETE, ingetrokken `placements.edit`, inactieve gebruikers,
  uitgesloten rollen en anonieme aanroepen. `scripts/qa-record-cleanup-isolation.sql` controleert tenantisolatie
  in een volledig teruggedraaide transactie (stel `qa.cleanup_actor` in op het eigen demo-profiel).
- Reproduceerbare QA: laad de bestaande demo-env en voer `node scripts/qa-record-cleanup-roles.mjs` uit.
  De ingelogde Supabase CLI levert alleen in het geheugen een sleutel voor eigen tijdelijke QA-accounts.
  `E2E_BASE_URL` selecteert desgewenst de lokale app; standaard is dit de live website. `QA_API_ONLY=1` slaat
  browserruns over. Accounts, testrecords en bestanden worden opgeruimd; test-audit blijft zonder de tijdelijke
  accountkoppeling bestaan. Traces/video staan uit. Geen uitnodigingen of berichten worden verstuurd.
- Lokale lint (0 fouten), typecheck, build en alle **1.978 unit-tests in 142 bestanden** geslaagd.
  Geen edge-functionwijziging nodig; frontend via Vercel na merge van PR #280.
