# AI-backfill dry-run plan — 2026-06-03

Doel: de circa 1.900 bestaande kandidaten gecontroleerd verrijken met AI op basis van CV, profiel, interne notities, communicatie en plaatsingshistorie, zonder onverwachte kosten, datavervuiling of oncontroleerbare conclusies.

## Preflight

- Bevestig organisatie-ID, provider (`gemini` aanbevolen voor kosten), model en beschikbaar AI-saldo.
- Zet automatische kandidaatcommunicatie stil zodra de globale kill-switch bestaat; tot die tijd geen campagne- of matchautomation tegelijk testen.
- Test alleen kandidaten met `ai_status IS NULL` of `idle`; gebruik `include_failed: true` pas nadat falende dossiers steekproefsgewijs zijn beoordeeld.
- Maak een QA-sample met minimaal: kandidaat zonder CV, kandidaat met interne red flag, kandidaat met onbekend rijbewijs, kandidaat met taal zonder bewijs, kandidaat met tegenstrijdige bronnen.

## Staged run

1. **Smoke sample:** `provider: "gemini"`, `batch_size: 5`, `max_candidates: 5`, `include_failed: false`.
2. **Breed sample:** `batch_size: 10`, `max_candidates: 25`, zelfde provider/model.
3. **Kosten-/runtimecheck:** vergelijk response `completed`, `failed`, `skipped`, `cost_cents` en `results`.
4. **QA-review:** open minimaal 10 afgeronde kandidaten en controleer:
   - feiten/aannames/onbekend zichtbaar in `ai_analysis.datakwaliteit`;
   - taalniveau is CEFR of expliciet `onbekend`;
   - taalbewijsstatus is `bewezen`, `recruiter_beoordeeld`, `ai_indicatief` of `onbekend`;
   - ontbrekend rijbewijs staat als `mobiliteit.rijbewijs_status = "onbekend"`;
   - CV-loos dossier heeft lage dossierbetrouwbaarheid en `manual_review_required = true`;
   - interne contra-indicatie staat in `contra_indicaties` en `ai_red_flags`.
5. **Full run:** pas starten na akkoord op QA-sample en saldo. Gebruik normale batchgrootte, laat self-triggering alleen doorlopen als kosten en foutpercentage binnen verwachting vallen.

## Stopcriteria

- Meer dan 15% `failed` of `skipped` in de breed sample.
- Gemiddelde kosten per kandidaat boven afgesproken limiet.
- AI concludeert meer dan incidenteel “geen rijbewijs” terwijl brondata ontbreekt.
- Taalvaardigheid wordt als feit gepresenteerd zonder CV-claim, recruiterbeoordeling of certificaat.
- Contra-indicaties uit interne notities ontbreken in de output.

## Acceptatie-output

- Eén kort rapport met aantallen, kosten, foutredenen, QA-samplelinks en besluit: doorgaan, prompt aanpassen of data eerst opschonen.
- Registry-item: `0603-AI-BACKFILL-DRYRUN`.
