# JA Werkt acceptatie-audit

Status: REVISE  
Datum: 2026-05-07  
Scope: lokale codebase, `CLAUDE.md`/`AGENTS.md`, `Meetings/`, `Offerte/JA Werkt Fase 1.docx.md`, lokale migrations en read-only live Supabase signalen.

## Live herstel uitgevoerd

Uitgevoerd op 2026-05-07:

- Supabase migration `security_advisor_followup` live toegepast.
- Supabase migration `security_advisor_execute_grants_followup` live toegepast.
- Edge functions live gedeployed: `microsoft-api`, `email-campaign-processor`, `cv-rewrite`, `carerix-attachment-download`, `data-export`.
- Live unauthenticated en invalid-token checks op deze vijf functions geven allemaal `401`.
- Supabase Advisor toont geen `v_unit_occupancy` SECURITY DEFINER view, geen permissive `client_errors`, geen public logo-bucket listing en geen anon SECURITY DEFINER execute warnings meer.

Resterende live advisor warnings:

- `pg_trgm` staat nog in schema `public`.
- Leaked password protection staat nog uit in Supabase Auth.
- Een set authenticated SECURITY DEFINER warnings blijft bewust bestaan voor browser/RLS/superadmin RPCs die interne tenant/rolchecks afdwingen.

## Korte conclusie

JA Werkt is functioneel ver: de kernmodules voor kandidaten, bedrijven, plaatsingen, medewerkers, portals, huisvesting, voertuigen, Q8/tankpascontrole, Carerix, Exact, Microsoft en AI staan grotendeels als echte productflows in de codebase. De architectuur sluit in grote lijnen aan op de Fase 1-belofte van een compleet werkbaar platform.

De huidige acceptatiestatus is nog niet "productie-hard". De grootste risico's zitten niet in ontbrekende schermen, maar in security, tenant-isolatie, live/local drift, type/schema-drift en een aantal belofte-vs-implementatie verschillen uit de offerte en meetings.

## Bronnen die zwaar wegen

- `CLAUDE.md` is de single source of truth voor architectuur, gevoelige data, RLS, edge functions en conventies.
- `AGENTS.md` verwijst expliciet naar `CLAUDE.md`, dus er is geen tweede agentspecifiek beleid.
- `Offerte/JA Werkt Fase 1.docx.md` zet de verwachting neer: een compleet werkbaar platform, geen losse demo.
- `Meetings/` maakt duidelijk dat plaatsing de centrale SSOT moet zijn, Carerix-productiedata acceptatiekritisch is, onboardinglinks mobiel moeten werken, Q8 een uitzonderings/signaaltool is en opdrachtgever/medewerkerportals onderdeel zijn van de basisflow.
- Live Supabase read-only controle laat zien dat sommige lokaal geharde functies nog niet live lijken te staan en dat security advisors kritieke waarschuwingen geven.

## Wat al goed staat

- Domeinmodel is volwassen: kandidaat, bedrijf, contact, vacature, plaatsing, medewerker, huisvesting, voertuig, looncomponenten, timesheets, documenten, AI en communicatie zijn herkenbaar gemodelleerd.
- Vier auth-zones zijn conceptueel aanwezig: hoofdapp, medewerkerportaal, opdrachtgeverportaal en superadmin.
- Edge-function architectuur is rijk en past bij externe koppelingen zoals Microsoft, Exact, WhatsApp, Carerix, RDW en AI.
- `CLAUDE.md` bevat sterke regels voor encrypted columns, tenant isolation en edge-function auth.
- De app heeft al RLS, service-role edge flows, generated Supabase types en audit/event logging.
- De lokale hardeningpass heeft inmiddels centrale auth helpers, HTML sanitization, audit-redaction, server-side data export en CI/typecheck gates toegevoegd.

## Acceptatieblokkers

1. Live edge functions zijn uitgerold, maar moeten functioneel met echte data worden doorgelopen.

   `microsoft-api`, `email-campaign-processor`, `cv-rewrite`, `carerix-attachment-download` en `data-export` staan live met self-auth/tenant-afleiding. Unauth en invalid-token checks falen correct met `401`. De resterende stap is happy-path validatie met echte gebruikers/data.

2. Security advisors zijn sterk teruggebracht, met bewuste restpunten.

   De kritieke live punten rond `v_unit_occupancy`, anon RPC execute, `client_errors` en logo-bucket listing zijn aangepakt. Resterend: `pg_trgm` in `public`, leaked-password-protection uit, en authenticated SECURITY DEFINER warnings voor RPCs die app/RLS/superadmin-flows nog nodig hebben.

3. Anon execute op decrypt/token RPCs is te ruim.

   Functies zoals `decrypt_sensitive`, `get_candidate_decrypted`, token getters en campaign/filter RPCs mogen niet als breed publiek API-oppervlak beschikbaar zijn. Waar clientgebruik nodig is, moet de functie zelf expliciet org/rol controleren.

