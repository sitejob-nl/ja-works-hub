# Session handover — 2026-06-05 (voor Codex)

Hand-off zodat je direct verder kan. Dit is de actuele werk-snapshot; zie [CLAUDE.md](CLAUDE.md) voor stabiele codebase-guidance, [AGENTS.md](AGENTS.md) voor "conventions that bite", en [HANDOVER.md](HANDOVER.md) voor de formele projectsamenvatting.

## Lees eerst

1. [CLAUDE.md](CLAUDE.md) — single source of truth (architectuur, schema, integraties, commands, conventies). **Net bijgewerkt** met de matching-engine, kill-switch, dedup en vacature-skillverrijking.
2. [AGENTS.md](AGENTS.md) — korte lijst conventies die je anders raken (worktree-per-sessie, Supabase MCP, geen edge-CI, stale types.ts, gedeelde matching-core, kill-switch-plicht).
3. `~/.claude/plans/analyseer-de-meetings-bestanden-zany-fog.md` (op Kas' machine) — de 8-fase roadmap uit de 06-03 werksessie. Fase 0/1/1.5b/2 zijn af; Fase 3–7 staan open.
4. [docs/open-gaps.md](docs/open-gaps.md) — open meetingpunten (decays snel).
5. `Meetings/carerrix meeting/` — Carerix-demo (Assisted Matching / JobDigger) als benchmark voor onze matching.

## Branch & repo-status

- **`main` is de actuele, schone staat** — alles van deze sessie is gemerged én gedeployed. Begin een nieuwe taak in een **git worktree off `main`** (niet rechtstreeks op main werken).
- Laatste merges: PR **#28** (docs) ← #27 (Fase 1.6 matching-lijst) ← #26 (kill-switch/security) ← #25 (enrich-vacancies) ← #24 (functie-groep-guard) ← #23/#22/#21/#20/#17/#16.
- Geen openstaande PR's of dirty work in flight.
- **`src/integrations/supabase/types.ts` is stale** (mist o.a. screening-kolommen migratie `20260402120000` + EU/NL-telefoon/ICE). Verifieer het live schema via Supabase MCP `list_tables` vóór schema-werk; regenereer types ná elke DDL.

## Wat deze sessie is opgeleverd (allemaal live op prod)

**Matching (Fase 1 + 1.5b + 1.6 + 2)** — kern in `supabase/functions/_shared/matching-core.ts`, gedeeld door `calculate-match` / `rank-candidates` / `rank-vacancies`:
- **Functie-groep-guard**: een `specialist` (`candidates.ai_classification`) zonder skill- én functie-titel-match wordt gecapt ≤40 (Alam-klacht: specialist niet hoog op productie). Unit-tests in `src/test/matching.test.ts` (18/18 groen).
- **Reverse matching**: `rank-vacancies` + tab "Vacatures" (`CandidateVacancyMatchesTab.tsx`).
- **`enrich-vacancies`** (Gemini): vult `required_skills` uit de volledige vacaturetekst, uitsluitend uit de actieve org-skillcatalogus. Auto bij `VacancyNew` (lege skills) + knop "AI-skills" op `VacancyDetail`.
- **`VacancyMatchesTab.tsx`**: match-pipeline is nu een **lijst** (statusfilter-chips, geen drag-kanban); klik "Waarom?" → volledige `match_breakdown`; bulk-select → **Status wijzigen** + **Interesse-bericht (ja/nee)** (WhatsApp-knoppen, reply-id `match_ja:<id>`); `whatsapp-webhook → handleMatchInterest()` schuift de match automatisch (ja→`in_gesprek`, nee→`afgewezen`).

**Kill-switch (Fase 0)** — `_shared/outbound-pause.ts`: globale org-pauze e-mail+WhatsApp via `organizations.settings.outbound_paused`, geblokkeerd → concept in `communications`. Guards in: `outlook-send.ts`, `outlook-send-mail`, `whatsapp-send`, `bulk-campaign-processor`, `automated-messages`, `check-document-expiry`, `send-placement-confirmation`. Toggle in Instellingen → Algemeen.

**Dedup (Fase 0)** — `/kandidaten/duplicaten` + RPC's `find_duplicate_candidates` (read-only) en `merge_candidate_records` (merge); **beide anon-revoked** (migratie `20260604130000`).

**Overig Fase 0** — CV-prompt (taal niet uit schrijfstijl, CEFR, feit/aanname, rijbewijs "onbekend") in `_shared/cv-prompt.ts`; rijbewijs-tri-state UI; werkhistorie-tijdlijn cap op huidig jaar; laadstates (skeletons + keepPreviousData). + de huisvesting-bug (Pand/bewonersnaam zichtbaar, #16).

## Bekende beperkingen / let op

- **WhatsApp is nooit live getest met echte Meta-credentials** (staat zo in CLAUDE.md). De ja/nee-interesse-loop (`whatsapp-send` interactive → webhook `handleMatchInterest`) is code-compleet en geverifieerd op deployed source, maar **end-to-end pas testbaar met gekoppelde Meta-creds**.
- **VPS-worker `system_prompt`**: bevestig bij de eerste live CV-run dat `worker.py` (Hetzner, off-repo, SSH `root@204.168.221.107`) het meegestuurde `system_prompt`/schema honoreert (anders divergeren VPS en Cloud).
- Bulk-status/bulk-propose lopen sequentieel zonder transactie (acceptabel; geen rollback bij mid-batch fout).
- `enrich-vacancies` kiest alleen uit **actieve** catalogus-skills — voor scherpe extractie moet de org-catalogus gecureerd zijn (`SkillCatalogSettings.tsx`).

## Open werk (volgende stappen)

1. **Fase 3 — screening & "Bellen"-interface**: `CandidateScreeningTab.tsx` bestaat al (met `buildCallQuestions()`); bouw de bel-popup (vragen 1-voor-1 + antwoordvelden, later Voys), breid screening-velden uit (matchbaar → typed kolom, rest → `screening_data` jsonb), auto-save, CEFR-afstemming met `speaksDutch` in matching. **Eerst** het live schema verifiëren (screening-kolommen staan niet in types.ts).
2. **Matching-takeaways uit de Carerix-benchmark** (zie `Meetings/carerrix meeting/`): (a) semantische/LLM-rerank op de volledige vacaturetekst bovenop de skill-extractie; (b) JobDigger-equivalent: per kandidaat externe webvacatures + 1-klik import (import-infra bestaat: `apify-job-import`/`linkedin-job-search`/`job-feed-runner`); (c) 1–10 kandidaat-preselect-score bij screening.
3. **Fase 4–7**: kandidaatprofiel inline-editing + unsaved-warning + 2 adressen/ICE; BSN/nationaliteit backfill; campagne vanuit kandidaten-selectie; tankregistratie/website-funnels.

## Conventies (kort — zie AGENTS.md)

- **Worktree per sessie**, PR's via `gh`. Edge functions deploy je **handmatig** via Supabase CLI/MCP (`--project-ref noaupcteygfvlyymqtew`); er is géén edge-deploy/migratie-CI. Alleen de frontend gaat automatisch via Vercel bij merge.
- Na DDL: `apply_migration` → `generate_typescript_types` → spiegel-migration in `supabase/migrations/` → `get_advisors`.
- Demo-org test-login: `fase1-demo-vast@ja-werkt.local` (wachtwoord in `.env.local`). QA-superadmin: `claude-qa@ja-werkt.local`.
- Visueel testen op `localhost:8090` (raakt prod-DB + deployed edge functions).

## Verificatie deze sessie

- `npm test` — 64/64 groen (incl. de matching-guard-tests). `npm run build` — groen. `npm run typecheck` + `eslint` — groen op alle gewijzigde files. `deno check` — groen op alle gewijzigde edge functions.
- QA-ronde (4 parallelle audit-agents) tegen de 06-03 verbeterpunten: CV-prompt + matching ✅; vond 3 kill-switch-lekken + 1 anon-security-gap → gefixt in #26.
- Post-deploy: security-advisor 0 ERROR; verificatie-workflow bevestigde dat alle 6 gedeployede edge functions de fixes dragen; `merge_candidate_records` niet meer anon-uitvoerbaar.
