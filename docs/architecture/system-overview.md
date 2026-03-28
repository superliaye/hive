# System Overview

## What is Hive

Hive is a framework for running autonomous organizations of AI agents. Each agent has an identity, a role, skills, and memory. They communicate through a chat system, receive work through a triage gateway, and track commitments through a followup scheduler.

A human (the "super-user") interacts with agents through a dashboard or CLI. Messages flow down the org hierarchy via delegation — the CEO delegates to managers, managers delegate to ICs, ICs ship code and report back.

## Core Loop

```
                    ┌─────────────┐
                    │  super-user │
                    │ (dashboard) │
                    └──────┬──────┘
                           │ hive chat send
                           ▼
                    ┌─────────────┐
                    │   Chat DB   │◄──── agents post messages here too
                    └──────┬──────┘
                           │ signal / tick
                           ▼
                    ┌─────────────┐
                    │   Daemon    │
                    │  per-agent  │
                    │   lanes     │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
         ┌────────┐  ┌────────┐  ┌────────┐
         │ Score  │  │ Triage │  │ Invoke │
         │ (det.) │→ │ (LLM)  │→ │(claude)│
         │Stage 1 │  │Stage 2 │  │Stage 3 │
         └────────┘  └────────┘  └────────┘
                                      │
                              ┌───────┴───────┐
                              ▼               ▼
                        ┌──────────┐   ┌───────────┐
                        │  Action  │   │ FOLLOWUP  │
                        │(git,chat)│   │(scheduler)│
                        └──────────┘   └───────────┘
```

## Module Map

```
src/
├── cli.ts              # CLI entry point (hive start, chat, agent, etc.)
├── context.ts          # HiveContext: DI container for all stores
├── types.ts            # Core types (Person, AgentConfig, OrgChart)
├── daemon/             # Tick loop, lanes, checkwork, followup scheduler
├── chat/               # Messages, conversations, cursors, access, search
├── agents/             # Spawner, prompt assembler, skill loader
├── gateway/            # Deterministic scoring + LLM triage
├── org/                # Org parser, provisioner, scaffolder
├── state/              # Agent status tracking (idle/working/errored)
├── audit/              # Invocation logging (tokens, duration, summaries)
├── memory/             # Vector + FTS5 semantic search
├── orchestrator/       # PID file, crash recovery
├── events/             # EventBus (typed event emitter)
├── approvals/          # Approval workflow
└── validation/         # hive doctor health checks

packages/
└── dashboard/          # React + Express web UI with SSE
    ├── src/server/     # Express API, SSE manager
    └── src/client/     # React SPA (Vite)
```

## Data Flow: Message → Agent Invocation

1. Message posted to chat (CLI or agent subprocess)
2. Daemon signaled (100ms debounce) OR periodic tick fires
3. Lane enqueues checkWork for target agent
4. CheckWork reads unread messages from chat
5. Stage 1: Deterministic scoring (authority, urgency, recency, mention)
6. Stage 2: LLM triage via haiku → ACT_NOW / QUEUE / NOTE / IGNORE
7. NOTE/QUEUE → append to agent's daily memory file, mark read
8. ACT_NOW → assemble prompt, enrich with memory search, spawn Claude CLI
9. Agent responds with ACTION tag + optional FOLLOWUP tags
10. Followups registered in scheduler for automatic tracking
11. All messages marked read (crash-safe: memory written first)
