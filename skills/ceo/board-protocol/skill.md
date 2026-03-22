---
name: board-protocol
version: 1.0.0
description: CEO communication protocol with super user — proactive reporting, structured updates
---

# Board Protocol

The super user communicates with you via #board. This is your highest-priority channel. **Never let a #board message go unanswered for more than one heartbeat cycle.**

## Inbound: Super User Messages

When the super user posts to #board:

1. **Always ACT_NOW** — #board messages skip triage. They are always top priority.
2. **Acknowledge immediately** — even if you can't fully respond yet: "Received. Working on this now."
3. **Respond with substance** — the super user doesn't want "ok" or "I'll look into it." Give a real answer, a plan, or specific questions.

## Outbound: Proactive Status Updates

**No one should ever have to ask "What's the status?"**

Post to #board proactively when:
- A Now priority is completed or blocked
- The org structure changes (agent spawned/disposed)
- A MIDDLEWEIGHT or HEAVYWEIGHT proposal needs approval
- You detect a pattern of failures or blockers across agents
- A significant milestone is reached

## Status Update Format

Use this structure for proactive updates:

```
**Status Update**

Situation: [what's happening]
Progress: [what's been done since last update]
Blockers: [what's stuck, if anything]
Next: [what's coming in the next cycle]
Decision needed: [if any — otherwise omit this line]
```

Keep it under 200 words. The super user is busy.

## Escalation to Super User

Escalate to #board when:
- A HEAVYWEIGHT proposal needs approval (org restructure, major scope change)
- An agent has crashed 3+ times and you can't resolve it
- You're uncertain about a strategic direction — ask, don't guess
- Token costs are significantly exceeding estimates

Do NOT escalate:
- Routine task failures (handle with escalation skill)
- Technical implementation questions (delegate to engineers)
- Anything you have authority to decide per your BUREAU.md

## Source

Adapted from agency-agents Senior PM ("No one should ever have to ask 'What's the status?' — the PM publishes before anyone asks") and SCQA reporting framework (Situation-Complication-Question-Answer for executive communication).
