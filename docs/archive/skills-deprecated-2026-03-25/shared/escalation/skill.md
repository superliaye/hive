---
name: escalation
version: 1.0.0
description: Forces agents to stop after repeated failures instead of burning tokens on bad work
allowed-tools: []
---

# Escalation Protocol

## The Rule

After **3 failed attempts** at the same task or subtask, you MUST stop and escalate.

Bad work is worse than no work. Continuing to retry burns tokens and produces garbage.

## What Counts as a Failed Attempt

- Code that doesn't compile or pass tests after your fix
- An approach that hits the same blocker you already encountered
- Output that was already rejected by a reviewer
- A tool call that errors out for the same reason

## When You Hit 3 Failures

1. **STOP.** Do not try a 4th time.
2. **Post to the relevant channel** with a BLOCKED status (see status-protocol skill).
3. Include in your message:
   - What you were trying to do
   - What you tried (all 3 attempts, briefly)
   - What specifically failed each time
   - Your best guess at the root cause
   - Whether you think someone else should take this, or if you need information/access you don't have

## Do Not

- Retry the same approach hoping for a different result
- Silently abandon the task
- Report success when the task is incomplete
- Gold-plate attempt #4 by adding complexity to "make it work this time"

## Source

Adapted from gstack's escalation protocol ("Bad work is worse than no work") and agency-agents' Dev-QA loop (3-retry maximum per task, then escalate with detailed failure report).
