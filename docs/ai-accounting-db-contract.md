# AI-accounting: maandbudget en databasecontract

Een organisatie met een maandbudget mag per kalendermaand maximaal het ingestelde bedrag aan klantcredits besteden. Voor JA Werkt is dat **€50 per maand**. Ongebruikt budget vervalt; er worden geen oude maanden ingehaald en bedragen stapelen niet op. Kalendermaanden volgen `Europe/Amsterdam`.

De bestaande accountingmigratie blijft onveranderd als historische migratie. De aanvullende migratie `20260907204252_ai_monthly_budget_reset.sql` vervangt de eerdere optellende maandregeling. Reeds geboekte regels blijven intact; correcties verschijnen als nieuwe grootboekregels. Organisaties zonder maandregeling blijven in hun bestaande prepaidmodel.

## Saldo en lopende aanvragen

| Veld | Betekenis |
| --- | --- |
| `organization_credits.credit_mode` | `prepaid` of `monthly`; maandbedrag nul binnen `monthly` betekent gepauzeerd. |
| `monthly_allowance_cents`, `monthly_start_month` | De ingestelde maandlimiet en eerste budgetmaand; de namen blijven compatibel met bestaande clients. |
| `budget_month`, `budget_limit_cents` | De daadwerkelijk verwerkte huidige budgetperiode en limiet. |
| `balance_cents` | Brutosaldo inclusief eventueel nog vastgehouden reserveringen uit eerdere maanden. Dit is niet het maandbudget. |
| `reserved_cents` | Alle open reserveringen, uit huidige én eerdere maanden. |
| `balance_cents - reserved_cents` | Beschikbaar budget voor nieuwe aanvragen; oude reserveringen tellen hierin nooit mee. |
| `ai_requests.budget_month` | De maand waarin de providerpoging is toegestaan. Deze maand blijft staan als de afrekening later komt. |
| `ai_usage_log.budget_month` | Dezelfde autorisatiemaand; oudere NULL-rijen worden toegerekend aan hun aanmaakmaand. |

Voorbeeld over een maandgrens: een septemberaanvraag houdt €10 vast. In oktober begint het nieuwe budget op €50 beschikbaar; technisch zijn het brutosaldo €60 en alle reserveringen €10. Als de septemberaanvraag daarna €8 kost, schrijft het grootboek €8 gebruik en €2 verlopen reservering. Oktober houdt €50 beschikbaar. Vrijgekomen septembergeld wordt nooit nieuw oktoberbudget.

Ook als een aanvraag met status `unknown` meerdere maanden open blijft, blijft uitsluitend die bestaande reservering vastgehouden. Er wordt geen extra budget voor gemiste maanden opgebouwd. De UI toont beschikbaar budget, huidige reserveringen en de maandlimiet; oude reserveringen staan apart.

## Vooraf reserveren en atomair afrekenen

De bestaande RPC-signatures veranderen niet; de elf bestaande edge functions hoeven hiervoor niet opnieuw uitgerold te worden.

```sql
reserve_ai_usage(
  p_request_id uuid, p_org_id uuid, p_user_id uuid,
  p_feature text, p_provider text, p_model text, p_reserved_cents integer,
  p_candidate_id uuid default null, p_metadata jsonb default '{}'
) returns jsonb;

finalize_ai_usage(
  p_request_id uuid, p_status text,
  p_input_tokens integer default null, p_output_tokens integer default null,
  p_thinking_tokens integer default null, p_provider_cost_usd numeric default null,
  p_charged_cents integer default null, p_provider_request_id text default null,
  p_error_code text default null, p_duration_ms integer default null,
  p_metadata jsonb default '{}'
) returns jsonb;
```

Alleen `service_role` mag deze RPC's uitvoeren. Vooraf reserveren vergrendelt de organisatierekening en synchroniseert eerst de huidige budgetmaand. Iedere echte providerpoging heeft een eigen UUID en conservatieve kostenbovengrens. Alleen `ok=true` met `already_exists=false` staat een providerverzoek toe; hergebruik of onvoldoende budget geeft geen tweede provideractie. Een maandbudget van nul blokkeert ook een aanvraag met een reservering van nul.

Een definitieve afrekening (`succeeded` of `failed`) vereist expliciete klantkosten, ook bij nul. Aanvraag, gebruikslog, saldo, reserveringsvrijgave en grootboek worden in één transactie verwerkt. Een fout kan betaald providerverbruik hebben; dat blijft geregistreerd. Exact dezelfde terminale payload mag opnieuw worden aangeboden zonder dubbele boeking; een afwijkende terminale payload wordt geweigerd.

`unknown` houdt de reservering vast totdat de werkelijke uitkomst is vastgesteld. Er is geen automatische vrijgave na een timeout. Aanvragen ouder dan 15 minuten worden zichtbaar als open aandachtspunt. Bij afrekenen van een oude budgetmaand vervalt het ongebruikte deel van die reservering via `reservation_expiry`; het vult de huidige maand niet aan.

