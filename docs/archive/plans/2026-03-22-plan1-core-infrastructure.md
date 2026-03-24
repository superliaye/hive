# Plan 1: Core Infrastructure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up the TypeScript project, org tree parser, agent config loader, Claude CLI spawner, audit database, and CLI skeleton so a single agent can be invoked from its folder.

**Architecture:** A TypeScript CLI (`hive`) using Commander.js for commands, better-sqlite3 for audit/state DBs, and child_process for spawning Claude CLI. The org tree is parsed from the filesystem; agent config is loaded from YAML-frontmatter markdown files.

**Tech Stack:** TypeScript, Node.js 20+, Commander.js, better-sqlite3, gray-matter (YAML frontmatter parsing), tsx (dev runner)

**Spec:** `docs/specs/2026-03-22-hive-platform-design.md`

---

## File Structure

```
hive/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .gitignore
├── src/
│   ├── cli.ts                    # CLI entry point (Commander.js)
│   ├── types.ts                  # Shared type definitions
│   ├── org/
│   │   └── parser.ts             # Reads org/ folder tree → OrgChart model
│   ├── agents/
│   │   ├── config-loader.ts      # Reads agent md files → AgentConfig
│   │   ├── prompt-assembler.ts   # Concatenates md files into system prompt
│   │   ├── spawner.ts            # Spawns Claude CLI processes
│   │   └── skill-loader.ts       # Copies/symlinks skills into agent .claude/skills/
│   ├── audit/
│   │   ├── store.ts              # SQLite audit trail (invocations table)
│   │   └── logger.ts             # Structured logging helper
│   └── state/
│       └── agent-state.ts        # SQLite agent_state table (orchestrator.db)
├── tests/
│   ├── org/
│   │   └── parser.test.ts
│   ├── agents/
│   │   ├── config-loader.test.ts
│   │   ├── prompt-assembler.test.ts
│   │   └── spawner.test.ts
│   ├── audit/
│   │   └── store.test.ts
│   ├── cli/
│   │   └── commands.test.ts
│   └── fixtures/
│       ├── sample-skills/        # Minimal skills tree for testing
│       │   ├── shared/
│       │   │   └── comms/
│       │   │       └── skill.md
│       │   └── engineering/
│       │       └── code-review/
│       │           └── skill.md
│       └── sample-org/           # Minimal org tree for testing
│           ├── ORG.md
│           └── ceo/
│               ├── IDENTITY.md
│               ├── SOUL.md
│               ├── BUREAU.md
│               ├── PRIORITIES.md
│               ├── ROUTINE.md
│               ├── MEMORY.md
│               └── engineering/
│                   └── eng-1/
│                       ├── IDENTITY.md
│                       ├── SOUL.md
│                       ├── BUREAU.md
│                       ├── PRIORITIES.md
│                       ├── ROUTINE.md
│                       └── MEMORY.md
└── bin/
    └── hive                      # Executable entry (#!/usr/bin/env tsx src/cli.ts)
```

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `bin/hive`
- Create: `src/cli.ts`
- Create: `src/types.ts`

- [ ] **Step 1: Initialize package.json**

```bash
cd /Users/superliaye/projects/hive
npm init -y
```

Then edit `package.json`:

```json
{
  "name": "hive",
  "version": "0.1.0",
  "description": "Self-organizing company of AI agents",
  "type": "module",
  "bin": {
    "hive": "./bin/hive"
  },
  "scripts": {
    "dev": "tsx src/cli.ts",
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {},
  "dependencies": {}
}
```

- [ ] **Step 2: Install dependencies**

```bash
npm install commander better-sqlite3 gray-matter chalk
npm install -D typescript tsx vitest @types/node @types/better-sqlite3
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "resolveJsonModule": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 4: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    testTimeout: 10_000,
  },
});
```

- [ ] **Step 5: Create .gitignore**

```
node_modules/
dist/
data/
*.db
org/*/.workspace/
.DS_Store
```

- [ ] **Step 6: Create shared types**

Create `src/types.ts`:

```typescript
export interface AgentIdentity {
  name: string;
  role: string;
  model: string;
  emoji?: string;
  vibe?: string;
  tools: string[];
}

export interface AgentConfig {
  id: string;                    // Derived from folder path: "ceo" or "ceo-engineering-eng-1"
  identity: AgentIdentity;       // Parsed from IDENTITY.md frontmatter
  dir: string;                   // Absolute path to agent folder
  depth: number;                 // 0 = CEO, 1 = VP, etc.
  parentId: string | null;       // Parent agent ID
  childIds: string[];            // Direct report IDs
  files: {
    identity: string;            // Full content of IDENTITY.md
    soul: string;                // Full content of SOUL.md
    bureau: string;              // Full content of BUREAU.md
    priorities: string;          // Full content of PRIORITIES.md
    routine: string;             // Full content of ROUTINE.md
    memory: string;              // Full content of MEMORY.md
  };
}

export interface OrgChart {
  root: AgentConfig;
  agents: Map<string, AgentConfig>;  // id → config
  channels: ChannelDef[];
}

export interface ChannelDef {
  name: string;                  // e.g., "eng-backend"
  autoGenerated: boolean;
  memberIds: string[];
}

export interface AuditEntry {
  id: string;
  agentId: string;
  invocationType: 'triage' | 'main' | 'memory' | 'proposal';
  model: string;
  tokensIn?: number;
  tokensOut?: number;
  durationMs?: number;
  inputSummary?: string;
  outputSummary?: string;
  channel?: string;
  timestamp: Date;
}

export interface AgentState {
  agentId: string;
  status: 'active' | 'idle' | 'working' | 'disposed' | 'errored';
  lastInvocation?: Date;
  lastHeartbeat?: Date;
  currentTask?: string;
  pid?: number;
}

export interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  tokensIn?: number;
  tokensOut?: number;
}
```

- [ ] **Step 7: Create CLI skeleton**

Create `src/cli.ts`:

```typescript
import { Command } from 'commander';

const program = new Command();

program
  .name('hive')
  .description('Self-organizing company of AI agents')
  .version('0.1.0');

program
  .command('org')
  .description('Print org chart from folder tree')
  .action(async () => {
    console.log('hive org — not yet implemented');
  });

program
  .command('status')
  .description('Show active agents and org status')
  .action(async () => {
    console.log('hive status — not yet implemented');
  });

program
  .command('init')
  .description('Bootstrap a new organization')
  .requiredOption('--mission <mission>', 'Organization mission statement')
  .option('--template <template>', 'Org template to use', 'startup')
  .action(async (opts) => {
    console.log(`hive init — mission: "${opts.mission}", template: ${opts.template}`);
  });

program
  .command('start')
  .description('Wake the organization')
  .action(async () => {
    console.log('hive start — not yet implemented');
  });

program
  .command('stop')
  .description('Graceful shutdown')
  .action(async () => {
    console.log('hive stop — not yet implemented');
  });

program.parse();
```

