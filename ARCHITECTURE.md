# Hive Architecture

> Living document. Update when architecture changes. Last updated: 2026-03-24.

## What is Hive

A general-purpose framework for building autonomous agent organizations. Agents are Claude instances organized in a hierarchy (like a company). They communicate through local slack channels, manage their own priorities and memory, and act autonomously. A single daemon manages the event loop.

## System Overview

```
                    super-user (id=0)
                        |
                      [DM]
                        |
                    +-------+
                    |  CEO  |  (id=1, root agent)
                    +-------+
                   /    |    \
               [DM]  [DM]   [DM]
               /        |        \
           +----+  +--------+  +------+
           | AR |  |plat-eng|  |qa-eng|
           +----+  +--------+  +------+
                \       |       /
              [Group: eng-team]
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
├── cli.ts                 CLI entry point (hive init|start|stop|chat|dashboard)
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
│   ├── skill-loader.ts    Load skill definitions from role-skills/ directory
│   └── config-loader.ts   Parse config.json → agent spawn configuration
│
├── chat/
│   ├── db.ts              Chat tables in org-state.db (channels, messages, read_cursors)
│   ├── channels.ts        DM (lazy) + Group (explicit) CRUD
│   ├── messages.ts        Send, history (with default limit + ranges), search
│   ├── cursors.ts         Per-person per-channel read cursors, inbox/ack
│   └── cli.ts             `hive chat` CLI subcommands
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

## Communication — `hive chat`

Chat is a module inside hive (`src/chat/`). It owns channel and message storage in `org-state.db`, reads `people` from the same DB. Fully testable in isolation.

### Two Channel Types

| Type | Creation | Members | Example |
|------|----------|---------|---------|
| **DM** | Lazy (first message creates it) | Exactly 2 people | dm between CEO and AR |
| **Group** | Explicit (`hive chat group create`) | N people (min 2) | eng-team, cross-func sprint |

No special named channels (`#board`, `#approvals`, `#team-*`). Team channels are just groups created on demand. Any member can manage groups they belong to. Group names: kebab-case `[a-z0-9-]`, max 50 chars, globally unique.

### CLI Commands

Identity is injected via `HIVE_AGENT_ID` env var. No `--as` flag. Super-user uses `HIVE_AGENT_ID=0`. Dashboard calls CLI under the hood.

All commands are agent-first: missing/invalid args return helpful error messages with usage hints. `hive chat --help` shows full command tree. `hive chat` with no subcommand shows help.

```
# Messaging
hive chat send @alias "message"              # DM (channel created lazily)
hive chat send #group "message"              # Message to group
                                             # Supports multiline strings, stdin pipe
                                             # Returns: "Sent seq <N> to <channel>"

# Inbox (rarely used — gateway handles inbound automatically)
hive chat inbox                              # All unread, grouped by channel, chronological
hive chat ack @alias <seq>                   # Advance DM read cursor
hive chat ack #group <seq>                   # Advance group read cursor

# History (channel-scoped thread view)
hive chat history @alias                     # Last 20 (default), shows "N of M total"
hive chat history #group                     # Group history
hive chat history @alias --limit 50          # Last 50
hive chat history @alias --from 10           # Seq 10 → latest
hive chat history @alias --to 30             # Oldest → seq 30
hive chat history @alias --from 10 --to 30   # Seq 10-30 (inclusive both ends)
hive chat history @alias --from 10 --limit 5 # 5 messages starting at seq 10
hive chat history @alias --all               # Everything

# Search (grep-aligned, cross-channel)
hive chat search "pattern"                       # All my channels (literal match)
hive chat search @alias "pattern"                # Within DM with alias
hive chat search #group "pattern"                # Within group
hive chat search --from @alias "pattern"         # From person, all my channels
hive chat search --from @alias @bob "pattern"    # From person, within DM with bob
hive chat search --from @alias #group "pattern"  # From person, within group
hive chat search --after 2026-03-20 "pattern"    # Time-bounded
hive chat search --before 2026-03-23 "pattern"   # Time-bounded
hive chat search -i "pattern"                    # Case insensitive
hive chat search -E "deploy.*fail"               # Extended regex (default: literal)
hive chat search "pattern" --limit 20            # Max results (default 20)
hive chat search "pattern" --limit 20 --offset 40  # Pagination
# Filters composable: --from, scope (@/\#), --after, --before, -i, -E
# At least one of: scope, --from, or "pattern" required
# Output: channel | sender | seq | timestamp | message (newest first)
# Header: "Found 47 results (showing 1-20)"

# Group management
hive chat group create "name" @a @b @c       # Create group (creator auto-joins, min 2 total)
hive chat group list                         # Groups you belong to
hive chat group info #name                   # Members, created_by, message count
hive chat group add #name @alias             # Add member
hive chat group remove #name @alias          # Remove member (including self = leave)
hive chat group delete #name                 # Delete group (any member, messages preserved)
```

