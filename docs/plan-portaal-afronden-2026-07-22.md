# Plan: medewerkersportaal afmaken + uitrollen

> **Voor een verse sessie.** Start met `git fetch origin main`, werk in een worktree vanaf
> `origin/main` (EnterWorktree), en volg het sessieprotocol onderaan. Dit plan is geschreven
> op 2026-07-22 en gebaseerd op live geverifieerde feiten (pg_policies, deployed functions),
> niet op aannames.

## Doel

Het medewerkersportaal (`/portaal`) is bijna af maar wordt niet gebruikt (1 account in prod).
Dit plan maakt het functioneel compleet (JobMarket), bruikbaar voor de doelgroep
(meertaligheid — arbeidsmigranten PL/RO/EN), geverifieerd (QA-ronde) en uitgerold
(activatiecampagne).

## Geverifieerde uitgangssituatie (2026-07-22)

- **RLS-permissive-gat is dicht** (migratie `20260722073336`, PR #198). Alle portaal-tabellen
  hebben nette self-policies, gecheckt tegen live `pg_policies`: timesheets, documents,
  placements, housing_assignments/-inspections, vehicle_assignments/-damage_reports,
  sick_reports, payslips, hour_letters, annual_statements, contracts, candidates,
  employee_notifications, loyalty/rewards (via `get_employee_candidate_id()`). ✅
- **Kapot: PortalJobMarket** ([src/pages/portal/PortalJobMarket.tsx](../src/pages/portal/PortalJobMarket.tsx)).
  `vacancies.tenant_select` vereist `has_role_permission('vacancies.view')` en
  `matches.tenant_select` vereist `matching.pipeline.view` — `has_role_permission()` geeft
  **altijd false** voor de rol `medewerker` (hardcoded rollenlijst in de functie). De pagina
  toont dus een lege lijst. Solliciteren (insert) werkt wél, via de op 22-07 toegevoegde
  policy `matches_employee_self_apply`.
- **i18n-fundament bestaat al**: `TranslationContext`
  ([src/contexts/TranslationContext.tsx](../src/contexts/TranslationContext.tsx)) vertaalt de
  hele DOM runtime via MutationObserver + DeepL (edge fn `translate-platform`, met
  localStorage-cache). Beperkingen nu: alleen `nl`/`en` (`PlatformLanguage`-union in
  [src/contexts/translation-context.ts](../src/contexts/translation-context.ts) én
  `ALLOWED_TARGETS` in [supabase/functions/translate-platform/index.ts](../supabase/functions/translate-platform/index.ts)),
  en een binaire `LanguageToggle`.
- **Welkomstvideo (FR-41)**: niet gebouwd, geen setting.
- **Uitnodigingsflow werkt**: `send-portal-invite` (edge, live) + `PortalActivateSheet`
  (per medewerker) + `/portaal/activeren/:token`. Geen bulk-invite.

## Fase A — JobMarket repareren (klein; migratie + evt. 1 UI-regel)

1. **Migratie** (idempotent, DROP IF EXISTS + CREATE), via MCP `apply_migration`:
   - `vacancies_employee_read_open` — SELECT voor `authenticated`:
     `organization_id = (select get_user_org_id()) AND status = 'open' AND (select is_employee_user())`.
   - `matches_employee_self_select` — SELECT voor `authenticated`:
     `organization_id = (select get_user_org_id()) AND candidate_id = (select get_employee_id())`.
2. **Companies-join**: de pagina embed `companies:company_id(id, name, address_city)`;
   medewerkers mogen `companies` niet lezen, dus de bedrijfsnaam blijft leeg (PostgREST geeft
   `null`-embed, geen error). Twee opties — **besluit vooraf**:
   - a) *(advies)* smalle leespolicy: `companies` SELECT voor medewerkers, beperkt tot
     `id IN (select company_id from vacancies where organization_id = get_user_org_id() and status='open')`;
   - b) join uit de pagina halen en geen bedrijfsnaam tonen (privacy-voorzichtiger; sommige
     inleners willen misschien niet zichtbaar zijn voor eigen flexkrachten — check bij Jeroen).
3. Spiegel-migratie in `supabase/migrations/` met **dezelfde versie** als de
   `schema_migrations`-registratie van de MCP-apply; daarna `get_advisors` (security) draaien.
4. **Acceptatie**: ingelogd als demo-medewerker toont /portaal/vacatures open vacatures,
   "al gesolliciteerd"-status klopt, solliciteren maakt een match (bron `sollicitatie`) en is
   idempotent (dubbel = nette fout).

## Fase B — Meertaligheid (PL/RO/EN) + welkomstvideo

Hergebruik het bestaande DeepL-systeem; dit is een uitbreiding, geen nieuwbouw.

1. **Edge fn `translate-platform`**: `ALLOWED_TARGETS` uitbreiden met `PL` en `RO` (DeepL
   ondersteunt beide; bron blijft `NL`). Check dat `DEEPL_API_KEY`-secret gezet is en of het
   free- of paid-endpoint wordt gebruikt (kostenimpact bespreken bij grote uitrol; cache in
   localStorage dempt het al flink). Deploy via CLI.
2. **Frontend**: `PlatformLanguage` → `'nl' | 'en' | 'pl' | 'ro'`; `normalizeLanguage`/
   `TARGET_LANGUAGE`-binariteit in `TranslationContext.tsx` vervangen door de union;
   `LanguageToggle` → klein dropdown-menu met vlaggen/taalnamen.
