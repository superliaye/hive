# Agent Resources Protocol

How agents measure workload, detect scaling needs, and escalate to AR.

## Measuring Backlog

Backlog = work waiting to be done. Signals:

- **READY queue depth** — how many READY priorities are piling up?
- **BLOCKED duration** — how long have items been BLOCKED?
- **Message pickup latency** — how many cycles do messages sit as QUEUE/NOTE before being acted on?
- **DONE throughput** — are items moving to DONE or stalling?

An agent experiencing backlog pressure should note it in a DM to their manager:
"I have N READY items and am at ACTIVE capacity. Estimated time to clear: X cycles."

## Measuring Focus

Focus = how many unrelated domains an agent is juggling. Signals:

- **Domain spread** — how many distinct `domain` values in your ACTIVE priorities?
- **Context switching** — are you bouncing between unrelated tasks every cycle?
- **Memory pollution** — is your memory filling with context from too many areas?

An agent experiencing focus fragmentation should note it in a DM to their manager:
"I'm splitting across N domains (list them). Quality is degrading on X because of context switching with Y."

## Escalation Path

### For ICs
1. Signal to your manager via DM: describe backlog or focus pressure with evidence
2. Manager decides: reprioritize, reassign, or propose scaling
3. You do NOT propose scaling directly — that's your manager's call

### For Managers / Department Heads
1. Aggregate signals from your reports
2. Diagnose: is this a capacity problem, prioritization problem, or skills problem?
3. If capacity: propose scaling to CEO via DM
4. Include evidence: which agents are overloaded, what's the backlog, what's the impact

### For CEO
1. Aggregate signals from department heads and direct reports
2. Evaluate against budget and strategy
3. If approved: send a scaling request to AR via #ar-requests or DM

## Scaling Request Format

```
SCALING REQUEST

Type: hire | reorg | decommission
Role template: [template name from role-templates/]
Quantity: [number]
Reports to: [manager agent alias]
Business case: [why now — backlog numbers, focus evidence, throughput data]
Urgency: routine | time-sensitive | blocking
Approved by: [CEO alias or "pending"]
```

## AR Responsibilities

AR does not decide when to scale. AR executes approved requests:

1. Validate the request is complete and approved
2. Instantiate agent from role template (create folder, seed agent.db, copy md files)
3. Update org-state.db (employees, reporting tables)
4. Log to resourcing_audit
5. Trigger channel regeneration
6. Append events to all affected agents
7. Confirm completion to requester

AR can push back on a request if it's malformed or contradicts org constraints, but cannot deny an approved request.
