# Daemon

## Overview

The daemon is the orchestration engine. It wakes agents on schedule or in response to messages, runs them through a triage pipeline, and spawns Claude CLI for work that needs attention.

## Startup (src/daemon/daemon.ts)

```
daemon.start():
  1. Write PID file (prevent duplicate daemons)
  2. Register all agents in state store
  3. Crash recovery (recover agents stuck in 'working' with dead PIDs)
  4. Initialize FollowUpStore + FollowUpScheduler
  5. Index agent memories (background, non-blocking)
  6. Schedule staggered ticks per agent
```

## Tick System

Each agent gets a periodic tick at `tickIntervalMs` (default: 600,000ms = 10 min).

Ticks are **staggered** to prevent thundering herd:
- Stagger interval: `tickMs / agentCount`
- Agent 0 fires immediately, Agent 1 fires at +stagger, Agent 2 at +2×stagger, etc.
- Each agent then repeats on `setInterval(tickMs)`

```
Timeline (4 agents, 10min tick):
  t=0:00  Agent 0 fires
  t=2:30  Agent 1 fires
  t=5:00  Agent 2 fires
  t=7:30  Agent 3 fires
  t=10:00 Agent 0 fires again
  ...
```

## Lanes (src/daemon/lane.ts)

Per-agent FIFO queue with concurrency=1.

- **Serial per-agent**: An agent can only have one checkWork running at a time
- **Parallel cross-agent**: Different agents' lanes run independently
- `drain()`: Wait for all pending tasks (used for graceful shutdown)

## Signal Path

When a message is posted (via CLI or dashboard), the daemon is signaled:

```
signalConversation(conversationId)
  → resolve conversation members
  → for each member who is an agent:
    → clear existing coalesce timer
    → setTimeout(enqueueCheckWork, 100ms)  // debounce
```

This provides ~100ms response time to new messages, vs waiting for the next tick.

## CheckWork Cycle (src/daemon/check-work.ts)

The sole entry point for agent invocations. Handles both inbox triage and followup processing in a single unified cycle:

```
1. Guard: skip if agent.status == 'working'
2. Read unread messages via ChatAdapter
3. If empty inbox AND no due followups → return (ZERO LLM cost)
4. Stage 1: Deterministic scoring (see triage.md)
5. Stage 2: LLM triage via haiku (timeout: 5 min)
6. Log triage audit row (message count, classification breakdown, tokens)
7. Override: super-user messages → always ACT_NOW
8. Process NOTE/QUEUE:
   - Log to triage-log.db (per-agent SQLite)
   - Mark read
9. Process IGNORE:
   - Mark read
10. Process due followups:
    - Run check commands (15s timeout each)
    - exit 0 → close followup, log audit row
    - exit 2 → reschedule, log audit row
    - exit 1 / no command → flag for agent spawn, log audit row
11. If ACT_NOW messages OR followups need spawn:
    - Build combined work input
    - Set status → working
    - Spawn Claude CLI (single entry point)
    - Parse ACTION + FOLLOWUP tags
    - Log agent invocation audit row
    - Advance/close/reschedule followups
    - Set status → idle
    - Advance cursors
12. Mark all messages read
13. Return { agentInvoked, recheckImmediately }
```

**recheckImmediately**: If work was done, the agent may have new messages (from its own actions). Re-enqueue immediately to catch them.

## Exponential Decay

When inbox has messages but none classified as ACT_NOW:

- Schedule recheck with increasing delays: [30s, 60s, 180s]
- Prevents constant re-triaging of the same queued messages
- Resets when inbox becomes empty

## Crash Recovery (src/orchestrator/)

On daemon start:
1. Scan `agent_state` table for `status='working'`
2. Check if PID is alive: `process.kill(pid, 0)`
3. If dead → mark as idle (recovered)

**Rate limiting**: 3+ crashes in 10 minutes → `status=errored`, skip further ticks. Resets on daemon restart.

## Graceful Shutdown

```
daemon.stop():
  1. Set running=false
  2. Clear all tick timers
  3. Stop followup scheduler
  4. Drain all lanes (wait for in-flight work)
  5. Remove PID file
```
