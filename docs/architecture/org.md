# Org Model

## Directory Structure

Agents live in flat folders under `org/`:

```
org/
├── PROTOCOLS.md              # Shared org-wide rules (all agents see this)
├── 1-ceo/                    # {personId}-{alias}/
│   ├── IDENTITY.md           # Frontmatter metadata + prose intro
│   ├── SOUL.md               # Personality, values, behavioral guidelines
│   ├── BUREAU.md             # Org position context (auto-generated)
│   ├── PRIORITIES.md         # Current priorities and focus areas
│   ├── ROUTINE.md            # Scheduled behaviors
│   ├── MEMORY.md             # Curated long-term notes (agent-editable)
│   ├── memory/               # Daily logs (auto-appended)
│   │   └── 2026-03-28.md
│   ├── role-skills/          # Skills from role template
│   │   └── delegation/SKILL.md
│   └── .claude/skills/       # Skills loaded by Claude CLI
│       └── delegation/SKILL.md
├── 2-eng-mgr/
├── 3-dev/
└── ...
```

Folder naming convention: `{id}-{alias}` (e.g., `1-ceo`, `3-dev`).

## People Table (hive.db)

Source of truth for hierarchy. Directory nesting is flat — hierarchy is defined by `reportsTo`.

```sql
CREATE TABLE people (
  id       INTEGER PRIMARY KEY,
  alias    TEXT UNIQUE NOT NULL,
  name     TEXT NOT NULL,
  roleTemplate TEXT,         -- e.g. "ceo", "manager", "swe", "qa"
  status   TEXT DEFAULT 'active',
  folder   TEXT NOT NULL,    -- relative path under org/
  reportsTo INTEGER REFERENCES people(id),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

Person ID 0 is reserved for the super-user (human operator).

## Identity Files

**IDENTITY.md** — YAML frontmatter + prose:
```yaml
---
id: 4
alias: alice
name: Alice
role: Engineering Manager
roleTemplate: manager
model: claude-opus-4-6
emoji: 🔧
vibe: pragmatic, detail-oriented
skills: [hive-comms, git-workflow, delegation]
---
Alice is the engineering manager for the frontend team...
```

**SOUL.md** — Behavioral guidelines, delegation rules, org boundaries.

**BUREAU.md** — Auto-generated org context: who reports to whom, team composition.

**PRIORITIES.md** — Current focus areas, board-level objectives.

**ROUTINE.md** — Scheduled behaviors (e.g., daily standup synthesis).

## Role Templates

Templates live in `role-templates/{template}/` and are copied during provisioning:

```
role-templates/
├── ceo/
│   ├── SOUL.md
│   └── role-skills/delegation/SKILL.md
├── manager/
│   ├── SOUL.md
│   └── role-skills/delegation/SKILL.md
├── swe/
│   └── SOUL.md
└── qa/
    └── SOUL.md
```

## Provisioning Flow

`hive agent create --alias bob --name Bob --template swe --reports-to alice`

1. Validate alias uniqueness, template exists, manager exists
2. Assign next person ID from DB
3. Create `org/{id}-{alias}/` folder
4. Copy template files, inject IDENTITY frontmatter
5. Insert into people table
6. Signal daemon for hot-reload

## Org Boundary Rules

- **CEO**: Delegates to direct reports only. Never skip-level assigns.
- **Managers**: Delegate to their direct reports. Never do IC work themselves.
- **ICs**: Execute work, report back to manager, request peer reviews.
