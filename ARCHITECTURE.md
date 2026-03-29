# Hive Architecture

> **Single source of truth:** [docs/architecture/index.html](docs/architecture/index.html)
>
> Deployed at: https://superliaye.github.io/hive/

## What is Hive

A framework for running autonomous organizations of AI agents. Agents are Claude instances with identities, roles, skills, and memory. They communicate through chat, receive work through a triage gateway, and track commitments through a followup scheduler.

## Sections

| Section | Covers |
|---------|--------|
| System Overview | Hero diagram, key invariants, module map |
| Org & Collaboration | Hierarchy, delegation, scaling, provisioning |
| Context Bundle | Per-agent files and databases, prompt assembly |
| Agent Process | LLM core, CLI tools, response format |
| Hive Service | Express + Daemon, checkWork cycle, lanes, crash recovery |
| Triage Pipeline | Deterministic scoring + LLM classification |
| Followup System | FOLLOWUP tags, scheduler, backoff |
| Chat System | Messages, cursors, access control |
| Dashboard & SSE | Web UI, API endpoints, real-time events |
| Memory System | Semantic search, FTS5 + vec0 |
| Data Stores | SQLite databases and schemas |
| CLI Reference | All `hive` commands |
