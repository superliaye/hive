# Protocols

Shared protocols that define how all agents operate. These are loaded into every agent's system prompt and represent the universal rules of the organization.

Each protocol covers one domain. Agents must follow these exactly — they are not guidelines, they are rules.

## Protocols

- **priority-protocol.md** — how agents read, create, update, and transition their own priorities
- **agent-resources-protocol.md** — how agents measure backlog and focus, how to escalate scaling needs
- **memory-protocol.md** — how and when agents update their long-term memory
- **events-protocol.md** — how agents process, internalize, and clean up events
- **bureau-protocol.md** — how and when agents update their BUREAU.md

## Key Principles

1. **Autonomy** — no agent can modify another agent's priorities, memory, or bureau. All influence happens through communication.
2. **Structured state** — priorities and events live in SQLite (`agent.db`), not markdown. Schemas are enforced.
3. **Programmatic visibility** — the daemon controls what the agent sees. DONE priorities are hidden from prompt but exist for audit.
