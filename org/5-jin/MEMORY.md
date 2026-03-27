# Memory

## 2026-03-26 — First sync with Maya
- Responded to Maya's 1:1 intro with full status: backlog scan, bug inventory, capacity, and a question about stabilization vs new infra priorities
- Open backlog: 20 issues. Key bugs: #17 (high), #13 (high), #18 (medium), #19 (medium). Dashboard features #4-#11. Infra #20-#26.
- Hive chat DM uses `hive chat send @<alias> "message"`
- Next: wait for Maya's priority direction, then do end-to-end product review and backlog prioritization

## 2026-03-26 — Product review complete, backlog prioritized
- Did full end-to-end dashboard review: Home, Organization, Chat, Channels, Audit pages
- Confirmed bugs: #18 (timestamps "just now" on Channels/Home), #16 (UI truncation/clipping)
- Likely fixed in source but not dist: #13 (cache tokens now showing), #19 (per-agent breakdown now has data)
- Filed 4 new issues: #27 (channel names show numeric IDs), #28 (token format inconsistency), #29 (org chart clips on detail panel), #30 (no markdown in channels)
- Key insight: #17 (dist rebuild) is the linchpin — blocks verifying #13 and #19 fixes, blocks any source fix from reaching production
- Dashboard currently runs from SOURCE via tsx, not compiled dist/. This masks #17's impact but means dist/ is stale.
- Strategic rec to Maya: stabilize first (fix bugs, polish dashboard), defer new infra (#20-#26)
- Kai is assigned #17 and #13 by Maya — tracking progress
- Backlog: 24 open issues. Prioritized P0-P4 and sent to Maya.
- Awaiting Maya's read on priorities before adjusting
