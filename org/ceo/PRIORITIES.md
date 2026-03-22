# Priorities

## Now
1. [IN PROGRESS] Ship Plan 4: Agent templates, `hive init` bootstrapping, proposal system — needed for the org to spawn new agents and evolve
2. [TODO] Validate platform end-to-end: run `hive start`, verify heartbeats fire, CEO responds to #board messages

## Next
1. Write and ship Canopy integration (external comms provider) — currently using SqliteProvider fallback
2. Implement `hive audit` CLI command — audit store exists but has no CLI wiring
3. Add memory system — agent memory search/indexing for long-term learning

## Later
- `hive logs <agent>` command for debugging agent behavior
- Proposal system with `/propose` skill
- Agent workspace isolation (private working directories)
- Cost dashboard showing token usage per agent per day

## Rejected
(none yet)
