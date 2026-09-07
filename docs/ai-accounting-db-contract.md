# AI-accounting databasecontract

Deze migratie start een nieuw, controleerbaar grootboek op het bestaande saldo. Ze verandert geen historisch saldo en schrijft geen ontbrekende oude AI-aanroepen bij. De maandregeling telt bedragen op; bestaand tegoed blijft staan. De standaard maandtoelage voor iedere organisatie is **0**. Alleen expliciet ingeschreven organisaties krijgen een toelage.

## Bedragen en bronnen

| Veld | Betekenis |
| --- | --- |
| `organization_credits.balance_cents` | Werkelijk klanttegoed in eurocenten, inclusief nog gereserveerd bedrag. |
| `reserved_cents` | Som van reserveringen met status `reserved` of `unknown`. |
| `balance_cents - reserved_cents` | Beschikbaar voor een volgende AI-aanroep. |
| `monthly_allowance_cents`, `monthly_start_month` | Toevoeging per kalendermaand vanaf deze eerste maand. Geen reset of vervaldatum. |
| `ai_requests.provider_cost_usd` | Providerkosten in USD: door de provider gerapporteerd of geschat op basis van echt verbruik en een tariefversie in `metadata`. `metadata.provider_cost_kind` onderscheidt die bronnen. NULL betekent onbekend, niet gratis. |
| `ai_requests.requested_charged_cents` | Berekende klantprijs voordat de grens van de reservering wordt toegepast. |
| `ai_requests.charged_cents` / `ai_usage_log.cost_cents` | Daadwerkelijk afgeschreven klantcredits. Niet gelijkstellen aan de providerfactuur. |
| `reservation_overrun_cents` | Berekende klantprijs boven de eigen reservering. Apart zichtbaar, nooit als schuld of ten laste van andere reserveringen. |

Nieuwe aanvragen, het gebruikslog, de afschrijving, het vrijgeven van de reservering en het grootboek krijgen bij afrekening één transactieresultaat. Een technische providerfout kan wel betaald verbruik hebben; status `failed` mag daarom positieve kosten bevatten.

Bij Gemini bevat `output_tokens` ook het betaalde denkwerk; `thinking_tokens` is daarvan een informatieve uitsplitsing en mag niet nogmaals worden opgeteld. Bij Anthropic bevat `input_tokens` ook cachelees- en cacheschrijftokens, met de verschillende providerprijzen vastgelegd in metadata.

## Vooraf reserveren

```sql
reserve_ai_usage(
  p_request_id uuid,
  p_org_id uuid,
  p_user_id uuid,
  p_feature text,
  p_provider text,
  p_model text,
  p_reserved_cents integer,
  p_candidate_id uuid default null,
  p_metadata jsonb default '{}'
) returns jsonb
```

Alleen `service_role` mag deze functie uitvoeren. De transportlaag maakt een nieuwe UUID voor **iedere daadwerkelijke providerpoging**, inclusief retries en een andere provider. Het bedrag is een conservatieve bovengrens voor die ene poging, inclusief mogelijk denkwerk en beeldtokens. De RPC verwerkt eerst eventuele verschuldigde maandtoelagen. Daarna vergrendelt ze de organisatierekening voordat ze beschikbaar saldo controleert.

Het antwoord bevat `ok`, `request_id`, `status`, `reservation_cents`, `balance_cents`, `reserved_cents`, `available_cents`, `already_exists`. Alleen `ok=true` en `already_exists=false` geven toestemming om de provider aan te roepen. Een herhaalde UUID retourneert de bestaande aanvraag met `ok=false`; dezelfde provideractie mag niet worden herhaald. Een UUID met andere kernparameters geeft een fout. Onvoldoende saldo levert een geregistreerde aanvraag met status `blocked` op, zonder reservering of providerverzoek.

## Afrekenen

```sql
finalize_ai_usage(
  p_request_id uuid,
  p_status text,
  p_input_tokens integer default null,
  p_output_tokens integer default null,
  p_thinking_tokens integer default null,
  p_provider_cost_usd numeric default null,
  p_charged_cents integer default null,
  p_provider_request_id text default null,
  p_error_code text default null,
  p_duration_ms integer default null,
  p_metadata jsonb default '{}'
) returns jsonb
```

Alleen `service_role`; status is `succeeded`, `failed` of `unknown`. Het antwoord bevat `ok`, `request_id`, `status`, `charged_cents`, `balance_cents`, `reserved_cents`, `available_cents`, `already_finalized`, `reservation_overrun_cents`.

