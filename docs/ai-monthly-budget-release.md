# Correctie naar vast AI-maandbudget — 7 september 2026

JA Werkt heeft €50 AI-budget per kalendermaand. Ongebruikt budget vervalt bij de maandwisseling;
er is geen stapeling of inhaaltegoed. Dit vervangt de onjuiste cumulatieve interpretatie in PR #260.

## Live databasecontrole

Migratie `20260907204252_ai_monthly_budget_reset.sql` is toegepast op `noaupcteygfvlyymqtew`.
SHA256: `88f303b57eac277c45d059bd40ee08bc34de85136b9d090f8c71fb95f67f4b76`.

De correctie staat als een nieuwe boeking van -1722 cent; historische boekingen zijn intact.
De gecontroleerde toestand na correctie is:

| Onderdeel | Uitkomst |
| --- | ---: |
| Septemberbudget | €50,00 |
| Septemberverbruik | €0,01 |
| Beschikbaar | €49,99 |
| Open reserveringen | €0,00 |
| Verschil tussen saldo en boekingen | €0,00 |
| Verschil in reserveringen | €0,00 |
| Opnieuw uitvoeren maandreset | Geen nieuwe boeking |
| Volgende budgetperiode | 1 oktober 2026, Nederlandse tijd |

Alleen JA Werkt gebruikt de maandregeling. De bestaande cron is actief en de bestaande AI-functies
gebruiken de aangepaste RPC's zonder wijziging van hun API-contract. Ook het ophalen van het
budgetoverzicht controleert de maandwisseling, zodat de UI niet op de uurcron hoeft te wachten.

## Validatie

- 982 applicatietests geslaagd; lint nul errors, typecheck en productiebuild geslaagd.
- 40 echte PostgreSQL/pg_cron-regressies op de definitieve migratiehash, inclusief gelijktijdigheid,
  maandgrenzen, geen stapeling en late afrekening uit de vorige maand. Eigen testcontainer opgeruimd.
- Nieuwe Supabase-types gegenereerd uit het live schema.
- Geen nieuwe security-advisories. De twee nieuwe performancevermeldingen betreffen nog ongebruikte
  indexen; zie [uitleg van de advisor](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).
- Geen betaalde AI-testcalls of klantcommunicatie.

De frontend van deze correctie wordt via de bijbehorende PR en Vercel uitgerold. De PR is leidend
voor de definitieve frontendstatus. Zie [afspraak en beheer](ai-accounting.md) en
[databasecontract](ai-accounting-db-contract.md) voor de actuele werking.
