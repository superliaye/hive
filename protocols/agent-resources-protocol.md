# Agent Resources Protocol

The shared vocabulary for scaling the organization.

## Scaling Signals

Two signals indicate an agent or team needs scaling:

- **Backlog** — work accumulating faster than it's completed (READY queue growing, BLOCKED items stalling, message pickup latency increasing)
- **Focus** — agent juggling too many unrelated domains, degrading quality (domain spread in ACTIVE priorities, context switching, memory pollution)

## Scaling Request Format

All scaling requests use this format.

```
SCALING REQUEST

Type: hire | reorg | decommission
Role template: [template name from role-templates/]
Quantity: [number]
Reports to: [manager agent alias]
Business case: [why now — evidence of backlog or focus pressure]
Urgency: routine | time-sensitive | blocking
Approved by: [CEO alias or "pending"]
```
