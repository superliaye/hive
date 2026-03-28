# Followup System

## Overview

Agents declare commitments via FOLLOWUP tags. The daemon tracks these and re-invokes agents on a backoff schedule until the commitment is resolved.

Two event streams drive agent work:
1. **Inbox events** (reactive) — new messages trigger checkWork
2. **Followup events** (proactive) — scheduled checks trigger followup invocations

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

## Scheduler Flow (src/daemon/followup-scheduler.ts)

```
For each open followup where next_check_at <= now:
  1. Execute check_command (shell, 15s timeout)
  2. Exit 0 → close as "done"
  3. Exit 2 → skip this tick, advance to next interval
  4. Exit 1 or no check_command → spawn agent for followup
  5. If final attempt (isFinal=true):
     - Agent must make terminal decision: complete, escalate, or cancel
     - Close as "expired" after agent runs
  6. Otherwise: advance attempt, schedule next check at backoff[attempt]
```

## Agent Followup Context

When spawned for a followup, the agent receives:

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

If the agent is already working when a followup fires, the scheduler retries in 2 minutes instead of consuming an attempt.
