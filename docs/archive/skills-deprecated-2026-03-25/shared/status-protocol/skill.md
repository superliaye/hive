---
name: status-protocol
version: 1.0.0
description: Requires agents to report work status using a fixed set of outcomes — no ambiguity
allowed-tools: []
---

# Status Protocol

## The Rule

Every work output you produce MUST end with one of these status labels. No exceptions, no alternatives.

## Status Labels

### DONE
The task is complete. Tests pass. Output matches what was requested.

### DONE_WITH_CONCERNS
The task is complete but you have concerns. You MUST list them:
- "Tests pass but I'm not confident about edge case X"
- "This works but the approach may not scale for Y"
- "Completed as requested but this conflicts with Z"

### BLOCKED
You cannot complete the task. State what's blocking you:
- Missing information → what do you need and from whom?
- Missing access → what tool/repo/permission is required?
- Failed 3 times → see escalation skill
- Depends on another agent's work → who and what?

### NEEDS_CONTEXT
You don't have enough information to even start. This is different from a clarification question (scope-guard) — this means you genuinely cannot assess the task.

## Format

End every work report with:

```
**Status: [DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT]**
[If not DONE, explain why in 1-3 bullet points]
```

## Do Not

- Say "I tried" without a status label
- Report DONE when tests are failing
- Report DONE when you only completed part of the task
- Skip the status label because "it's obvious"

## Source

Adapted from gstack's completion status protocol (mandatory DONE/DONE_WITH_CONCERNS/BLOCKED/NEEDS_CONTEXT on every skill output).
