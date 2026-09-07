# Releasecontrole AI-accounting — 7 september 2026

## Productie

De migratie is toegepast op Supabase-project `noaupcteygfvlyymqtew` als versie
`20260907201512`. De lokale bestandsnaam volgt die geregistreerde versie; de SQL-hash is
`53b8bc047b4eca409bbcce9aca5759066b06f48e4df241f1b1976d8b9177dd93`.

De elf betaalde endpoints zijn met de Supabase CLI vanuit de actuele featureworktree uitgerold,
inclusief gedeelde helpers. Alle elf staan ACTIVE en behouden hun bestaande self-auth-configuratie.
Een runtimecontrole zonder inlog gaf voor ieder endpoint HTTP 401, zonder providerverzoek.

| Functie | Nieuwe versie |
| --- | ---: |
| analyze-cv | 82 |
| analyze-cv-batch | 42 |
| extract-cv-profile | 14 |
| enrich-vacancies | 19 |
| generate-call-questions | 11 |
| generate-vacancy | 10 |
| rerank-matches | 20 |
| cv-rewrite | 75 |
| recruiter-priorities | 69 |
| validate-timesheets | 74 |
| exa-people-search | 83 |

Alleen JA Werkt is ingeschreven voor 5000 cent per maand vanaf september 2026.
De eerste bijschrijving bracht 1721 cent op 6721 cent. Herhaalde uitvoering maakte nul extra
boekingen. De volgende periode begint 1 oktober 2026 om 00:00 Europe/Amsterdam; de cron draait
ieder uur op minuut 5 en een AI-reservering haalt eventueel ontbrekend maandtegoed direct in.

De livecontrole gaf nul verschil tussen saldo en boekingen, nul verschil in reserveringen,
nul afwijkende afrekeningen en nul open/onbekende aanvragen. Het historische verschil van 22 cent
blijft afzonderlijk zichtbaar. Andere organisaties zijn niet ingeschreven.

## Validatie

- Volledige quality-gate: 978 Vitest-tests, typecheck en productiebuild geslaagd; ESLint nul errors.
- Alle elf Deno-entrypoints gecontroleerd.
- Echte PostgreSQL-regressies voor concurrency, idempotentie, rollback, rechten, historische opening,
  registratie-opruiming en maandgrenzen. De onafhankelijke runner gebruikt echte `pg_cron`.
- Desktop en mobiele weergave getest met synthetische gegevens, zonder externe verzoeken.
- Supabase-types opnieuw gegenereerd uit het live schema; JSON-saldo heeft aanvullende runtimevalidatie.

De security-advisor voegde alleen drie verwachte meldingen toe voor bewust aangeboden authenticated
SECURITY DEFINER-RPC's. Interne tenantlezers en actieve superadmins worden binnen de functies
gecontroleerd; anonieme toegang is ingetrokken. Zie de
[toelichting bij deze advisor](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
De performance-advisor meldde uitsluitend nog ongebruikte nieuwe indexen; die zijn nodig voor de
nieuwe tabellen. Er zijn geen nieuwe onbeschermde tabellen of anonieme schrijffuncties gevonden.

De frontend gaat via de bijbehorende PR naar `main` en Vercel. Deze controle beschrijft de database-
en edge-uitrol; de PR en Vercel-deployment tonen de definitieve frontendstatus.

## Grenzen

Er zijn geen betaalde productie-AI-aanroepen of klantberichten verstuurd voor deze tests.
Providerkosten zijn verbruiksramingen volgens het vastgelegde tarief, behalve waar de provider zelf
kosten rapporteert. Onbekende uitkomsten houden hun reservering tot controle met verbruiksbewijs;
oude ontbrekende providerkosten zijn niet achteraf verzonnen. Zie [beheer en herstel](ai-accounting.md).
