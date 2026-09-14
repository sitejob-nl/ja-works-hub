# Overdracht T10 — matrixbasis vervangen

Voor de ontwikkelaar die dit overneemt. Stand: **14 september 2026**, PR
[#278](https://github.com/sitejob-nl/ja-works-hub/pull/278) op branch `feat/urenmodule-matrixvervanging`.

## In één alinea

Een urendag waarvan de matrixbasis onherroepelijk is vastgelegd kan nu met een aparte, gecontroleerde
procedure op een andere basis worden herberekend. De vastgelegde basis blijft ongewijzigd en elke
eerdere uitkomst blijft naast de nieuwe staan: een vervanging is één append-only schakel, geen
overschrijving. De reden is verplicht en staat in een eigen kolom die nergens letterlijk wordt
toegepast. Een dag die al is vrijgegeven is geblokkeerd — vrijgave bestaat nog niet, maar het register
waarin die ooit wordt vastgelegd staat er al, leeg en zonder schrijfroute, zodat T12 de blokkade niet
hoeft aan te zetten.

Dit is ticket T10 uit [docs/urenmodule-tickets.md](urenmodule-tickets.md). Het volledige contract staat
in [docs/urenmodule-basis-replacement-contract.md](urenmodule-basis-replacement-contract.md); lees dat
vóór je iets aan deze route verandert.

## Wat er klaar is

| Onderdeel | Status |
|---|---|
| Databaselaag (twee tabellen, twee RPC's, vijf private helpers, gewijzigde projectie) | Op productie |
| Frontend (paneel, vervangingsformulier, datalaag, typen) | In de PR, live bij merge |
| Edge functions | Niet gewijzigd — `hours-classify-day` leest de effectieve basis via de bestaande context |
| Documentatie | Contract, ticketlijst, CLAUDE.md en handover bijgewerkt |
| Databaseproef | `scripts/hours-basis-replacement-db-test.py`, 356 tests |
| Browser-QA | `scripts/e2e-hours-basis-demo.spec.ts`, geslaagd tegen de demo-organisatie |

Alle drie acceptatiecriteria van het ticket zijn afgevinkt.

## Wat je moet weten vóór je verdergaat

**Productie loopt vooruit op de merge.** De database staat er al; de frontend gaat live zodra de PR
gemerged is. Tussen nu en de merge ziet de oude frontend de nieuwe velden gewoon niet — de zod-schema's
hebben defaults, dus daar breekt niets.

**De migratielijst op productie wijkt af van de repo.** De eindtoestand is in vijf stappen via de
Supabase-MCP aangebracht (basismigratie, indexen, en drie reviewrondes), en daarna is de
bestandsversie `20260917090000` zelf in `supabase_migrations.schema_migrations` geregistreerd — precies
zoals bij de zustermigraties van T5 en T7. De repo heeft één bestand met exact die eindtoestand, en
`db push` slaat het over. **Voer dat bestand niet handmatig opnieuw uit op productie.**

**De invariant die je niet mag breken.** `hours_day_matrix_basis` is onherroepelijk. Alles wat de
werkende basis bepaalt loopt via `private.hours_effective_day_basis()` — één plek, geen tweede waarheid.
Een vervanging rekent niets uit; herberekenen blijft `hours-classify-day`. De databaseproef bewijst de
onveranderlijkheid met een volledige rijvergelijking vóór en ná zowel de vervanging als de
herberekening, niet met een steekproef.

## Voor T12 (vrijgave) — dit is al voor je klaargezet

- Schrijf je vrijgave in `public.hours_day_releases`: één rij per vrijgegeven dagrevisie, `batch_id`
  groepeert de levering. De tabel bestaat, is leeg en heeft geen schrijfroute voor `anon`,
  `authenticated` of `service_role`; voeg je eigen vertrouwde `SECURITY DEFINER`-RPC toe.
- **Schrijf vrijgave nergens anders.** `hours_replace_day_matrix_basis` blokkeert uitsluitend op dit
  register, en de geërfde databaseproef valt om zodra er een tweede vrijgave-, export-, batch- of
  payroll-achtige `hours_`-tabel bijkomt, of zodra een tweede functie de tabel noemt. Dat is opzet: een
  blokkade die stil ophoudt te werken is erger dan een falende test.
- Neem `private.hours_lock_day` vóór je schrijft; dan serialiseert de vrijgavecontrole vanzelf tegen een
  lopende vervanging.
- Je hoeft de blokkade niet aan te zetten. Zodra er een rij staat, blokkeert T10 vanzelf, en
  `hours_get_day_matrix_options` geeft `released: true` terug zodat het scherm het ook zegt.

## Voor T13 (correcties na export)

Een dag met een rij in `hours_day_releases` geeft `22023` op een vervanging. Dat is het aanknopingspunt
voor de correctieroute. **Hef die blokkade niet op in de vervangings-RPC zelf** — de correctie hoort een
eigen route te zijn, met een eigen spoor.

## Zelf verifiëren

```bash
# Databaseproef (Docker vereist; geïsoleerde container, geen netwerk, geen productie)
python3 scripts/hours-basis-replacement-db-test.py           # 356 tests
python3 scripts/hours-basis-replacement-db-test.py --cleanup

# Applicatiesuite zoals CI draait
npm run lint && npm run typecheck && npm run test && npm run build
```

Browser-QA tegen de demo-organisatie (JA Werkt staat UIT, demo AAN — laat dat zo):

```bash
# 1. Verse synthetische klantweek. Elke run verbruikt permanent één werkdag,
#    dus gebruik altijd een nieuwe run-id in plaats van een bestaande week.
HOURS_PAGES_RUN_ID="t10-$(date +%Y%m%d%H%M%S)" \
HOURS_PAGES_FIXTURE_PATH=/tmp/t10/fixture.json \
  node --env-file=.env --env-file=.env.local scripts/prepare-hours-pages-demo.mjs

# 2. Eigen dev-server, eigen poort — nooit die van een andere sessie meepakken
npx vite --port 8091 --strictPort --host 127.0.0.1

# 3. De spec, met de webserver van Playwright uitgezet
PLAYWRIGHT_SKIP_WEBSERVER=1 E2E_BASE_URL=http://127.0.0.1:8091 \
HOURS_BASIS_LIVE_READY=1 HOURS_BASIS_FIXTURE=/tmp/t10/fixture.json \
HOURS_BASIS_EVIDENCE_DIR=/tmp/t10/evidence \
  node --env-file=.env --env-file=.env.local \
  ./node_modules/@playwright/test/cli.js test --config scripts/playwright.hours-basis.config.ts
```

De spec publiceert via de echte schermen een klantmatrix en een gekoppelde CAO, slaat uren op,
classificeert (basisversie 0, factor 1), vervangt de basis met een reden, herberekent (basisversie 1,
factor 2), en leest daarna de vastgelegde basisrij en de eerste uitkomst byte-identiek terug. Daarnaast:
een verouderde basisversie geeft 409, dezelfde versie opnieuw kiezen geeft 400, en het
medewerkersportaal krijgt 403 en ziet de vervangingstabel niet.

## Bewust niet gedaan

- **Het ophalen van de matrixopties staat buiten TanStack Query.** Het is een eenmalige lees-actie op één
  klik waarvan het antwoord meteen wordt beoordeeld; een cache zou hier vooral een verouderde lijst
  kunnen opleveren. De juistheid hangt er niet aan: de lijst draagt de basisversie waarvoor hij is
  opgehaald, en zodra die niet meer klopt weigert het formulier te verzenden.
- **`hours_get_week` is niet herschreven tot joins.** De basisprojectie kost per dag twee extra queries.
  Dat is gemeten en bewust gelaten: het herschrijven van die projectie raakt elke urenroute en hoort een
  eigen ticket te zijn, niet een bijvangst van T10.
- **Slankere snapshots en minder indexen op het lege vrijgaveregister** zijn genoteerd voor T12, die de
  werkelijke toegangspaden kent.

## Restpunt

De eerste QA-poging liet in de synthetische demo-opdrachtgever `Urenmodule QA t10-202609110835` één
halfafgeronde dag achter (basis vervangen, nog niet herberekend). Dat is synthetische data in een eigen
QA-bedrijf en staat er bewust nog, net als bij eerdere runs. De geslaagde runs zijn
`Urenmodule QA t10-20260911083830` en `Urenmodule QA t10-20260914140820`.