### Validation Rules

- `send` to self → error: `Cannot send message to yourself`
- `send @unknown` → error: `Person "unknown" not found. Run: hive chat group list`
- `send #unknown` → error: `Group "unknown" not found. Run: hive chat group list`
- `--from` > `--to` → error: `--from must be <= --to`
- Missing `HIVE_AGENT_ID` → error: `HIVE_AGENT_ID not set. Are you running inside a hive agent?`
- `group create` with < 2 members → error: `Group must have at least 2 members`
- `group create` with invalid alias → error: `Person "x" not found`
- `group add` super-user → error: `Super-user cannot be added to groups`
- Non-CEO messaging super-user → error: `Only CEO can message super-user`

### Message Model

- Per-channel sequential IDs (monotonically increasing)
- Per-person per-channel read cursors (Kafka-style)
- Crash-safe: cursor only advances after message is processed
- History output header: `Showing 20 of 47 messages in dm:1:2 (seq 28-47)`
- All output includes: sender alias, seq ID, timestamp, full message content
- DM channel ID: `dm:<lower_id>:<higher_id>` (internal, transparent to user)

### Gateway Integration

The gateway handles inbound messages for agents automatically:

1. Gateway checks for unread messages (read cursors)
2. Gateway writes `MSG_RECEIVED` events to agent's `agent.db` events table (dedup key: message seq ID)
3. Gateway advances read cursors
4. Agent sees messages as events during activation, responds via `hive chat send`

Crash safety: events written to `agent.db` **before** cursors advance. If crash between 2→3, duplicate events on next cycle — deduped by seq ID. Gateway acks after dumping messages to events.

Super-user sends messages via CLI (`HIVE_AGENT_ID=0`) or dashboard (which calls CLI).

### Access Control

- Only CEO (+ optionally department heads) can message super-user (id=0)
- Super-user cannot be added to groups
- Agents can only see/search channels they are members of
- Any member can add/remove members from groups they belong to
- Any member can delete a group they belong to (messages preserved for audit)

### Scale Design

An agent is only a member of channels relevant to its position. A leaf IC belongs to ~2-3 channels (DM with manager, maybe a group). A message on one channel only triggers activation for members, not the entire org.

Cross-team communication: agents create ad-hoc groups for cross-functional work (2 engineers, 1 PM, 1 QA), or route through hierarchy.

## Agent File Structure

Each agent lives in a flat directory under `org/`:

```
org/001-ceo/
├── config.json    Gateway-only: model, tools, mcp, skills (never in agent prompt)
├── IDENTITY.md    Pure prose identity (no frontmatter, loaded into agent prompt)
├── SOUL.md        Personality, values, communication style
├── BUREAU.md      Org position, reporting structure, collaborator notes
├── PRIORITIES.md  Starting priorities (structured data in agent.db)
├── MEMORY.md      Agent's curated long-term memory (agent-written)
├── EVENTS.md      Unprocessed events template (structured data in agent.db)
├── agent.db       Per-agent SQLite: priorities, events, memory index
└── memory/        Daily activity logs (YYYY-MM-DD.md), gateway-written
```

## Storage

All data is SQLite (WAL mode):

```
Shared (org-level):
├── org-state.db     People, reporting hierarchy (temporal), resourcing audit,
│                    channels, messages, read_cursors, channel_members
├── audit.db         Invocation log: tokens, duration, summaries, action_summary
└── orchestrator.db  Agent state: status, last_invocation, last_heartbeat, pid

Per-agent (in agent folder):
└── agent.db         Priorities, events, memory index (chunks, FTS5, sqlite-vec)
```

**Org isolation**: Each org uses `{cwd}/data/` for shared DBs. Different directories = different databases = full isolation.

## Activation Triggers

The gateway checks three triggers per agent each cycle:

1. **Events** — unprocessed events exist in agent.db
2. **Communications** — unread messages in inbox (gateway converts to `MSG_RECEIVED` events in agent.db, advances cursors)
3. **Priorities** — ACTIVE priorities exist (agent has ongoing work)

When **any** trigger fires, the agent is activated. When none are true, no-op.

Messages are converted to events before activation — the agent sees all input as events. Protocols are conditionally loaded based on which triggers fired — don't bloat context with irrelevant instructions.

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
7. **All agents use `hive chat send`** for communication (identity injected via `HIVE_AGENT_ID` and `HIVE_AGENT_NAME` env vars)

## Dependencies

- `better-sqlite3` — Embedded database (WAL mode)
- `commander` — CLI framework
- `claude` CLI — Agent execution (spawned as child process)
- `express` — Dashboard API server
- `react` + `vite` + `tailwind` — Dashboard frontend
- `vitest` — Test framework