- [ ] **Step 8: Create bin/hive executable**

Create `bin/hive`:

```bash
#!/usr/bin/env node
import('../dist/cli.js');
```

> **Note:** Uses `node` shebang with dynamic `import()` for ESM compatibility. Points to `dist/cli.js` (the compiled output from `tsc`). Run `npm run build` before using `bin/hive`. For development, use `npx tsx src/cli.ts` instead.

```bash
chmod +x bin/hive
```

- [ ] **Step 9: Verify setup**

```bash
cd /Users/superliaye/projects/hive
npx tsx src/cli.ts --help
npx tsx src/cli.ts org
```

Expected: CLI prints help text, then "hive org — not yet implemented"

- [ ] **Step 10: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore src/cli.ts src/types.ts bin/hive
git commit -m "feat: scaffold TypeScript project with CLI skeleton and shared types"
```

---

### Task 2: Test Fixtures — Sample Org Tree

**Files:**
- Create: `tests/fixtures/sample-org/ORG.md`
- Create: `tests/fixtures/sample-org/ceo/IDENTITY.md` (+ SOUL, BUREAU, PRIORITIES, ROUTINE, MEMORY)
- Create: `tests/fixtures/sample-org/ceo/engineering/eng-1/IDENTITY.md` (+ others)

- [ ] **Step 1: Create ORG.md fixture**

Create `tests/fixtures/sample-org/ORG.md`:

```markdown
---
timezone: America/Los_Angeles
active_hours: "09:00-18:00"
default_model: sonnet
triage_model: haiku
heartbeat_persistent: 10
heartbeat_ondemand: 120
---

# Organization

## Mission
Build a test analytics platform.
```

- [ ] **Step 2: Create CEO agent files**

Create `tests/fixtures/sample-org/ceo/IDENTITY.md`:

```markdown
---
name: Test CEO
role: Chief Executive Officer
model: sonnet
emoji: "👔"
vibe: "Leads with clarity, decides fast, delegates well."
tools: [Read, Write, Edit, Bash, Grep, Glob]
---

# Identity

You are the CEO. You set strategic direction, delegate to your reports, and communicate with the super user via #board.
```

Create `tests/fixtures/sample-org/ceo/SOUL.md`:

```markdown
# Soul

## Core Traits
- Strategic thinker — sees the big picture
- Decisive — makes calls quickly with available info
- Delegator — trusts team leads to manage their domains

## Communication Style
- Clear, concise directives
- Asks probing questions before approving

## Critical Rules
- Never ignore #board messages
- Always respond to super user within one cycle
```

Create `tests/fixtures/sample-org/ceo/BUREAU.md`:

```markdown
# Bureau

