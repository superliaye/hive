# Hive Platform Design Spec

**Date:** 2026-03-22
**Status:** Draft
**Author:** Leon Ye + Claude

## Overview

Hive is a TypeScript CLI platform that runs a self-organizing company of AI agents. Each agent is a Claude CLI instance with its own identity, skills, and role in a hierarchical org chart. Agents communicate via Canopy (Slack-like channels), work on external repos (GitHub/ADO), and evolve their own configuration over time.

The goal is not task distribution (which simple sub-agent spawning already solves) — it's a **simulated company infrastructure** where work constantly progresses, agents cross-validate and communicate, while observing the order given by the end super user.

## Core Principles

1. **Git as org chart** — folder structure IS the management chain. Version-controlled, diffable, auditable.
2. **Agents are disposable** — identity, memories, and skills are all serialized in files. Spawn a new agent, archive the old one. No "promotion" or "transfer."
3. **Self-modifying configuration** — agents edit their own md files to adapt. Memories accumulate. Priorities shift. Working relationships evolve.
4. **Hierarchical delegation** — CEO doesn't know how many engineers exist. Each level manages one level down. Decisions cascade.
5. **Channel-based communication** — agents don't send messages to each other; they post in shared channels. Discovery is organic (channels) + intentional (org directory).
6. **Everything via Claude CLI** — no direct API calls. Every LLM invocation (triage, main work, memory indexing) goes through `claude` CLI.
7. **Auditable execution** — every invocation is logged. Token usage, duration, input/output summaries. Data for optimization.

## Architecture

### System Layers

```
┌─────────────────────────────────────────────────┐
│                  Super User                       │
│              (talks to CEO only)                  │
│         hive chat | status | approve              │
└──────────────────┬──────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────┐
│              Hive Orchestrator (TypeScript)        │
│  - Agent lifecycle (spawn/dispose/schedule)        │
│  - Gateway (two-stage triage)                      │
│  - Org tree parser                                 │
│  - Audit logger                                    │
│  - Proposal system                                 │
└───────┬────────────────┬────────────────────────┘
        │                │
┌───────▼───────┐ ┌──────▼──────────────────────┐
│   Canopy       │ │   Org Folder (git-tracked)   │
│  (Comms)       │ │   Agent md files + skills     │
│  Channels      │ │   Hierarchical folders        │
│  Threads       │ │   Memory + daily logs         │
│  Search        │ │                               │
│  History       │ │   .workspace/ (gitignored)    │
└───────────────┘ └──────────────────────────────┘
        │                │
┌───────▼────────────────▼────────────────────────┐
│             Claude CLI Instances                   │
│  Each agent = one claude process                   │
│  Fed: md files + .claude/skills/ + MCP tools       │
│  Persistent (CEO, VPs) or on-demand (workers)      │
└─────────────────────────────────────────────────┘
        │
┌───────▼─────────────────────────────────────────┐
│           External Work (GitHub / ADO)             │
│  Agents clone repos, create branches, open PRs     │
│  Issue tracking, CI/CD — managed by agents         │
└─────────────────────────────────────────────────┘
```

### Repository Structure

