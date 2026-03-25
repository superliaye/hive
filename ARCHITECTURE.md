# Hive Architecture

> Living document. Update when architecture changes. Last updated: 2026-03-24.

## What is Hive

A general-purpose framework for building autonomous agent organizations. Agents are Claude instances organized in a hierarchy (like a company). They communicate through local slack channels, manage their own priorities and memory, and act autonomously. A single daemon manages the event loop.

## System Overview

```
                    super-user
                        |
                   [#board channel]
                        |
                    +-------+
                    |  CEO  |  (root agent)
                    +-------+
                   /    |    \
             [dm:ar] [dm:eng] [dm:qa]
               /        |        \
           +----+  +--------+  +------+
           | AR |  |plat-eng|  |qa-eng|
           +----+  +--------+  +------+
                \       |       /
              [#team-ceo channel]
```

## Core Data Flow

```
Gateway Cycle
    |
    v
Check 3 triggers per agent:
    1. Unprocessed events in agent.db?
    2. Unread messages in inbox?
    3. ACTIVE priorities in agent.db?
    |
    (any trigger fires)
    |
    v
┌─── Agent Activation ────────┐
│                              │
│  1. Assemble system prompt   │
│     (identity, soul, bureau, │
│      protocols, priorities,  │
│      memory)                 │
│  2. Build work input         │
│     (messages, events,       │
│      priority context)       │
│  3. Invoke agent (opus)      │
│  4. Agent processes all      │
│     input, triages, acts     │
│  5. Post responses           │
│  6. Log input/output to      │
│     memory/YYYY-MM-DD.md     │
│  7. Re-index memory          │
│  8. Log audit                │
│                              │
└──────────────────────────────┘
```

The agent (opus) handles all decision-making: triage, prioritization, response, memory curation. The gateway is a dumb activator and recorder.

## Module Map

```
src/
├── cli.ts                 CLI entry point (hive init|start|stop|post|dashboard)
├── context.ts             HiveContext — creates all stores, parses org, wires deps
├── types.ts               Core interfaces: AgentConfig, OrgChart, ChannelDef, AgentState
│
├── org/
│   ├── parser.ts          Walk org/ tree → OrgChart. Generates channel topology.
│   └── scaffold.ts        `hive init` — bootstrap from role templates
│
├── daemon/
│   ├── daemon.ts          Main event loop. Tick-based + signal-driven. Crash recovery.
│   ├── check-work.ts      Activation pipeline: check triggers → assemble → invoke → record
│   ├── direct-channel.ts  DirectChannelRegistry: channel→agents mapping + signal coalescing (100ms)
│   ├── lane.ts            Per-agent concurrency: max 1 activation running per agent
│   └── hot-reload.ts      Detect new/removed agents by rescanning org/ directory
│
├── gateway/
│   ├── scorer.ts          Deterministic ranking: authority × urgency × channel × recency × mention
│   └── types.ts           ScoredMessage, ScoringWeights
│
├── agents/
│   ├── spawner.ts         Spawn `claude -p` process. Extract tokens. JSON output.
│   ├── prompt-assembler.ts Assemble system prompt from agent files + conditional protocols
│   ├── skill-loader.ts    Load skill definitions from skills/ directory
│   └── config-loader.ts   Parse IDENTITY.md frontmatter → AgentIdentity
│
├── comms/
│   ├── sqlite-provider.ts SQLite backend: channels, messages, read_receipts, FTS5 search
│   ├── channel-manager.ts Sync org chart channels into DB. ensureChannel() for organic channels.
│   ├── types.ts           Message, Channel, ICommsProvider interface
│   └── cli-commands.ts    Terminal post/observe commands
│
├── memory/
│   ├── indexer.ts         Chunk daily logs + MEMORY.md, embed with nomic-embed-text
│   ├── search.ts          Hybrid search: BM25 (30%) + vector (70%) + temporal decay
│   ├── store.ts           Per-agent SQLite: chunks, FTS5, sqlite-vec
│   └── manager.ts         Manages per-agent memory stores, re-indexes after writes
│
├── audit/
│   └── store.ts           SQLite audit log: invocations, tokens, action summaries
│
├── state/
│   └── agent-state.ts     Agent status (idle/working/errored), last invocation time
│
├── events/
│   └── event-bus.ts       In-process event emitter for SSE → dashboard
│
├── approvals/
│   └── engine.ts          Parse approval requests/decisions from messages
│
└── orchestrator/
    ├── pid-file.ts        Single-daemon lock file
    └── crash-recovery.ts  3 crashes in 10min → rate limit
```

