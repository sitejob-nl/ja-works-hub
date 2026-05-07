# Session handover — 2026-05-06

Korte hand-off voor de volgende agent (Codex / Claude Code) zodat je direct verder kan zonder de hele sessie opnieuw te lezen. Dit is een **werk-in-uitvoering** doc — niet de formele client-handover (zie [HANDOVER.md](HANDOVER.md) van 2026-04-07).

## Lees eerst

1. **[CLAUDE.md](CLAUDE.md)** — single source of truth voor architectuur, schema, integraties, MCP-workflow. Geldt 1-op-1 voor Codex (zie [AGENTS.md](AGENTS.md), is een 1-regel pointer).
2. **[docs/open-gaps.md](docs/open-gaps.md)** — open client-meeting items + Fase 2 backlog. Recent uit CLAUDE.md gehaald omdat het project-state is, niet codebase-guidance.
3. **Memory:** zie ook `meeting_jeroen_20260429.md` in auto-memory voor de meest recente meeting-besluiten.

## Wat is er deze sessie gebeurd in CLAUDE.md

CLAUDE.md is teruggebracht van ~1240 → 591 regels. **Geen kennis weggegooid**, alleen gestructureerd:

- AGENTS.md → 1-regel pointer naar CLAUDE.md (waren bijna identieke duplicaten, drift-risico).
- README.md → vervangen (was Lovable boilerplate met `REPLACE_WITH_PROJECT_ID`).
- Routes / Database Schema / Enums tables → drastisch ingekort. Patronen blijven, volledige lijsten staan in `src/App.tsx` en `src/integrations/supabase/types.ts`. Non-obvious invarianten (encrypted columns, dropped columns, dynamic-talentpool flags, `properties.name` nullable, `vacancies.urgency` CHECK 1-3, etc.) zijn behouden.
- "Open gaps from client meetings" → verplaatst naar `docs/open-gaps.md`.
- Directory tree → vervangen door notities-only lijst (paden zijn discoverable; alleen *gedrag* dat niet uit een `ls` blijkt staat erin).

## Werk-in-uitvoering (uncommitted in `main`)

### Twee nieuwe migrations (al toegepast op productie via Supabase MCP, lokaal nog niet gecommit):

1. **`supabase/migrations/20260429190000_company_functions_salary_skills.sql`**
   - `company_functions` krijgt `salary_min numeric(10,2)`, `salary_max numeric(10,2)`, `required_skills text[]`.
   - Bedoeling (meeting Jeroen 29-04): salaris-**range** op functie-niveau (geen vast uurtarief) + standaard-skills. Vacature erft beide als defaults bij aanmaken; user kan overschrijven. Skills voeden talentpool "Genereer uit functie".

2. **`supabase/migrations/20260430160000_vehicles_first_registration_nl.sql`**
   - `vehicles.first_registration_nl text` — RDW-veld `datum_eerste_tenaamstelling_in_nederland`. Functioneel ~ aankoopdatum eerste NL-eigenaar.

### UI/edge-function wijzigingen die hierbij horen:

- `src/components/companies/tabs/CompanyFunctionsTab.tsx` — formulier uitgebreid met `salary_min`/`salary_max` (range) + `required_skills` via `TagInput`. `formatSalaryRange()` helper toegevoegd voor weergave.
- `src/pages/VacancyNew.tsx` — neemt nu defaults over uit de gekoppelde `company_function` (28 regels diff).
- `src/pages/Vacancies.tsx` — kleine UI-aanpassing voor de nieuwe range-weergave.
- `src/pages/Talentpools.tsx` — "Genereer uit functie" flow gebruikt `required_skills` om `filter_criteria` te seeden (138 regels diff — dit is de grootste).
- `src/pages/VehicleNew.tsx` + `VehicleEdit.tsx` — `first_registration_nl` veld toegevoegd, gevoed door RDW-lookup.
- `supabase/functions/analyze-cv/index.ts` + `_shared/anthropic-cv.ts` + `_shared/cv-prompt.ts` — kleine tweaks aan de CV-pipeline (14/3/5 regels). Niet gerelateerd aan bovenstaande migrations.
- `src/components/candidates/tabs/CandidateAiTab.tsx` — 11 regels diff, hoort bij CV-pipeline-tweaks.

### Niet gerelateerd, ook uncommitted:

- `eslint.config.js` (1 regel)
- `.claude/settings.local.json`
- `Panden/` (untracked dir — onduidelijk waarom dit hier staat, even checken voor je commit; kan een per-ongeluk gedropte map zijn)

## Voorgestelde volgende stappen

1. **Doorlopen wat in-progress is** in `CompanyFunctionsTab.tsx` + `VacancyNew.tsx` + `Talentpools.tsx` — controleer of de salary-range UX klopt en of de skills-overerving uit `company_functions` → `vacancies` werkt zonder dubbele invoer.
2. **Test de talentpool "Genereer uit functie"** end-to-end: functie met skills → maak pool → controleer of `filter_criteria` gevuld wordt en `refresh-talentpool-members` edge function de juiste matches oplevert.
3. **Controleer `Panden/` directory** voor je iets commit — waarschijnlijk niet de bedoeling dat die in repo terechtkomt.
4. **Commit-strategie:** drie aparte commits voorstel:
   - `feat(functions): salaris-range + skills op company_functions, vacatures erven defaults` (migration + CompanyFunctionsTab + VacancyNew + Vacancies + Talentpools)
   - `feat(transport): RDW datum-eerste-tenaamstelling op voertuigen` (migration + VehicleNew + VehicleEdit)
   - `chore(cv): kleine tweaks aan analyze-cv pipeline` (de _shared + analyze-cv + CandidateAiTab files)

## Belangrijk om te weten voor de volgende agent

- **Schema-wijzigingen via Supabase MCP** zijn al **live op productie** (project `noaupcteygfvlyymqtew`). De `.sql` files in `supabase/migrations/` zijn spiegel-files voor lokale dev/CI consistency — niet om opnieuw uit te voeren.
- **Edge-function deploys**: gebruik `mcp__claude_ai_Supabase__deploy_edge_function`. Alle protected edge functions hebben `verify_jwt = false` met self-auth in body — dat is bewust (Supabase Edge Runtime kan ES256 niet valideren).
- **Types regenereren** na schema-wijziging: `mcp__claude_ai_Supabase__generate_typescript_types` → schrijf naar `src/integrations/supabase/types.ts`. Hand-edit nooit.
- **Encrypted velden**: lees nooit direct (`candidates.bsn`/`iban`, tokens in `whatsapp_config`/`exact_config`). Gebruik altijd de RPC-functies — zie CLAUDE.md sectie "Encrypted columns".
- **Multi-tenant**: alle queries scoped op `organization_id` via `useOrganizationId()`. Hook **throwt** buiten AuthProvider — niet aanroepen in portal/superadmin/public routes.