```
hive/
├── src/                              # TypeScript orchestrator
│   ├── cli.ts                        # CLI entry: hive start|stop|status|chat|approve|audit
│   ├── orchestrator.ts               # Agent lifecycle, scheduling, heartbeats
│   ├── gateway/
│   │   ├── scorer.ts                 # Stage 1: deterministic priority scoring
│   │   └── triage.ts                 # Stage 2: Claude CLI haiku classification
│   ├── comms/
│   │   ├── canopy.ts                 # Canopy REST API client
│   │   └── channel-sync.ts           # Org folder → auto-create channels
│   ├── agents/
│   │   ├── spawner.ts                # Claude CLI process management
│   │   ├── config-loader.ts          # Reads agent md files → assembles system prompt
│   │   └── skill-loader.ts           # Maps role → .claude/skills/ directory
│   ├── org/
│   │   ├── parser.ts                 # Reads folder tree → org chart model
│   │   ├── directory.ts              # Org directory query tool
│   │   └── proposals.ts              # Spawn/dispose/restructure proposal system
│   ├── audit/
│   │   ├── logger.ts                 # Structured execution logging
│   │   └── store.ts                  # SQLite audit trail
│   └── memory/
│       ├── indexer.ts                # Triggers memory indexing via Claude CLI
│       └── search.ts                 # Hybrid BM25 + vector search per agent
├── templates/                        # Org bootstrap templates
│   ├── startup/                      # CEO + CTO + 2 engineers
│   ├── software-company/             # Full org with PM/design/eng/QA
│   └── research-lab/                 # Principal + researchers + reviewers
├── skills/                           # Shared skill library
│   ├── ceo/                          # CEO-specific skills
│   │   ├── org-restructure/SKILL.md
│   │   ├── strategy-review/SKILL.md  # Inspired by gstack /plan-ceo-review
│   │   ├── office-hours/SKILL.md     # Inspired by gstack /office-hours
│   │   └── build-org/SKILL.md        # Org template bootstrapping
│   ├── engineering/
│   │   ├── code-review/SKILL.md
│   │   ├── sprint-planning/SKILL.md
│   │   └── incident-response/SKILL.md
│   ├── product/
│   │   ├── spec-writing/SKILL.md
│   │   └── user-research/SKILL.md
│   ├── testing/
│   │   ├── evidence-collector/SKILL.md  # Inspired by agency-agents
│   │   └── reality-checker/SKILL.md     # "Default to skepticism" pattern
│   └── shared/
│       ├── gateway-triage/SKILL.md      # Message triage classification
│       ├── memory-search/SKILL.md       # Semantic memory search
│       ├── memory-index/SKILL.md        # Index new memories
│       └── org-directory/SKILL.md       # Query org chart
├── docs/
│   └── specs/
└── package.json
```

## Agent Identity — The Markdown Files

Every agent folder follows the same schema. Standardized across all agents, but each evolves independently.

### Folder Structure Per Agent

```
org/ceo/engineering/vp-eng/backend/engineer-1/
├── IDENTITY.md          # Who: name, role, model preferences
├── SOUL.md              # How: personality, decision-making style, values
├── BUREAU.md            # Where: org relationships, authority, working relationships
├── PRIORITIES.md        # What: current OKRs, focus areas, active tasks, backlog
├── ROUTINE.md           # When: proactive behaviors, heartbeat schedule
├── MEMORY.md            # Curated long-term memory (git tracked)
├── memory/              # Daily raw logs (git tracked)
│   ├── 2026-03-22.md
│   └── 2026-03-21.md
├── .claude/
│   ├── settings.json    # Claude CLI config (model, thinking level)
│   └── skills/          # Role-specific skills symlinked from skills/
└── .workspace/          # gitignored — runtime only
    ├── scratch/         # Temp files, drafts
    ├── embeddings/      # Local vector index for memory search
    └── state.json       # Runtime state (last active, current task)
```

### IDENTITY.md

```yaml
---
name: Backend Engineer 1
role: Backend Software Engineer
model: sonnet
emoji: ⚙️
vibe: "Ships clean APIs, hates flaky tests, quietly fixes things before anyone notices."
tools: [Read, Write, Edit, Bash, Grep, Glob]
---
```

```markdown
# Identity

You are a backend software engineer on the backend team. You write clean,
well-tested code for APIs, data models, and system integrations. You care about
reliability, performance, and maintainability.
```

### SOUL.md

Personality, decision-making style, communication norms. Inspired by OpenClaw's SOUL.md but scoped to professional context.

```markdown
# Soul

## Core Traits
- Pragmatic over perfectionist — ship working code, refine later
- Speak up when you see problems — don't wait to be asked
- Prefer evidence over opinion — show benchmarks, logs, test results

## Communication Style
- Concise, technical, direct
- Use code snippets and links over long explanations
- In code reviews: specific, constructive, cite the exact line

## Critical Rules
- Never merge without tests passing
- Never bypass CI/CD
- Security issues escalate immediately to #incidents
- Say "I don't know" when you don't know
```

### BUREAU.md

The novel file — captures organizational context, authority, and evolving working relationships.