## Channel Topology

Channels are generated from the org tree (and eventually from org-state.db reporting table).

| Pattern | Example | Members | Purpose |
|---------|---------|---------|---------|
| `board` | `#board` | Root agent only | Super-user ↔ CEO interface |
| `approvals` | `#approvals` | Root agent only | Approval workflow |
| `team-<id>` | `#team-ceo` | Manager + direct reports | Team coordination |
| `dm:<agent-id>` | `#dm:ceo-ar` | Parent + child (2 members) | 1:1 private communication |
| `ar-requests` | `#ar-requests` | CEO + AR | Agent provisioning |

**Scale design**: An agent is only a member of channels relevant to its hierarchy position. A leaf agent belongs to ~3 channels (its DM, its team channel, ar-requests if AR). A message on one channel only triggers activation for 2-8 agents, not the entire org.

**No #all-hands by design**. Broadcasts go through team channels which fan out through the hierarchy. Cross-team communication flows: agent → manager → other-manager → target.

## Agent File Structure

Each agent lives in a flat directory under `org/`:

```
org/001-ceo/
├── IDENTITY.md    Frontmatter: name, role, model, emoji, tools, skills
├── SOUL.md        Personality, values, communication style
├── BUREAU.md      Org position, reporting structure, collaborator notes
├── PRIORITIES.md  Starting priorities (structured data in agent.db)
├── MEMORY.md      Agent's curated long-term memory (agent-written)
├── EVENTS.md      Unprocessed events template (structured data in agent.db)
├── agent.db       Per-agent SQLite: priorities, events tables
└── memory/        Daily activity logs (YYYY-MM-DD.md), gateway-written
```

## Storage

All data is SQLite (WAL mode):

```
Shared (org-level):
├── comms.db         Channels, messages, read_receipts, channel_members, FTS5 index
├── audit.db         Invocation log: tokens, duration, summaries, action_summary
├── orchestrator.db  Agent state: status, last_invocation, last_heartbeat, pid
└── org-state.db     People (super-user + agents), reporting hierarchy (temporal), resourcing audit

Per-agent (in agent folder):
└── agent.db         Priorities, events, memory index (chunks, FTS5, sqlite-vec)
```

**Org isolation**: Each org uses `{cwd}/data/` for shared DBs. Different directories = different databases = full isolation.

## Activation Triggers

The gateway checks three triggers per agent each cycle:

1. **Events** — unprocessed events exist in agent.db
2. **Communications** — unread messages exist in inbox
3. **Priorities** — ACTIVE priorities exist (agent has ongoing work)

When **any** trigger fires, the agent is activated. When none are true, no-op.

Protocols are conditionally loaded based on which triggers fired — don't bloat context with irrelevant instructions.

## Memory System

**MEMORY.md** — curated notebook, always in prompt. Agent writes to it deliberately.

**Daily logs** (`memory/YYYY-MM-DD.md`) — gateway records input/output of each activation cycle. One file per day, append per cycle. Agent never writes these.

**Memory search** — agent can search past activity via `hive memory search "query"`. Hybrid search (BM25 + vector + temporal decay). Per-agent index in agent.db. No gateway pre-fetching — agent decides when and what to search.

## Key Invariants

1. **One activation per agent** at a time (lane system)
2. **Signal coalescing**: Rapid messages within 100ms → single activation
3. **Crash recovery**: 3 crashes in 10min → agent rate-limited
4. **Hot reload**: Daemon rescans org/ directory on each tick for new/removed agents
5. **Agent autonomy**: No agent modifies another agent's state. All influence through communication.
6. **Gateway is dumb**: Gateway activates, records, indexes. Agent makes all decisions.
7. **All agents use `hive msg`** for communication (identity injected via `HIVE_AGENT_ID` env var)

## Dependencies

- `better-sqlite3` — Embedded database (WAL mode)
- `commander` — CLI framework
- `gray-matter` — YAML frontmatter parsing
- `claude` CLI — Agent execution (spawned as child process)
- `express` — Dashboard API server
- `react` + `vite` + `tailwind` — Dashboard frontend
- `vitest` — Test framework
