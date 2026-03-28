# Follow-Up Tracker

Agents declare commitments (PRs, delegations, etc.) that need to be driven to completion. The daemon schedules independent checks with agent-defined exponential backoff, running machine-checkable commands when possible to avoid token spend.

## Two Event Streams

- **Inbox events** (reactive): message arrives → triage → maybe spawn. Existing system.
- **Follow-up events** (proactive): agent declared a commitment → daemon schedules checks on agent-defined backoff → run check command → route by exit code → maybe spawn.

Both share the per-agent lane (no concurrent spawns per agent).

## FOLLOWUP Tag Format

Agent appends to response:
```
FOLLOWUP: PR #46 — drive to merge
| check: gh pr view 46 --json state -q '.state == "MERGED"'
| backoff: 10m, 30m, 1h, 4h
```

- `description` (required): what is being tracked
- `check` (optional): shell command; exit code determines outcome
- `backoff` (required): comma-separated intervals; length = max attempts

## Check Command Exit Codes

| Exit | Meaning | Daemon action |
|------|---------|---------------|
| 0 | Done | Auto-close, no spawn |
| 1 | Not done, stdout has context | Spawn agent with stdout |
| 2 | Not done, try next interval | Advance to next backoff, no spawn |
| Other / timeout / crash | Error | Spawn agent with error details |

Last attempt exhausted → spawn agent with `final: true`, then set status=expired.

## Gateway Validation

- Min interval: 5 minutes
- Max interval: 7 days
- Max attempts: 5 (hard cap on backoff array length)
- Check command: reject dangerous patterns (`rm `, `kill `, `sudo`, etc.)
- Invalid values clamped to boundaries with warning logged

## SQLite Schema

```sql
CREATE TABLE followups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,
  description TEXT NOT NULL,
  check_command TEXT,
  backoff_schedule TEXT NOT NULL,  -- JSON: ["10m","30m","1h","4h"]
  attempt INTEGER DEFAULT 0,
  next_check_at DATETIME NOT NULL,
  last_check_exit INTEGER,
  last_check_output TEXT,
  status TEXT DEFAULT 'open',     -- open | done | expired | cancelled
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  closed_at DATETIME
);
CREATE INDEX idx_followups_agent_status ON followups(agent_id, status);
CREATE INDEX idx_followups_next_check ON followups(status, next_check_at);
```

## Daemon Scheduling

Each follow-up gets its own `setTimeout`. On creation:
```
attempt=0, next_check_at = now + backoff[0]
setTimeout(runCheck, backoff[0])
```

On daemon start, restore timers for all open follow-ups based on `next_check_at`.

## Agent Invocation Context

When spawned for a follow-up:
```
FOLLOW-UP CHECK (attempt 2 of 4):
Description: PR #46 — drive to merge
Check result (exit 1): "state: OPEN, reviews: 0, comments: 0"
Backoff remaining: 1h, 4h
History:
  #1 (30m ago) — exit 1: "state: OPEN, reviews: 0"

Drive this to completion. Take action to unblock progress.
```

Final attempt:
```
FOLLOW-UP CHECK (attempt 4 of 4 — FINAL):
...
This is your last check. Make a terminal decision: merge, close, escalate, or cancel.
```

## Protocol (git-workflow skill update)

Agents taught to:
- Declare FOLLOWUP tags for any commitment needing follow-up
- Prefer programmatic `check` commands (zero token cost when check passes)
- Choose backoff schedules matching expected resolution time
- On final attempt, make a terminal decision (don't leave things hanging)

## Files to Create/Modify

- `src/daemon/followup-store.ts` — SQLite CRUD for followups table
- `src/daemon/followup-scheduler.ts` — independent timer management, check execution
- `src/daemon/followup-parser.ts` — parse FOLLOWUP tags from agent output
- `src/daemon/followup-validator.ts` — validate backoff, check commands
- `src/daemon/check-work.ts` — parse FOLLOWUP tags after agent response
- `src/daemon/daemon.ts` — wire scheduler, restore timers on start
- `org/*/role-skills/git-workflow/SKILL.md` — teach agents about FOLLOWUP tags
- Tests for each new module
