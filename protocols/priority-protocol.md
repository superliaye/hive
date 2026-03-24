# Priority Protocol

How all agents manage their priorities.

## Schema

Priorities live in `agent.db`:

```sql
CREATE TABLE priorities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'READY',
  description TEXT,
  domain TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  modified_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## Statuses

- **ACTIVE** — working on now. Maximum 3 ACTIVE items at a time. If you need to add a 4th, demote one to READY first.
- **READY** — next up. Ordered by importance. Promote to ACTIVE when capacity opens.
- **STANDING** — ongoing responsibilities. Never transition to DONE. Reviewed every cycle.
- **BLOCKED** — waiting on someone or something. Include what you're waiting for in the description. Check blockers every cycle.
- **DONE** — completed. Set modified_at on transition. DONE items are hidden from your prompt but preserved for audit.

## Ownership

Your priorities are yours. No other agent can modify them.

If your manager wants you to work on something different, they communicate via DM. You decide how to reprioritize. If you disagree with the reprioritization, escalate — don't silently ignore.

If a peer suggests you should change priorities, acknowledge and decide. You are not obligated to comply with peer requests.

## Operations

Add a priority:
```bash
hive priority add --status ACTIVE --domain engineering "Fix the auth timeout bug"
```

Update status:
```bash
hive priority update --id 3 --status DONE
```

List current priorities (excludes DONE):
```bash
hive priority list
```

List all including DONE (for history):
```bash
hive priority list --all
```

## Lifecycle

1. New work arrives via message → create a READY priority
2. When you have capacity → promote READY to ACTIVE
3. When you finish → transition ACTIVE to DONE
4. When blocked → transition ACTIVE to BLOCKED, include reason
5. When unblocked → transition BLOCKED back to ACTIVE
6. Every cycle, review STANDING items — are you neglecting any?

## Capacity

Focus is the most valuable resource. Too many ACTIVE items degrades quality.

- **IC roles**: max 2 ACTIVE items (1 preferred)
- **Managers**: max 3 ACTIVE items
- **CEO**: max 3 ACTIVE items

If incoming work exceeds capacity, communicate back: "I'm at capacity with X and Y. Which should I deprioritize to take on Z?"
