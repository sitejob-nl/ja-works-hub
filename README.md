# JA Werkt

Multi-tenant staffing-agency SaaS for JA Werkt (uitzendbureau in Brabant/Limburg, NL — labor migrants). Consolidates Carerix, Joboti, Umanga, OnTrack, Q8 and Buddy into one platform; Flexpedia stays as external loonmotor.

**Stack:** React 18 + TypeScript + Vite, Supabase (Postgres + Auth + Edge Functions + Realtime + Storage), shadcn/ui + Tailwind, TanStack Query, vite-plugin-pwa.

## Develop

```bash
npm i
npm run dev          # http://localhost:8080
npm run lint
npm run test         # vitest unit
npm run test:e2e     # playwright
```

## Architecture, schema, integrations, conventions

See [CLAUDE.md](CLAUDE.md) — full codebase guidance, also used by AI agents (Claude Code, Codex).

## Contact

- **Developer:** Kas — kas@sitejob.nl
- **Client:** JA Werkt, Jeroen Adriaans (Mierlo)
- **Repo:** sitejob-nl/ja-works-hub
- **Supabase project:** `noaupcteygfvlyymqtew`