## Position
- **Reports to:** Super User (via #board)
- **Direct Reports:** @eng-1

## Authority
- Can: approve LIGHTWEIGHT and MIDDLEWEIGHT proposals
- Can: restructure org (with super user approval for HEAVYWEIGHT)
- Cannot: bypass super user on HEAVYWEIGHT decisions

## Standing Orders
- Check #board every triage cycle — always ACT_NOW
- Summarize org status when super user asks
```

Create `tests/fixtures/sample-org/ceo/PRIORITIES.md`:

```markdown
# Priorities

## Current
1. [IN PROGRESS] Build initial org structure
2. [TODO] Define product roadmap
```

Create `tests/fixtures/sample-org/ceo/ROUTINE.md`:

```markdown
# Routine

## Heartbeat (every 10min)
- Check #board for super user messages
- Check #leadership for reports' updates
- Review pending proposals

## Schedule
- Active hours: 09:00-18:00 org timezone
- Persistent: true
```

Create `tests/fixtures/sample-org/ceo/MEMORY.md`:

```markdown
# Memory

Organization bootstrapped on 2026-03-22.
```

- [ ] **Step 3: Create engineer agent files**

Create `tests/fixtures/sample-org/ceo/engineering/eng-1/IDENTITY.md`:

```markdown
---
name: Engineer 1
role: Backend Software Engineer
model: sonnet
emoji: "⚙️"
vibe: "Ships clean code, hates flaky tests."
tools: [Read, Write, Edit, Bash, Grep, Glob]
---

# Identity

You are a backend software engineer. You write clean, well-tested code.
```

Create `tests/fixtures/sample-org/ceo/engineering/eng-1/SOUL.md`:

```markdown
# Soul

## Core Traits
- Detail-oriented — catches edge cases
- Test-driven — writes tests before code
- Collaborative — asks for help early

## Communication Style
- Technical, precise language
- Shares progress in daily standups

## Critical Rules
- Never push broken code
- Always run tests before committing
```

Create `tests/fixtures/sample-org/ceo/engineering/eng-1/BUREAU.md`:

```markdown
# Bureau

## Position
- **Reports to:** @ceo
- **Direct Reports:** none

## Authority
- Can: write and merge code in assigned repos
- Can: create feature branches
- Cannot: approve own PRs without review

## Standing Orders
- Check #engineering for task assignments
- Post daily progress to #engineering
```

Create `tests/fixtures/sample-org/ceo/engineering/eng-1/PRIORITIES.md`:

```markdown
# Priorities

## Current
1. [TODO] Implement backend API endpoints
2. [TODO] Write unit tests for data layer
```

Create `tests/fixtures/sample-org/ceo/engineering/eng-1/ROUTINE.md`:

```markdown
# Routine

## Heartbeat (every 120min)
- Check #engineering for new tasks
- Continue work on current task
- Post status update

## Schedule
- Active hours: 09:00-18:00 org timezone
- Persistent: false
```

Create `tests/fixtures/sample-org/ceo/engineering/eng-1/MEMORY.md`:

```markdown
# Memory

Onboarded 2026-03-22. Assigned to backend work.
```

Create `tests/fixtures/sample-skills/shared/comms/skill.md`:

```markdown
---
name: comms
version: 1.0.0
description: Communication helpers for channel messaging
---

# Comms Skill

Post messages to channels using the Canopy protocol.
```

Create `tests/fixtures/sample-skills/engineering/code-review/skill.md`:

```markdown
---
name: code-review
version: 1.0.0
description: Code review skill for engineering agents
---

# Code Review Skill

Review pull requests and provide structured feedback.
```

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/
git commit -m "test: add sample org tree and skills fixtures for testing"
```

---

### Task 3: Org Tree Parser

**Files:**
- Create: `src/org/parser.ts`
- Create: `tests/org/parser.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/org/parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseOrgTree } from '../../src/org/parser.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/sample-org');

describe('parseOrgTree', () => {
  it('parses the root agent (CEO)', async () => {
    const org = await parseOrgTree(FIXTURE_DIR);
    expect(org.root.identity.name).toBe('Test CEO');
    expect(org.root.identity.role).toBe('Chief Executive Officer');
    expect(org.root.depth).toBe(0);
    expect(org.root.parentId).toBeNull();
  });

  it('discovers nested agents', async () => {
    const org = await parseOrgTree(FIXTURE_DIR);
    expect(org.agents.size).toBe(2); // CEO + eng-1
  });

  it('builds parent-child relationships', async () => {
    const org = await parseOrgTree(FIXTURE_DIR);
    const ceo = org.root;
    expect(ceo.childIds.length).toBeGreaterThan(0);

    const eng1 = org.agents.get(ceo.childIds[0]);
    expect(eng1).toBeDefined();
    expect(eng1!.parentId).toBe(ceo.id);
  });

  it('generates channel definitions from tree', async () => {
    const org = await parseOrgTree(FIXTURE_DIR);
    const channelNames = org.channels.map(c => c.name);
    expect(channelNames).toContain('all-hands');
    expect(channelNames).toContain('board');
  });

  it('derives agent IDs from folder path', async () => {
    const org = await parseOrgTree(FIXTURE_DIR);
    const ids = Array.from(org.agents.keys());
    expect(ids).toContain('ceo');
    expect(ids.some(id => id.includes('eng-1'))).toBe(true);
  });

  it('reads agent md files into config', async () => {
    const org = await parseOrgTree(FIXTURE_DIR);
    const ceo = org.root;
    expect(ceo.files.soul).toContain('Strategic thinker');
    expect(ceo.files.bureau).toContain('Super User');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/org/parser.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement org parser**

Create `src/org/parser.ts`:

```typescript
import fs from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';
import type { AgentConfig, AgentIdentity, OrgChart, ChannelDef } from '../types.js';

const AGENT_FILES = ['IDENTITY.md', 'SOUL.md', 'BUREAU.md', 'PRIORITIES.md', 'ROUTINE.md', 'MEMORY.md'];
const SKIP_DIRS = ['.claude', '.workspace', '.archive', '.proposals', 'memory', 'node_modules', '.git'];

async function isAgentDir(dir: string): Promise<boolean> {
  try {
    await fs.access(path.join(dir, 'IDENTITY.md'));
    return true;
  } catch {
    return false;
  }
}

function deriveAgentId(agentPath: string, orgRoot: string): string {
  const relative = path.relative(orgRoot, agentPath);
  if (relative === '' || relative === '.') return 'root';
  // org/ceo/engineering/eng-1 → ceo-engineering-eng-1
  // But the first agent folder is typically just "ceo"
  return relative.split(path.sep).filter(s => s !== '').join('-');
}

function deriveChannelName(agentPath: string, orgRoot: string): string | null {
  const relative = path.relative(orgRoot, agentPath);
  const parts = relative.split(path.sep).filter(s => s !== '');
  if (parts.length < 2) return null;
  // Use last two significant segments: "engineering/backend" → "eng-backend"
  const parent = parts[parts.length - 2];
  const team = parts[parts.length - 1];
  return `${parent}-${team}`;
}

export async function readAgentFiles(dir: string): Promise<AgentConfig['files']> {
  const read = async (name: string): Promise<string> => {
    try {
      return await fs.readFile(path.join(dir, name), 'utf-8');
    } catch {
      return '';
    }
  };
  return {
    identity: await read('IDENTITY.md'),
    soul: await read('SOUL.md'),
    bureau: await read('BUREAU.md'),
    priorities: await read('PRIORITIES.md'),
    routine: await read('ROUTINE.md'),
    memory: await read('MEMORY.md'),
  };
}

export function parseIdentityFrontmatter(content: string): AgentIdentity {
  const { data } = matter(content);
  return {
    name: data.name ?? 'Unknown',
    role: data.role ?? 'Unknown',
    model: data.model ?? 'sonnet',
    emoji: data.emoji,
    vibe: data.vibe,
    tools: data.tools ?? ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'],
  };
}

async function walkIntermediate(
  dir: string,
  orgRoot: string,
  parentDepth: number,
  parentId: string,
  parentConfig: AgentConfig,
  agents: Map<string, AgentConfig>,
): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIRS.includes(entry.name)) continue;
    const childDir = path.join(dir, entry.name);
    if (await isAgentDir(childDir)) {
      const child = await walkAgents(childDir, orgRoot, parentDepth + 1, parentId, agents);
      if (child) parentConfig.childIds.push(child.id);
    } else {
      // Keep recursing through intermediate directories
      await walkIntermediate(childDir, orgRoot, parentDepth, parentId, parentConfig, agents);
    }
  }
}

async function walkAgents(
  dir: string,
  orgRoot: string,
  depth: number,
  parentId: string | null,
  agents: Map<string, AgentConfig>,
): Promise<AgentConfig | null> {
  if (!(await isAgentDir(dir))) return null;

  const id = deriveAgentId(dir, orgRoot);
  const files = await readAgentFiles(dir);
  const identity = parseIdentityFrontmatter(files.identity);

  const config: AgentConfig = {
    id,
    identity,
    dir,
    depth,
    parentId,
    childIds: [],
    files,
  };

  agents.set(id, config);

  // Scan subdirectories for child agents
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIRS.includes(entry.name)) continue;
    const childDir = path.join(dir, entry.name);

    // Check if this dir itself is an agent, or contains agents
    if (await isAgentDir(childDir)) {
      const child = await walkAgents(childDir, orgRoot, depth + 1, id, agents);
      if (child) config.childIds.push(child.id);
    } else {
      // Intermediate directory (e.g., "engineering/") — recurse fully
      await walkIntermediate(childDir, orgRoot, depth, id, config, agents);
    }
  }

  return config;
}

function generateChannels(agents: Map<string, AgentConfig>, orgRoot: string): ChannelDef[] {
  const channels: ChannelDef[] = [
    { name: 'all-hands', autoGenerated: true, memberIds: Array.from(agents.keys()) },
    { name: 'board', autoGenerated: true, memberIds: ['ceo'] },
    { name: 'approvals', autoGenerated: true, memberIds: ['ceo'] },
  ];

  // Leadership channel: CEO + direct reports
  const root = Array.from(agents.values()).find(a => a.depth === 0);
  if (root) {
    channels.push({
      name: 'leadership',
      autoGenerated: true,
      memberIds: [root.id, ...root.childIds],
    });
  }

  // Team channels from folder structure
  for (const agent of agents.values()) {
    if (agent.childIds.length > 0) {
      const channelName = deriveChannelName(agent.dir, orgRoot);
      if (channelName && !channels.find(c => c.name === channelName)) {
        channels.push({
          name: channelName,
          autoGenerated: true,
          memberIds: [agent.id, ...agent.childIds],
        });
      }
    }
  }

  return channels;
}

