# Memory

## 2026-03-26 — Onboarding & Priority Shift

- **Team mission**: Dashboard maintenance team. Sam (manager), Jules (product review), me (engineering).
- **Priority shift from Sam**: Focus on `packages/dashboard/` — our team is now the dedicated dashboard maintenance team. Jules is doing a product review and will produce a prioritized improvement list. I'll build from that list.
- **Dashboard architecture understood**:
  - Express backend on port 3001 — routes in `src/server/routes/` (org, chat, channels, audit, system)
  - React 19 + React Router 7 frontend — pages: Home, Org, Chat, Channels, Audit
  - Vite 6 + Tailwind CSS 4 for build
  - Real-time updates via SSE (HiveEventBus → SSE manager → EventSource on client)
  - Core engine integration via HiveContext wrapping (comms, state, audit) with event bus emission
  - Key hooks: useApi (REST polling), useSSE (real-time events)
  - Tests in `src/server/__tests__/routes.test.ts` using vitest + Express test server

## 2026-03-26 — Bug Fix Sprint

- **#31/#32 (org tree)**: PR #42 open. Mobile: vertical indented list layout. Desktop: `w-fit` prevents node compression, horizontal scroll with visible scrollbar. Review requested from @tess.
- **Pre-existing test failure**: `spawner.test.ts` "uses haiku model for triage" — appears to be fixed now (432/432 pass).
- **#37/#35**: PR #44 open. #37: Replaced hooks-in-loop with batch `/api/audit/agent-totals` endpoint. #35: Added `formatChannelName()` utility. Review requested from @tess.
- **Process note**: Multiple dashboard processes accumulate — always `kill -9` ALL node/tsx processes before restart. Stale processes on port 3001 serve old code.
- **Route note**: Express nested paths under `router.use()` mount work fine for flat routes (`/agent-totals`) but had issues with sub-paths (`/totals/by-agent`) — stick to flat route names.
- **Branch hygiene**: Always verify `git branch --show-current` before committing. Process kills can cause unexpected branch switches.
