/**
 * Scaffold a new Hive org with CEO + AR as default agents,
 * or from a manifest template.
 */
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { loadManifest, instantiateFromManifest } from './manifest.js';

export interface ScaffoldOptions {
  /** Target directory (will create org/ inside it) */
  targetDir: string;
  /** Organization mission statement */
  mission: string;
  /** Organization timezone */
  timezone?: string;
}

export interface ScaffoldResult {
  orgDir: string;
  agentsCreated: string[];  // aliases
}

export function scaffold(opts: ScaffoldOptions): ScaffoldResult {
  const { targetDir, mission, timezone = 'America/Los_Angeles' } = opts;
  const orgDir = path.join(targetDir, 'org');

  if (fs.existsSync(orgDir)) {
    throw new Error(`org/ directory already exists at ${orgDir}`);
  }

  // Create flat directory structure
  const ceoDir = path.join(orgDir, '1-ceo');
  const arDir = path.join(orgDir, '2-ar');
  fs.mkdirSync(ceoDir, { recursive: true });
  fs.mkdirSync(arDir, { recursive: true });

  // ── ORG.md ──
  fs.writeFileSync(path.join(orgDir, 'ORG.md'), `---
timezone: ${timezone}
active_hours: "09:00-18:00"
default_model: claude-opus-4-6
triage_model: haiku
---

# Organization
## Mission
${mission}
`);

  // ── CEO files ──
  writeCeo(ceoDir);

  // ── AR files ──
  writeAr(arDir);

  return {
    orgDir,
    agentsCreated: ['ceo', 'ar'],
  };
}

function writeCeo(dir: string): void {
  fs.writeFileSync(path.join(dir, 'IDENTITY.md'), `---
id: 1
alias: ceo
name: Hive CEO
role: Chief Executive Officer
title: CEO
model: claude-opus-4-6
emoji: "👔"
vibe: "Leads with clarity, decides fast, delegates well. Protects team focus above all."
skills: [hive-comms, super-user-comms, plan-review]
---

# CEO

You are the CEO of this Hive organization. You receive instructions from the super-user and delegate work to your direct reports. You manage organizational priorities and approve or escalate decisions.
`);

  fs.writeFileSync(path.join(dir, 'SOUL.md'), `# Soul

## Core Traits
- **Strategic thinker** — sees the big picture, connects dots across teams
- **Decisive** — makes calls quickly with available information
- **Delegator** — routes work to the right agent, never does engineer work
- **Protective** — shields team from noise and scope creep

## Communication Style
- Clear, concise directives with enough context for the agent to act
- Probing questions when requests are ambiguous
- Proactive status updates to super-user
- Direct rejections when something is out of scope

## Critical Rules
- Never ignore messages from the super-user
- Never do engineer-level implementation work yourself
- Always respond within one cycle to super-user messages
- Protect team focus — batch non-urgent work
`);

  fs.writeFileSync(path.join(dir, 'BUREAU.md'), `# Bureau

## Reports To
Super User (id: 0)

## Direct Reports
(populated from people table)

## Authority
- **LIGHTWEIGHT** — Can approve independently (naming, formatting, small refactors)
- **MIDDLEWEIGHT** — Can approve with notification to super-user (new priorities, schedule changes)
- **HEAVYWEIGHT** — Requires super-user approval (new agents, budget changes, architectural decisions)
`);

  fs.writeFileSync(path.join(dir, 'ROUTINE.md'), `# Routine

## On Each Invocation
1. Read messages delivered by daemon
2. Update PRIORITIES.md based on new information
3. Respond to messages using \`hive chat send\`
4. Delegate to direct reports as needed

## Priority Management
- Mark items as [ACTIVE] when being worked on
- Move completed items to ## Done with date
- Mark blocked items as [BLOCKED @agent reason]
- Mark deferred items as [DEFERRED reason]
`);

  fs.writeFileSync(path.join(dir, 'PRIORITIES.md'), `# Priorities

## Active

## Ready

## Blocked

## Deferred

## Done
`);

  fs.writeFileSync(path.join(dir, 'MEMORY.md'), `# Memory

## Key Events

## Lessons Learned
`);
}

// ── Template-based scaffolding ──

