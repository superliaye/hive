# Engineering/Product Org Template — Design

An org template for building software products. One human, N agents.

## Core Philosophy

> "In an agent company, the signals of scaling demand are **backlog** and **focus**."
>
> An idle agent costs nothing. A distracted agent costs quality.
> You don't scale to save cost. You scale to preserve focus.

## Key Decisions

### 1. Roles are templates, agents are instances

A role defines: model, tools, skills, soul, routine, bureau template.
An agent is an instantiation of a role with a unique ID, alias, and accumulated memory.
Scaling means instantiating more agents from a role template — not redesigning them.

### 2. Flat folders, structured org-state

Agent folders are flat (`001-ceo/`, `002-ar/`, `003-platform-eng/`).
Hierarchy lives in `org-state.db` (SQLite), not the filesystem.
A reorg updates a database row, not a directory tree.

### 3. Hierarchy for governance, lateral workflows for work

The reporting chain is for: escalation, strategy, approvals, scaling decisions.
Actual work flows laterally through defined workflows:
- bug-fix: PA finds → files issue → engineer fixes → QA verifies → PA closes
- feature: PM specs → engineer builds → QA tests → PM accepts
- incident: any agent escalates → engineer triages → fixes → post-mortem

Agents can communicate laterally with peers in the same team without manager approval.
Cross-team communication goes through the hierarchy.

### 4. Super-user interfaces with CEO and department heads

Super-user (the human) talks to CEO normally.
Can reach department heads directly when needed.
Never talks to ICs directly — that goes through the chain.

### 5. Dynamic scaling through distributed judgment

No central scaling controller. Instead:
- ICs signal constraints to their manager (backlog pressure, focus fragmentation)
- Managers aggregate signals and propose scaling to CEO
- CEO approves/denies based on strategy and budget
- AR executes: instantiates from role template, updates org-state, triggers events

### 6. New agents onboard themselves

No shadow period. Instead:
- AR creates the agent from a role template
- Agent's default top priority: "check org relationships, 1:1 with manager and all direct reports"
- Agent proactively requests context, instructions, knowledge transfer
- Agent updates its own md files and memory based on what it learns

### 7. Events, not notifications

Org changes append to each affected agent's `events.md` (programmatic).
Agents internalize events in their next routine cycle.
Events have timestamps and are machine-written.
Agents decide how to act on events (update BUREAU.md, adjust priorities, etc.).

### 8. Communication is DM-first

Directed messages use DM channels (`dm:<agent-id>`).
Team channels are for broadcasts only.
Comms happen via CLI: `hive post --channel dm:<agent-id> --as <your-id> "message"`.

## Org-State Schema

SQLite database at `org-state/org.db`:

```sql
CREATE TABLE employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alias TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role_template TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  folder TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE reporting (
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  manager_id INTEGER REFERENCES employees(id),
  effective_from DATETIME DEFAULT CURRENT_TIMESTAMP,
  effective_until DATETIME,
  PRIMARY KEY (employee_id, effective_from)
);

CREATE TABLE resourcing_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  employee_id INTEGER NOT NULL,
  details TEXT NOT NULL,
  initiated_by INTEGER,
  approved_by INTEGER,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

Key properties:
- `reporting` is temporal — full history of every reorg via `effective_from`/`effective_until`
- `employees.id` is monotonically increasing — never reused
- `employees.folder` maps to the flat directory name (e.g., `003-platform-eng`)
- Channels are derived from `reporting` table, managed by existing comms system

## Growth Stages

### Stage 1: Seed (2-3 agents)
- CEO (wears PM, engineering lead hats)
- Engineer (generalist)
- AR (handles future scaling)

### Stage 2: Team (5-8 agents)
- CEO sheds engineering to VP Engineering
- VP Engineering + 2-3 engineers
- QA Engineer
- AR

### Stage 3: Company (10-20 agents)
- CEO + PM + Designer
- VP Engineering + team leads + engineers
- QA team
- Product Analyst
- AR

### Stage 4: Enterprise (20+ agents)
- Multiple departments with dedicated heads
- Multiple instances per role
- Specialized roles (security, devops, tech writer)
- AR may need scaling itself

## Role Templates

Role templates live at the repository root: `/role-templates/`.
They are shared across all org templates. The bar for changing them is extremely high.

This org template uses: chief-executive, agent-resources, department-head, software-engineer, qa-engineer, product-manager, product-analyst, designer.

See `/role-templates/README.md` for the change policy.

## Events System

`events.md` in each agent's folder. Format:

```markdown
## Events

- [2026-03-23T22:00:00Z] ORG_CHANGE: New direct report added — 005-frontend-eng (Frontend Engineer). Check org-state for updated reporting chain.
- [2026-03-23T22:00:00Z] ROLE_CREATED: You have been instantiated from role template "software-engineer". Your first priority: 1:1 with your manager and all direct reports to establish context.
```

Events are appended programmatically by the framework (not by agents).
Agents read and internalize events during their routine cycle.
Old events can be cleaned up by the agent after internalization.
