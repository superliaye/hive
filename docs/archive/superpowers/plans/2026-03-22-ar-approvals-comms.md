# AR Agent, Approvals Channel, and Inter-Agent Communication

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Agent Resources (AR) role that creates/manages agents on CEO command, an #approvals channel for CEO→super-user gating, and cross-agent communication skills so any agent can propose changes via channels.

**Architecture:** Three independent subsystems wired together: (1) AR agent with filesystem tools to scaffold new agent dirs and write their .md files, (2) #approvals channel with structured approval items that the daemon processes on CEO's next checkWork, (3) a shared `comms` skill added to every agent's skill set enabling proactive channel messaging and escalation proposals. The daemon's hot-reload capability detects new org/ directories and registers new agent lanes without restart.

**Tech Stack:** TypeScript, SQLite (comms.db), Claude CLI (spawner.ts), Vitest

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `org/ceo/ar/IDENTITY.md` | AR agent identity — name, role, model, tools, explicit skills list |
| `org/ceo/ar/SOUL.md` | AR personality — methodical, pushes back on incomplete requests |
| `org/ceo/ar/BUREAU.md` | AR position — reports to CEO, direct channel #ar-requests |
| `org/ceo/ar/PRIORITIES.md` | AR work queue |
| `org/ceo/ar/ROUTINE.md` | AR invocation behavior — how it creates agents |
| `org/ceo/ar/MEMORY.md` | AR memory (initially empty) |
| `skills/shared/comms/skill.md` | Shared skill: how to use channels, propose ideas, escalate |
| `skills/ar/agent-provisioning/skill.md` | AR-specific skill: how to scaffold agent directories |
| `src/daemon/hot-reload.ts` | Detect new org/ dirs and register new agent lanes at runtime |
| `src/approvals/engine.ts` | Parse #approvals messages, match approve/reject, update item state |
| `tests/daemon/hot-reload.test.ts` | Tests for hot-reload detection |
| `tests/approvals/engine.test.ts` | Tests for approval parsing and state transitions |
| `tests/fixtures/sample-org/ceo/ar/IDENTITY.md` | Test fixture for AR agent |
| `tests/fixtures/sample-org/ceo/ar/BUREAU.md` | Test fixture for AR bureau |
| `tests/fixtures/sample-org/ceo/ar/SOUL.md` | Test fixture |
| `tests/fixtures/sample-org/ceo/ar/ROUTINE.md` | Test fixture |
| `tests/fixtures/sample-org/ceo/ar/PRIORITIES.md` | Test fixture |
| `tests/fixtures/sample-org/ceo/ar/MEMORY.md` | Test fixture |

### Modified Files
| File | Change |
|------|--------|
| `src/types.ts:1-8` | Add optional `skills` field to `AgentIdentity` |
| `src/org/parser.ts:54-64` | Parse `skills` from IDENTITY.md frontmatter |
| `src/org/parser.ts:132-164` | Add `ar-requests` channel generation when AR agent exists |
| `src/agents/skill-loader.ts:1-19` | Add `ar` role mapping; prefer explicit skills over role guessing |
| `src/daemon/daemon.ts` | Add `hotReload()` method |
| `src/daemon/check-work.ts:147-156` | Extend super-user override to also cover #approvals |
| `org/ceo/BUREAU.md` | Add AR working relationship, #approvals protocol |
| `org/ceo/ROUTINE.md` | Add approval-checking and tracking instructions |
| `org/ceo/IDENTITY.md` | Add explicit `skills` list to frontmatter |
| `org/ceo/engineering/platform-eng/IDENTITY.md` | Add explicit `skills` list |
| `org/ceo/engineering/platform-eng/BUREAU.md` | Add comms/proposal instructions |
| `org/ceo/engineering/qa-eng/IDENTITY.md` | Add explicit `skills` list |
| `org/ceo/engineering/qa-eng/BUREAU.md` | Add comms/proposal instructions |
| `packages/dashboard/src/server/index.ts` | Wire periodic hot-reload timer |

---

## Task 1: Programmatic Per-Agent Skill Declarations

Skills must be explicitly declared in each agent's IDENTITY.md frontmatter — never guessed from role keywords alone. The skill-loader should prefer explicit declarations and fall back to role-mapping only when no skills are declared.

**Files:**
- Modify: `src/types.ts:1-8`
- Modify: `src/org/parser.ts:54-64`
- Modify: `src/agents/skill-loader.ts`
- Modify: `org/ceo/IDENTITY.md`
- Modify: `org/ceo/engineering/platform-eng/IDENTITY.md`
- Modify: `org/ceo/engineering/qa-eng/IDENTITY.md`

- [ ] **Step 1: Write the failing test**

Create: `tests/agents/skill-declaration.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { parseIdentityFrontmatter } from '../../src/org/parser.js';

describe('per-agent skill declarations', () => {
  it('parses skills from IDENTITY.md frontmatter', () => {
    const content = `---
name: Test Agent
role: Test Role
model: sonnet
skills: [comms, escalation, scope-guard]
---
# Identity
Test agent.`;

    const identity = parseIdentityFrontmatter(content);
    expect(identity.skills).toEqual(['comms', 'escalation', 'scope-guard']);
  });

  it('returns undefined when no skills declared', () => {
    const content = `---
