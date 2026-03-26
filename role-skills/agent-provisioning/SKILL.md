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

Templates live in `role-templates/`. Each template contains the standard agent files (IDENTITY.md, SOUL.md, BUREAU.md, PRIORITIES.md, MEMORY.md) with role-appropriate defaults.

Available templates:
- `chief-executive`, `agent-resources`, `department-head`
- `software-engineer`, `qa-engineer`, `designer`
- `product-manager`, `product-analyst`

Read the template files before creating an agent — they define the structure and conventions.

## Creating an Agent

### 1. Register in people table

Insert into the `people` table first — this is the source of truth. Use the next available ID, alias, name, role_template, and `reports_to` pointing to the manager's person ID. The folder field should be `{id}-{alias}` (e.g., `5-product-analyst`).

### 2. Pick template and create directory

Choose the closest role template. Create a flat directory under `org/` named `{id}-{alias}/` matching the folder in the people table.

### 3. Copy and customize template files

Copy all files from the role template into the new directory. Customize:
- **IDENTITY.md** frontmatter: name, vibe, skills for this specific agent
- **BUREAU.md**: reports-to, direct reports, authority scope
- **PRIORITIES.md**: initial work items from CEO's request

### 4. Confirm to CEO

DM CEO with the agent alias, role summary, reporting relationship, and initial priorities.

## Modifying an Agent

Read the agent's current files before making changes. Only modify what CEO requested. DM CEO confirming what changed.

## Archiving an Agent

Move the agent directory to `.archive/`. DM CEO confirming the archive.

## Quality Gates

Before creating any agent, verify:
- [ ] Role doesn't duplicate an existing agent's responsibilities
- [ ] Reporting chain is valid (manager exists in people table)
- [ ] At least one concrete priority beyond "introduce yourself"
- [ ] Skills array includes `hive-comms`
- [ ] Model is `claude-opus-4-6` unless CEO specifies otherwise
