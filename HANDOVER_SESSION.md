# Session handover — 2026-06-07

Korte overdracht voor Codex / Claude Code. Zie [CLAUDE.md](CLAUDE.md) voor stabiele codebase-guidance, [AGENTS.md](AGENTS.md) voor harde repo-conventies en [HANDOVER.md](HANDOVER.md) voor de formele projectsamenvatting.

## Productiestatus

- Frontend productie: `https://ja-works-hub.vercel.app`.
- Laatste bevestigde HTTP-check: 2026-06-07, HTTP 200.
- Supabase project: `noaupcteygfvlyymqtew`.
- Edge functions worden handmatig gedeployed; er is geen edge-function deploy-CI.

## Release 2026-06-07

Deze release administreert de juni-meeting follow-up bovenop `origin/main`.

Inhoud:
- AI-screening output scherper: feiten/aannames/onbekend, taalbewijs, rijbewijsstatus onbekend, bronverwijzing en dossierbetrouwbaarheid.
- AI-dossier/backfill-documentatie: gecontroleerde dry-run aanpak voor bestaande kandidaten.
- Bulk match-notificatie: nieuwe edge function `match-bulk-notify`.
- Leadfunnel-promotie/rejectie: bestaande kandidaat bijwerken, taken/notificaties afronden, geen duplicaat-kandidaat maken.
- Geocode backfill: `geocode-backfill` voor NL-adrescoördinaten via PDOK.
- UX-roadmap/spec voor ontbrekende logische acties.

## Belangrijke merge-keuze

`origin/main` bevat al de huidige kill-switch via `organizations.settings.outbound_paused` en `_shared/outbound-pause.ts`. Gebruik die als enige bron. De oudere lokale `communication_pause`-variant hoort niet terug te komen in nieuwe code.

Nieuwe of aangepaste uitgaande communicatiepaden moeten dus:

```ts
import { isOutboundPaused } from "../_shared/outbound-pause.ts";
```

of het gedeelde Outlook-chokepoint `sendViaOutlookAccount()` gebruiken.

## Repo-status aandachtspunt

- Werk niet rechtstreeks op `main`; gebruik een worktree/branch.
- `test vacatures/*.docx` blijft bewust ongetrackt tenzij Kas expliciet zegt dat ze in git moeten.
- `src/integrations/supabase/types.ts` kan stale zijn; check live schema vóór DDL.

## Verificatie voor releasecommit

Gedraaid vóór de rebase:

```bash
git diff --check
npm run typecheck
deno check supabase/functions/analyze-cv/index.ts supabase/functions/analyze-cv-batch/index.ts supabase/functions/analyze-cv-callback/index.ts supabase/functions/match-bulk-notify/index.ts supabase/functions/outlook-send-mail/index.ts supabase/functions/email-campaign-processor/index.ts supabase/functions/bulk-campaign-processor/index.ts supabase/functions/send-match-proposal/index.ts supabase/functions/send-placement-confirmation/index.ts supabase/functions/send-portal-invite/index.ts supabase/functions/send-timesheet-approval/index.ts supabase/functions/whatsapp-send/index.ts supabase/functions/automated-messages/index.ts supabase/functions/check-document-expiry/index.ts supabase/functions/birthday-loyalty-cron/index.ts supabase/functions/send-damage-report/index.ts supabase/functions/send-ai-analysis/index.ts supabase/functions/process-sick-report/index.ts supabase/functions/geocode-backfill/index.ts
npm run test
npm run build
```

Na conflictresolutie opnieuw draaien voordat je pusht/deployt.

## Open vervolg

1. Rebase afronden bovenop `origin/main`.
2. Opnieuw typecheck/test/build/Deno-check draaien.
3. Production opnieuw deployen als de gerebasede code afwijkt van de eerder live gezette commit.
4. Commit/tag/push pas doen nadat de checks groen zijn.