Uitzonderlijke kosten boven de eigen reservering worden niet bij andere aanvragen of de klant in rekening gebracht. `requested_charged_cents` bewaart de berekende prijs, `charged_cents` de begrensde afschrijving en `reservation_overrun_cents` het te onderzoeken verschil. Providerkosten blijven apart bewaard. Een mislukte databaseafrekening draait alle boekhoudmutaties terug; de reservering blijft dan zichtbaar open.

## Maandreset en instellingen

```sql
set_monthly_ai_allowance(p_org_id uuid, p_amount_cents integer, p_start_month date)
  returns jsonb;
grant_monthly_ai_credits(p_as_of timestamptz default now(), p_org_id uuid default null)
  returns jsonb;
```

De naam `grant_monthly_ai_credits` blijft bestaan voor compatibiliteit met de bestaande cron. De functie **reset het actuele budget** en telt geen maandbedragen op. Het antwoord bevat `resets_created`, het compatibele `grants_created`, de netto grootboekmutatie in `amount_cents` en `through_month`.

De interne `private.refresh_ai_monthly_budget` verwerkt uitsluitend de gevraagde huidige of nog niet verwerkte periode. Een eerdere periode dan de al verwerkte `budget_month` is een no-op. Een toekomstige kalendermaand wordt geweigerd, ook als die binnen de toegestane vijf minuten klokmarge zou vallen. Een gemiste cronrun leidt uitsluitend tot het actuele maandbudget, niet tot een reeks historische toevoegingen.

De bestaande uurcron draait iedere uur op minuut 5. Reserveren, afrekenen en een geautoriseerde samenvatting ophalen synchroniseren het budget eveneens. De UI hoeft daardoor niet te wachten op de cron. `get_ai_credit_summary` is bewust `VOLATILE`: de leesactie mag eerst de gecontroleerde budgetreset verwerken.

De instellings-RPC is beschikbaar voor actieve superadmins en `service_role`. Een superadmin zonder regulier profiel blijft toegestaan volgens `private.is_active_user()`. Een wijziging voor de huidige maand wordt direct verwerkt. Herhaald opslaan van dezelfde instelling reset reeds besteed budget niet opnieuw. Een echte limietwijziging herberekent het restant na werkelijk geboekte maandkosten en krijgt een afzonderlijke, controleerbare grootboekmutatie.

Een bedrag nul pauzeert het maandbudget, ook als die maand al kosten zijn geboekt. Een verlaging die nog lopende, in de huidige maand goedgekeurde reserveringen zou aantasten wordt geweigerd; deze aanvragen moeten eerst worden afgerond of opgelost. Oude maandreserveringen blokkeren de pauze niet. Het maandbedrag nul zet een organisatie niet terug naar prepaid en biedt geen route om de maandlimiet via handmatig saldo te omzeilen.

Handmatige `topup_ai_credits_once`-mutaties zijn daarom geweigerd voor maandbudgetorganisaties. Het oude `consume_ai_credits`-pad retourneert in maandmodus `ok=false`; nieuwe aanvragen moeten de centrale reserveringsroute gebruiken. In prepaidmodus blijven beide bestaande routes gelijk werken. Een exacte retry van een reeds geboekte handmatige correctie blijft idempotent, ook als de organisatie inmiddels maandmodus gebruikt.

## Correctie JA Werkt

De migratie bevat geen hardcoded organisatie-ID en verwijdert geen historie. Voor de gecontroleerde huidige toestand geldt:

- Eerder brutosaldo: 6721 cent; open reserveringen: 0.
- Budget september: 5000 cent; septembergebruik: 1 cent.
- Correct beschikbaar budget: **4999 cent**.
- Expliciete `monthly_reset`-mutatie: **-1722 cent**; eerdere opening en maandtoevoeging blijven bestaan.

Na toepassing van de migratie verwerkt de bestaande RPC de correctie automatisch op basis van de actuele gegevens:

```sql
-- Uitvoeren als service_role, met het geverifieerde JA Werkt-organisatie-ID.
select grant_monthly_ai_credits(now(), :ja_werkt_org_id);
select get_ai_credit_summary(:ja_werkt_org_id);
```

Als er ondertussen nieuw gebruik is ontstaan, berekent de database het dan juiste restant; er is geen handmatige UPDATE van het saldo nodig. Volgende maand wordt het nieuwe budget €50, onafhankelijk van het ongebruikte restant. Het oude historische verschil van €0,22 blijft ongewijzigd als toelichting op de openingsboeking.

## Samenvatting en kosten

`get_ai_credit_summary(p_org_id uuid)` behoudt alle bestaande velden en voegt toe:

