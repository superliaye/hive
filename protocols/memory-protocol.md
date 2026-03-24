# Memory Protocol

How and when agents update their long-term memory.

## What Memory Is

MEMORY.md is your curated long-term knowledge. It contains facts, decisions, context, and lessons that you'll need in future cycles. It is NOT a log — it's a reference document.

Daily logs (`memory/YYYY-MM-DD.md`) are automatically generated from NOTE and QUEUE messages during triage. These are raw and unprocessed.

## When to Update MEMORY.md

Update after completing significant work:
- A decision was made that affects future work
- You learned something about the codebase, product, or org that you'll need again
- A pattern emerged that changes how you should approach similar tasks
- Context was transferred from a 1:1 that you need to retain

Do NOT update for:
- Routine task completions (that's what DONE priorities are for)
- Transient information (meeting notes that won't matter next week)
- Information already captured in other persistent stores (GitHub issues, audit logs)

## Format

Keep entries concise and scannable:

```markdown
# Memory

## Architecture
- Dashboard uses React + Vite, served by Express on port 3001
- Comms backend is SQLite with FTS5 for search

## Decisions
- [2026-03-23] Chose SQLite over Postgres for org-state — single-process, no infra dependency
- [2026-03-24] DM-first routing — team channels for broadcasts only

## People
- platform-eng: strong on infra, prefers explicit specs
- qa-eng: thorough but slow, give extra time for reviews
```

## Pruning

Memory should stay focused. If MEMORY.md grows beyond what's useful in your prompt context:
- Remove entries that are no longer relevant
- Consolidate related entries
- Move historical context to daily logs if needed for audit but not for active work

## Daily Logs

Daily logs are machine-generated and append-only during a cycle. At the start of each cycle, you may review recent daily logs and promote important items to MEMORY.md.

Old daily logs (>7 days) may be pruned if their content has been promoted to MEMORY.md or is no longer relevant.

## Vector Search

Your memories are indexed for semantic search. The daemon automatically re-indexes after memory writes. When you're invoked, relevant memories are retrieved and included in your context. You don't need to manage the index — just write good, clear memory entries.
