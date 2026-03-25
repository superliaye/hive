---
name: agent-provisioning
description: Use when CEO requests creating a new agent, modifying an existing agent's configuration, or archiving an agent
---

# Agent Provisioning

## Before You Start

Every provisioning request from CEO must include:
- **Role**: what the agent does (e.g., "QA engineer for frontend")
- **Reports to**: who manages this agent
- **Justification**: why this agent is needed now

If any of these are missing, DM CEO with specific clarification questions. Do NOT guess or fill in defaults.

## Creating an Agent

### 1. Determine directory path

Follow the reporting chain. Agent directories nest under their manager:
```
org/ceo/                          # CEO reports to super-user
org/ceo/engineering/              # Engineering lead reports to CEO
org/ceo/engineering/platform-eng/ # Engineer reports to engineering lead
```

### 2. Create the directory and write all files

Every agent needs exactly these files:

**config.json** — Gateway configuration (not in agent prompt):
```json
{
  "name": "[Display Name]",
  "model": "claude-opus-4-6",
  "emoji": "[emoji]",
  "tools": ["Read", "Write", "Edit", "Bash", "Grep", "Glob"],
  "mcp": ["playwright"],
  "skills": ["hive-comms"]
}
```
Add role-specific skills to the skills array as appropriate.

**IDENTITY.md** — Who the agent is. YAML frontmatter + prose body:
```yaml
---
name: [Role Name]
role: [Title]
model: claude-opus-4-6
emoji: "[emoji]"
vibe: "[1-2 sentence personality]"
tools: [Read, Write, Edit, Bash, Grep, Glob]
skills: [hive-comms, ...]
---

[Prose description of identity, responsibilities, and what this agent does NOT do]
```

**SOUL.md** — Personality, values, decision-making style. Write this based on the role:
- Engineers: bias toward shipping, testing everything, simplicity
- QA: default skepticism, evidence over claims
- Product: user-first thinking, scope discipline
- Managers: delegation, clarity, focus over throughput

**BUREAU.md** — Org position and relationships:
```markdown
## Reporting
Reports to: @[manager-alias]
Direct reports: [list or "none"]

## Authority
[What they can decide autonomously vs. what needs escalation]

## Collaborators
[Who they work with regularly outside reporting chain]
```

**PRIORITIES.md** — Initial work items. Start with onboarding:
```markdown
## ACTIVE
- Introduce yourself to manager via DM
- Review codebase and document findings

## READY
[Tasks CEO mentioned in the request]

## BLOCKED
[none]

## DONE
[none]
```

**ROUTINE.md** — On-invocation behavior:
```markdown
## On Invocation
1. Process all inbound messages
2. Check PRIORITIES.md for ACTIVE items
3. [Role-specific standing orders]
4. Update PRIORITIES.md if work changes
```

**MEMORY.md** — Empty initially. Agent writes to this over time.

### 3. Confirm to CEO

DM CEO with:
- Agent alias and directory path
- Role summary
- Reporting relationship
- Initial priorities
- Any skills assigned

## Modifying an Agent

Read the agent's current files before making changes. Only modify what CEO requested. DM CEO confirming what changed.

## Archiving an Agent

Move the agent directory to `.archive/` under its parent. DM CEO confirming the archive.

## Quality Gates

Before creating any agent, verify:
- [ ] Role doesn't duplicate an existing agent's responsibilities
- [ ] Reporting chain is valid (manager exists)
- [ ] At least one concrete priority beyond "introduce yourself"
- [ ] Skills array includes `hive-comms`
- [ ] Model is `claude-opus-4-6` unless CEO specifies otherwise
