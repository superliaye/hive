# Hive — Claude Code Instructions

## Required Reading

Before any architecture or design work, read `ARCHITECTURE.md` in the repo root.
It contains the system overview, module map, data flow, channel topology, and key invariants.

## Project Structure

- `src/` — Core engine (TypeScript)
- `packages/dashboard/` — Web dashboard (Express + React + Vite)
- `org/` — Live org structure (agent config files)
- `data/` — Runtime SQLite databases (gitignored)
- `skills/` — Shared skill definitions for agents
- `tests/` — Vitest test suite

## Development

```bash
npx vitest run                    # Run all tests
npx vitest run tests/gateway/     # Run specific test dir
npx tsx src/cli.ts dashboard      # Start dashboard + daemon
npx vite build                    # Rebuild dashboard client (from packages/dashboard/)
```

## Key Conventions

- Agent communication goes through `hive post` → dashboard API → `signalChannel()`. Never write directly to SQLite for message posting in the daemon.
- SQLite `CURRENT_TIMESTAMP` stores UTC without `Z`. Always use `parseUtcDatetime()` when converting to JS Date.
- Claude CLI with `--output-format json` wraps output in `{"result": "...", "usage": {...}}`. Always unwrap the envelope before parsing.
- Haiku may wrap JSON in markdown code fences. Always strip `` ```json ``` `` before parsing.
- Channel names use `dm:<agent-id>` for 1:1 channels, `team-<id>` for team channels.
- Every agent invocation must log to the audit store with token counts.
- The ACTION tag protocol: agents self-report `ACTION: <summary>` at end of response; haiku fallback if missing.

## Background Processes

Never start long-running servers directly with Bash.
Always fully detach:
```bash
nohup <command> </dev/null >/tmp/<name>.log 2>&1 & disown
```

On macOS, `setsid` is not available — use `nohup ... & disown` instead.

## Change Scope Decision

Before making any change, deliberately decide its scope:

- **Infra** — Improves the hive engine for all orgs (src/, packages/dashboard/, tests/). Example: fixing triage parsing, adding memory search, dashboard features.
- **Org-specific** — Only affects a particular org's agents (org/). Example: updating a CEO's PRIORITIES.md, adding a new team member agent.
- **Both** — Engine change + org config to use it. Example: adding a new skill type (infra) + enabling it for specific agents (org).

Ask yourself: "Would this change matter to a different org using hive?" If yes → infra. If no → org-specific. If both → separate the commits.

## Testing

- All tests use vitest with mocked `spawnClaude` — never invoke real Claude CLI in tests
- Mock the spawner module, not individual functions
- When testing triage output, account for JSON envelope wrapping and code fence stripping