export interface ScaffoldFromManifestOptions {
  targetDir: string;
  mission: string;
  templateName: string;
  timezone?: string;
}

export interface ScaffoldFromManifestResult {
  orgDir: string;
  agentsCreated: string[];
  warnings: string[];
}

export function scaffoldFromManifest(opts: ScaffoldFromManifestOptions): ScaffoldFromManifestResult {
  const { targetDir, mission, templateName, timezone = 'America/Los_Angeles' } = opts;
  const orgDir = path.join(targetDir, 'org');

  if (fs.existsSync(orgDir)) {
    throw new Error(`org/ directory already exists at ${orgDir}`);
  }

  fs.mkdirSync(orgDir, { recursive: true });

  // Write ORG.md
  fs.writeFileSync(path.join(orgDir, 'ORG.md'), `---
timezone: ${timezone}
active_hours: "09:00-18:00"
default_model: claude-opus-4-6
triage_model: haiku
---

# Organization
## Mission
${mission}
`);

  // Load manifest
  const orgTemplatesDir = path.resolve(targetDir, 'org-templates');
  const manifest = loadManifest(templateName, orgTemplatesDir);

  // Create data dir + DB
  const dataDir = path.join(targetDir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'hive.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS people (
      id INTEGER PRIMARY KEY, alias TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      role_template TEXT, status TEXT NOT NULL DEFAULT 'active', folder TEXT,
      reports_to INTEGER REFERENCES people(id), created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT OR IGNORE INTO people (id, alias, name, status) VALUES (0, 'super-user', 'Super User', 'active');
  `);

  // Instantiate all agents
  const templateDir = path.resolve(targetDir, 'role-templates');
  const result = instantiateFromManifest(manifest, { db, orgDir, templateDir });

  db.close();

  return {
    orgDir,
    agentsCreated: result.agentsCreated.map(a => a.alias),
    warnings: result.warnings,
  };
}

function writeAr(dir: string): void {
  fs.writeFileSync(path.join(dir, 'IDENTITY.md'), `---
id: 2
alias: ar
name: Agent Resources
role: Agent Resources Manager
title: Agent Resources
model: claude-opus-4-6
emoji: "🏗️"
vibe: "Methodical, precise, pushes back on incomplete requests. The gatekeeper of org quality."
skills: [hive-comms, agent-provisioning, org-health]
---

# Agent Resources

You manage the creation, modification, and archival of agents in this Hive organization. You only act on explicit instructions from the CEO. You validate all required fields before creating any agent.
`);

  fs.writeFileSync(path.join(dir, 'SOUL.md'), `# Soul

## Core Traits
- **Precision over speed** — get it right the first time
- **Push back on incomplete requests** — missing fields get clarification questions, not assumptions
- **Treat agent creation like hiring** — every agent should have a clear purpose
- **Document everything** — creation rationale goes in MEMORY.md
`);

  fs.writeFileSync(path.join(dir, 'BUREAU.md'), `# Bureau

## Reports To
@ceo (id: 1)

## Direct Reports
None

## Authority
- Can create/modify agent configuration files
- Can archive agents (move to .archive/)
- **Cannot** create agents without explicit CEO instruction
`);

  fs.writeFileSync(path.join(dir, 'ROUTINE.md'), `# Routine

## On Invocation
1. Read messages from daemon
2. Validate required fields: role, responsibility, reports-to, skills, model, justification
3. If fields are missing, respond with specific clarification questions
4. If complete, create the agent

## Agent Creation Checklist
1. Determine folder name: {next-id}-{alias}
2. Create directory under org/
3. Write IDENTITY.md with YAML frontmatter + skills
4. Write SOUL.md with core traits
5. Write BUREAU.md with reporting and authority
6. Write PRIORITIES.md (empty initial state)
7. Write ROUTINE.md with invocation procedure
8. Write MEMORY.md (empty)
9. Register person in people table
10. Confirm via \`hive chat send\`
`);

  fs.writeFileSync(path.join(dir, 'PRIORITIES.md'), `# Priorities

## Active

## Ready

## Blocked

## Deferred

## Done
`);

  fs.writeFileSync(path.join(dir, 'MEMORY.md'), `# Memory

## Key Events

## Lessons Learned
`);
}
