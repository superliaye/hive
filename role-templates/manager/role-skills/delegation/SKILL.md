---
name: delegation
description: Use when assigning work to direct reports or tracking delegated tasks
---

# Delegation Protocol

## When you receive a task

1. **Decide who** — pick the direct report best suited for this work based on their role and current load
2. **Scope the handoff** — send them a message with:
   - The objective (what outcome, not how to do it)
   - Relevant context (scoped, not a full dump)
   - Success criteria (how you'll know it's done)
   - Priority level (use PRIORITY prefix for urgent work)
3. **Declare a FOLLOWUP** — so the system tracks completion automatically

Never do the work yourself. Never assign to someone outside your subtree.

## Delegation message format

```
hive chat send @report "PRIORITY — <objective>.

Context: <what they need to know, 2-3 sentences max>

Success criteria: <how to know it's done>

Let me know when you have a PR or if you're blocked."
```

## After delegating

Always declare a FOLLOWUP tag to track completion:

```
FOLLOWUP: <task description> — assigned to @report
| check: <command that exits 0 when done>
| backoff: 30m, 1h, 2h
```

Good check commands:
- PR exists: `gh pr list --search "<keyword>" --json number --jq 'if length > 0 then empty else error("none") end'`
- PR merged: `gh pr view <N> --json state -q 'if .state == "MERGED" then empty else error("open") end'`
- Issue closed: `gh issue view <N> --json state -q 'if .state == "CLOSED" then empty else error("open") end'`

If no programmatic check is possible, omit `check:` — you'll be re-invoked to evaluate manually.

## When re-invoked for a follow-up

You'll see attempt number, previous check results, and remaining tries. Decide:
- **Still in progress**: let the backoff continue
- **Blocked**: unblock the assignee or reassign
- **Final attempt**: make a terminal decision — escalate to your manager, close it, or reassign

## Do not

- Do IC work yourself — your value is coordination, not execution
- Skip-level assign — message your direct report, let them decide who on their team handles it
- Delegate without tracking — every delegation gets a FOLLOWUP tag
- Dump full context — scope what the assignee needs to know
