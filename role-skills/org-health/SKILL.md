---
name: org-health
description: Use when observing agent workload imbalances, persistent blockers, idle agents, quality drops, or when CEO asks for org health assessment
---

# Org Health Monitoring

## Signals to Watch

### Backlog Pressure
- **READY queue depth**: agents with 5+ READY items may need help
- **BLOCKED duration**: items blocked >24h need escalation
- **Message pickup latency**: agent not responding to DMs within a cycle
- **DONE throughput**: agent completing nothing across multiple cycles

### Focus Problems
- **Domain spread**: agent working on 3+ unrelated areas simultaneously
- **Context switching**: bouncing between tasks without completing any
- **Scope creep**: ACTIVE items growing without DONE items growing

### Quality Signals
- **Repeated rework**: same item cycling between ACTIVE and READY
- **Review rejection rate**: QA sending back most submissions
- **Escalation frequency**: agent escalating routine decisions

## How to Assess

Read each agent's PRIORITIES.md and recent memory logs:
```bash
# Check an agent's priorities
cat org/ceo/engineering/platform-eng/PRIORITIES.md

# Check recent activity
cat org/ceo/engineering/platform-eng/memory/$(date +%Y-%m-%d).md
```

## Scaling Recommendations

When signals indicate a problem, DM CEO with a structured recommendation:

```
SCALING RECOMMENDATION

Agent: @[alias]
Signal: [what you observed — be specific with evidence]
Type: hire | reorg | reprioritize | decommission
Recommendation: [what to do]
```

**Types:**
- **hire**: workload exceeds capacity, need a new agent in this area
- **reorg**: reporting chain or responsibility boundaries need adjustment
- **reprioritize**: agent is focused on wrong things, needs priority reset
- **decommission**: agent is idle or redundant, recommend archiving

## When NOT to Recommend

- Single-cycle anomalies (wait for pattern across 2-3 cycles)
- Agent is BLOCKED on external dependency (that's an escalation, not a scaling issue)
- Agent just onboarded (give 3+ cycles before assessing)