| Veld | Betekenis |
| --- | --- |
| `budget_mode` | Canonieke responsewaarde `monthly` of `prepaid`; de tabelkolom heet `credit_mode`. |
| `budget_month` | Verwerkte maand; null voor prepaid zonder maandperiode. |
| `monthly_budget_cents` | Limiet van de actuele periode; nul bij een gepauzeerd maandbudget. |
| `month_remaining_cents` | Maandlimiet minus werkelijk geboekt maandgebruik, vóór actuele reserveringen. |
| `current_month_reserved_cents` | Alleen reserveringen die de huidige maand belasten. |
| `previous_period_reserved_cents` | Reserveringen uit eerdere maanden, apart vastgehouden. |
| `previous_month_reserved_cents` | Compatibele alias voor hetzelfde bedrag uit eerdere maanden. |
| `month_reset_at` | Tijdstip van de laatste reset of limietwijziging. |
| `next_grant_at` | Eerstvolgende maandreset, of null bij een gepauzeerde regeling. |

`month_charged_cents` en de maandelijkse providerkosten volgen de autorisatiemaand, zodat een late septemberafrekening geen oktobergebruik wordt. `balance_cents` blijft uitsluitend het technische brutosaldo; toon dit niet als maandlimiet.

`ai_usage_log.cost_cents` en `charged_cents` zijn klantcredits in eurocenten. `provider_cost_usd` is apart: door de provider gerapporteerd of uit echt verbruik en een vastgelegde tariefversie berekend. `metadata.provider_cost_kind` onderscheidt die bronnen. NULL betekent onbekend, niet gratis. NaN en oneindige bedragen worden geweigerd. Gemini-denktokens zijn een uitsplitsing van het al betaalde `output_tokens`-totaal en worden niet dubbel geteld. Prompts en modelantwoorden horen niet in technische boekhoudmetadata.

## Grootboek, autorisatie en reconciliatie

`ai_credit_ledger` blijft append-only. De nieuwe soorten zijn `monthly_reset` (netto mutatie naar het nieuwe budget) en `reservation_expiry` (ongebruikt deel van een oude reservering). Eenzelfde verzoek heeft maximaal één `usage_charge` en één eventuele `reservation_expiry`. Een reset kan netto nul zijn of alleen het verschil tonen tussen de vervallen vrije ruimte en de nieuwe limiet; de metadata legt de volledige limiet en periode vast.

Interne gebruikers lezen uitsluitend hun eigen organisatie; actieve superadmins lezen organisatieoverstijgend. Anonieme, portal- en gedeactiveerde gebruikers krijgen geen toegang. De interne refresh is geen rechtstreeks uitvoerbare client-RPC. Alle financiële schrijftoegang loopt via de geautoriseerde transacties.

De oorspronkelijke organisatie-UUID blijft zonder verwijderende FK in het grootboek staan. Daardoor kan een mislukte, ongebruikte registratie worden teruggedraaid terwijl de opening als afgeschermde audit bewaard blijft. Bestaande request- en topup-FK's beschermen de bijbehorende betaalde historie.

`ledger_difference_cents` en `reservation_difference_cents` horen nul te zijn. De gebruikscontrole moet alleen de daadwerkelijke afschrijving vergelijken, niet de aanvullende expiratie:

```sql
select r.id, r.organization_id, r.status, r.charged_cents,
       u.cost_cents usage_charge, l.amount_cents ledger_movement
from public.ai_requests r
left join public.ai_usage_log u on u.request_id = r.id
left join public.ai_credit_ledger l on l.request_id = r.id and l.kind = 'usage_charge'
where r.status in ('succeeded', 'failed')
  and (u.id is null or l.id is null
    or u.cost_cents is distinct from r.charged_cents
    or l.amount_cents is distinct from -r.charged_cents);
```

Deze query hoort geen rijen terug te geven. Een verlopen reservering telt niet als nieuw AI-gebruik of providerkosten.

## Validatie en uitrol

De geïsoleerde PostgreSQL-tests draaien oude en nieuwe migraties in volgorde met synthetische gegevens. Ze controleren onder meer €67,21→€49,99, maandgrenzen en zomertijd, gelijktijdige resets, geen inhaalbudget, oude onbekende aanvragen, late afrekeningen en expiratie, herhaalde instellingen en maandbedrag nul. Bestaande transactietests voor rollen, registratie-rollback en betaalde oproepen blijven gelden.

`python3 supabase/tests/ai_accounting_test.py` gebruikt een tijdelijke database en ruimt deze zelf op. `python3 scripts/ai-accounting-db-test.py` controleert ook echte `pg_cron` en bewaart zijn container ter inspectie; opruimen kan met dezelfde opdracht en `--cleanup`. Er zijn geen provideroproepen, productieverbindingen of klantgegevens nodig voor deze tests.

Uitrol: nieuwe migratie toepassen, de JA Werkt-reset via de bestaande RPC uitvoeren, saldo en nulverschillen controleren en de gecorrigeerde UI publiceren. De bestaande edge-function-RPC-signatures blijven compatibel. De oude migratie of oude maandfunctie mag niet opnieuw over deze correctie heen worden toegepast.