- `succeeded` en `failed` vereisen een expliciet bedrag, ook bij nul. De definitieve status, één gebruikslogrij, één grootboekrij (ook bij nul) en de saldoverandering worden atomair opgeslagen.
- Exact dezelfde terminale payload mag opnieuw worden aangeboden en boekt niets dubbel. Een andere terminale payload geeft een fout. De transportlaag bewaart dus ook de oorspronkelijke duur en metadata bij een afrekenretry.
- `unknown` houdt de volledige reservering vast. Een timeout, procescrash of verloren antwoord wordt niet automatisch gratis en geeft geen toestemming voor een betaalde retry. De aanvraag kan later met verbruiksbewijs via dezelfde RPC definitief worden afgerekend. Bij onzekerheid over de afrekening zelf kan de exacte afrekening opnieuw worden aangeboden.
- Bij uitzonderlijke overschrijding wordt maximaal de eigen reservering afgeschreven. De volledige berekende prijs, providerkosten en overschrijding blijven bewaard. Dit vereist onderzoek en verbetering van de bovengrens; er ontstaat geen negatieve klantbalans.

Het modelantwoord of de prompt hoort niet in `metadata`; sla alleen technische tarief-, token- en foutgegevens op. Achtergebleven aanvragen worden vanaf 15 minuten zichtbaar als `stale_requests`. Reserveringen hebben bewust geen automatische vrijgave na een timeout.

## Maandregeling

```sql
set_monthly_ai_allowance(p_org_id uuid, p_amount_cents integer, p_start_month date)
  returns jsonb;
grant_monthly_ai_credits(p_as_of timestamptz default now(), p_org_id uuid default null)
  returns jsonb;
```

De eerste RPC is alleen voor superadmins of `service_role` en wijzigt uitsluitend de instellingen. De tweede is voor `service_role` en de databasecron. Er wordt per organisatie en maand exact één grootboekrij met `kind='monthly_grant'` aangemaakt; parallelle uitvoering en herhaalde uitvoering schrijven niets dubbel bij. Het antwoord is `{grants_created, amount_cents, through_month}`.

De kalendermaand wordt bepaald in `Europe/Amsterdam`, inclusief zomer- en wintertijd. De uurcron `ai-monthly-credit-grants` draait iedere uur op minuut 5. De reserverings-RPC haalt een gemiste cronuitvoering ook in. Toekomstig bijschrijven is niet toegestaan; `p_as_of` mag maximaal vijf minuten vooruit liggen voor klokverschil. Een inhaalperiode boven tien jaar faalt expliciet. Toelagen en handmatige mutaties zijn begrensd op €100.000 per handeling/maand; dit is een technische foutgrens, geen standaardbedrag.

Voor JA Werkt is de gewenste inschrijving €50 vanaf september 2026; uitvoeren gebeurt apart na review/deploy:

```sql
-- Uitvoeren met service_role en het geverifieerde JA Werkt-organisatie-ID.
select set_monthly_ai_allowance(:ja_werkt_org_id, 5000, date '2026-09-01');
select grant_monthly_ai_credits(now(), :ja_werkt_org_id);
```

Een bedrag wijzigen verandert reeds geboekte maanden niet. Voor nog niet geboekte maanden vanaf de ingestelde startmaand geldt het nieuwe bedrag. De UI moet daarom expliciet de eerste maand tonen. Er is geen automatische inschrijving of terugwerkende toelage voor andere organisaties.

## Handmatige correcties

```sql
topup_ai_credits_once(p_org_id uuid, p_amount_cents integer, p_note text, p_request_id uuid)
  returns integer;
```

Alleen actieve superadmins; een superadmin zonder regulier organisatieprofiel mag dit ook, volgens de bestaande `private.is_active_user()`-regel. De UI bewaart dezelfde UUID bij een onzekere netwerkretry. Het bedrag en de notitie moeten dan identiek zijn. Negatieve correcties zijn mogelijk zolang ze geen gereserveerd bedrag besteden en geen schuld creëren. Het bestaande `topup_ai_credits(uuid, integer, text)` blijft compatibel maar maakt zelf een UUID; nieuwe UI-code gebruikt uitsluitend de `once`-variant.

`consume_ai_credits(uuid, integer)` blijft tijdelijk bruikbaar voor nog actieve oude edge-functionversies. Deze oude aanroepen worden als `legacy_charge` in het grootboek geschreven en kunnen geen nieuw gereserveerd saldo verbruiken. Ze kunnen zelf geen provider-request-ID leveren; productiecode moet daarom volledig naar de reserveringsroute worden overgezet. Het oude `ai_usage_log` blijft voor zulke lopende aanroepen schrijfbaar via de service-role tijdens de overgang.

## Lezen en reconciliatie

```sql
get_ai_credit_summary(p_org_id uuid) returns jsonb
```

Beschikbaar voor interne gebruikers van hun eigen organisatie, superadmins en `service_role`. De uitkomst bevat:

