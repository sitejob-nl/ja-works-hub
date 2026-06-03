# Session handover — 2026-06-01

Korte hand-off voor Claude Code / Codex zodat je direct verder kan. Dit is de actuele werk-in-uitvoering snapshot; zie [HANDOVER.md](HANDOVER.md) voor de formele projectsamenvatting en [CLAUDE.md](CLAUDE.md) voor stabiele codebase-guidance.

## Lees eerst

1. [CLAUDE.md](CLAUDE.md) — single source of truth voor architectuur, schema, integraties, commands en conventies.
2. [docs/open-gaps.md](docs/open-gaps.md) — open meetingpunten t/m 2026-05-27.
3. [docs/meeting-open-points-2026-05-27.md](docs/meeting-open-points-2026-05-27.md) — meest recente productrichting: leadfunnel, kandidaatprofiel als werkplek, AI-verrijking met notities.
4. [docs/carerix-integratie-audit.md](docs/carerix-integratie-audit.md) — status en risico's van Carerix-productieimport.

## Branch en repo-status

- Huidige branch: `codex/portal-i18n`.
- Laatste commits: `5559b1f fix: complete portal translation coverage`, `4b7097b feat: add portal i18n toggle`, `ee61023 Merge pull request #1 from sitejob-nl/codex/instroom-fast-path`, `a0997a5 feat: add candidate intake funnel`.
- Dirty worktree is verwacht; niets terugdraaien zonder expliciete opdracht.
- Er zijn geen schema-migrations in de huidige dirty set; `src/integrations/supabase/types.ts` is niet aangepast.

## Docs deze beurt

- `AGENTS.md` is bijgewerkt als compacte pointer naar `CLAUDE.md` plus actuele handover.
- `CLAUDE.md` is bijgewerkt voor kandidaatdossier-AI, Carerix-enrichment en huidige commands.
- `HANDOVER.md` en dit bestand zijn naar 2026-06-01 getrokken.

## Huidige uncommitted codewijzigingen

### AI kandidaatdossier-analyse v2

Bestanden:
- `supabase/functions/_shared/candidate-dossier.ts` (nieuw)
- `supabase/functions/analyze-cv/index.ts`
- `supabase/functions/analyze-cv-batch/index.ts`
- `supabase/functions/analyze-cv-callback/index.ts`
- `supabase/functions/_shared/anthropic-cv.ts`
- `supabase/functions/_shared/cv-prompt.ts`
- `supabase/functions/_shared/cv-write.ts`
- `src/components/AiAnalysisCard.tsx`
- `src/components/candidates/tabs/CandidateAiTab.tsx`
- `src/components/settings/AiCvProviderSettings.tsx`
- `src/pages/superadmin/SuperAdminCvBackfill.tsx`
- `deno.lock`

Wat het doet:
- Analyse heet functioneel nog `analyze-cv`, maar de input is nu een kandidaatdossier: CV/documenttekst, profielvelden, interne notities, communicatie, plaatsingen en arbeidsrelaties.
- `_shared/candidate-dossier.ts` kiest het beste CV-/tekstdocument (`candidate.cv_file_url` of `documents`), extraheert PDF/DOCX/ODT/RTF/TXT/legacy DOC server-side en voegt interne context toe.
- UI-upload in `CandidateAiTab` ondersteunt PDF, DOC/DOCX, ODT, TXT, RTF en afbeeldingen; PDF/image OCR gebeurt client-side met pdfjs-dist/Tesseract.js.
- Dossier wordt server-side gesanitized, gepseudonimiseerd en naar VPS of Cloud gestuurd. VPS-request blijft backwards compatible via `cv_text`, maar stuurt nu ook `dossier_text`, `system_prompt`, `prompt_version`, tool/schema en input metadata mee.
- Cloud-pad gebruikt dezelfde promptbasis en `organizations.settings.candidate_analysis_prompt`; legacy `cv_prompt_addendum` blijft compatibel.
- Outputschema heeft nu `dossier`, `manual_review_required`, `contra_indicaties` en `bronverwijzingen`; `AiAnalysisCard` toont die.
- Batchbackfill selecteert kandidaten zonder completed analyse, niet alleen kandidaten met `cv_file_url`, en toont document/context-statistieken.

Let op:
- Server-side batch OCR't image-only documenten niet; image OCR bestaat alleen in de UI-upload.
- Controleer of de VPS-worker `system_prompt`/schema gebruikt of in elk geval geldig JSON blijft teruggeven. Callback kan stringified JSON parsen, maar slechte JSON zet de kandidaat op `failed`.

### Carerix enrichment

Bestanden:
- `supabase/functions/_shared/carerix/mappers.ts`
- `supabase/functions/_shared/carerix/queries.ts`
- `supabase/functions/_shared/carerix/runner.ts`
- `supabase/functions/_shared/carerix/types.ts`
- `src/test/carerix-mappers.test.ts` (nieuw)

Wat het doet:
- `CREmployee` query haalt extra velden op: `employeeID`, BSN/SOFI-velden, `additionalInfo`, taalnode, identificatieland.
- Mapper vult `employee_number`, `bsn`, `nationality` en genormaliseerde `languages` uit CR-velden en tenant-specifieke `additionalInfo`.
- Runner bulk-enrichment vult ook arrays en stuurt BSN via een aparte update zodat DB-encryptietriggers blijven werken.
- Nieuwe Vitest-test dekt identity/nationality/language mapping.

## Open productcontext

- 2026-05-27 vraagt: instroom-/leadfunnel, kandidaatprofiel als centrale werkplek, AI-verrijking van ~1.900 kandidaten met CV én interne notities, en duidelijk onderscheid tussen algemene plaatsbaarheid en vacature-matchscore.
- `docs/open-meeting-task-registry.md` markeert `0527-AI-BACKFILL`, `0527-PROFILE-WORKSPACE`, `0527-TASK-DELEGATION`, `0527-DOC-FORMATS` en `0527-DATA-COMPLIANCE` als nog open/in progress.
- Carerix productie-import is ver gekomen, maar `crCompanyPage`/`crContactPage`, REST attachment fallback, 27 parentloze `CRNote` records en businessvalidatie van `CRMatch`/`CRWorkHistory` blijven aandachtspunten.

## Verificatie deze beurt

- `git diff --check` — groen.
- `npx vitest run src/test/carerix-mappers.test.ts` — groen, 2 tests.
- `npm run typecheck` — groen.
- Deno checks en functionele Supabase/VPS-runs zijn nog niet gedaan.

## Aanbevolen volgende stappen

1. Resterende edge-function checks draaien:
   - `deno check supabase/functions/analyze-cv/index.ts`
   - `deno check supabase/functions/analyze-cv-batch/index.ts`
   - `deno check supabase/functions/analyze-cv-callback/index.ts`
2. AI-flow testen met één kandidaat via Cloud en één via VPS: controleer `dossier_meta`, `ai_analysis.dossier`, red flags en realtime status.
3. Superadmin backfill testen met kleine batch (`batch_size=1`) en `include_failed=false`; let op kandidaten zonder CV maar met notitiecontext.
4. Beslissen of image-only server-side backfill OCR nodig is voor 05-27 `DOC-FORMATS`; anders expliciet als beperking laten staan.
5. Deploy pas na checks via Supabase MCP: `analyze-cv`, `analyze-cv-batch`, `analyze-cv-callback` plus shared dependencies.

## Commitstrategie

- `docs: update claude and handover for june continuation`
- `feat(ai): analyze candidate dossiers with internal context`
- `feat(carerix): enrich candidate identity fields`
