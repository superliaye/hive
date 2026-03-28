# Followup System

## Overview

Agents declare commitments via FOLLOWUP tags. The daemon tracks these and re-invokes agents on a backoff schedule until the commitment is resolved.

Two event streams feed into the unified checkWork cycle:
1. **Inbox events** (reactive) — new messages trigger checkWork
2. **Followup events** (proactive) — scheduled timers trigger checkWork via `enqueueCheckWork`

## FOLLOWUP Tag Format

Emitted by agents at the end of their response, before the ACTION tag:

```
FOLLOWUP: Bug #47 verification — QA reviewing PR
| check: gh pr view 47 --json state -q '.state'
| backoff: 10m, 30m, 1h
```

- **description**: Human-readable commitment
- **check**: Shell command (exit 0=done, 1=not done, 2=skip this tick)
- **backoff**: Comma-separated intervals between checks

## Storage (src/daemon/followup-store.ts)

Persisted in `orchestrator.db`:

```sql
CREATE TABLE followups (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id         TEXT NOT NULL,
  description      TEXT NOT NULL,
  check_command    TEXT,
  backoff_schedule TEXT NOT NULL,    -- JSON array of ms values
  attempt          INTEGER DEFAULT 0,
  next_check_at    DATETIME NOT NULL,
  last_check_exit  INTEGER,
  last_check_output TEXT,
  status           TEXT DEFAULT 'open',  -- open, done, expired, cancelled
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  closed_at        DATETIME
);
```

## Scheduler (timer-only) (src/daemon/followup-scheduler.ts)

The FollowUpScheduler is a thin timer manager. It does NOT spawn agents.

```
1. When a FOLLOWUP tag is parsed → store in DB + schedule timer
2. When timer fires → signal daemon via enqueueCheckWork(agentId)
3. Daemon enqueues checkWork for that agent's lane
4. checkWork picks up due followups and processes them
```

### Processing in checkWork

When checkWork runs, it checks for due followups alongside inbox triage:

```
1. Run check command (if present, 15s timeout)
2. Exit 0 → close as "done", log audit row
3. Exit 2 (skip) + not final → advance to next interval, log audit row
4. Exit 1 or no command → include in agent spawn context
5. After agent completes:
   - Not final → advance attempt, reschedule
   - Final → close as "expired"
```

### Benefits over separate scheduler

- **No race conditions**: Agent lane (concurrency=1) prevents followup and checkWork from running simultaneously
- **Single spawn path**: All Claude CLI invocations go through checkWork
- **Combined context**: Agent sees both inbox messages AND followup status in one invocation
- **Unified audit trail**: All activity logged consistently

## Agent Followup Context

When checkWork spawns an agent that includes followup context, the agent receives:

```
# Follow-Up Check (attempt 2 of 3)
**Description:** Bug #47 verification — QA reviewing PR
**Check result** (exit 1): open
**Previous check output:** open
**Backoff remaining:** 1h

---
[Agent's full system prompt + memory context]
```

On the **final attempt**, the header says `[FINAL]` — the agent must resolve, escalate, or cancel. No open items left unresolved.

## Lifecycle

```
registered → attempt 1 check → not done → spawn agent → schedule attempt 2
          → attempt 2 check → not done → spawn agent → schedule attempt 3
          → attempt 3 check [FINAL] → spawn agent → close (expired)

          OR at any point:
          → check exit 0 → close (done)
```

## Guard: Busy Agent

If the agent is already working when checkWork runs (e.g. from a followup timer), the lane's concurrency=1 ensures the work is queued and processed after the current invocation completes. No attempts are consumed while waiting.
