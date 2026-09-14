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
- Browser-QA op 14 september 2026: negen scenario's met echte tijdelijke records in de demo-organisatie. Kenteken aanmaken/bewerken, historie vanaf beide schermen, verwijderen met annuleren/bevestigen, boetestatus op beide schermen, documenttype, sorteren/pagineren en onboarding inclusief een geweigerde database-write.
- Vijftien aanvullende tabelscenario's geslaagd voor kandidaten, medewerkers, opdrachtgevers, contacten, vacatures, plaatsingen, uren, planning, talentpools, communicatie, vacaturebank en transport. De transporttest wacht op de geladen rijen; de vacaturebanktest maakt en verwijdert eigen demo-vacatures.
- De nieuwe `onboarding-submit` draait voor de pre-release-QA lokaal onder Deno tegen de echte database. Browserrequests worden doorgestuurd naar die handler; responses en databasewrites zijn niet gemockt.
- De tests ruimen hun eigen records op en herstellen de voorafgaande communicatie-instelling. Uitgaande e-mail/WhatsApp staat alleen in de demo-organisatie tijdens de fixturetests op pauze; er worden geen berichten verstuurd.
- Reproduceerbare suite: `npx playwright test --config=playwright.client-release.config.ts`. Vereist demo-credentials (`DEMO_ORG_*`, daarnaast `TEST_EMAIL`/`TEST_PASSWORD` voor de browserlogin), `VITE_SUPABASE_URL` en `VITE_SUPABASE_PUBLISHABLE_KEY`. `E2E_BASE_URL` kiest de frontend; optioneel `QA_LOCAL_EDGE` kiest de lokale onboardinghandler. Zonder die override gaat onboarding naar de productie-edge.
- QA-screenshots en een opruimjournaal blijven onder de genegeerde map `scripts/.qa/`; geen credentials of testtokens in git.

## Release

Live op 14 september 2026 via PR #274, productiecommit `bb86474f53a9f1a0a3d17ebbd2f7aa58c0783c6f`. Frontend bevestigd op `https://ja-works-hub.vercel.app`. `onboarding-submit` is via CLI gedeployed als versie 75 (`ACTIVE`, `verify_jwt=false`); beide live bestanden zijn inhoudelijk gelijk aan de geteste index en gedeelde helper. Geen nieuwe DB-migratie nodig.

De 24 browserscenario's zijn ook op productie geslaagd. Eén bestaande vacaturetabeltest las bij de paginawissel tijdens de laadstatus; de QA-vervolgfix wacht op de response en de eerste rij-ID van pagina 2. Alle eigen testrecords zijn daarna afwezig bevonden en de oorspronkelijke communicatie-instelling van de demo-organisatie is exact teruggelezen.

Bestaande kandidaatvelden worden niet achteraf overschreven met oudere formulierantwoorden. De antwoordenkaart maakt eerdere inzendingen zichtbaar. Bij een deels mislukte inzending blijft de link bruikbaar; de opslag is geen nieuwe atomaire transactie. Een retry kan aanvullende antwoord- of documentrijen opleveren, maar de profielkaart toont het nieuwste antwoord per veld.

Overige wensen uit de inventarisatie vallen buiten deze wijziging en worden apart geoffreerd.
