# Hive Architecture

Hive is an autonomous agent organization framework. It runs a team of Claude-powered agents that communicate, delegate, and ship code with minimal human intervention.

## Documents

| Document | Covers |
|----------|--------|
| [System Overview](system-overview.md) | What Hive is, core concepts, high-level data flow |
| [Org Model](org.md) | People, hierarchy, provisioning, role templates |
| [Agents](agents.md) | Identity files, prompt assembly, spawner, skills |
| [Chat](chat.md) | Messages, conversations, cursors, access control |
| [Daemon](daemon.md) | Tick loop, lanes, checkwork cycle, crash recovery |
| [Triage](triage.md) | Two-stage gateway: deterministic scoring + LLM classification |
| [Followups](followups.md) | FOLLOWUP tags, scheduler, backoff, auto-closure |
| [Dashboard & SSE](dashboard.md) | Web UI, Express API, real-time event streaming |
| [Memory](memory.md) | Semantic search, vector embeddings, daily logs |
| [Data Stores](data-stores.md) | SQLite databases, schemas, WAL mode |
| [CLI Reference](cli.md) | All `hive` commands and their behavior |

## Key Principles

1. **Lanes** — Serial per-agent, parallel cross-agent. No agent conflicts, maximum throughput.
2. **Two-stage triage** — Fast deterministic scoring, then LLM classification. Zero-cost when inbox empty.
3. **Persistent followups** — Agents declare commitments; daemon tracks completion automatically.
4. **Crash safety** — Process NOTE/QUEUE to memory before marking read. Recover stale agents on restart.
5. **Git as identity** — Each agent signs commits with their alias. Org structure lives in git.
6. **Signal + tick** — Responsive to new messages (100ms), with guaranteed baseline checks (10min).