- Saldo: `balance_cents`, `reserved_cents`, `available_cents`.
- Toelage: `monthly_allowance_cents`, `monthly_start_month`, `next_grant_at` (ISO-tijdstip of null; kan in het verleden liggen als een bijschrijving nog ontbreekt).
- Huidige Nederlandse maand: `month_start`, `month_charged_cents`, `month_provider_cost_usd` (null zonder bekende providerkosten), `month_provider_cost_unknown_count`.
- Open posten: `unresolved_requests`, `stale_requests`, `unreviewed_overrun_cents`.
- Aansluiting: `ledger_difference_cents`, `reservation_difference_cents`, `historical_unexplained_cents`.

De eerste twee verschillen moeten **nul** zijn. Het historische verschil blijft zichtbaar als onveranderlijke openingstoelichting. Voor JA Werkt was op het voorafgaande controlemoment het saldo 1721 cent, levenslange toevoegingen 5000 cent en geregistreerde gebruikskosten 3257 cent: een historisch onverklaard verschil van 22 cent. De migratie legt de daadwerkelijk aanwezige waarden vast op het migratiemoment; ze corrigeert of verzint geen historie.

Aanvullende diagnose voor afrekeningen die niet exact aan hun gebruikslog en grootboek aansluiten:

```sql
select r.id, r.organization_id, r.status, r.charged_cents,
       u.cost_cents usage_charge, l.amount_cents ledger_movement
from public.ai_requests r
left join public.ai_usage_log u on u.request_id = r.id
left join public.ai_credit_ledger l on l.request_id = r.id
where r.status in ('succeeded', 'failed')
  and (u.id is null or l.id is null
    or u.cost_cents is distinct from r.charged_cents
    or l.amount_cents is distinct from -r.charged_cents);
```

Deze query moet geen rijen geven. De reserveringssom telt uitsluitend `reserved` en `unknown`; `blocked` heeft nooit saldo vastgezet. Nieuwe tabellen ondersteunen interne tenantlezers en superadmins via RLS, inclusief de actieve-profielcontrole. Dezelfde actieve-superadmincontrole geldt in de SECURITY DEFINER-RPC's. Anonieme en portalgebruikers hebben geen toegang; clientrollen kunnen de boekhouding niet schrijven.

Grootboekregels kunnen niet worden gewijzigd of verwijderd, ook niet via directe service-role schrijftoegang. `ai_credit_ledger.organization_id` bewaart de oorspronkelijke UUID zonder verwijderende organisatie-FK. Hierdoor kan de bestaande registratieflow een ongebruikte nieuwe organisatie terugdraaien als het aanmaken van het auth-account mislukt; de openingsboeking blijft voor actieve superadmins beschikbaar als audit. Er ontstaat geen tenanttoegang tot die achtergebleven boeking. Bestaande request- en topup-FK's beschermen bijbehorende betaalde historie tegen cascades. Een verwijderde organisatie heeft geen actieve creditrekening meer; een eventueel toekomstig retentie-/verwijderproces moet de bewaarde audit expliciet behandelen.

## Validatie en uitrol

Voer de migratie en regressietests uit in een geïsoleerde PostgreSQL-database, inclusief concurrerende transacties. Pas de migratie daarna toe voordat edge functions die de nieuwe RPC's gebruiken worden uitgerold. Het saldo blijft bruikbaar voor oude functies gedurende deze overgang. Schrijf vervolgens alle actieve betaalde AI-paden over naar de centrale transportlaag, schrijf alleen JA Werkt in, voer de eerste maandbijschrijving uit en verifieer beide nulverschillen en de cron. Geen providerverzoek is nodig om de boekhouding te testen.

De basisrunner `python3 supabase/tests/ai_accounting_test.py` gebruikt uitsluitend een tijdelijke PostgreSQL 17-Dockercontainer zonder netwerk of hostpoort. De 22 regressies omvatten echte concurrerende reserveringen en afrekeningen, idempotentie, onbekende uitkomsten, kostenplafond, rollen, historische opening, registratie-rollback en handmatige bijschrijvingen. `python3 scripts/ai-accounting-db-test.py` voegt onafhankelijke controle toe met echte `pg_cron`, Nederlandse maandgrenzen en aanvullende foutgevallen. De runners gebruiken synthetische gegevens. De basisrunner ruimt zijn container automatisch op; de uitgebreide runner bewaart hem voor inspectie en ruimt hem op met `python3 scripts/ai-accounting-db-test.py --cleanup`.

Bij een noodzakelijke code-rollback blijven de migratie en het grootboek staan. De compatibele `consume_ai_credits` beschermt bestaande reserveringen en registreert de oude afschrijvingen. Verwijder of reset na echte boekingen geen grootboektabellen om een edge-functionprobleem op te lossen.
