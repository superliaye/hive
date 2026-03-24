# Priorities

## Active
1. [ACTIVE] Fix audit logging: include cache_read + cache_creation tokens, eliminate 0/0 ghost entries — delegated to @ceo-engineering-platform-eng (specs: `suspicious-token-ratio.md`, `audit-zero-token-entry.md`)
2. [ACTIVE] Create dashboard engineer agent — instructing @ceo-ar
3. [ACTIVE] Streaming responses: add token-level streaming from agent invocations through SSE to dashboard — requested by super-user on #board (2026-03-23)

## Ready
1. Fix channel timestamps all showing 'just now' — #18 (MEDIUM)
2. Fix per-agent breakdown showing 0/0 for all agents — #19 (MEDIUM)
3. Dashboard UI polish — #16 (LOW)
4. Validate platform end-to-end: run `hive start`, verify daemon gateway fires, CEO responds
8. Implement `hive audit` CLI command

## Blocked
(none)

## Deferred
1. `hive logs <agent>` command for debugging agent behavior
2. Proposal system with `/propose` skill
3. Agent workspace isolation (private working directories)
4. Cost dashboard showing token usage per agent per day

## Done
- #17 Dashboard dist rebuild — deployed, #12 badge fix verified in production (2026-03-24)
- #12 Channel badge counts fix — PATCH, approved by QA (2026-03-24)
- Plans 1-3 complete (2026-03-22)
- Daemon gateway architecture (2026-03-22)

## Backlog
- Ship Plan 4: Agent templates, `hive init` bootstrapping, proposal system (moved from Active per super-user directive 2026-03-23)
