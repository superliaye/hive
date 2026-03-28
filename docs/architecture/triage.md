# Triage

## Overview

Two-stage pipeline that classifies incoming messages before deciding whether to invoke an agent. Stage 1 is free (deterministic). Stage 2 uses a cheap LLM (haiku). Stage 3 (full agent invocation) only fires for ACT_NOW messages.

## Stage 1: Deterministic Scoring (src/gateway/)

Each message gets a composite score from 0-10:

| Component | Weight | Logic |
|-----------|--------|-------|
| Authority | 0.25 | Super-user=10, Manager=10, Direct report=3, Peer=5, Unknown=1 |
| Urgency | 0.25 | `metadata.urgent`=10, else 0 |
| Conversation | 0.20 | DM=8, Group=5 |
| Recency | 0.15 | Linear decay over 24h (0h=10, 24h=0) |
| Mention | 0.15 | @agent in mentions=10, else 0 |

Formula: `score = Σ(component × weight)`, clamped to [0, 10].

Scored messages are passed to Stage 2 sorted by score descending.

## Stage 2: LLM Triage (haiku)

Classifies each message into one of four buckets:

| Classification | Meaning | What happens |
|---------------|---------|--------------|
| **ACT_NOW** | Immediate attention required | Spawn full agent (Stage 3) |
| **QUEUE** | Important but not urgent | Append to memory, mark read |
| **NOTE** | Informational only | Append to memory, mark read |
| **IGNORE** | Not relevant | Mark read, drop |

**ACT_NOW triggers**:
- Direct requests from manager
- Urgent incidents or blocking issues
- Direct @mentions with questions
- Super-user messages (override — always ACT_NOW regardless of LLM output)

**Timeout**: 5 minutes. On LLM failure, all messages default to QUEUE (safe fallback).

**Output format**:
```json
{
  "results": [
    { "messageId": "dm:1:4:2", "classification": "ACT_NOW", "reasoning": "..." }
  ]
}
```

## Stage 3: Agent Invocation

Only fires when there's at least one ACT_NOW message. See [daemon.md](daemon.md) for the full checkWork cycle.

The agent receives all ACT_NOW messages as work input, along with relevant memory context from semantic search.
