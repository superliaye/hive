# Memory

## 2026-03-26 — Dashboard Test Coverage Audit

### Priority shift
Sam directed team to become dedicated dashboard maintenance team. My role: audit test coverage in `packages/dashboard/`, prepare verification workflows for improvements Jules will identify.

### Dashboard test coverage findings
- **1 test file exists**: `packages/dashboard/src/server/__tests__/routes.test.ts`
- **Server coverage**: Partial — 9 GET endpoints tested (happy path only). Missing: POST /api/chat success, POST /api/chat/post, SSE, query param filtering, error handling beyond 400/404.
- **Client coverage**: Zero. 33 React files (25 components, 5 pages, 3 hooks) — all untested.
- **Test infra**: vitest, express HTTP testing with fetch, HiveContext integration with temp SQLite, fixture org at `tests/fixtures/sample-org/`.
- **Risk assessment**: Server routes have basic smoke tests but no edge case or error path coverage. Client has no testing whatsoever — any refactor or feature change ships blind.

### Key files
- Server routes: `src/server/routes/{org,audit,channels,chat,system}.ts`
- SSE: `src/server/sse.ts`
- Client entry: `src/client/App.tsx`, `src/client/main.tsx`
- Hooks: `src/client/hooks/{useApi,useSSE,useAgentMap}.ts`

## 2026-03-27 — Bug Verification Workflow Active

### Mission update
Sam assigned verification workflow for 11 bugs (#31-#41) from Jules's product review. Rio and Noor implementing fixes. My job: verify each fix, write regression tests for critical/major, ensure mobile viewport coverage.

### Bug tracking
- **#32 (P0 Critical)**: Org tree mobile — VERIFIED & MERGED (PR #42)
- **#31 (P1 Major)**: Org tree desktop overflow — VERIFIED & MERGED (PR #42)
- **#37**: Per-agent breakdown race condition — awaiting Rio's fix
- **#35**: Channel names — awaiting Rio's fix
- **#33**: Timestamps — awaiting Noor's fix
- **#36**: Noor's fix pending
- **#34**: Noor's fix pending
- **#39**: Noor's fix pending
- **#38**: Noor's fix pending
- **#40**: Noor's fix pending
- **#41**: Noor's fix pending

### Review workflow
- Visual verification with Playwright at 375px, 1280px, 1920px viewports
- Run full test suite before approving
- Post comment-based reviews (shared GH account — can't use review API)
- Reviewer merges (not author) per protocol

### Observation
- PR #42 at 1920px: rightmost node clips slightly. Non-blocking but tree is wider than expected with 12 agents + sidebar.
