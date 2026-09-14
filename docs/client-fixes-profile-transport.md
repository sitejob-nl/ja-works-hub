# Geselecteerde klantpunten: profiel en transport

Werkbranch: `codex/client-fixes`, vanaf `origin/main` `192e222`.
Werkmap: `/Users/kas/dev/ja-works-hub/.worktrees/codex-client-fixes`.

| Punt | Resultaat |
|---|---|
| Kentekens | Aanmaken/bewerken normaliseren hoofdletters, spaties en streepjes naar de bijbehorende Nederlandse kentekenserie, bijvoorbeeld `2-TLH-29`. Ongeldige/incomplete schrijfwijze blokkeert opslaan. Geen controle of het kenteken daadwerkelijk geregistreerd is. |
| Onboarding in kandidaatprofiel | Dezelfde ingediende antwoorden verschijnen in Profiel en Onboarding. Nieuwste antwoord per veld; BSN/IBAN blijven afgeschermd. Gekoppelde velden gaan naar de kandidaat; fouten bij profiel-, antwoord- of documentopslag worden niet meer als succes gemeld. Formulierkeuze is aan token/organisatie gebonden. |
| Historische autotoewijzing | Vanaf voertuig een afgesloten periode invoeren; overlap wordt vooraf getoond. Vanaf medewerkersdossier blijft toevoegen beschikbaar bij een huidige auto. Historische registratie verandert een vrije auto niet in toegewezen en verstuurt geen autoreglement. |
| Boetestatus | Bevestiging bestaat op beide boetenschermen (#251); klik en annuleren schrijven niets. Bestaande componenttests uitgevoerd. |
| Autotoewijzing verwijderen vanuit medewerker | Bestaat (#254); componenttest bewijst bevestiging en aanroep van dezelfde verwijderlogica als voertuigkant. De bestaande voorwaarde eerst inleveren blijft gelden. |
| Inventarisatieformulier | Actief documenttype live bevestigd voor de aanwezige organisaties; bestaande documenttypebeheerfunctie (#247) blijft gebruikt. |
| Sorteren en 10/20/50 rijen | Bestaat op Transport en de hoofdtabellen (ook 100 rijen). Tests voor sortering over de volledige set, paginering en URL-state uitgevoerd. |

## Verificatie

- Volledige quality-gate: lint (geen errors; bestaande warnings), typecheck, productiebuild en Vitest.
- Deno-typecheck van `onboarding-submit`.
- Gerichte componenttests met gemockte data voor historische toewijzing, verwijderen, onboardingantwoorden en boetebevestiging.
- Live alleen metadata/configuratie gelezen: formulierkoppelingen, documenttype, kolommen en toewijzingstriggers.
- Geen productiegegevens gewijzigd en geen berichten verzonden. Geen live browser-E2E in deze ronde.

## Release

Frontend via PR-merge; daarna `supabase functions deploy onboarding-submit --project-ref noaupcteygfvlyymqtew` vanuit deze branch (bundelt de nieuwe gedeelde helper). Geen nieuwe DB-migratie nodig.

Bestaande kandidaatvelden worden niet achteraf overschreven met oudere formulierantwoorden. De antwoordenkaart maakt eerdere inzendingen zichtbaar. Bij een deels mislukte inzending blijft de link bruikbaar; de opslag is geen nieuwe atomaire transactie. Een retry kan aanvullende antwoord- of documentrijen opleveren, maar de profielkaart toont het nieuwste antwoord per veld.

Overige wensen uit de inventarisatie vallen buiten deze wijziging en worden apart geoffreerd.
