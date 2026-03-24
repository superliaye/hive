# Agent Resources Protocol

The shared vocabulary for scaling the organization.

## Measuring Backlog

Backlog = work waiting to be done. Signals:

- **READY queue depth** — how many READY priorities are piling up?
- **BLOCKED duration** — how long have items been BLOCKED?
- **Message pickup latency** — how many cycles do messages sit as QUEUE/NOTE before being acted on?
- **DONE throughput** — are items moving to DONE or stalling?

## Measuring Focus

Focus = how many unrelated domains an agent is juggling. Signals:

- **Domain spread** — how many distinct `domain` values in your ACTIVE priorities?
- **Context switching** — are you bouncing between unrelated tasks every cycle?
- **Memory pollution** — is your memory filling with context from too many areas?

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
