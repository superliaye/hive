# Memory

## 2026-03-26 — Dashboard Product Review (Cycle 1)

### Context
- Board directive: Sam's team (Jules/Rio/Noor/Tess) is now the dedicated dashboard maintenance team
- My role: PM — own the product backlog, spec work, verify fixes
- Dashboard: Express + React + Vite, runs via `npx tsx src/cli.ts dashboard` on port 3001
- Dashboard code lives in `packages/dashboard/`

### Issues Filed (#31–#41)
- **P0 (fix now):** #33 (timestamps all "just now"), #37 (per-agent breakdown zeros)
- **P1 (fix soon):** #35 (raw channel IDs), #31 (org tree overflow), #39 (sender name inconsistency)
- **P2 (next sprint):** #32 (mobile org tree), #36 (mobile audit table), #34 (raw markdown), #38 (token format)
- **P3 (polish):** #40 (mobile channel card), #41 (flat org list)

### Key Learnings
- CLAUDE.md warns about UTC timestamps without `Z` — #33 is likely related to `parseUtcDatetime()` usage
- The Per-Agent Breakdown (#37) shows correct data on initial load but zeros on subsequent navigations — race condition in data fetch
- Mobile experience is the weakest area — org tree and audit table are effectively broken
- SSE real-time updates work well — a strong foundation to build on
- Sender labels use aliases in some places and role names in others — needs a single display-name resolution layer

### Team
- @sam — my manager, briefed on findings
- @rio — engineer, assigned: #32 (mobile org tree), #31 (org tree desktop), #37 (per-agent breakdown), #35 (channel names)
- @noor — engineer, assigned: #33 (timestamps), #36 (audit responsive), #40 (channel mobile), #34 (markdown), #39 (sender labels), #38 (token format)
- @tess — QA, verification + regression tests for all fixes

## 2026-03-26 — Fix Verification Phase (Cycle 2)

### Role
- I am the **product quality gate** — UX verification of every fix before it's considered done
- Tess handles technical verification (tests pass, no regressions); I handle user-experience verification
- Must re-review each fix in-product: does the user see the right thing?

### Duplicate Issue Mapping (close older once fixed)
| New (better repro) | Old (close as dupe) |
|---|---|
| #35 | #27 |
| #33 | #18 |
| #37 | #19 |
| #38 | #28 |
| #31 | #29 |

### Backlogged
- #41 (cosmetic, org list hierarchy) — not assigned this cycle

### Process
1. Monitor for merged PRs / fix notifications from Rio, Noor, Tess
2. For each fix: launch dashboard, test the specific scenario from the original issue
3. Check happy path + edge cases documented in the issue
4. If fix meets the bar → close issue + close older duplicate
5. If fix doesn't meet bar → comment with what's still wrong, reopen if needed
