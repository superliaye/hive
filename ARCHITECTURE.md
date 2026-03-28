# Hive Architecture

> Consolidated architecture documentation lives in [`docs/architecture/`](docs/architecture/README.md).
>
> This file is a quick reference. See the linked docs for full details.

## What is Hive

A framework for running autonomous organizations of AI agents. Agents are Claude instances with identities, roles, skills, and memory. They communicate through chat, receive work through a triage gateway, and track commitments through a followup scheduler.

## Architecture Docs

| Document | Covers |
|----------|--------|
| [System Overview](docs/architecture/system-overview.md) | Core concepts, data flow diagram, module map |
| [Org Model](docs/architecture/org.md) | People table, hierarchy, provisioning, role templates |
| [Agents](docs/architecture/agents.md) | Spawner, prompt assembly, identity files, skills |
| [Chat](docs/architecture/chat.md) | Messages, conversations, cursors, access control |
| [Daemon](docs/architecture/daemon.md) | Tick loop, lanes, checkwork cycle, crash recovery |
| [Triage](docs/architecture/triage.md) | Two-stage gateway: scoring + LLM classification |
| [Followups](docs/architecture/followups.md) | FOLLOWUP tags, scheduler, backoff, auto-closure |
| [Dashboard & SSE](docs/architecture/dashboard.md) | Web UI, Express API, real-time event streaming |
| [Memory](docs/architecture/memory.md) | Semantic search, vector embeddings, daily logs |
| [Data Stores](docs/architecture/data-stores.md) | SQLite databases and schemas |
| [CLI Reference](docs/architecture/cli.md) | All `hive` commands |

## Key Invariants

1. **One lane per agent, concurrency=1** — no overlapping invocations
2. **Cursor advances only after processing** — crash-safe message handling
3. **Zero LLM cost when inbox empty** — ticks are free if nothing to do
4. **Super-user messages always ACT_NOW** — bypass triage classification
5. **Agents never call `ack`** — daemon owns cursor management (`HIVE_DAEMON_SPAWN=1`)
6. **Staggered ticks** — prevents thundering herd of concurrent API calls
7. **Memory written before read** — NOTE/QUEUE saved to disk before marking messages read
