# AGENTS.md

- See [CLAUDE.md](CLAUDE.md) for canonical codebase guidance: architecture, schema, integrations, commands and conventions. Applies equally to Codex, Claude Code and other repo agents.
- For current in-progress state, read [HANDOVER_SESSION.md](HANDOVER_SESSION.md) first; [HANDOVER.md](HANDOVER.md) is the formal project snapshot.

## Conventions that bite (read before changing things)

- **Werk in een git worktree per sessie**, niet rechtstreeks op `main` (main is eerder gebroken door parallelle sessies). PR's gaan via `gh pr create/merge`.
- **DB & edge functions via Supabase MCP** (project `noaupcteygfvlyymqtew`): `apply_migration`, `deploy_edge_function`, `get_advisors` na DDL. Er is **geen** edge-deploy/migratie-CI — edge functions worden handmatig gedeployed; alleen de frontend gaat automatisch via Vercel bij merge.
- **`src/integrations/supabase/types.ts` is auto-generated en kan stale zijn** — verifieer het live schema (`list_tables`) vóór schema-werk; nooit handmatig editen.
- **Matching is regel-gebaseerd** in `supabase/functions/_shared/matching-core.ts` (gedeeld door `calculate-match`/`rank-candidates`/`rank-vacancies`); pas dáár aan, niet per functie. Unit-tests in `src/test/matching.test.ts`.
- **Uitgaande communicatie heeft een kill-switch** (`_shared/outbound-pause.ts`): nieuwe e-mail-/WhatsApp-sendpaden moeten `isOutboundPaused()` respecteren, anders lekken ze er langs.
- **Encrypted kolommen** (BSN/IBAN/tokens) nooit direct SELECTen — gebruik de decrypt-RPC's. **SECURITY DEFINER write-RPC's** mogen niet `anon`-uitvoerbaar zijn.
- TypeScript-config is bewust relaxed (`noImplicitAny:false`, `strictNullChecks:false`) — niet aanscherpen zonder verzoek.