export async function parseOrgTree(orgRoot: string): Promise<OrgChart> {
  const agents = new Map<string, AgentConfig>();

  // Find the root agent directory (first dir with IDENTITY.md)
  const entries = await fs.readdir(orgRoot, { withFileTypes: true });
  let root: AgentConfig | null = null;

  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIRS.includes(entry.name)) continue;
    const candidateDir = path.join(orgRoot, entry.name);
    root = await walkAgents(candidateDir, orgRoot, 0, null, agents);
    if (root) break;
  }

  if (!root) {
    throw new Error(`No agent found in org root: ${orgRoot}. Expected a directory with IDENTITY.md.`);
  }

  const channels = generateChannels(agents, orgRoot);

  return { root, agents, channels };
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/org/parser.test.ts
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/org/parser.ts tests/org/parser.test.ts
git commit -m "feat: implement org tree parser with parent-child relationships and channel generation"
```

---

### Task 4: Agent Config Loader & Prompt Assembler

**Files:**
- Create: `src/agents/config-loader.ts`
- Create: `src/agents/prompt-assembler.ts`
- Create: `tests/agents/config-loader.test.ts`
- Create: `tests/agents/prompt-assembler.test.ts`

- [ ] **Step 1: Write config-loader test**

Create `tests/agents/config-loader.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { loadAgentConfig } from '../../src/agents/config-loader.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CEO_DIR = path.resolve(__dirname, '../fixtures/sample-org/ceo');

describe('loadAgentConfig', () => {
  it('loads identity frontmatter', async () => {
    const config = await loadAgentConfig(CEO_DIR, 'ceo', 0, null);
    expect(config.identity.name).toBe('Test CEO');
    expect(config.identity.model).toBe('sonnet');
    expect(config.identity.tools).toContain('Read');
  });

  it('loads all md file contents', async () => {
    const config = await loadAgentConfig(CEO_DIR, 'ceo', 0, null);
    expect(config.files.soul).toContain('Strategic thinker');
    expect(config.files.bureau).toContain('Super User');
    expect(config.files.priorities).toContain('Build initial org');
  });

  it('handles missing optional files gracefully', async () => {
    const config = await loadAgentConfig(CEO_DIR, 'ceo', 0, null);
    // MEMORY.md exists but even if it didn't, should return empty string
    expect(typeof config.files.memory).toBe('string');
  });
});
```

- [ ] **Step 2: Write prompt-assembler test**

Create `tests/agents/prompt-assembler.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { assemblePrompt } from '../../src/agents/prompt-assembler.js';
import { loadAgentConfig } from '../../src/agents/config-loader.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CEO_DIR = path.resolve(__dirname, '../fixtures/sample-org/ceo');

describe('assemblePrompt', () => {
  it('concatenates all md files with section markers', async () => {
    const config = await loadAgentConfig(CEO_DIR, 'ceo', 0, null);
    const prompt = assemblePrompt(config);
    expect(prompt).toContain('# Identity');
    expect(prompt).toContain('# Soul');
    expect(prompt).toContain('# Bureau');
    expect(prompt).toContain('# Priorities');
    expect(prompt).toContain('# Routine');
  });

  it('includes all file content', async () => {
    const config = await loadAgentConfig(CEO_DIR, 'ceo', 0, null);
    const prompt = assemblePrompt(config);
    expect(prompt).toContain('Strategic thinker');
    expect(prompt).toContain('Super User');
  });

  it('separates sections clearly', async () => {
    const config = await loadAgentConfig(CEO_DIR, 'ceo', 0, null);
    const prompt = assemblePrompt(config);
    // Sections should be separated by dividers
    expect(prompt).toContain('---');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run tests/agents/
```

Expected: FAIL

- [ ] **Step 4: Implement config-loader**

Create `src/agents/config-loader.ts`:

```typescript
import type { AgentConfig } from '../types.js';
import { readAgentFiles, parseIdentityFrontmatter } from '../org/parser.js';

export async function loadAgentConfig(
  dir: string,
  id: string,
  depth: number,
  parentId: string | null,
): Promise<AgentConfig> {
  const files = await readAgentFiles(dir);
  const identity = parseIdentityFrontmatter(files.identity);

  return {
    id,
    identity,
    dir,
    depth,
    parentId,
    childIds: [],
    files,
  };
}
```

> **Note:** `readAgentFiles` and `parseIdentityFrontmatter` are exported from `src/org/parser.ts` (already defined there). This avoids duplicating the file-reading and frontmatter-parsing logic.

- [ ] **Step 5: Implement prompt-assembler**

Create `src/agents/prompt-assembler.ts`:

```typescript
import type { AgentConfig } from '../types.js';
import matter from 'gray-matter';

function stripFrontmatter(content: string): string {
  const { content: body } = matter(content);
  return body.trim();
}

export function assemblePrompt(config: AgentConfig): string {
  const sections = [
    stripFrontmatter(config.files.identity),
    config.files.soul,
    config.files.bureau,
    config.files.priorities,
    config.files.routine,
    config.files.memory,
  ].filter(s => s.trim().length > 0);

  return sections.join('\n\n---\n\n');
}
```

- [ ] **Step 6: Run tests**

```bash
npx vitest run tests/agents/
```

Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add src/agents/config-loader.ts src/agents/prompt-assembler.ts tests/agents/
git commit -m "feat: implement agent config loader and prompt assembler"
```

---

### Task 5: Claude CLI Spawner

**Files:**
- Create: `src/agents/spawner.ts`
- Create: `tests/agents/spawner.test.ts`

- [ ] **Step 1: Write spawner tests**

Create `tests/agents/spawner.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildClaudeArgs, buildTriageArgs } from '../../src/agents/spawner.js';

describe('buildClaudeArgs', () => {
  it('builds correct args for print mode invocation', () => {
    const args = buildClaudeArgs({
      model: 'sonnet',
      systemPrompt: 'You are a test agent.',
      tools: ['Read', 'Write', 'Bash'],
    });
    expect(args).toContain('-p');
    expect(args).toContain('--model');
    expect(args).toContain('sonnet');
    expect(args).toContain('--system-prompt');
    expect(args).toContain('You are a test agent.');
    expect(args).toContain('--allowedTools');
    expect(args).toContain('Read,Write,Bash');
  });

  it('includes output-format json when specified', () => {
    const args = buildClaudeArgs({
      model: 'haiku',
      systemPrompt: 'Triage messages.',
      tools: [],
      outputFormat: 'json',
    });
    expect(args).toContain('--output-format');
    expect(args).toContain('json');
  });
});

describe('buildTriageArgs', () => {
  it('uses haiku model for triage', () => {
    const args = buildTriageArgs('Triage prompt here');
    expect(args).toContain('haiku');
    expect(args).toContain('json');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/agents/spawner.test.ts
```

- [ ] **Step 3: Implement spawner**

Create `src/agents/spawner.ts`:

```typescript
import { spawn as nodeSpawn } from 'child_process';
import type { SpawnResult } from '../types.js';

export interface ClaudeArgs {
  model: string;
  systemPrompt: string;
  tools: string[];
  outputFormat?: 'json' | 'text';
}

export function buildClaudeArgs(opts: ClaudeArgs): string[] {
  const args: string[] = ['-p', '--model', opts.model, '--system-prompt', opts.systemPrompt];

  if (opts.tools.length > 0) {
    args.push('--allowedTools', opts.tools.join(','));
  }

  if (opts.outputFormat) {
    args.push('--output-format', opts.outputFormat);
  }

  return args;
}

export function buildTriageArgs(triagePrompt: string): string[] {
  return buildClaudeArgs({
    model: 'haiku',
    systemPrompt: triagePrompt,
    tools: [],
    outputFormat: 'json',
  });
}

export async function spawnClaude(
  args: string[],
  opts: { cwd: string; input?: string; timeoutMs?: number },
): Promise<SpawnResult> {
  const start = Date.now();

  return new Promise((resolve, reject) => {
    const proc = nodeSpawn('claude', args, {
      cwd: opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: opts.timeoutMs ?? 300_000, // 5 min default
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    if (opts.input) {
      proc.stdin.write(opts.input);
      proc.stdin.end();
    } else {
      proc.stdin.end();
    }

    proc.on('close', (code) => {
      // Try to extract token usage from JSON output (claude --output-format json)
      let tokensIn: number | undefined;
      let tokensOut: number | undefined;
      try {
        const parsed = JSON.parse(stdout);
        if (parsed.usage) {
          tokensIn = parsed.usage.input_tokens;
          tokensOut = parsed.usage.output_tokens;
        }
      } catch {
        // Non-JSON output — no token info available
      }

      resolve({
        stdout,
        stderr,
        exitCode: code ?? 1,
        durationMs: Date.now() - start,
        tokensIn,
        tokensOut,
      });
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn claude: ${err.message}`));
    });
  });
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/agents/spawner.test.ts
```

Expected: PASS (unit tests don't actually spawn claude)

- [ ] **Step 5: Commit**

```bash
git add src/agents/spawner.ts tests/agents/spawner.test.ts
git commit -m "feat: implement Claude CLI spawner with arg builder and triage mode"
```

---

### Task 6: Audit Store (SQLite)

**Files:**
- Create: `src/audit/store.ts`
- Create: `src/audit/logger.ts`
- Create: `tests/audit/store.test.ts`

- [ ] **Step 1: Write audit store tests**

Create `tests/audit/store.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AuditStore } from '../../src/audit/store.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = path.join(__dirname, '../fixtures/test-audit.db');

