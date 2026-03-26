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

## Role Templates

Templates live in `role-templates/`. Read the template files to understand what each role provides.

Available: `chief-executive`, `agent-resources`, `manager`, `software-engineer`, `qa-engineer`, `designer`, `product-manager`

## Creating an Agent

Use the CLI — it handles people table registration, folder creation, template copying, and reporting chain updates:

```bash
hive agent create \
  --alias <alias> \
  --name "<Display Name>" \
  --template <role-template> \
  --reports-to <manager-alias> \
  --vibe "<personality>" \
  --skills "skill1,skill2"
```

The CLI will:
1. Validate inputs (alias unique, manager exists, template exists)
2. Insert into people table (source of truth)
3. Create `org/{id}-{alias}/` from the template
4. Generate IDENTITY.md frontmatter with name, vibe, skills
5. Update BUREAU.md with reporting relationships
6. Update the manager's BUREAU.md to include the new direct report

After creation, customize any files that need agent-specific content beyond the template defaults.

### Example

```bash
hive agent create \
  --alias alice \
  --name "Alice Park" \
  --template software-engineer \
  --reports-to ceo \
  --vibe "Ships solid infrastructure. Hates over-engineering."
```

## Listing Agents

```bash
hive agent list
```

## Modifying an Agent

Read the agent's current files before making changes. Only modify what CEO requested. DM CEO confirming what changed.

## Archiving an Agent

Move the agent directory to `.archive/`. DM CEO confirming the archive.

## Quality Gates

Before running `hive agent create`, verify:
- [ ] Role doesn't duplicate an existing agent's responsibilities
- [ ] At least one concrete priority from CEO's request
- [ ] Skills include `hive-comms`
