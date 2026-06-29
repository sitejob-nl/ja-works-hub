# Go-live data checklist — 17 juni 2026

Werkdocument voor de data/livegang-punten uit de 06-17 projectbespreking. Doel: productie-resync en eerste livegang niet starten zonder expliciete go/no-go op data-integriteit, duplicaten en financiele koppelingen.

## Nu in deze branch verwerkt

- Carerix delta-resync kan vanuit de UI worden gestart via `Delta vanaf`; de backend ondersteunde `modified_since` al.
- Matchduplicaten worden DB-level geblokkeerd met een unieke index op `(organization_id, vacancy_id, candidate_id)` na cleanup van bestaande duplicaten.
- AI-backfill scherm toont staged-run guardrails: organisatie verplicht, `max_candidates`, provider/resultaat/kosten.

## Voor go-live afvinken

- Carerix Acceptance-tab draaien na dry-run en na live import: CR*-scope, aantallen, documentbytes, failures en entity coverage.
- Delta-resync datum vastleggen: laatste betrouwbare importdatum, daarna eerst dry-run, daarna pas live.
- Duplicaten steekproef controleren: kandidaten, matches, Carerix external mappings en testvacatures.
- Testdata opschonen via expliciete SQL-runbook of tijdelijke beheerquery; geen handmatige deletes zonder auditnotitie.
- Kandidaten zonder e-mail/telefoon: productkeuze vastleggen tussen importeren-met-datakwaliteitsvlag of overslaan.
- KVK-matching voor Carerix-opdrachtgevers: handmatige steekproef en besluit of automatische verrijking later in scope komt.
- Flexpedia: person-match sleutel kiezen voordat omzet/marge-import wordt gebouwd (`flexpedia_id`, personeelsnr of andere sleutel). API-koppeling blijft aparte scope.
- Exact omzetrapportage: scopebesluit directie/admin-only voordat financieel dashboard of extra Exact-endpoints worden gebouwd.

## Stopcriteria

- Carerix dry-run maakt onverwacht veel nieuwe kandidaten/opdrachtgevers aan waar bestaande records verwacht worden.
- Documentbytes of CV-koppelingen ontbreken bij een relevante steekproef.
- Duplicaatpercentage stijgt na resync.
- Onvoldoende contactgegevens bij kandidaten blokkeren recruitmentflow zonder dat er een datakwaliteitsvlag zichtbaar is.
- Geen akkoord op Flexpedia-matchsleutel of Exact-roltoegang.