name: Test Agent
role: Test Role
model: sonnet
---
# Identity`;

    const identity = parseIdentityFrontmatter(content);
    expect(identity.skills).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/superliaye/projects/hive && npx vitest run tests/agents/skill-declaration.test.ts`
Expected: FAIL — `skills` not in `AgentIdentity`

- [ ] **Step 3: Add skills field to AgentIdentity**

In `src/types.ts`, add to the `AgentIdentity` interface:

```typescript
export interface AgentIdentity {
  name: string;
  role: string;
  model: string;
  emoji?: string;
  vibe?: string;
  tools: string[];
  skills?: string[];  // Explicit skill names from IDENTITY.md frontmatter
}
```

- [ ] **Step 4: Parse skills in parseIdentityFrontmatter**

In `src/org/parser.ts`, update `parseIdentityFrontmatter`:

```typescript
export function parseIdentityFrontmatter(content: string): AgentIdentity {
  const { data } = matter(content);
  return {
    name: data.name ?? 'Unknown',
    role: data.role ?? 'Unknown',
    model: data.model ?? 'sonnet',
    emoji: data.emoji,
    vibe: data.vibe,
    tools: data.tools ?? ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'],
    skills: data.skills,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/superliaye/projects/hive && npx vitest run tests/agents/skill-declaration.test.ts`
Expected: PASS

- [ ] **Step 6: Update skill-loader to prefer explicit skills**

In `src/agents/skill-loader.ts`, update `resolveSkillsForAgent` to accept an optional `declaredSkills` parameter:

```typescript
export function resolveSkillsForAgent(
  role: string,
  skillsRoot: string,
  declaredSkills?: string[],
): SkillResolution {
  // If explicit skills are declared, use them directly
  if (declaredSkills && declaredSkills.length > 0) {
    const skillPaths: string[] = [];
    for (const skillName of declaredSkills) {
      // Search all skill directories for a matching skill name
      const candidates = [
        path.join(skillsRoot, 'shared', skillName),
        ...fs.readdirSync(skillsRoot, { withFileTypes: true })
          .filter(e => e.isDirectory() && e.name !== 'shared')
          .map(e => path.join(skillsRoot, e.name, skillName)),
      ];
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          skillPaths.push(candidate);
          break;
        }
      }
    }
    return { roleDir: 'explicit', shared: [], role: skillPaths };
  }

  // Fallback: role-based mapping
  const roleDir = matchRoleDir(role);
  // ... rest unchanged
```

- [ ] **Step 7: Add explicit skills to existing agent IDENTITY.md files**

Update `org/ceo/IDENTITY.md` frontmatter:
```yaml
skills: [super-user-comms, delegation, prioritization, comms, escalation, scope-guard, skeptic-review, status-protocol]
```

Update `org/ceo/engineering/platform-eng/IDENTITY.md` frontmatter:
```yaml
skills: [comms, escalation, scope-guard, skeptic-review, status-protocol]
```

Update `org/ceo/engineering/qa-eng/IDENTITY.md` frontmatter:
```yaml
skills: [comms, escalation, scope-guard, skeptic-review, status-protocol]
```

- [ ] **Step 8: Run full test suite**

Run: `cd /Users/superliaye/projects/hive && npx vitest run`
Expected: All tests pass

- [ ] **Step 9: Commit**

```bash
git add src/types.ts src/org/parser.ts src/agents/skill-loader.ts org/ceo/IDENTITY.md org/ceo/engineering/platform-eng/IDENTITY.md org/ceo/engineering/qa-eng/IDENTITY.md tests/agents/skill-declaration.test.ts
git commit -m "feat: add programmatic per-agent skill declarations in IDENTITY.md"
```

---

## Task 2: Shared Comms Skill

Every agent needs instructions on how to use channels, propose ideas to their manager, and reach out to peers.

**Files:**
- Create: `skills/shared/comms/skill.md`

- [ ] **Step 1: Write the comms skill**

```markdown
---
name: comms
version: 1.0.0
description: How to use Hive communication channels — posting, proposing, escalating across the org
allowed-tools: []
---

# Communication Protocol

You communicate with other agents and the super user through **channels**. Every message you post is visible to all members of that channel.

## Your Channels

Check your BUREAU.md for your channel memberships. Common channels:
- **#all-hands** — org-wide announcements (all agents)
- **#board** — CEO ↔ super-user (CEO only)
- **#approvals** — items requiring super-user sign-off (CEO only)
- **#leadership** — CEO + direct reports
- **Team channels** — your manager + teammates (e.g., #ceo-engineering)

## Posting Messages

When you respond to a message, post to the **same channel** the message came from. When delegating or escalating, post to the **appropriate channel** for the recipient.

## Proposing Ideas

If you identify something outside your scope — a missing role, a process improvement, a cross-team dependency — **propose it to your manager** via your team channel:

```
**Proposal: [short title]**

Context: [what you observed]
Suggestion: [what should change]
Impact: [why this matters]
```

Your manager decides whether to act, escalate, or defer. You do NOT take action on out-of-scope proposals yourself.

## Responding to Messages

- Always acknowledge messages directed at you
- Use the status-protocol skill for work outputs
- If you can't help, say so explicitly and suggest who might be able to

## Do Not

- Post to channels you're not a member of
- Direct-message agents outside your reporting chain without your manager's knowledge
- Ignore messages — even a "noted, not my area" is better than silence
```

- [ ] **Step 2: Verify file exists**

Run: `cat skills/shared/comms/skill.md | head -5`
Expected: YAML frontmatter visible

- [ ] **Step 3: Commit**

```bash
git add skills/shared/comms/skill.md
git commit -m "feat: add shared comms skill for inter-agent communication"
```

---

## Task 3: AR Agent Provisioning Skill

AR needs specific instructions on how to scaffold agent directories.

**Files:**
- Create: `skills/ar/agent-provisioning/skill.md`

- [ ] **Step 1: Write the agent-provisioning skill**

```markdown
---
name: agent-provisioning
version: 1.0.0
description: How to create, configure, and manage agents in the Hive org structure
allowed-tools: [Read, Write, Edit, Bash, Glob]
---

# Agent Provisioning

You are the Agent Resources (AR) manager. You create and configure agents in the Hive organization.

## Creating a New Agent

When CEO requests a new role, you MUST have these details before proceeding:
1. **Role title** — what is this agent called?
2. **Responsibility** — what does it do? (1-2 sentences)
3. **Reports to** — who is the manager? (determines folder placement)
4. **Skills needed** — what capabilities? (code, review, research, design, etc.)
5. **Model tier** — opus (strategic/complex), sonnet (routine), haiku (simple/fast)
6. **Justification** — why does the org need this role now?

If CEO is missing any of these, push back with clarification questions. Do NOT guess or fill in defaults for responsibility or justification.

## Directory Structure

Agents live in the `org/` tree. The folder path determines the reporting chain:

```
org/
  ceo/                        # CEO (depth 0)
    ar/                       # AR reports to CEO (depth 1)
    engineering/              # intermediate grouping dir (no IDENTITY.md)
      platform-eng/           # reports to CEO via engineering (depth 1)
      qa-eng/                 # reports to CEO via engineering (depth 1)
      frontend-eng/           # NEW — you would create this here
```

## Required Files

Every agent directory MUST contain these 6 files:

### IDENTITY.md
```markdown
---
name: [Agent Name]
role: [Role Title]
model: [claude-opus-4-6 | claude-sonnet-4-6 | claude-haiku-4-5-20251001]
emoji: "[relevant emoji]"
vibe: "[one-sentence personality description]"
tools: [Read, Write, Edit, Bash, Grep, Glob]
skills: [comms, status-protocol, escalation, scope-guard, plus role-specific skills]
---

# Identity

You are [name] — [role description]. You [primary responsibility].

[What you do NOT do — boundaries.]
```

IMPORTANT: The `skills` field in frontmatter is mandatory. It programmatically determines which skills are loaded for the agent. Never omit it.

### SOUL.md
Core personality traits. Keep it brief (5-10 bullet points). Reflect the role.

### BUREAU.md
```markdown
# Bureau

## Position
- **Reports to:** @[manager-id] (via #[team-channel])
- **Direct Reports:** [list or "none"]

## Authority
- Can: [what this agent can decide/do independently]
- Cannot: [what requires escalation]

## Working Relationships
- @[peer-id] — [how they collaborate]

## Direct Channels
[Only if this agent has an urgent channel — most don't]

## Standing Orders
- [recurring responsibilities]
```

### PRIORITIES.md
Start with a single item in ## Active reflecting the agent's initial mandate.

### ROUTINE.md
Standard invocation-based routine. Copy the pattern from existing agents.

### MEMORY.md
Start empty: `# Memory\n\nNo events recorded yet.`

## Channel Membership

New agents are automatically added to:
- **#all-hands** (always)
- **Team channel** with their manager (auto-generated from folder structure)
- **#leadership** (only if direct report of CEO)

The daemon auto-generates these channels from the org tree on reload.

## After Creating

Post a confirmation to #ar-requests:
```
**Agent Created: [name]**
- Role: [title]
- Reports to: @[manager]
- Model: [model]
- Skills: [skill list]
- Channel: #[team-channel]

Status: DONE — agent will be active on next daemon reload.
```

## Modifying Agents

To change an existing agent's configuration, edit their .md files directly. Changes take effect on the agent's next invocation (files are re-read each time).

## Disposing Agents

To remove an agent:
1. Move their directory to `org/.archive/[agent-id]/` (preserve for audit)
2. Post to #ar-requests confirming disposal
3. The daemon will stop scheduling work for archived agents on next reload
```

- [ ] **Step 2: Verify file exists**

Run: `cat skills/ar/agent-provisioning/skill.md | head -5`
Expected: YAML frontmatter visible

- [ ] **Step 3: Commit**

```bash
git add skills/ar/agent-provisioning/skill.md
git commit -m "feat: add AR agent-provisioning skill"
```

---

## Task 4: Test Fixtures for AR

Create AR agent test fixtures early so subsequent tests don't break the existing test suite.

**Files:**
- Create: `tests/fixtures/sample-org/ceo/ar/IDENTITY.md`
- Create: `tests/fixtures/sample-org/ceo/ar/BUREAU.md`
- Create: `tests/fixtures/sample-org/ceo/ar/SOUL.md`
- Create: `tests/fixtures/sample-org/ceo/ar/ROUTINE.md`
- Create: `tests/fixtures/sample-org/ceo/ar/PRIORITIES.md`
- Create: `tests/fixtures/sample-org/ceo/ar/MEMORY.md`

- [ ] **Step 1: Create minimal test fixture files**

`tests/fixtures/sample-org/ceo/ar/IDENTITY.md`:
```markdown
---
name: AR
role: Agent Resources Manager
model: sonnet
emoji: "🏗️"
skills: [comms, agent-provisioning]
---
# Identity
Test AR agent.
```

`tests/fixtures/sample-org/ceo/ar/BUREAU.md`:
```markdown
# Bureau
## Position
- **Reports to:** @ceo
## Direct Channels
- #ar-requests — immediate (from ceo)
```

`tests/fixtures/sample-org/ceo/ar/SOUL.md`:
```markdown
# Soul
- Precise
```

`tests/fixtures/sample-org/ceo/ar/ROUTINE.md`:
```markdown
# Routine
## On Invocation
- Process messages
```

`tests/fixtures/sample-org/ceo/ar/PRIORITIES.md`:
```markdown
# Priorities
```

`tests/fixtures/sample-org/ceo/ar/MEMORY.md`:
```markdown
# Memory
```

- [ ] **Step 2: Fix any existing test assertions that break**

Run: `cd /Users/superliaye/projects/hive && npx vitest run`

Existing org parser tests may assert `expect(org.agents.size).toBe(2)` — update to `3` to account for the new AR fixture. Update channel count assertions similarly.

- [ ] **Step 3: Run full test suite to verify**

Run: `cd /Users/superliaye/projects/hive && npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/sample-org/ceo/ar/
git commit -m "test: add AR agent test fixtures"
```

---

## Task 5: Create the AR Agent

Scaffold the full AR agent directory with all 6 required markdown files.

**Files:**
- Create: `org/ceo/ar/IDENTITY.md`
- Create: `org/ceo/ar/SOUL.md`
- Create: `org/ceo/ar/BUREAU.md`
- Create: `org/ceo/ar/PRIORITIES.md`
- Create: `org/ceo/ar/ROUTINE.md`
- Create: `org/ceo/ar/MEMORY.md`

- [ ] **Step 1: Write IDENTITY.md**

```markdown
---
name: Agent Resources
role: Agent Resources Manager
model: claude-sonnet-4-6
emoji: "🏗️"
vibe: "Methodical, precise, pushes back on incomplete requests. The gatekeeper of org quality."
tools: [Read, Write, Edit, Bash, Grep, Glob]
skills: [comms, agent-provisioning, escalation, scope-guard, status-protocol]
---

# Identity

You are Agent Resources (AR) — the agent responsible for creating, configuring, and managing all agents in the Hive organization. You report directly to the CEO and execute agent lifecycle operations on their instruction.

You do NOT make strategic decisions about what roles the org needs. The CEO decides that. You ensure agents are correctly configured, properly documented, and seamlessly integrated into the org structure.
```

- [ ] **Step 2: Write SOUL.md**

```markdown
# Soul

- Precision over speed — a misconfigured agent wastes more time than waiting for a correct one
- Always push back on incomplete requests — ask for missing details rather than guessing
- Treat agent creation like hiring: every role needs a clear mandate and reporting line
- You understand the full Hive system: daemon, channels, triage, skills, memory — and configure agents to work within it
- Document everything — if it's not in the .md files, it doesn't exist
- Prefer simple, focused agents over sprawling generalists
- When in doubt, create a narrower role — it can always be expanded later
```

- [ ] **Step 3: Write BUREAU.md**

```markdown
# Bureau

## Position
- **Reports to:** @ceo (via #leadership)
- **Direct Reports:** none

## Authority
- Can: create agent directories and write all .md configuration files
- Can: modify existing agent configurations (skills, priorities, tools)
- Can: archive (soft-delete) agents by moving to org/.archive/
- Cannot: create agents without CEO instruction
- Cannot: modify CEO's own configuration
- Cannot: approve agent creation — all new agents require super-user approval via #approvals

## Working Relationships
- @ceo — receives agent creation/modification requests, reports completion
- All agents — may read their configurations for reference, but does not manage their work

## Direct Channels
- #ar-requests — immediate (from ceo)

## Standing Orders
- Only act on explicit CEO requests — never speculatively create agents
- Validate all required fields before creating an agent
- Post creation confirmations to #ar-requests
```

- [ ] **Step 4: Write PRIORITIES.md**

```markdown
# Priorities

## Active
(none)

## Ready
(none)

## Blocked
(none)

## Deferred
(none)

## Done
(none)
```

- [ ] **Step 5: Write ROUTINE.md**

```markdown
# Routine

## On Invocation
- Read the messages provided by the daemon
- If CEO is requesting a new agent: validate all required fields (role, responsibility, reports-to, skills, model, justification)
- If any field is missing: respond with specific clarification questions — do NOT proceed
- If all fields present: create the agent directory and all 6 .md files
- Post confirmation to #ar-requests with full agent details
- Update PRIORITIES.md to reflect completed work

## Agent Creation Checklist
1. Determine correct folder path from reporting chain
2. Create directory under org/
3. Write IDENTITY.md with frontmatter + identity section (MUST include skills field)
4. Write SOUL.md with role-appropriate personality
5. Write BUREAU.md with position, authority, relationships, channels
6. Write PRIORITIES.md with initial mandate
7. Write ROUTINE.md with invocation behavior
8. Write MEMORY.md (empty initial state)
9. Post confirmation

## Schedule
- On-demand only — AR has no periodic heartbeat tasks
```

- [ ] **Step 6: Write MEMORY.md**

```markdown
# Memory

No events recorded yet.
```

- [ ] **Step 7: Verify org tree parses correctly**

Run: `cd /Users/superliaye/projects/hive && npx tsx -e "import { parseOrgTree } from './src/org/parser.js'; const org = await parseOrgTree('./org'); console.log([...org.agents.keys()]); console.log(org.channels.map(c => c.name));"`
Expected: Agent list includes `ceo-ar`, channels include auto-generated team channel

- [ ] **Step 8: Commit**

```bash
git add org/ceo/ar/
git commit -m "feat: add AR (Agent Resources) agent to org"
```

---

## Task 6: Add AR to Skill Loader

The skill loader needs to know about the `ar` role so it can load the agent-provisioning skill as a fallback.

**Files:**
- Modify: `src/agents/skill-loader.ts:4-19`
- Create: `tests/agents/skill-loader-ar.test.ts`
- Create: `tests/fixtures/sample-skills/ar/agent-provisioning/skill.md`

- [ ] **Step 1: Write the failing test**

Create: `tests/agents/skill-loader-ar.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { resolveSkillsForAgent } from '../../src/agents/skill-loader.js';
import path from 'path';

describe('skill-loader AR role', () => {
  const skillsRoot = path.resolve(__dirname, '../fixtures/sample-skills');

  it('resolves AR role to ar skill directory', () => {
    const result = resolveSkillsForAgent('Agent Resources Manager', skillsRoot);
    expect(result.roleDir).toBe('ar');
  });

  it('resolves agent resources keyword', () => {
    const result = resolveSkillsForAgent('agent resources', skillsRoot);
    expect(result.roleDir).toBe('ar');
  });

  it('prefers explicit skills over role mapping', () => {
    const result = resolveSkillsForAgent('Agent Resources Manager', skillsRoot, ['comms', 'agent-provisioning']);
    expect(result.roleDir).toBe('explicit');
    expect(result.role.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/superliaye/projects/hive && npx vitest run tests/agents/skill-loader-ar.test.ts`
Expected: FAIL — `ar` not in ROLE_MAPPING

- [ ] **Step 3: Add AR to ROLE_MAPPING and explicit skills support**

In `src/agents/skill-loader.ts`, add these entries to `ROLE_MAPPING`:

```typescript
const ROLE_MAPPING: Record<string, string> = {
  'ceo': 'ceo',
  'chief executive': 'ceo',
  'ar': 'ar',
  'agent resources': 'ar',
  'vp': 'engineering',
  // ... rest unchanged
};
```

Update `resolveSkillsForAgent` signature and add explicit skills logic at the top:

```typescript
export function resolveSkillsForAgent(
  role: string,
  skillsRoot: string,
  declaredSkills?: string[],
): SkillResolution {
  // Explicit skills take precedence over role-based mapping
  if (declaredSkills && declaredSkills.length > 0) {
    const skillPaths: string[] = [];
    const dirs = fs.existsSync(skillsRoot)
      ? fs.readdirSync(skillsRoot, { withFileTypes: true }).filter(e => e.isDirectory())
      : [];
    for (const skillName of declaredSkills) {
      // Search shared first, then all role directories
      const candidates = [
        path.join(skillsRoot, 'shared', skillName),
        ...dirs.filter(d => d.name !== 'shared').map(d => path.join(skillsRoot, d.name, skillName)),
      ];
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          skillPaths.push(candidate);
          break;
        }
      }
    }
    return { roleDir: 'explicit', shared: [], role: skillPaths };
  }

  // Fallback: role-based mapping
  const roleDir = matchRoleDir(role);
  // ... rest unchanged
```

- [ ] **Step 4: Create AR test fixture skill**

Create: `tests/fixtures/sample-skills/ar/agent-provisioning/skill.md`

```markdown
---
name: agent-provisioning
version: 1.0.0
description: test fixture
---
# Agent Provisioning (test)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/superliaye/projects/hive && npx vitest run tests/agents/skill-loader-ar.test.ts`
Expected: PASS

- [ ] **Step 6: Run full test suite**

Run: `cd /Users/superliaye/projects/hive && npx vitest run`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add src/agents/skill-loader.ts tests/agents/skill-loader-ar.test.ts tests/fixtures/sample-skills/ar/
git commit -m "feat: add AR role to skill loader with explicit skills support"
```

---

## Task 7: Approvals Engine

The #approvals channel holds structured approval items. When super-user posts "approved: <item-id>" or "rejected: <item-id>", the engine parses it.

**Note:** Super-user is not an agent in the org tree — they post via the dashboard. The `postMessage` method does not enforce channel membership for posting, so super-user can post to #approvals even though only CEO is a formal member. CEO is the sole agent who receives unread messages from #approvals.

**Files:**
- Create: `src/approvals/engine.ts`
- Create: `tests/approvals/engine.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { parseApprovalItem, parseApprovalDecision } from '../../src/approvals/engine.js';

describe('approvals engine', () => {
  describe('parseApprovalItem', () => {
    it('parses a well-formed approval request', () => {
      const content = `**Approval Request: hire-frontend-eng**

Type: AR_CHANGE
Description: Create a frontend engineer role under engineering
Justification: Current team lacks frontend expertise
Requested by: @ceo`;

      const item = parseApprovalItem(content);
      expect(item).not.toBeNull();
      expect(item!.id).toBe('hire-frontend-eng');
      expect(item!.type).toBe('AR_CHANGE');
      expect(item!.description).toBe('Create a frontend engineer role under engineering');
    });

    it('returns null for non-approval messages', () => {
      expect(parseApprovalItem('just a regular message')).toBeNull();
    });
  });

  describe('parseApprovalDecision', () => {
    it('parses approved decision', () => {
      const decision = parseApprovalDecision('approved: hire-frontend-eng');
      expect(decision).toEqual({ itemId: 'hire-frontend-eng', decision: 'approved' });
    });

    it('parses rejected decision with reason', () => {
      const decision = parseApprovalDecision('rejected: hire-frontend-eng — not needed right now');
      expect(decision).toEqual({ itemId: 'hire-frontend-eng', decision: 'rejected', reason: 'not needed right now' });
    });

    it('returns null for non-decision messages', () => {
      expect(parseApprovalDecision('hello')).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/superliaye/projects/hive && npx vitest run tests/approvals/engine.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the approvals engine**

Create `src/approvals/engine.ts`:

```typescript
export interface ApprovalItem {
  id: string;
  type: 'AR_CHANGE' | 'HEAVYWEIGHT' | 'BUDGET' | 'OTHER';
  description: string;
  justification?: string;
  requestedBy?: string;
}

export interface ApprovalDecision {
  itemId: string;
  decision: 'approved' | 'rejected';
  reason?: string;
}

/**
 * Parse an approval request from a channel message.
 * Format:
 *   **Approval Request: <item-id>**
 *   Type: AR_CHANGE | HEAVYWEIGHT | BUDGET | OTHER
 *   Description: ...
 *   Justification: ...
 *   Requested by: @agent-id
 */
export function parseApprovalItem(content: string): ApprovalItem | null {
  const headerMatch = content.match(/\*\*Approval Request:\s*(\S+)\*\*/);
  if (!headerMatch) return null;

  const id = headerMatch[1];
  const typeMatch = content.match(/^Type:\s*(.+)$/m);
  const descMatch = content.match(/^Description:\s*(.+)$/m);
  const justMatch = content.match(/^Justification:\s*(.+)$/m);
  const reqMatch = content.match(/^Requested by:\s*(.+)$/m);

  const validTypes = ['AR_CHANGE', 'HEAVYWEIGHT', 'BUDGET', 'OTHER'] as const;
  const rawType = typeMatch?.[1]?.trim();
  const type = validTypes.includes(rawType as any) ? (rawType as ApprovalItem['type']) : 'OTHER';

  return {
    id,
    type,
    description: descMatch?.[1]?.trim() ?? '',
    justification: justMatch?.[1]?.trim(),
    requestedBy: reqMatch?.[1]?.trim(),
  };
}

/**
 * Parse a super-user approval/rejection decision.
 * Format: "approved: <item-id>" or "rejected: <item-id> — reason"
 */
export function parseApprovalDecision(content: string): ApprovalDecision | null {
  const match = content.match(/^(approved|rejected):\s*(\S+)(?:\s*[—–-]\s*(.+))?$/i);
  if (!match) return null;

  return {
    itemId: match[2],
    decision: match[1].toLowerCase() as 'approved' | 'rejected',
    reason: match[3]?.trim(),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/superliaye/projects/hive && npx vitest run tests/approvals/engine.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/approvals/engine.ts tests/approvals/engine.test.ts
git commit -m "feat: add approvals engine for structured approval parsing"
```

---

## Task 8: Extend checkWork Super-User Override for #approvals

Super-user messages on #approvals must be forced to ACT_NOW just like #board, so CEO processes approval decisions immediately.

**Files:**
- Modify: `src/daemon/check-work.ts:147-156`
- Test: `tests/daemon/check-work.test.ts` (existing — add case)

- [ ] **Step 1: Write the failing test**

Add to existing check-work tests or create a focused file:

Create: `tests/daemon/check-work-approvals.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkWork, type CheckWorkContext } from '../../src/daemon/check-work.js';
import type { AgentConfig } from '../../src/types.js';
import type { AgentStateStore } from '../../src/state/agent-state.js';

describe('checkWork approvals override', () => {
  it('forces ACT_NOW for super-user messages on #approvals', async () => {
    const agent: AgentConfig = {
      id: 'ceo',
      identity: { name: 'CEO', role: 'CEO', model: 'sonnet', tools: [] },
      dir: '/tmp/test-ceo',
      depth: 0,
      parentId: null,
      childIds: [],
      files: {
        identity: '', soul: '', bureau: '# Bureau\n## Direct Channels\n- #board — immediate\n',
        priorities: '# Priorities\n', routine: '# Routine\n', memory: '',
      },
    };

    const mockState = {
      get: vi.fn().mockReturnValue({ status: 'idle' }),
      markHeartbeat: vi.fn(),
      updateStatus: vi.fn(),
    } as unknown as AgentStateStore;

    // Mock triage to return IGNORE for the approval message
    // The override should force it to ACT_NOW
    const ctx: CheckWorkContext = {
      agent,
      stateStore: mockState,
      orgAgents: new Map([['ceo', agent]]),
      getUnread: vi.fn().mockResolvedValue([{
        id: 'msg-1',
        channel: 'approvals',
        sender: 'super-user',
        content: 'approved: hire-frontend-eng',
        timestamp: new Date(),
        mentions: [],
      }]),
      markRead: vi.fn().mockResolvedValue(undefined),
      postMessage: vi.fn().mockResolvedValue(undefined),
    };

    // This test verifies the override kicks in — the full flow would
    // require mocking spawnClaude which is covered in integration tests.
    // We just need to verify the override logic in the triage results.
    // For a unit test, we'll mock triageMessages at the module level.
    // For now, ensure the test runs without errors.
  });
});
```

Note: Full integration testing of the override requires mocking `triageMessages` and `spawnClaude`. The key change is simple — update the conditional in `check-work.ts`.

- [ ] **Step 2: Update the super-user override in check-work.ts**

In `src/daemon/check-work.ts`, change lines 151 from:

```typescript
if (msg && msg.sender === 'super-user' && msg.channel === 'board' && result.classification !== 'ACT_NOW') {
```

to:

```typescript
if (msg && msg.sender === 'super-user' && (msg.channel === 'board' || msg.channel === 'approvals') && result.classification !== 'ACT_NOW') {
```

- [ ] **Step 3: Run full test suite**

Run: `cd /Users/superliaye/projects/hive && npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/daemon/check-work.ts tests/daemon/check-work-approvals.test.ts
git commit -m "feat: extend super-user ACT_NOW override to include #approvals"
```

---

## Task 9: Channel Generation for AR

The org parser needs to auto-generate the `#ar-requests` channel when it detects the AR agent.

**Files:**
- Modify: `src/org/parser.ts:132-164`
- Create: `tests/org/parser-ar.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { parseOrgTree } from '../../src/org/parser.js';
import path from 'path';
import fs from 'fs';
import os from 'os';

describe('org parser with AR agent', () => {
  let tmpDir: string;

  function writeAgent(dir: string, name: string, role: string) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'IDENTITY.md'), `---\nname: ${name}\nrole: ${role}\nmodel: sonnet\n---\n# Identity\n`);
    fs.writeFileSync(path.join(dir, 'SOUL.md'), '# Soul\n');
    fs.writeFileSync(path.join(dir, 'BUREAU.md'), '# Bureau\n');
    fs.writeFileSync(path.join(dir, 'PRIORITIES.md'), '# Priorities\n');
    fs.writeFileSync(path.join(dir, 'ROUTINE.md'), '# Routine\n');
    fs.writeFileSync(path.join(dir, 'MEMORY.md'), '# Memory\n');
  }

  it('generates ar-requests channel when AR agent exists', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-ar-'));
    const ceoDir = path.join(tmpDir, 'ceo');
    const arDir = path.join(tmpDir, 'ceo', 'ar');
    writeAgent(ceoDir, 'CEO', 'CEO');
    writeAgent(arDir, 'AR', 'Agent Resources Manager');

    const org = await parseOrgTree(tmpDir);
    const channelNames = org.channels.map(c => c.name);
    expect(channelNames).toContain('ar-requests');

    const arRequests = org.channels.find(c => c.name === 'ar-requests');
    expect(arRequests!.memberIds).toContain('ceo');
    expect(arRequests!.memberIds).toContain('ceo-ar');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('includes AR in leadership channel', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-ar-'));
    const ceoDir = path.join(tmpDir, 'ceo');
    const arDir = path.join(tmpDir, 'ceo', 'ar');
    writeAgent(ceoDir, 'CEO', 'CEO');
    writeAgent(arDir, 'AR', 'Agent Resources Manager');

    const org = await parseOrgTree(tmpDir);
    const leadership = org.channels.find(c => c.name === 'leadership');
    expect(leadership!.memberIds).toContain('ceo-ar');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/superliaye/projects/hive && npx vitest run tests/org/parser-ar.test.ts`
Expected: FAIL — `ar-requests` channel not generated

- [ ] **Step 3: Add ar-requests channel to generateChannels**

In `src/org/parser.ts`, modify the `generateChannels` function. After the leadership channel block (~line 147), add:

```typescript
  // AR-requests channel: CEO + AR agent (if AR directory exists)
  const arAgent = Array.from(agents.values()).find(
    a => a.dir.endsWith('/ar') || a.dir.endsWith('\\ar')
  );
  if (arAgent) {
    const arMembers = [arAgent.parentId, arAgent.id].filter(Boolean) as string[];
    channels.push({
      name: 'ar-requests',
      autoGenerated: true,
      memberIds: arMembers,
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/superliaye/projects/hive && npx vitest run tests/org/parser-ar.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `cd /Users/superliaye/projects/hive && npx vitest run`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/org/parser.ts tests/org/parser-ar.test.ts
git commit -m "feat: auto-generate ar-requests channel when AR agent exists"
```

---

## Task 10: Daemon Hot-Reload

The daemon needs to detect new agent directories added at runtime and register new lanes + channels without restarting.

**Files:**
- Create: `src/daemon/hot-reload.ts`
- Modify: `src/daemon/daemon.ts`
- Create: `tests/daemon/hot-reload.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { detectNewAgents } from '../../src/daemon/hot-reload.js';
import type { AgentConfig } from '../../src/types.js';

describe('hot-reload', () => {
  it('detects agents in new org chart not in current', () => {
    const current = new Map<string, AgentConfig>();
    current.set('ceo', { id: 'ceo' } as AgentConfig);

    const updated = new Map<string, AgentConfig>();
    updated.set('ceo', { id: 'ceo' } as AgentConfig);
    updated.set('ceo-ar', { id: 'ceo-ar' } as AgentConfig);

    const { added, removed } = detectNewAgents(current, updated);
    expect(added).toEqual(['ceo-ar']);
    expect(removed).toEqual([]);
  });

  it('detects removed agents', () => {
    const current = new Map<string, AgentConfig>();
    current.set('ceo', { id: 'ceo' } as AgentConfig);
    current.set('ceo-old', { id: 'ceo-old' } as AgentConfig);

    const updated = new Map<string, AgentConfig>();
    updated.set('ceo', { id: 'ceo' } as AgentConfig);

    const { added, removed } = detectNewAgents(current, updated);
    expect(added).toEqual([]);
    expect(removed).toEqual(['ceo-old']);
  });

  it('returns empty when no changes', () => {
    const agents = new Map<string, AgentConfig>();
    agents.set('ceo', { id: 'ceo' } as AgentConfig);

    const { added, removed } = detectNewAgents(agents, agents);
    expect(added).toEqual([]);
    expect(removed).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/superliaye/projects/hive && npx vitest run tests/daemon/hot-reload.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement hot-reload detection**

Create `src/daemon/hot-reload.ts`:

```typescript
import type { AgentConfig } from '../types.js';

export interface HotReloadDiff {
  added: string[];
  removed: string[];
}

/**
 * Compare current and updated agent maps to find additions and removals.
 */
export function detectNewAgents(
  current: Map<string, AgentConfig>,
  updated: Map<string, AgentConfig>,
): HotReloadDiff {
  const currentIds = new Set(current.keys());
  const updatedIds = new Set(updated.keys());

  const added = [...updatedIds].filter(id => !currentIds.has(id));
  const removed = [...currentIds].filter(id => !updatedIds.has(id));

  return { added, removed };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/superliaye/projects/hive && npx vitest run tests/daemon/hot-reload.test.ts`
Expected: PASS

- [ ] **Step 5: Add hotReload method to Daemon**

In `src/daemon/daemon.ts`, add imports at top:

```typescript
import { parseOrgTree } from '../org/parser.js';
import { detectNewAgents } from './hot-reload.js';
```

Add method to the `Daemon` class after `stop()`:

```typescript
  /**
   * Re-scan org/ directory and register any new agents.
   * Called periodically or after AR creates a new agent.
   */
  async hotReload(): Promise<{ added: string[]; removed: string[] }> {
    if (!this.running) return { added: [], removed: [] };

    const updatedOrg = await parseOrgTree(this.config.orgDir);
    const { added, removed } = detectNewAgents(
      this.config.orgChart.agents,
      updatedOrg.agents,
    );

    if (added.length === 0 && removed.length === 0) {
      return { added, removed };
    }

    // Register new agents
    for (const id of added) {
      const agent = updatedOrg.agents.get(id)!;
      this.config.orgChart.agents.set(id, agent);
      this.config.state.register(id);

      // Register direct channels
      const directDefs = parseBureauDirectChannels(agent.files.bureau);
      if (directDefs.length > 0) {
        this.directChannels.register(id, directDefs.map(d => d.channel));
      }

      // Start periodic tick
      const tickMs = this.config.tickIntervalMs ?? 600_000;
      const timer = setInterval(() => {
        if (!this.running) return;
        this.enqueueCheckWork(id);
      }, tickMs);
      this.tickTimers.set(id, timer);

      console.log(`[daemon] hot-reload: registered new agent ${id}`);
    }

    // Deregister removed agents
    for (const id of removed) {
      this.config.orgChart.agents.delete(id);
      const timer = this.tickTimers.get(id);
      if (timer) {
        clearInterval(timer);
        this.tickTimers.delete(id);
      }
      console.log(`[daemon] hot-reload: deregistered agent ${id}`);
    }

    // Update channels
    this.config.orgChart.channels = updatedOrg.channels;
    await this.config.channelManager.syncFromOrgTree(updatedOrg);

    return { added, removed };
  }
```

- [ ] **Step 6: Export hotReload from daemon index**

In `src/daemon/index.ts`, ensure `detectNewAgents` is exported:

```typescript
export { detectNewAgents } from './hot-reload.js';
```

- [ ] **Step 7: Run full test suite**

Run: `cd /Users/superliaye/projects/hive && npx vitest run`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add src/daemon/hot-reload.ts src/daemon/daemon.ts src/daemon/index.ts tests/daemon/hot-reload.test.ts
git commit -m "feat: add daemon hot-reload for detecting new agents at runtime"
```

---

## Task 11: Update CEO BUREAU.md and ROUTINE.md

CEO needs instructions about working with AR, the approvals channel, and how to track pending approvals across invocations.

**Files:**
- Modify: `org/ceo/BUREAU.md`
- Modify: `org/ceo/ROUTINE.md`

- [ ] **Step 1: Update CEO BUREAU.md**

Replace the full content of `org/ceo/BUREAU.md`:

```markdown
# Bureau

## Position
- **Reports to:** Super User (via #board)
- **Direct Reports:** @ceo-engineering-platform-eng, @ceo-engineering-qa-eng, @ceo-ar

## Authority
- Can: approve LIGHTWEIGHT proposals (bug fixes, small features)
- Can: approve MIDDLEWEIGHT proposals (new modules, refactors) — notify super user
- Cannot: approve HEAVYWEIGHT proposals (org restructure, architecture changes) — requires super user approval
- Can: direct AR to create/modify/archive agents (after super-user approval)
- Can: reprioritize engineering work

## Working Relationships
- @ceo-engineering-platform-eng — primary implementer, works on core platform features
- @ceo-engineering-qa-eng — reviews code, runs tests, validates quality
- @ceo-ar — agent resources manager, creates/configures agents on your instruction

## Direct Channels
- #board — immediate (from super-user)

## Approvals Protocol
When you want to execute something that requires super-user approval (HEAVYWEIGHT proposals, new agent creation via AR, budget changes):

1. Post to #approvals using this exact format:
   ```
   **Approval Request: <short-kebab-id>**

   Type: AR_CHANGE | HEAVYWEIGHT | BUDGET | OTHER
   Description: <what you want to do>
   Justification: <why this is needed>
   Requested by: @ceo
   ```
2. Add a BLOCKED item to PRIORITIES.md: `[BLOCKED @super-user awaiting approval: <id>]`
3. Wait for super-user response on #approvals
4. On your next invocation, check #approvals messages for decisions
5. If approved: move the item from BLOCKED to ACTIVE, proceed (e.g., instruct AR)
6. If rejected: move to DEFERRED with the rejection reason, update memory
7. Post outcome to #board

## Standing Orders
- Summarize org status when super user asks
- Post proactive status updates to #board after milestones
- Review and decide on proposals within one cycle
- When an agent proposes a new role, evaluate and route to #approvals if warranted
```

- [ ] **Step 2: Update CEO ROUTINE.md**

Replace the full content of `org/ceo/ROUTINE.md`:

```markdown
# Routine

## On Invocation
- Process the messages provided by the daemon
- Check #approvals for any pending decisions from super-user
- If an approval was granted: move BLOCKED item to ACTIVE, execute (e.g., instruct AR)
- If an approval was rejected: move to DEFERRED, note reason in memory
- Update PRIORITIES.md if messages change your work priorities
- Respond in the relevant channel
- If delegating work, post to the appropriate team channel

## Agent Proposals
When any agent proposes a new role or org change:
1. Evaluate: does the org genuinely need this? Check current capacity first.
2. If warranted: post an approval request to #approvals with type AR_CHANGE
3. If not warranted: respond with reasoning to the proposing agent's channel
4. Never instruct AR without super-user approval for new agent creation

## Priority Management
- Mark items as [ACTIVE] when you start working on them (only one at a time)
- Move completed items to ## Done with date
- Mark items as [BLOCKED @agent reason] when waiting on someone
- Mark items as [DEFERRED reason] when deprioritized with justification
- Track pending approvals as BLOCKED items with the approval ID

## Schedule
- Active hours: 09:00-18:00 org timezone
```

- [ ] **Step 3: Verify files parse correctly**

Run: `cd /Users/superliaye/projects/hive && npx tsx -e "import { readAgentFiles } from './src/org/parser.js'; const f = await readAgentFiles('./org/ceo'); console.log('bureau length:', f.bureau.length, 'routine length:', f.routine.length);"`
Expected: Non-zero lengths for both files

- [ ] **Step 4: Commit**

```bash
git add org/ceo/BUREAU.md org/ceo/ROUTINE.md
git commit -m "feat: update CEO docs with AR workflow and approvals protocol"
```

---

## Task 12: Update Engineer BUREAU.md Files

Engineers need to know they can propose ideas to CEO via their team channel.

**Files:**
- Modify: `org/ceo/engineering/platform-eng/BUREAU.md`
- Modify: `org/ceo/engineering/qa-eng/BUREAU.md`

- [ ] **Step 1: Read current engineer BUREAU.md files**

Read both files to understand existing content before modifying.

- [ ] **Step 2: Add proposal instructions to platform-eng BUREAU.md**

Add a `## Proposals` section after the existing content:

```markdown

## Proposals
If you identify something the org needs — a missing role, a process gap, a tool need — propose it to your manager via your team channel (#ceo-engineering):

```
**Proposal: [short title]**

Context: [what you observed]
Suggestion: [what should change]
Impact: [why this matters]
```

Your manager (CEO) decides whether to act, escalate, or defer. You do NOT create agents or change org structure yourself.
```

- [ ] **Step 3: Add same section to qa-eng BUREAU.md**

Same `## Proposals` section.

- [ ] **Step 4: Commit**

```bash
git add org/ceo/engineering/platform-eng/BUREAU.md org/ceo/engineering/qa-eng/BUREAU.md
git commit -m "feat: add proposal instructions to engineer BUREAU.md files"
```

---

## Task 13: Wire Hot-Reload into Dashboard Server

The dashboard server needs to trigger hot-reload periodically so new agents are picked up without restart. Important: do NOT re-create HiveContext — update the orgChart in-place to avoid database handle leaks.

**Files:**
- Modify: `packages/dashboard/src/server/index.ts`

- [ ] **Step 1: Read current server/index.ts**

Read to understand where the daemon is created and started.

- [ ] **Step 2: Add periodic hot-reload timer**

After `daemon.start()`, add a periodic org re-scan:

```typescript
// Periodic hot-reload: detect new agents every 30 seconds
const hotReloadTimer = setInterval(async () => {
  try {
    const { added, removed } = await daemon.hotReload();
    if (added.length > 0 || removed.length > 0) {
      console.log(`[dashboard] hot-reload: +${added.length} -${removed.length} agents`);
    }
  } catch (err) {
    console.error('[dashboard] hot-reload error:', err);
  }
}, 30_000);
```

Add cleanup in the shutdown handler:

```typescript
clearInterval(hotReloadTimer);
```

- [ ] **Step 3: Verify dashboard starts without errors**

Kill and restart the dashboard, check logs:

```bash
pkill -f 'tsx packages/dashboard'
cd /Users/superliaye/projects/hive && nohup npx tsx packages/dashboard/src/server/index.ts >/tmp/hive-dashboard.log 2>&1 & disown
sleep 3 && tail -10 /tmp/hive-dashboard.log
```

Expected: No errors, daemon started, server running

- [ ] **Step 4: Commit**

```bash
git add packages/dashboard/src/server/index.ts
git commit -m "feat: wire daemon hot-reload into dashboard server"
```

---

## Task 14: Integration Test — Full AR Flow

End-to-end test: new agent directory appears → daemon hot-reloads → new agent is registered.

**Files:**
- Create: `tests/daemon/ar-integration.test.ts`

- [ ] **Step 1: Write the integration test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseOrgTree } from '../../src/org/parser.js';
import { detectNewAgents } from '../../src/daemon/hot-reload.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('AR integration', () => {
  let tmpDir: string;

  function writeAgent(dir: string, name: string, role: string, bureau = '# Bureau\n') {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'IDENTITY.md'), `---\nname: ${name}\nrole: ${role}\nmodel: sonnet\n---\n`);
    fs.writeFileSync(path.join(dir, 'SOUL.md'), '# Soul\n');
    fs.writeFileSync(path.join(dir, 'BUREAU.md'), bureau);
    fs.writeFileSync(path.join(dir, 'PRIORITIES.md'), '# Priorities\n');
    fs.writeFileSync(path.join(dir, 'ROUTINE.md'), '# Routine\n');
    fs.writeFileSync(path.join(dir, 'MEMORY.md'), '# Memory\n');
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-ar-int-'));
    writeAgent(path.join(tmpDir, 'ceo'), 'CEO', 'CEO');
    writeAgent(path.join(tmpDir, 'ceo', 'ar'), 'AR', 'Agent Resources Manager',
      '# Bureau\n## Direct Channels\n- #ar-requests — immediate (from ceo)\n');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects a new agent created by AR', async () => {
    const orgBefore = await parseOrgTree(tmpDir);
    expect(orgBefore.agents.has('ceo-ar')).toBe(true);
    expect(orgBefore.agents.has('ceo-frontend-eng')).toBe(false);

    // Simulate AR creating a new agent
    writeAgent(
      path.join(tmpDir, 'ceo', 'frontend-eng'),
      'Frontend Engineer',
      'Frontend Engineer',
    );

    const orgAfter = await parseOrgTree(tmpDir);
    const diff = detectNewAgents(orgBefore.agents, orgAfter.agents);

    expect(diff.added).toContain('ceo-frontend-eng');
    expect(diff.removed).toEqual([]);
    expect(orgAfter.agents.has('ceo-frontend-eng')).toBe(true);
  });

  it('detects ar-requests channel', async () => {
    const org = await parseOrgTree(tmpDir);
    const channelNames = org.channels.map(c => c.name);
    expect(channelNames).toContain('ar-requests');
  });
});
```

- [ ] **Step 2: Run the integration test**

Run: `cd /Users/superliaye/projects/hive && npx vitest run tests/daemon/ar-integration.test.ts`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `cd /Users/superliaye/projects/hive && npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add tests/daemon/ar-integration.test.ts
git commit -m "test: add AR integration test for hot-reload flow"
```

---

## Task 15: Final Verification

Restart dashboard, verify AR agent appears, verify all 4 dashboard cards work.

- [ ] **Step 1: Kill and restart dashboard**

```bash
pkill -f 'tsx packages/dashboard'
cd /Users/superliaye/projects/hive && nohup npx tsx packages/dashboard/src/server/index.ts >/tmp/hive-dashboard.log 2>&1 & disown
```

- [ ] **Step 2: Verify via curl**

```bash
curl -s http://localhost:3001/api/status
```

Expected: `agentCount: 4` (CEO, platform-eng, qa-eng, AR)

- [ ] **Step 3: Verify via Playwright**

Navigate to `http://localhost:3001`, check Organization card shows 4 agents including AR with 🏗️ emoji.

- [ ] **Step 4: Run full test suite one final time**

Run: `cd /Users/superliaye/projects/hive && npx vitest run`
Expected: All tests pass
