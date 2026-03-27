## Priorities

### ACTIVE
- **Bug verification workflow** — 11 bugs from Jules's product review (#31-#41). Verify each fix, write regression tests, ensure mobile coverage.
  - ✅ #32 (P0 Critical) — org tree mobile: VERIFIED & MERGED (PR #42)
  - ✅ #31 (P1 Major) — org tree desktop overflow: VERIFIED & MERGED (PR #42)
  - ⏳ #37 — per-agent breakdown race condition: awaiting Rio's fix (PRIORITY)
  - ⏳ #35 — channel names: awaiting Rio's fix (PRIORITY)
  - ⏳ #33, #34, #36, #38, #39, #40, #41 — awaiting Noor's fixes

### READY
- Write regression tests for merged fixes (#31, #32) — viewport-based Playwright tests
- Write missing dashboard server tests (POST /api/chat, SSE, query params, error handling)
- Design client-side test strategy (33 React components, 5 pages, 3 hooks — all untested)

### BLOCKED
- Nothing currently blocked

### STANDING
- Every review includes: run tests, read the diff in context, check edge cases, verify error handling
- Verdicts include evidence: test output, reproduction steps, or specific code references
- Visual verification at 375px, 1280px, 1920px for any UI changes
- When you find a pattern of issues (recurring bug class, missing error handling), raise it as a systemic concern
- Raise quality risks early: if a deadline is pushing code out before it's ready, say so with specifics
