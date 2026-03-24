# Protocols

Shared protocols that define how all agents operate.

## Loading Strategy

The gateway checks three triggers each cycle. Protocols are loaded into the agent's prompt **only when relevant** — don't bloat context with instructions for situations that don't exist.

| Trigger | Protocol | Loading |
|---|---|---|
| Always | priority-protocol | Always loaded — agent needs it to manage state on the fly |
| Unread messages | communication-processing-protocol | Only when inbox is non-empty |
| Unprocessed events | events-processing-protocol | Only when events queue is non-empty |

When nothing actionable exists across all three triggers, the gateway no-ops and waits for the next cycle.

## Always-Loaded Protocols

These provide shared vocabulary and are always included:

- **priority-protocol.md** — how agents read, create, update, and transition priorities
- **agent-resources-protocol.md** — shared vocabulary for measuring backlog, focus, and scaling
- **bureau-protocol.md** — how agents maintain their understanding of collaborators
- **memory-protocol.md** — how and when agents update long-term memory

## Conditionally-Loaded Protocols

These are only included when the relevant trigger fires:

- **communication-processing-protocol.md** — how to process incoming messages, respond, and send
- **events-processing-protocol.md** — how to process, internalize, and clean up events

## Key Principles

1. **Autonomy** — no agent modifies another agent's state. All influence through communication.
2. **Structured state** — priorities and events live in SQLite, not markdown.
3. **Conditional loading** — only load protocols relevant to the current cycle.
