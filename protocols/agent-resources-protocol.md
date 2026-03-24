# Agent Resources Protocol

The shared contract for scaling the organization. All agents must understand this vocabulary.

## Scaling Signals

Two signals indicate an agent or team needs scaling:

- **Backlog** — work accumulating faster than it's completed (READY queue growing, BLOCKED items stalling, message pickup latency increasing)
- **Focus** — agent juggling too many unrelated domains, degrading quality (domain spread in ACTIVE priorities, context switching, memory pollution)

## Scaling Request Format

All scaling requests use this format. This is the shared language between proposers and AR.

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

## Approval Chain

- Only managers and CEO can propose scaling. ICs signal pressure to their manager.
- CEO approves all scaling requests (LIGHTWEIGHT/MINOR self-approved, MAJOR requires board).
- AR executes approved requests. AR does not decide when to scale.
- AR can push back on malformed requests but cannot deny an approved one.

## Execution

On receiving an approved request, AR:

1. Validates the request is complete and approved
2. Instantiates agent from role template
3. Updates org-state.db
4. Logs to resourcing_audit
5. Triggers channel regeneration
6. Appends events to all affected agents
7. Confirms completion to requester
