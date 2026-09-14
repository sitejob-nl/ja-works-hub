# Boetes, plaatsingen en dubbele opdrachtgevers — 14 september 2026

Deze drie punten vallen onder de fixes, niet onder de apart te offreren uitbreidingen.

- **Boetes verwijderen** bestaat en werkt live, zowel via Transport → Boetes als via een voertuig → Boetes.
  De bevestiging noemt de boete en bijlagen. Ook het verwijderen van de bijlage is gecontroleerd.
- **Testplaatsingen verwijderen** bestaat en werkt live vanuit het opdrachtgeverdossier → Plaatsingen,
  het plaatsingenoverzicht en de plaatsingsdetailpagina. De bestaande grens blijft gelden: gekoppelde
  uren, urenbrieven, ziekmeldingen of factuurregels blokkeren definitief verwijderen; daarvoor is beëindigen.
- **Dubbele opdrachtgevers samenvoegen** bestaat via Opdrachtgevers → Duplicaten. Bij QA bleek dat de RPC
  voor notities en taken alleen het oude label `bedrijf` herkende, terwijl het dossier `opdrachtgever` gebruikt.
  Daardoor bleven die records bij de verdwenen opdrachtgever hangen. De fix hangt de labels `opdrachtgever`,
  `bedrijf` en `company` om en normaliseert ze naar `opdrachtgever`, binnen dezelfde organisatie.

Boetes en plaatsingen verwijderen blijft alleen voor beheerders. Deze release wijzigt geen rollen of policies.
De merge-RPC behoudt zijn bestaande interne tenantcontrole en is niet anoniem uitvoerbaar.

## Verificatie en deployment

- Migratie `20260914113835_merge_company_dossier_references` toegepast op productie; security- en
  performance-advisors gecontroleerd. De melding over een authenticated SECURITY DEFINER is bij deze RPC
  verwacht: de bestaande functie controleert intern de rol en organisatie.
- De oude fout is gereproduceerd in een teruggedraaide productietransactie. Na de fix slaagt
  `scripts/qa-company-merge.sql`: contacten, plaatsingen, documenten, notities, taken, herkomst en audit blijven
  gekoppeld; afwijkende entiteitstypen blijven onaangeraakt. Alle SQL-fixtures worden teruggedraaid.
- Alle zes Playwright-flows slagen op de live website in de aparte demo-organisatie. Het samengevoegde document
  is opnieuw gedownload; notities en taken zijn in het behouden dossier zichtbaar. Alle eigen testrecords en
  bestanden zijn opgeruimd. Er zijn geen berichten verstuurd.
- Reproduceerbare browser-QA: `npx playwright test --config=playwright.record-cleanup.config.ts`, met de
  bestaande demo-env en `TEST_EMAIL`/`TEST_PASSWORD` gelijk aan de demo-login. Traces/video staan uit.
- Lokale lint, typecheck, build en alle 1.960 unit-tests geslaagd. Geen edge-functionwijziging nodig.