4. Type/schema-discipline blijft overdrachtskritisch.

   Tijdens de audit faalde `npm run typecheck` op drift rond employee/portal/talentpool/vehicle/WhatsApp types. Dat is lokaal opgelost en de gate is nu groen, maar gegenereerde types, migrations en live schema moeten bij overdracht strak gelijk blijven.

5. AI/privacy belofte moet worden gladgetrokken.

   De offerte noemt AI op een eigen EU-server. De code heeft nu twee paden: default VPS/Qwen3-14B en optioneel Cloud/Anthropic Claude Haiku 4.5 met server-side pseudonimisering en €50 starterbudget per organisatie. Dat kan prima, maar dan moet het contractueel, technisch en in logging/pseudonymisatie expliciet kloppen.

6. Carerix-productiedata blijft acceptatiekritisch.

   Meetings maken duidelijk dat import, bijlagen, mapping en productiegegevens essentieel zijn. Lokale code bevat veel Carerix-werk, inclusief CR*-runners en aparte documentbyte-download, maar de acceptatie moet aantonen dat productiedata en documenten volledig en veilig doorkomen.

7. Onboarding/profile links moeten mobiel bewezen werken.

   In de meetings is expliciet genoemd dat een testlink faalde en testen daardoor stopte. Publieke tokenflows zijn daarom een P1 QA-pad, niet een nice-to-have.

8. Opdrachtgeverportaal moet route-level dicht zitten.

   De rol `opdrachtgever` bestaat in types en productscope. Main-app routes moeten opdrachtgevergebruikers consequent naar `/klantportaal` sturen en niet alleen leunen op UI-navigatie.

9. Q8/tankpascontrole moet als signaaltool worden gevalideerd.

   De meeting over Q8 beschrijft periodematching met On-track en configureerbare marge rond 10-15 procent. Acceptatie moet bewijzen dat deze functionele nuance in de module zit.

10. Repo/live migration drift moet weg.

    Live migrations bevatten recent toegepaste schemawijzigingen die lokaal als ongecommitteerd of drift zichtbaar zijn. Dat is overdrachts- en deployrisico.

## Herstelvolgorde

1. Security eerst.

   De eerste live hardening is uitgevoerd. Volgende stap: beslissen of `pg_trgm` naar `extensions` mag en leaked-password-protection aanzetten in Supabase Auth.

2. Typecheck groen houden.

   De lokale gate is groen. Houd dit als harde CI-eis en genereer Supabase types opnieuw zodra live schemawijzigingen worden toegepast.

3. Tenant-isolatie aantonen.

   Test Company A/B isolatie voor hoofdapp, portals, service-role edge flows, exports, documenten, campaigns en Carerix attachment download.

4. Acceptatieflows uit Meetings nalopen.

   Plaatsing als SSOT, Carerix import, onboarding link, medewerkerportaal, opdrachtgeverportaal, uren/goedkeuring, huisvesting, vervoer en Q8.

5. AI/privacy contract rechtzetten.

   Leg vast of AI extern draait, welke data wordt gepseudonimiseerd, welke prompts/logs worden opgeslagen en welke verwerker/locatieafspraken gelden.

6. CI en overdracht stabiliseren.

   `lint`, `typecheck`, `test`, `build` en een kleine Playwright smoke moeten standaard gates zijn. Uncommitted migrations moeten gecommit of expliciet gequarantined worden.

## Minimale acceptatietests

- Edge auth: unauthenticated, invalid token, wrong organization en happy path voor `microsoft-api`, `email-campaign-processor`, `cv-rewrite`, `carerix-attachment-download` en `data-export`.
- Sensitive data: export, audit log, compliance check en candidate edit bevatten geen ruwe BSN/IBAN/tokens.
- HTML security: mail bodies, template previews en AI HTML renderers strippen scripts, events en gevaarlijke URLs.
- Portal routing: `opdrachtgever` kan niet in hoofdapp routes; medewerker kan niet in opdrachtgeverroutes; publieke tokenroutes blijven alleen token-bound.
- Multi-tenant: org A kan org B niet lezen/schrijven via UI, RPC, storage of edge function.
- Carerix: productie-import, documentdownload en mapping met echte randgevallen.
- Q8: periodematching, marge-instelling, afwijkingslijst en rapportage.
- Gates: `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, daarna Playwright critical flows.

## Beslispunt

De codebase verdient geen afkeuring; hij verdient een harde acceptatieronde. Mijn advies is om pas te deployen/accepteren wanneer live edge functions zijn gehard, Supabase advisor issues zijn teruggebracht, typecheck groen is en de meetingkritieke flows met echte data zijn getest.