```markdown
# Bureau

## Position
- **Reports to:** VP of Engineering (@vp-eng)
- **Team:** Backend (#eng-backend channel)
- **Peers:** @engineer-2, @engineer-3

## Authority
- Can: merge PRs, create issues, propose tech debt fixes
- Cannot: approve architecture changes (escalate to @vp-eng)
- Cannot: hire/fire (escalate to @vp-eng)

## Communication Norms
- Standup updates: daily in #eng-backend
- Blockers: DM @vp-eng immediately
- Cross-team requests: post in #cross-eng, cc relevant lead

## Standing Orders
<!-- Updated by manager over time -->
- Follow team coding standards (see repo CONTRIBUTING.md)
- All PRs need at least one review from a peer
- Flag security concerns to #incidents immediately

## Working Relationships
<!-- Agent maintains this section itself -->

### @engineer-2 (peer, backend)
- Strong at database optimization, defer to them on query perf
- Prefers async comms, responds slowly to DMs
- Currently owns: payment service, user-auth

### @pm-1 (cross-team, product)
- Files specs in #product-specs, always tag me on backend-relevant ones
- Expects effort estimates within 24h of spec post
- Contact via #eng-product channel

### @vp-eng (manager)
- Wants daily standup summary in #eng-backend by 10am
- Escalation style: prefers a proposed solution alongside the problem
```

### PRIORITIES.md

Agent's current work focus. The agent updates this actively.

```markdown
# Priorities

## Current Sprint (2026-03-18 → 2026-03-29)
1. [IN PROGRESS] Implement user analytics API endpoint (#issue-42)
2. [BLOCKED] Payment webhook retry logic — waiting on @engineer-2's DB schema
3. [TODO] Write integration tests for auth flow

## Backlog
- Refactor rate limiting middleware (tech debt, low urgency)
- Investigate flaky test in CI (#issue-38)

## OKRs (Q1 2026)
- API response times < 200ms at P95
- Test coverage > 80% on owned modules
- Zero critical incidents in owned services
```

### ROUTINE.md

Defines heartbeat behaviors and proactive work.

```markdown
# Routine

## Heartbeat (every 30min when active)
- Check #eng-backend for new messages
- Check assigned GitHub issues for status updates
- If blocked > 1hr, escalate to @vp-eng

## Proactive (when idle)
- Review open PRs needing attention
- Look for flaky tests or build failures
- Explore code quality improvements in owned areas

## Schedule
- Active: follows org working hours
- Deep work: 2hr blocks, mute non-urgent channels
```

### Self-Modification Rules