describe('AuditStore', () => {
  let store: AuditStore;

  beforeEach(() => {
    store = new AuditStore(TEST_DB);
  });

  afterEach(() => {
    store.close();
    try { fs.unlinkSync(TEST_DB); } catch {}
  });

  it('creates the invocations table on init', () => {
    // Just opening should create the table
    expect(store).toBeDefined();
  });

  it('logs an invocation', () => {
    store.logInvocation({
      agentId: 'ceo',
      invocationType: 'main',
      model: 'sonnet',
      tokensIn: 1000,
      tokensOut: 500,
      durationMs: 3000,
      inputSummary: 'Check board messages',
      outputSummary: 'Reviewed 3 messages',
    });

    const entries = store.getInvocations({ agentId: 'ceo' });
    expect(entries.length).toBe(1);
    expect(entries[0].model).toBe('sonnet');
    expect(entries[0].agentId).toBe('ceo');
    expect(entries[0].invocationType).toBe('main');
    expect(entries[0].tokensIn).toBe(1000);
    expect(entries[0].durationMs).toBe(3000);
  });

  it('queries by agent and time range', () => {
    store.logInvocation({ agentId: 'ceo', invocationType: 'triage', model: 'haiku' });
    store.logInvocation({ agentId: 'eng-1', invocationType: 'main', model: 'sonnet' });

    const ceoEntries = store.getInvocations({ agentId: 'ceo' });
    expect(ceoEntries.length).toBe(1);

    const allEntries = store.getInvocations({});
    expect(allEntries.length).toBe(2);
  });

  it('computes token totals', () => {
    store.logInvocation({ agentId: 'ceo', invocationType: 'main', model: 'sonnet', tokensIn: 1000, tokensOut: 500 });
    store.logInvocation({ agentId: 'ceo', invocationType: 'triage', model: 'haiku', tokensIn: 200, tokensOut: 100 });

    const totals = store.getTokenTotals('ceo');
    expect(totals.totalIn).toBe(1200);
    expect(totals.totalOut).toBe(600);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/audit/store.test.ts
```

- [ ] **Step 3: Implement audit store**

Create `src/audit/store.ts`:

```typescript
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

export interface LogInvocationOpts {
  agentId: string;
  invocationType: string;
  model: string;
  tokensIn?: number;
  tokensOut?: number;
  durationMs?: number;
  inputSummary?: string;
  outputSummary?: string;
  channel?: string;
}

export interface InvocationRow {
  id: string;
  agentId: string;
  invocationType: string;
  model: string;
  tokensIn: number | null;
  tokensOut: number | null;
  durationMs: number | null;
  inputSummary: string | null;
  outputSummary: string | null;
  channel: string | null;
  timestamp: string;
}

function mapInvocationRow(row: any): InvocationRow {
  return {
    id: row.id,
    agentId: row.agent_id,
    invocationType: row.invocation_type,
    model: row.model,
    tokensIn: row.tokens_in ?? null,
    tokensOut: row.tokens_out ?? null,
    durationMs: row.duration_ms ?? null,
    inputSummary: row.input_summary ?? null,
    outputSummary: row.output_summary ?? null,
    channel: row.channel ?? null,
    timestamp: row.timestamp,
  };
}

export class AuditStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS invocations (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        invocation_type TEXT NOT NULL,
        model TEXT NOT NULL,
        tokens_in INTEGER,
        tokens_out INTEGER,
        duration_ms INTEGER,
        input_summary TEXT,
        output_summary TEXT,
        channel TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_invocations_agent ON invocations(agent_id);
      CREATE INDEX IF NOT EXISTS idx_invocations_ts ON invocations(timestamp);
    `);
  }

  logInvocation(opts: LogInvocationOpts): string {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO invocations (id, agent_id, invocation_type, model, tokens_in, tokens_out, duration_ms, input_summary, output_summary, channel)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, opts.agentId, opts.invocationType, opts.model,
      opts.tokensIn ?? null, opts.tokensOut ?? null, opts.durationMs ?? null,
      opts.inputSummary ?? null, opts.outputSummary ?? null, opts.channel ?? null,
    );
    return id;
  }

  getInvocations(filter: { agentId?: string; since?: Date; limit?: number }): InvocationRow[] {
    let sql = 'SELECT * FROM invocations WHERE 1=1';
    const params: unknown[] = [];

    if (filter.agentId) {
      sql += ' AND agent_id = ?';
      params.push(filter.agentId);
    }
    if (filter.since) {
      sql += ' AND timestamp >= ?';
      params.push(filter.since.toISOString());
    }
    sql += ' ORDER BY timestamp DESC';
    if (filter.limit) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
    }

    return (this.db.prepare(sql).all(...params) as any[]).map(mapInvocationRow);
  }

  getTokenTotals(agentId?: string): { totalIn: number; totalOut: number } {
    let sql = 'SELECT COALESCE(SUM(tokens_in), 0) as total_in, COALESCE(SUM(tokens_out), 0) as total_out FROM invocations';
    const params: unknown[] = [];
    if (agentId) {
      sql += ' WHERE agent_id = ?';
      params.push(agentId);
    }
    const row = this.db.prepare(sql).get(...params) as { total_in: number; total_out: number };
    return { totalIn: row.total_in, totalOut: row.total_out };
  }

  close(): void {
    this.db.close();
  }
}
```

- [ ] **Step 4: Implement logger helper**

Create `src/audit/logger.ts`:

```typescript
import { AuditStore, type LogInvocationOpts } from './store.js';
import type { SpawnResult } from '../types.js';

export class AuditLogger {
  constructor(private store: AuditStore) {}

  logAgentInvocation(
    agentId: string,
    invocationType: LogInvocationOpts['invocationType'],
    model: string,
    result: SpawnResult,
    opts?: { inputSummary?: string; channel?: string },
  ): string {
    return this.store.logInvocation({
      agentId,
      invocationType,
      model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      durationMs: result.durationMs,
      inputSummary: opts?.inputSummary,
      outputSummary: result.stdout.slice(0, 200), // First 200 chars as summary
      channel: opts?.channel,
    });
  }
}
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run tests/audit/store.test.ts
```

Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/audit/ tests/audit/
git commit -m "feat: implement SQLite audit store with invocation logging and querying"
```

---

### Task 7: Agent State Store

**Files:**
- Create: `src/state/agent-state.ts`
- Create: `tests/state/agent-state.test.ts`

- [ ] **Step 1: Write tests**

Create `tests/state/agent-state.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentStateStore } from '../../src/state/agent-state.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = path.join(__dirname, '../fixtures/test-state.db');

describe('AgentStateStore', () => {
  let store: AgentStateStore;

  beforeEach(() => {
    store = new AgentStateStore(TEST_DB);
  });

  afterEach(() => {
    store.close();
    try { fs.unlinkSync(TEST_DB); } catch {}
  });

  it('registers a new agent', () => {
    store.register('ceo');
    const state = store.get('ceo');
    expect(state).toBeDefined();
    expect(state!.status).toBe('idle');
  });

  it('updates agent status', () => {
    store.register('ceo');
    store.updateStatus('ceo', 'working', { pid: 1234, currentTask: 'triage' });
    const state = store.get('ceo');
    expect(state!.status).toBe('working');
    expect(state!.pid).toBe(1234);
  });

  it('finds stale agents', () => {
    store.register('ceo');
    store.updateStatus('ceo', 'working', { pid: 2_147_483_647 }); // Max 32-bit PID — guaranteed not to exist
    const stale = store.findStale();
    expect(stale.length).toBe(1);
    expect(stale[0].agentId).toBe('ceo');
  });

  it('lists all agents', () => {
    store.register('ceo');
    store.register('eng-1');
    const all = store.listAll();
    expect(all.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/state/agent-state.test.ts
```

- [ ] **Step 3: Implement agent state store**

Create `src/state/agent-state.ts`:

```typescript
import Database from 'better-sqlite3';
import type { AgentState } from '../types.js';

export class AgentStateStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_state (
        agent_id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'idle',
        last_invocation DATETIME,
        last_heartbeat DATETIME,
        current_task TEXT,
        pid INTEGER
      );
    `);
  }

  register(agentId: string): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO agent_state (agent_id, status) VALUES (?, 'idle')
    `).run(agentId);
  }

  get(agentId: string): AgentState | undefined {
    const row = this.db.prepare('SELECT * FROM agent_state WHERE agent_id = ?').get(agentId) as any;
    if (!row) return undefined;
    return {
      agentId: row.agent_id,
      status: row.status,
      lastInvocation: row.last_invocation ? new Date(row.last_invocation) : undefined,
      lastHeartbeat: row.last_heartbeat ? new Date(row.last_heartbeat) : undefined,
      currentTask: row.current_task ?? undefined,
      pid: row.pid ?? undefined,
    };
  }

  updateStatus(
    agentId: string,
    status: AgentState['status'],
    opts?: { pid?: number; currentTask?: string },
  ): void {
    this.db.prepare(`
      UPDATE agent_state
      SET status = ?, pid = ?, current_task = ?, last_invocation = CURRENT_TIMESTAMP
      WHERE agent_id = ?
    `).run(status, opts?.pid ?? null, opts?.currentTask ?? null, agentId);
  }

  markHeartbeat(agentId: string): void {
    this.db.prepare(`
      UPDATE agent_state SET last_heartbeat = CURRENT_TIMESTAMP WHERE agent_id = ?
    `).run(agentId);
  }

  findStale(): AgentState[] {
    const rows = this.db.prepare(
      "SELECT * FROM agent_state WHERE status = 'working'"
    ).all() as any[];

    return rows
      .filter((row) => {
        if (!row.pid) return true;
        try {
          process.kill(row.pid, 0);
          return false; // Process alive → not stale
        } catch {
          return true; // Process dead → stale
        }
      })
      .map((row) => ({
        agentId: row.agent_id,
        status: row.status,
        pid: row.pid,
        currentTask: row.current_task,
      }));
  }

  listAll(): AgentState[] {
    return (this.db.prepare('SELECT * FROM agent_state').all() as any[]).map((row) => ({
      agentId: row.agent_id,
      status: row.status,
      lastInvocation: row.last_invocation ? new Date(row.last_invocation) : undefined,
      lastHeartbeat: row.last_heartbeat ? new Date(row.last_heartbeat) : undefined,
      currentTask: row.current_task ?? undefined,
      pid: row.pid ?? undefined,
    }));
  }

  close(): void {
    this.db.close();
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/state/agent-state.test.ts
```

Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/state/ tests/state/
git commit -m "feat: implement agent state store with stale PID detection"
```

---

### Task 8: Wire Up `hive org` and `hive status` Commands

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Implement `hive org` command**

Update `src/cli.ts` — replace the org command:

```typescript
import { Command } from 'commander';
import { parseOrgTree } from './org/parser.js';
import { AgentStateStore } from './state/agent-state.js';
import chalk from 'chalk';
import path from 'path';
import fs from 'fs';

function getOrgDir(): string {
  const orgDir = path.resolve(process.cwd(), 'org');
  if (!fs.existsSync(orgDir)) {
    console.error(chalk.red('No org/ directory found. Run `hive init` first.'));
    process.exit(1);
  }
  return orgDir;
}

function getDataDir(): string {
  const dataDir = path.resolve(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return dataDir;
}

const program = new Command();

program
  .name('hive')
  .description('Self-organizing company of AI agents')
  .version('0.1.0');

program
  .command('org')
  .description('Print org chart from folder tree')
  .action(async () => {
    const org = await parseOrgTree(getOrgDir());
    function printAgent(id: string, indent: number): void {
      const agent = org.agents.get(id);
      if (!agent) return;
      const prefix = '  '.repeat(indent);
      const emoji = agent.identity.emoji ?? '🔹';
      console.log(`${prefix}${emoji} ${chalk.bold(agent.identity.name)} (${agent.identity.role}) [${agent.id}]`);
      for (const childId of agent.childIds) {
        printAgent(childId, indent + 1);
      }
    }
    console.log(chalk.underline('\nOrg Chart:\n'));
    printAgent(org.root.id, 0);
    console.log(`\n${chalk.dim(`${org.agents.size} agents, ${org.channels.length} channels`)}\n`);
  });

program
  .command('status')
  .description('Show active agents and org status')
  .action(async () => {
    const org = await parseOrgTree(getOrgDir());
    const stateStore = new AgentStateStore(path.join(getDataDir(), 'orchestrator.db'));

    for (const [id, agent] of org.agents) {
      stateStore.register(id);
    }

    const states = stateStore.listAll();
    console.log(chalk.underline('\nAgent Status:\n'));
    for (const state of states) {
      const agent = org.agents.get(state.agentId);
      const name = agent?.identity.name ?? state.agentId;
      const statusColor = state.status === 'working' ? chalk.green : state.status === 'errored' ? chalk.red : chalk.dim;
      console.log(`  ${statusColor(state.status.padEnd(8))} ${name}`);
    }
    console.log();
    stateStore.close();
  });

program
  .command('init')
  .description('Bootstrap a new organization')
  .requiredOption('--mission <mission>', 'Organization mission statement')
  .option('--template <template>', 'Org template to use', 'startup')
  .action(async (opts) => {
    console.log(`hive init — mission: "${opts.mission}", template: ${opts.template}`);
    console.log(chalk.dim('(Not yet implemented — see Plan 4)'));
  });

program
  .command('start')
  .description('Wake the organization')
  .action(async () => {
    console.log('hive start — not yet implemented (see Plan 3)');
  });

program
  .command('stop')
  .description('Graceful shutdown')
  .action(async () => {
    console.log('hive stop — not yet implemented (see Plan 3)');
  });

program.parse();
```

- [ ] **Step 2: Test manually with sample org**

```bash
cd /Users/superliaye/projects/hive
# Create a temporary org/ from fixtures for manual testing
cp -r tests/fixtures/sample-org org
npx tsx src/cli.ts org
npx tsx src/cli.ts status
# Clean up
rm -rf org
```

Expected: `hive org` prints a tree; `hive status` lists agents as idle.

- [ ] **Step 3: Write CLI integration tests**

Create `tests/cli/commands.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const FIXTURE_ORG = path.resolve(__dirname, '../fixtures/sample-org');
const TEMP_ORG = path.join(PROJECT_ROOT, 'org');

function runCli(args: string[]): string {
  return execFileSync('npx', ['tsx', 'src/cli.ts', ...args], {
    cwd: PROJECT_ROOT,
    encoding: 'utf-8',
    timeout: 10_000,
  });
}

describe('CLI commands', () => {
  beforeEach(() => {
    fs.cpSync(FIXTURE_ORG, TEMP_ORG, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEMP_ORG, { recursive: true, force: true });
    // Clean up any test DBs
    const dataDir = path.join(PROJECT_ROOT, 'data');
    if (fs.existsSync(dataDir)) {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('hive org prints the org chart', () => {
    const output = runCli(['org']);
    expect(output).toContain('Test CEO');
    expect(output).toContain('Engineer 1');
    expect(output).toContain('2 agents');
  });

  it('hive status lists agents', () => {
    const output = runCli(['status']);
    expect(output).toContain('idle');
    expect(output).toContain('Test CEO');
  });

  it('hive --help shows available commands', () => {
    const output = runCli(['--help']);
    expect(output).toContain('org');
    expect(output).toContain('status');
    expect(output).toContain('init');
    expect(output).toContain('start');
    expect(output).toContain('stop');
  });
});
```

- [ ] **Step 4: Run CLI tests**

```bash
npx vitest run tests/cli/commands.test.ts
```

Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts tests/cli/
git commit -m "feat: wire up hive org and hive status CLI commands with tests"
```

---

### Task 9: Skill Loader

**Files:**
- Create: `src/agents/skill-loader.ts`
- Create: `tests/agents/skill-loader.test.ts`

- [ ] **Step 1: Write tests**

Create `tests/agents/skill-loader.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { resolveSkillsForAgent } from '../../src/agents/skill-loader.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SKILLS_FIXTURE = path.resolve(__dirname, '../fixtures/sample-skills');

describe('resolveSkillsForAgent', () => {
  it('returns shared skills for any agent', () => {
    const skills = resolveSkillsForAgent('engineer', SKILLS_FIXTURE);
    // Fixture has shared/comms skill
    expect(skills.shared.length).toBe(1);
  });

  it('maps role keywords to skill directories', () => {
    const mapping = resolveSkillsForAgent('ceo', SKILLS_FIXTURE);
    expect(mapping.roleDir).toBe('ceo');
  });

  it('maps engineering roles correctly', () => {
    const mapping = resolveSkillsForAgent('Backend Software Engineer', SKILLS_FIXTURE);
    expect(mapping.roleDir).toBe('engineering');
  });

  it('resolves role-specific skills from fixture', () => {
    const skills = resolveSkillsForAgent('engineer', SKILLS_FIXTURE);
    expect(skills.role.length).toBe(1); // engineering/code-review
  });
});
```

- [ ] **Step 2: Implement skill loader**

Create `src/agents/skill-loader.ts`:

```typescript
import fs from 'fs';
import path from 'path';

const ROLE_MAPPING: Record<string, string> = {
  'ceo': 'ceo',
  'chief executive': 'ceo',
  'vp': 'engineering',
  'engineer': 'engineering',
  'developer': 'engineering',
  'backend': 'engineering',
  'frontend': 'engineering',
  'product': 'product',
  'pm': 'product',
  'designer': 'design',
  'design': 'design',
  'qa': 'testing',
  'test': 'testing',
  'tester': 'testing',
};

function matchRoleDir(role: string): string {
  const roleLower = role.toLowerCase();
  for (const [keyword, dir] of Object.entries(ROLE_MAPPING)) {
    if (roleLower.includes(keyword)) return dir;
  }
  return 'shared';
}

export interface SkillResolution {
  roleDir: string;
  shared: string[];    // Paths to shared skill dirs
  role: string[];      // Paths to role-specific skill dirs
}

export function resolveSkillsForAgent(role: string, skillsRoot: string): SkillResolution {
  const roleDir = matchRoleDir(role);
  const shared: string[] = [];
  const rolePaths: string[] = [];

  // Shared skills
  const sharedDir = path.join(skillsRoot, 'shared');
  if (fs.existsSync(sharedDir)) {
    const entries = fs.readdirSync(sharedDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        shared.push(path.join(sharedDir, entry.name));
      }
    }
  }

  // Role-specific skills
  const roleSkillDir = path.join(skillsRoot, roleDir);
  if (fs.existsSync(roleSkillDir)) {
    const entries = fs.readdirSync(roleSkillDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        rolePaths.push(path.join(roleSkillDir, entry.name));
      }
    }
  }

  return { roleDir, shared, role: rolePaths };
}

export function copySkillsToAgent(
  skills: SkillResolution,
  agentClaudeDir: string,
): void {
  const skillsDir = path.join(agentClaudeDir, 'skills');
  fs.mkdirSync(skillsDir, { recursive: true });

  const allSkills = [...skills.shared, ...skills.role];
  for (const skillPath of allSkills) {
    const skillName = path.basename(skillPath);
    const targetDir = path.join(skillsDir, skillName);

    if (!fs.existsSync(targetDir)) {
      // Copy the skill directory
      fs.cpSync(skillPath, targetDir, { recursive: true });
    }
  }
}
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run tests/agents/skill-loader.test.ts
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/agents/skill-loader.ts tests/agents/skill-loader.test.ts
git commit -m "feat: implement skill loader with role-based skill resolution"
```

---

### Task 10: Integration Test — Full Pipeline

**Files:**
- Create: `tests/integration/pipeline.test.ts`

- [ ] **Step 1: Write integration test**

Create `tests/integration/pipeline.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseOrgTree } from '../../src/org/parser.js';
import { loadAgentConfig } from '../../src/agents/config-loader.js';
import { assemblePrompt } from '../../src/agents/prompt-assembler.js';
import { buildClaudeArgs } from '../../src/agents/spawner.js';
import { AuditStore } from '../../src/audit/store.js';
import { AgentStateStore } from '../../src/state/agent-state.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/sample-org');
const TEST_AUDIT_DB = path.join(__dirname, '../fixtures/integration-audit.db');
const TEST_STATE_DB = path.join(__dirname, '../fixtures/integration-state.db');

describe('Full pipeline integration', () => {
  it('parses org → loads config → assembles prompt → builds args', async () => {
    // 1. Parse org tree
    const org = await parseOrgTree(FIXTURE_DIR);
    expect(org.agents.size).toBeGreaterThan(0);

    // 2. Load CEO config
    const ceo = org.root;
    expect(ceo.identity.name).toBe('Test CEO');

    // 3. Assemble prompt
    const prompt = assemblePrompt(ceo);
    expect(prompt.length).toBeGreaterThan(100);
    expect(prompt).toContain('CEO');

    // 4. Build claude args
    const args = buildClaudeArgs({
      model: ceo.identity.model,
      systemPrompt: prompt,
      tools: ceo.identity.tools,
    });
    expect(args).toContain('-p');
    expect(args).toContain('sonnet');
  });

  it('audit and state stores work together', () => {
    const auditStore = new AuditStore(TEST_AUDIT_DB);
    const stateStore = new AgentStateStore(TEST_STATE_DB);

    try {
      // Register agent
      stateStore.register('ceo');
      stateStore.updateStatus('ceo', 'working', { pid: process.pid, currentTask: 'triage' });

      // Log invocation
      auditStore.logInvocation({
        agentId: 'ceo',
        invocationType: 'triage',
        model: 'haiku',
        tokensIn: 500,
        tokensOut: 200,
        durationMs: 1500,
      });

      // Verify
      const state = stateStore.get('ceo');
      expect(state!.status).toBe('working');

      const invocations = auditStore.getInvocations({ agentId: 'ceo' });
      expect(invocations.length).toBe(1);
    } finally {
      auditStore.close();
      stateStore.close();
      try { fs.unlinkSync(TEST_AUDIT_DB); } catch {}
      try { fs.unlinkSync(TEST_STATE_DB); } catch {}
    }
  });
});
```

- [ ] **Step 2: Run all tests**

```bash
npx vitest run
```

Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add tests/integration/
git commit -m "test: add integration test covering full parse→load→assemble→build pipeline"
```

---

## Plan Summary

After completing Plan 1, you will have:
- A working `hive` CLI with `org` and `status` commands
- Org tree parser that reads folder structure → org chart model
- Agent config loader that reads YAML frontmatter + md files
- Prompt assembler that concatenates agent context
- Claude CLI spawner with arg builder (triage + main modes)
- SQLite audit store for invocation logging
- SQLite agent state store with stale PID detection
- Skill loader with role-based resolution
- Full test coverage with fixtures

**What comes next:**
- **Plan 2:** Communication layer (SqliteProvider, Canopy adapter, channel sync)
- **Plan 3:** Gateway & Orchestrator (scoring, triage, heartbeat loop, `hive start`/`stop`)
- **Plan 4:** Agent templates, skill library, `hive init` bootstrapping, proposal system