3. **Scope van de provider checken**: waar hangt `TranslationProvider` nu (grep in
   `App.tsx`/layouts)? Zorg dat hij het hele `/portaal/*`-segment dekt, niet alleen
   login/activate/profiel.
4. **Persistentie**: localStorage (bestaat) volstaat als MVP. Optioneel later:
   `candidates.portal_language`-kolom zodat de voorkeur cross-device meegaat en bruikbaar is
   voor uitgaande communicatie.
5. **Welkomstvideo (FR-41)**: `organizations.settings.portal_welcome_video_url` (gewoon een
   settings-key, geen migratie nodig) + dismissable videokaart bovenaan `PortalDashboard`
   (embed YouTube/Vimeo-URL); instelbaar in Instellingen → Algemeen. Let op de
   `enforce_organization_settings_update`-trigger: settings-updates kunnen alleen als
   admin/settings.manage — de bestaande settings-componenten doen dit al goed.
6. **Acceptatie**: taal-switch naar PL vertaalt dashboard/uren/documenten runtime; voorkeur
   overleeft refresh; welkomstvideo toont bij gezette URL en is weg te klikken.

## Fase C — QA-ronde portaal (browser, demo-org)

Zoals de kernflow-QA van 22-07, maar dan voor beide portalen. Protocol:

1. **Kill-switch AAN** op de demo-org vóór flows die mailen (ziekmelding → notificatie), via
   PATCH op `organizations.settings.outbound_paused = {"email":true,"whatsapp":true}` als
   demo-admin (de `enforce_organization_settings_update`-trigger blokkeert de MCP-SQL-weg;
   REST als ingelogde admin werkt). **Na afloop terugzetten naar `{"email":false,"whatsapp":false}`.**
2. **Demo-medewerker aanmaken** via de normale flow: demo-kandidaat → PortalActivateSheet →
   invite (concept door kill-switch) → activatielink uit `portal_invites` halen via SQL →
   activeren.
3. **Doorlopen als medewerker**: dashboard, uren invoeren + indienen, plaatsingen,
   documenten (download), loonstroken/jaaropgaven/urenbrieven, ziekmelden, huisvesting,
   voertuig (schade melden), vacaturemarkt (fase A), loyalty, profiel, notificaties,
   taal-switch (fase B). Console-errors loggen; elke lege lijst waar data hoort = bevinding.
4. **Klantportaal kort meenemen** (`/klantportaal`): login als opdrachtgever-contact, eigen
   plaatsingen zien, uren goedkeuren/afkeuren.
5. Bevindingen fixen vóór fase D; testdata opruimen.

## Fase D — Uitrol (deels klant-actie)

1. **Besluit met Jeroen**: startgroep (alle actieve medewerkers of pilotgroep), taal van het
   uitnodigingsbericht (minimaal NL+EN+PL), en de JobMarket-zichtbaarheidsvraag uit fase A2.
2. **Bulk-invites**: als de startgroep >±20 is, kleine bulk-actie in de Medewerkers-lijst
   (selectie → "Portaal-uitnodiging versturen", hergebruik `send-portal-invite`); anders
   handmatig per medewerker. Kill-switch UIT — dit zijn echte mails.
3. **Meten**: activatiegraad (auth-accounts met rol `medewerker` vs. verstuurde invites) na
   1 en 4 weken; portal-gebruik via Sentry/PostHog als die tegen die tijd aanstaan.

## Sessieprotocol (voor de uitvoerende sessie)

- Branch vanaf `origin/main` in een worktree; nooit doorbouwen op een stale checkout.
- Verificatie vóór PR: `npm run lint` (0 errors; dekt óók `supabase/functions/`),
  `npm run typecheck`, `npm run test`, `npm run build`, en per gewijzigde edge fn
  `deno check supabase/functions/<fn>/index.ts`.
- Edge deploys: per functie `npx supabase functions deploy <fn> --project-ref noaupcteygfvlyymqtew`
  (CLI is buiten de sandbox geauthenticeerd; shell-loops rond deploys worden door de
  permission-classifier geblokkeerd — losse commando's, evt. met `&&` gebundeld).
- Migraties: MCP `apply_migration` → spiegel-bestand met de geregistreerde versie →
  `generate_typescript_types` bij schemawijzigingen → `get_advisors` draaien.
- QA-accounts: `DEMO_ORG_*` (interne admin demo-org) en `QA_SUPERADMIN_*` in `.env.local`
  (nooit waarden printen). Demo-org id begint met `6dedabe4`.
- Merge + deploy is één stap: een edge-wijziging is pas af als de functie ook gedeployd is.

## Volgorde & omvang

| Fase | Omvang | Afhankelijkheid |
|------|--------|-----------------|
| A — JobMarket | klein (1 migratie + evt. 1 UI-regel + QA) | besluit A2 (bedrijfsnaam tonen?) |
| B — i18n + video | middel (edge fn + context + toggle + settings-kaart) | geen |
| C — QA-ronde | middel (agent-gedreven) | A + B gemerged & gedeployd |
| D — Uitrol | klein (evt. bulk-invite UI) + klant-actie | C groen, besluiten Jeroen |

A en B kunnen parallel/na elkaar in één sessie; C en D daarna.