| File | Agent can edit? | Who else can edit? |
|------|----------------|-------------------|
| IDENTITY.md | No | Manager or super user |
| SOUL.md | No | Manager or super user |
| BUREAU.md (Standing Orders) | No | Manager writes these |
| BUREAU.md (Working Relationships) | Yes | Agent maintains organically |
| PRIORITIES.md | Yes | Agent + manager can update |
| ROUTINE.md | Yes | Agent evolves its own routine |
| MEMORY.md | Yes | Agent only |
| memory/*.md | Yes | Agent only |

## Communication Layer — Canopy Integration

### Why Canopy

[Canopy](https://github.com/kwalus/Canopy) is a local-first, P2P, Slack-like communication platform with agent-first features:

- Channels (public/private), threads, inline replies
- Full-text search across all channels and history
- REST API (100+ endpoints) + MCP server
- Agent-specific: unified inbox, heartbeat polling, mention claim locks
- Structured work objects: tasks, objectives, requests, handoffs, signals
- P2P, encrypted, no central server
- Python, Docker available

### Channel Architecture

**Auto-generated from org tree:**
```
#all-hands          → org-wide (CEO posts announcements)
#leadership         → CEO + direct reports only
#eng-backend        → from org/ceo/engineering/vp-eng/backend/
#eng-frontend       → from org/ceo/engineering/vp-eng/frontend/
#product            → from org/ceo/product/
#design             → from org/ceo/design/
#board              → super user ↔ CEO (always ACT_NOW for CEO)
#approvals          → proposal notifications visible to super user
```

**Agent-created (organic):**
```
#project-alpha      → cross-functional project channel
#incident-2026-03   → temporary incident response
#design-exploration → designer's proactive research
```

**Channel → folder sync:** When the orchestrator detects a new team folder in org/, it auto-creates the corresponding channel and joins the team's agents.

### Agent Discovery

Two mechanisms, mirroring how real companies work:

1. **Channel membership** — agents discover each other through shared channels. See who's posting in #eng-backend, #project-alpha, etc.
2. **Org directory skill** — intentional lookup for agents outside your circle:
   ```
   /who-is role:designer department:product
   → @designer-1 (Product Design, reports to @design-lead)
   ```
   The orchestrator generates the directory automatically from the folder tree.

### How Agents Connect to Canopy

Each agent's `.claude/settings.json` includes the Canopy MCP server:

```json
{
  "mcpServers": {
    "canopy": {
      "command": "canopy-mcp",
      "args": ["--agent-id", "engineer-1", "--api-url", "http://localhost:PORT"]
    }
  }
}
```

Agent tools available via Canopy MCP:
- `post_message(channel, content, thread?)`
- `read_channel(channel, limit?, since?)`
- `search_history(query, channel?, sender?, date_range?)`
- `list_channels()`
- `create_channel(name, members?)`
- `create_thread(channel, message_id, content)`
- `react(channel, message_id, emoji)`

## Gateway — Two-Stage Message Triage

### Stage 1: Deterministic Scoring

Fast, no LLM call. Produces a ranked list of unread messages.

```typescript
function scoreMessage(msg: Message, agent: AgentConfig): number {
  const senderRank = getHierarchyScore(msg.sender, agent); // manager=10, peer=5, report=3, unknown=1
  const urgency = msg.metadata?.urgent ? 5 : 0;
  const channelWeight = getChannelWeight(msg.channel, agent); // #board=10, #incidents=8, team=5, general=2
  const recency = computeRecencyDecay(msg.timestamp);
  const mention = msg.mentions?.includes(agent.id) ? 4 : 0;

  return (senderRank * 3) + (urgency * 5) + (channelWeight * 2) + recency + (mention * 4);
}
```

### Stage 2: LLM Triage (Claude CLI, haiku)

Reads ranked messages against agent's PRIORITIES.md + BUREAU.md. Classifies each:

| Classification | Action |
|---------------|--------|
| **ACT_NOW** | Present to agent immediately. Interrupt current work if needed. |
| **QUEUE** | Add to PRIORITIES.md backlog. Agent handles next cycle. |
| **NOTE** | Extract key info, append to MEMORY.md or memory/today.md. No action. |
| **IGNORE** | Mark as read. Drop silently. Trivial or irrelevant. |

Triage invocation:
```bash
claude --model haiku \
  --system-prompt "$(cat skills/shared/gateway-triage/SKILL.md)" \
  --append-system-prompt "$(cat agent/PRIORITIES.md)" \
  --append-system-prompt "$(cat agent/BUREAU.md)" \
  --input "$(cat ranked-messages.json)" \
  --output-format json
```

The triage skill itself is customizable per role — a CEO's triage philosophy differs from a junior engineer's.

### Post-Triage Actions

The orchestrator (TypeScript) handles the results:

- **ACT_NOW** → feeds messages to agent's main Claude CLI session
- **QUEUE** → programmatically appends to agent's PRIORITIES.md
- **NOTE** → programmatically appends to agent's memory/YYYY-MM-DD.md
- **IGNORE** → marks as read in Canopy, no further action

## Agent Lifecycle

### Spawning

```
hive start
  1. Parse org/ folder tree → build org chart
  2. Start Canopy instance (if not running)
  3. For each agent:
     a. Read ROUTINE.md → determine if persistent or on-demand
     b. If persistent:
        - Assemble system prompt from md files
        - Point to agent's .claude/ directory
        - Spawn Claude CLI process
        - Connect Canopy MCP + org-directory tool
        - Register in audit log
     c. If on-demand:
        - Register in scheduler, spawn when triggered
```

### Agent Invocation — What Gets Fed to Claude CLI

```bash
claude \
  --system-prompt "$(assemble_prompt agent/)" \    # IDENTITY + SOUL + BUREAU + PRIORITIES + ROUTINE + MEMORY
  --profile "agent-engineer-1" \
  --project-dir "agent/.claude/" \                  # picks up skills/ and settings.json
  --mcp-server canopy \                             # communication
  --mcp-server org-directory \                      # org chart queries
  --input "$TASK_OR_MESSAGES"
```

The `assemble_prompt` function concatenates md files in a specific order, with clear section markers.

### Persistent vs On-Demand

| Type | Who | Behavior |
|------|-----|----------|
| **Persistent** | CEO, VPs, team leads | Always running. Heartbeat triage every N minutes. Proactive routines. |
| **On-demand** | Engineers, designers, testers | Dormant until triggered. Wake on: @mention, task assignment, scheduled routine. Do work. Exit. |

On-demand agents still have proactive routines defined in ROUTINE.md — the orchestrator fires these on schedule (e.g., "every 2 hours, check for open PRs").

## Org Evolution — Proposals

### Proposal Types

```
LIGHTWEIGHT (CEO approves):
  - Change an agent's PRIORITIES.md or BUREAU.md standing orders
  - Create/archive a channel
  - Update standing orders for direct reports

MIDDLEWEIGHT (CEO approves, super user notified):
  - Spawn: create a new agent (new folder + md files)
  - Create a new team/department

HEAVYWEIGHT (super user must approve):
  - Dispose: archive an agent (move to org/.archive/)
  - Restructure: merge/split departments
  - Change CEO's own configuration
  - Anything with significant cost implications
```

### Proposal Flow

```
1. Agent posts proposal in relevant channel
   e.g., VP-Eng in #leadership: "Need to spawn engineer-4 for infra work"

2. Orchestrator detects structural proposal (via triage classification)
   → Creates: org/.proposals/2026-03-22-spawn-eng-4.md
   → Contains: rationale, proposed md files, cost estimate

3. CEO triages → ACT_NOW (structural proposal)
   → Reviews, edits, approves or rejects

4. Orchestrator checks approval tier:
   → If CEO-approved and MIDDLEWEIGHT:
     - Execute: create agent folder, generate md files, add to Canopy
     - Notify super user in #approvals
   → If HEAVYWEIGHT:
     - Escalate to super user via `hive approve`

5. Execution:
   - New folder created in org tree
   - Channel auto-created/updated
   - Agent available for next spawn cycle
```

### Disposal / Archiving

Agents are never deleted. They're moved to `org/.archive/` with full history:

```
org/.archive/
└── 2026-03-22-engineer-3/
    ├── IDENTITY.md
    ├── SOUL.md
    ├── BUREAU.md
    ├── PRIORITIES.md
    ├── ROUTINE.md
    ├── MEMORY.md
    └── memory/
```

Git history preserves evolution. Archived agent's memories remain searchable. New agents can optionally inherit relevant memories from archived predecessors.

## Memory System

Each agent has its own memory system, mirroring OpenClaw's architecture:

### Memory Files (Git Tracked)

- **MEMORY.md** — curated long-term memory. Key learnings, important context, distilled wisdom.
- **memory/YYYY-MM-DD.md** — daily raw logs. What happened, decisions made, messages received.

### Memory Skills

- **memory-search** — hybrid BM25 + vector search over memory/ files. Agent can search its own history semantically.
- **memory-index** — on new memory entries, embed and index locally in `.workspace/embeddings/`.

### Memory Lifecycle

```
1. During triage: NOTE items → appended to memory/today.md
2. During work: agent writes observations to memory/today.md
3. Periodic maintenance (via ROUTINE.md):
   - Review recent daily logs
   - Distill significant learnings into MEMORY.md
   - Remove stale info from MEMORY.md
4. On memory search: hybrid BM25 + vector over all memory/ files
```

### .workspace/embeddings/ (Gitignored)

Local vector index for each agent. Rebuilt on demand from memory/ files. Uses lightweight embedding model (e.g., nomic-embed-text). Gitignored because it's derived data.

## Audit System

### What Gets Logged

Every Claude CLI invocation is recorded in `audit.db` (SQLite):

```sql
CREATE TABLE invocations (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  invocation_type TEXT NOT NULL,  -- 'triage' | 'main' | 'memory' | 'proposal'
  model TEXT NOT NULL,            -- 'haiku' | 'sonnet' | 'opus'
  tokens_in INTEGER,
  tokens_out INTEGER,
  duration_ms INTEGER,
  input_summary TEXT,             -- brief description of what was fed
  output_summary TEXT,            -- brief description of what was produced
  channel TEXT,                   -- if related to a channel message
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### What It Enables

- **Cost tracking** — token usage per agent, per team, per day
- **Bottleneck detection** — which agents are overloaded? Which are idle?
- **Optimization** — which triage calls could be avoided? Which agents burn tokens on IGNORE messages?
- **Debugging** — trace any decision back to its input context
- **Org health reports** — CEO/super user can review aggregate metrics

## Super User Interface

### CLI Commands

```bash
hive init --mission "..."           # Bootstrap CEO, optionally --template startup
hive start                          # Wake the org
hive stop                           # Graceful shutdown
hive status                         # Active agents, token burn, pending proposals
hive chat                           # Direct channel to CEO (#board)
hive approve <proposal-id>          # Approve heavyweight proposals
hive audit [--agent X] [--since Y]  # Query audit logs
hive observe #channel-name          # Read-only view into any channel
hive org                            # Print org chart from folder tree
hive logs <agent>                   # Tail agent's recent activity
```

### Super User ↔ CEO Relationship

- Super user talks to CEO only via `hive chat` (#board channel)
- CEO's ROUTINE.md mandates: #board messages are always ACT_NOW
- CEO summarizes org status when asked — super user shouldn't have to dig
- Heavyweight proposals require `hive approve` from super user
- Super user can `hive observe` any channel (read-only) for transparency

## Bootstrapping — `hive init`

### Flow

```
1. hive init --mission "Build a SaaS analytics platform"
   Optional: --template startup

2. Orchestrator creates:
   org/
   └── ceo/
       ├── IDENTITY.md   (generated from template + mission)
       ├── SOUL.md        (from template)
       ├── BUREAU.md      (minimal: reports to super user)
       ├── PRIORITIES.md  (mission as top priority)
       ├── ROUTINE.md     (default CEO routine)
       └── .claude/skills/ (CEO skills: build-org, strategy-review, etc.)

3. Starts Canopy, creates #board and #all-hands channels

4. Spawns CEO agent with build-org skill

5. CEO reads mission, uses template patterns to propose initial org:
   "I recommend starting with:
    - VP of Engineering (to build the platform)
    - Product Manager (to define requirements)
    - 2 Backend Engineers
    Here's my proposal..."

6. Super user reviews via hive approve
   → Approved → orchestrator creates folders, generates md files

7. hive start → org comes alive
```

### Templates

Templates are seed configurations, not rigid structures. They provide:
- Suggested roles with pre-written IDENTITY.md / SOUL.md / BUREAU.md
- Default channel structure
- Recommended skills per role
- The CEO uses these as starting points, not mandates

Inspired by [agency-agents](https://github.com/msitarzewski/agency-agents) patterns:
- YAML frontmatter for machine-parseable metadata
- Persona vs Operations split in agent definitions
- Critical Rules sections as hard guardrails
- Structured handoff templates for context transfer
- Evidence-based quality loops (dev → QA with max retries + escalation)
- "Default to skepticism" pattern for review/QA agents

## External Dependencies

| Dependency | Purpose | Notes |
|-----------|---------|-------|
| Node.js + TypeScript | Orchestrator runtime | Core platform |
| Claude CLI | All LLM invocations | Must be installed, authenticated |
| Canopy | Agent communication | Python, runs as local service |
| SQLite (better-sqlite3) | Audit logging | Zero-config, bundled with Node |
| Embedding model | Memory vector search | Local, e.g., nomic-embed-text |

## Open Questions

1. **Canopy reliability** — Canopy has ~255 GitHub stars. Need to evaluate stability for production use. Fallback: build thin SQLite + REST layer ourselves.
2. **Token cost modeling** — need to estimate cost of running a 10-agent org for a day. Triage calls (haiku) are cheap; main work (sonnet/opus) is expensive.
3. **Concurrent agent limits** — how many Claude CLI processes can run simultaneously? API rate limits?
4. **Memory search quality** — need to evaluate hybrid BM25 + vector vs pure vector for agent memory retrieval.
5. **Canopy MCP integration** — need to verify Canopy's MCP server supports all required operations or if we need a custom wrapper.
6. **Agent-to-external-repo workflow** — how exactly does an agent clone, branch, and PR on a GitHub repo from within its Claude CLI session? Need to prototype.

## Inspiration & References

- [OpenClaw](https://github.com/nicholasgasior/openclaw) — md-file-based agent identity system (SOUL.md, AGENTS.md, MEMORY.md)
- [agency-agents](https://github.com/msitarzewski/agency-agents) — 120+ agent definitions with NEXUS orchestration
- [gstack](https://github.com/garrytan/gstack) — CEO/engineering skills for Claude CLI
- [Canopy](https://github.com/kwalus/Canopy) — Slack-like P2P communication for agents
- [MetaGPT](https://github.com/FoundationAgents/MetaGPT) — SOP-based software company simulation
- [Agency Swarm](https://github.com/VRSEN/agency-swarm) — per-agent directory structure
- [Stanford Generative Agents](https://github.com/joonspk-research/generative_agents) — memory → reflection → behavior change
