# Memory

## 2026-03-26 — First cycle, team onboarding

- **Team:** Jules (PM), Rio (Eng), Noor (Eng), Tess (QA) — all in onboarding phase
- Sent 1:1s to all four reports with initial assignments
- **Strategy: stabilize-first** — bugs before features, matching Maya's team approach
- **Assignment split:**
  - Rio: High-sev bugs #17 (dist rebuild) and #13 (token counts) — pending confirmation Kai (Maya's team) isn't already on these
  - Noor: Medium-sev bugs #18 (timestamps), #27 (channel names), #19 (per-agent breakdown)
  - Jules: Product review, spec writing for #18/#27/#19, backlog validation against Jin's work
  - Tess: Test suite audit (27 failing tests from provision.ts alias bug), coverage mapping, review workflow setup
- **Policy: No merges while test suite is red**
- **Cross-team dependency:** Maya's team (Kai on #17/#13, Ava on test fix, Jin on product review) — need to coordinate with Maya to avoid overlap
- Sent status update to Hiro via dm:ceo
- **Next:** Coordinate with Maya on backlog split, await report responses, track throughput

## 2026-03-27 — Board directive: Dashboard ownership

- **Priority shift:** Board directive via Hiro — our team is now the dedicated dashboard maintenance team
- Previous stabilize-first bug work deprioritized unless dashboard-related
- **New assignments:**
  - Jules: Product review of dashboard (UX issues, bugs, missing features, polish gaps) → prioritized improvement list. Timeline: this cycle.
  - Rio: Orient on `packages/dashboard/` architecture, await Jules's list for build assignments
  - Noor: Same as Rio — shifted from bugs #18/#27/#19 to dashboard focus
  - Tess: Dashboard test coverage audit, verification workflow setup
- **Status:** All four reports briefed. Hiro acknowledged. Awaiting Jules's assessment.
- **Next:** Receive Jules's product review → brief Hiro → plan execution across Rio/Noor/Tess

## 2026-03-27 — Bug triage: Jules's product review

- **Jules filed 11 bugs** (#31-#41) from dashboard product review
- Triaged by severity: 1 critical, 5 major, 4 minor, 1 cosmetic
- 5 are duplicates of pre-existing bugs: #35≈#27, #33≈#18, #37≈#19, #38≈#28, #31≈#29
- **Assignments:**
  - Rio (4 bugs): #32 (critical, org tree mobile), #31 (org tree desktop), #37 (per-agent breakdown), #35 (channel names)
  - Noor (6 bugs): #33 (timestamps), #36 (audit responsive), #40 (channel activity mobile), #34 (markdown), #39 (sender labels), #38 (token format)
  - Tess: Verification + regression tests for all fixes
  - Jules: Product-side UX re-verification as fixes land
  - #41 (cosmetic): Backlogged
- **Timeline:** Critical/major by end of today, minors by tomorrow
- **Reported to Hiro** with full severity breakdown, assignments, and timeline
- **Next:** Monitor Rio/Noor progress, unblock as needed, verify fixes with Tess/Jules
