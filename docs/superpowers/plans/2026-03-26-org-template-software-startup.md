# Org Template: software-startup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a manifest-driven org template system and a `software-startup` template that bootstraps a 13-agent software org via `hive init --template software-startup`.

**Architecture:** An org template is a JSON manifest listing agents with human names, role templates, and reporting chains. A new `instantiateFromManifest()` function reads the manifest, seeds the DB, then calls `provision()` for each agent in topological order (managers before reports). `hive init` is extended with `--template` to load a manifest instead of using hardcoded scaffold. The entire pipeline is validated with `runFullScan()` at the end.

**Tech Stack:** TypeScript, better-sqlite3, Vitest, Commander.js

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/org/manifest.ts` | Parse manifest, topological sort, `instantiateFromManifest()` |
| `org-templates/software-startup/manifest.json` | The template: 13 agents, human names, reporting chain |
| `src/cli.ts` | Extend `hive init` with `--template` option |
| `tests/org/manifest.test.ts` | Unit tests for manifest parsing + topological sort |
| `tests/org/instantiate.test.ts` | Integration test: full org creation + `runFullScan()` validation |

---

### Task 1: Define manifest types and parser

**Files:**
- Create: `src/org/manifest.ts`
- Test: `tests/org/manifest.test.ts`

- [ ] **Step 1: Write the failing tests for manifest parsing**

```typescript
// tests/org/manifest.test.ts
import { describe, it, expect } from 'vitest';
import { parseManifest, topologicalSort } from '../../src/org/manifest.js';

describe('parseManifest', () => {
  it('parses a valid manifest', () => {
    const manifest = parseManifest({
      name: 'Test Org',
      description: 'A test org',
      agents: [
        { alias: 'hiro', name: 'Hiro Tanaka', role: 'chief-executive', reports_to: 'super-user' },
        { alias: 'zoe', name: 'Zoe Chen', role: 'agent-resources', reports_to: 'hiro' },
      ],
    });

    expect(manifest.name).toBe('Test Org');
    expect(manifest.agents).toHaveLength(2);
    expect(manifest.agents[0].alias).toBe('hiro');
    expect(manifest.agents[0].role).toBe('chief-executive');
  });

  it('throws on duplicate aliases', () => {
    expect(() => parseManifest({
      name: 'Bad',
      agents: [
        { alias: 'hiro', name: 'Hiro', role: 'chief-executive', reports_to: 'super-user' },
        { alias: 'hiro', name: 'Hiro 2', role: 'manager', reports_to: 'hiro' },
      ],
    })).toThrow('Duplicate alias');
  });

  it('throws when reports_to references unknown alias', () => {
    expect(() => parseManifest({
      name: 'Bad',
      agents: [
        { alias: 'hiro', name: 'Hiro', role: 'chief-executive', reports_to: 'nobody' },
      ],
    })).toThrow('reports_to');
  });

  it('throws when no agent reports to super-user', () => {
    expect(() => parseManifest({
      name: 'Bad',
      agents: [
        { alias: 'hiro', name: 'Hiro', role: 'chief-executive', reports_to: 'zoe' },
        { alias: 'zoe', name: 'Zoe', role: 'manager', reports_to: 'hiro' },
      ],
    })).toThrow('root');
  });
});

describe('topologicalSort', () => {
  it('sorts managers before their reports', () => {
    const agents = [
      { alias: 'kai', name: 'Kai', role: 'software-engineer', reports_to: 'maya' },
      { alias: 'hiro', name: 'Hiro', role: 'chief-executive', reports_to: 'super-user' },
      { alias: 'maya', name: 'Maya', role: 'manager', reports_to: 'hiro' },
    ];

    const sorted = topologicalSort(agents);
    const aliases = sorted.map(a => a.alias);

    expect(aliases.indexOf('hiro')).toBeLessThan(aliases.indexOf('maya'));
    expect(aliases.indexOf('maya')).toBeLessThan(aliases.indexOf('kai'));
  });

  it('handles flat structure (all report to same manager)', () => {
    const agents = [
      { alias: 'hiro', name: 'Hiro', role: 'chief-executive', reports_to: 'super-user' },
      { alias: 'a', name: 'A', role: 'software-engineer', reports_to: 'hiro' },
      { alias: 'b', name: 'B', role: 'software-engineer', reports_to: 'hiro' },
    ];

    const sorted = topologicalSort(agents);
    expect(sorted[0].alias).toBe('hiro');
    expect(sorted).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/org/manifest.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement manifest types and parser**

```typescript
// src/org/manifest.ts
import fs from 'fs';
import path from 'path';

export interface ManifestAgent {
  alias: string;
  name: string;
  role: string;           // role-template name (e.g. "software-engineer")
  reports_to: string;     // alias of manager, or "super-user"
  title?: string;
  vibe?: string;
}

export interface OrgManifest {
  name: string;
  description?: string;
  agents: ManifestAgent[];
}

/**
 * Parse and validate a raw manifest object.
 */
export function parseManifest(raw: {
  name: string;
  description?: string;
  agents: Array<{ alias: string; name: string; role: string; reports_to: string; title?: string; vibe?: string }>;
}): OrgManifest {
  const agents = raw.agents;

  // Check for duplicate aliases
  const aliases = new Set<string>();
  for (const agent of agents) {
    if (aliases.has(agent.alias)) {
      throw new Error(`Duplicate alias "${agent.alias}" in manifest`);
    }
    aliases.add(agent.alias);
  }

  // Check all reports_to references are valid
  for (const agent of agents) {
    if (agent.reports_to !== 'super-user' && !aliases.has(agent.reports_to)) {
      throw new Error(`Agent "${agent.alias}" reports_to "${agent.reports_to}" which is not in the manifest`);
    }
  }

  // Check at least one agent reports to super-user (the root)
  const roots = agents.filter(a => a.reports_to === 'super-user');
  if (roots.length === 0) {
    throw new Error('Manifest must have at least one root agent (reports_to: "super-user")');
  }

  return {
    name: raw.name,
    description: raw.description,
    agents,
  };
}

/**
 * Topological sort: managers come before their reports.
 * Agents reporting to "super-user" come first.
 */
export function topologicalSort(agents: ManifestAgent[]): ManifestAgent[] {
  const byAlias = new Map(agents.map(a => [a.alias, a]));
  const sorted: ManifestAgent[] = [];
  const visited = new Set<string>();

  function visit(alias: string): void {
    if (visited.has(alias)) return;
    const agent = byAlias.get(alias);
    if (!agent) return;

    // Visit manager first (unless it's super-user)
    if (agent.reports_to !== 'super-user') {
      visit(agent.reports_to);
    }

    visited.add(alias);
    sorted.push(agent);
  }

  for (const agent of agents) {
    visit(agent.alias);
  }

  return sorted;
}

/**
 * Load a manifest from an org-templates directory.
 */
export function loadManifest(templateName: string, orgTemplatesDir: string): OrgManifest {
  const manifestPath = path.join(orgTemplatesDir, templateName, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Org template "${templateName}" not found at ${manifestPath}`);
  }
  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  return parseManifest(raw);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/org/manifest.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/org/manifest.ts tests/org/manifest.test.ts
git commit -m "feat(org-template): manifest parser with validation and topological sort"
```

---

### Task 2: Implement `instantiateFromManifest()`

**Files:**
- Modify: `src/org/manifest.ts`
- Test: `tests/org/instantiate.test.ts`

- [ ] **Step 6: Write the failing integration test**

This test creates a full 13-agent org from a manifest using in-memory DB + temp dirs, then runs `runFullScan()` to validate.

```typescript
// tests/org/instantiate.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { instantiateFromManifest } from '../../src/org/manifest.js';
import { runFullScan } from '../../src/validation/org-health.js';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Minimal role-template setup helper
function createRoleTemplates(baseDir: string): string {
  const templateDir = path.join(baseDir, 'role-templates');

  const roles: Record<string, { config: object; identity: string }> = {
    'chief-executive': {
      config: { name: 'Chief Executive Officer', model: 'claude-opus-4-6', emoji: '👔', skills: ['hive-comms', 'board-protocol', 'plan-review'] },
      identity: '# CEO\n\nYou are the CEO.',
    },
    'agent-resources': {
      config: { name: 'Agent Resources Manager', model: 'claude-opus-4-6', emoji: '🧬', skills: ['hive-comms', 'agent-provisioning', 'org-health'] },
      identity: '# AR\n\nYou manage agent creation.',
    },
    'manager': {
      config: { name: 'Manager', model: 'claude-opus-4-6', emoji: '📋', skills: ['hive-comms', 'retro'] },
      identity: '# Manager\n\nYou manage context for your team.',
    },
    'software-engineer': {
      config: { name: 'Software Engineer', model: 'claude-opus-4-6', emoji: '🔧', skills: ['hive-comms', 'code-lifecycle'] },
      identity: '# SWE\n\nYou build software.',
    },
    'qa-engineer': {
      config: { name: 'QA Engineer', model: 'claude-opus-4-6', emoji: '🧪', skills: ['hive-comms', 'code-lifecycle', 'test-strategy'] },
      identity: '# QA\n\nYou ensure quality.',
    },
    'product-manager': {
      config: { name: 'Product Manager', model: 'claude-opus-4-6', emoji: '📦', skills: ['hive-comms', 'product-review', 'spec-writing'] },
      identity: '# PM\n\nYou own the product.',
    },
  };

  for (const [name, data] of Object.entries(roles)) {
    const dir = path.join(templateDir, name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(data.config));
    fs.writeFileSync(path.join(dir, 'IDENTITY.md'), data.identity);
    fs.writeFileSync(path.join(dir, 'SOUL.md'), '# Soul\n\nCore traits here.\n');
    fs.writeFileSync(path.join(dir, 'BUREAU.md'), '## Reporting\n\nReports to: [populated on instantiation]\nDirect reports: none\n');
    fs.writeFileSync(path.join(dir, 'PRIORITIES.md'), '# Priorities\n\n## Active\n');
    fs.writeFileSync(path.join(dir, 'MEMORY.md'), '# Memory\n');
  }

  return templateDir;
}

// Minimal role-skills setup
function createRoleSkills(baseDir: string): string {
  const roleSkillsDir = path.join(baseDir, 'role-skills');
  const skills = [
    'hive-comms', 'board-protocol', 'plan-review', 'agent-provisioning',
    'org-health', 'retro', 'code-lifecycle', 'test-strategy',
    'product-review', 'spec-writing',
  ];
  for (const skill of skills) {
    fs.mkdirSync(path.join(roleSkillsDir, skill), { recursive: true });
    fs.writeFileSync(path.join(roleSkillsDir, skill, 'SKILL.md'), `# ${skill}\n`);
  }
  return roleSkillsDir;
}

const SOFTWARE_STARTUP_MANIFEST = {
  name: 'Software Startup',
  description: 'Small product team for building software',
  agents: [
    { alias: 'hiro', name: 'Hiro Tanaka', role: 'chief-executive', reports_to: 'super-user' },
    { alias: 'zoe', name: 'Zoe Chen', role: 'agent-resources', reports_to: 'hiro' },
    { alias: 'maya', name: 'Maya Patel', role: 'manager', reports_to: 'hiro', title: 'Engineering Lead' },
    { alias: 'sam', name: 'Sam Rivera', role: 'manager', reports_to: 'hiro', title: 'Engineering Lead' },
    { alias: 'jin', name: 'Jin Park', role: 'product-manager', reports_to: 'maya' },
    { alias: 'jules', name: 'Jules Moreau', role: 'product-manager', reports_to: 'sam' },
    { alias: 'kai', name: 'Kai Nakamura', role: 'software-engineer', reports_to: 'maya' },
    { alias: 'lena', name: 'Lena Kowalski', role: 'software-engineer', reports_to: 'maya' },
    { alias: 'ava', name: 'Ava Thompson', role: 'qa-engineer', reports_to: 'maya' },
    { alias: 'rio', name: 'Rio Santos', role: 'software-engineer', reports_to: 'sam' },
    { alias: 'noor', name: 'Noor Ali', role: 'software-engineer', reports_to: 'sam' },
    { alias: 'tess', name: 'Tess Bergman', role: 'qa-engineer', reports_to: 'sam' },
  ],
};

describe('instantiateFromManifest', () => {
  let tmpDir: string;
  let orgDir: string;
  let templateDir: string;
  let roleSkillsDir: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-manifest-'));
    orgDir = path.join(tmpDir, 'org');
    fs.mkdirSync(orgDir, { recursive: true });
    templateDir = createRoleTemplates(tmpDir);
    roleSkillsDir = createRoleSkills(tmpDir);

    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE people (
        id INTEGER PRIMARY KEY, alias TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
        role_template TEXT, status TEXT NOT NULL DEFAULT 'active', folder TEXT,
        reports_to INTEGER REFERENCES people(id), created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO people (id, alias, name, status) VALUES (0, 'super-user', 'Super User', 'active');
    `);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates all 12 agents from the software-startup manifest', () => {
    const result = instantiateFromManifest(SOFTWARE_STARTUP_MANIFEST, {
      db, orgDir, templateDir,
    });

    expect(result.agentsCreated).toHaveLength(12);
    expect(result.agentsCreated.map(a => a.alias)).toContain('hiro');
    expect(result.agentsCreated.map(a => a.alias)).toContain('tess');
  });

  it('creates correct folder structure for every agent', () => {
    instantiateFromManifest(SOFTWARE_STARTUP_MANIFEST, { db, orgDir, templateDir });

    // Every agent should have a folder
    const folders = fs.readdirSync(orgDir);
    expect(folders.length).toBe(12);

    // Each folder should have IDENTITY.md
    for (const folder of folders) {
      expect(fs.existsSync(path.join(orgDir, folder, 'IDENTITY.md'))).toBe(true);
    }
  });

  it('sets up correct reporting chain in DB', () => {
    instantiateFromManifest(SOFTWARE_STARTUP_MANIFEST, { db, orgDir, templateDir });

    // Hiro reports to super-user (id 0)
    const hiro = db.prepare('SELECT id, reports_to FROM people WHERE alias = ?').get('hiro') as any;
    expect(hiro.reports_to).toBe(0);

    // Maya reports to Hiro
    const maya = db.prepare('SELECT reports_to FROM people WHERE alias = ?').get('maya') as any;
    expect(maya.reports_to).toBe(hiro.id);

    // Kai reports to Maya
    const kai = db.prepare('SELECT reports_to FROM people WHERE alias = ?').get('kai') as any;
    expect(kai.reports_to).toBe(
      (db.prepare('SELECT id FROM people WHERE alias = ?').get('maya') as any).id
    );
  });

  it('writes BUREAU.md with correct reporting for leaf agents', () => {
    instantiateFromManifest(SOFTWARE_STARTUP_MANIFEST, { db, orgDir, templateDir });

    const kai = db.prepare('SELECT folder FROM people WHERE alias = ?').get('kai') as any;
    const bureau = fs.readFileSync(path.join(orgDir, kai.folder, 'BUREAU.md'), 'utf-8');
    expect(bureau).toContain('Reports to: @maya (Maya Patel)');
  });

  it('writes BUREAU.md with direct reports for managers', () => {
    instantiateFromManifest(SOFTWARE_STARTUP_MANIFEST, { db, orgDir, templateDir });

    const maya = db.prepare('SELECT folder FROM people WHERE alias = ?').get('maya') as any;
    const bureau = fs.readFileSync(path.join(orgDir, maya.folder, 'BUREAU.md'), 'utf-8');
    expect(bureau).toContain('@kai');
    expect(bureau).toContain('@lena');
    expect(bureau).toContain('@ava');
    expect(bureau).toContain('@jin');
  });

  it('passes runFullScan with zero errors', () => {
    instantiateFromManifest(SOFTWARE_STARTUP_MANIFEST, { db, orgDir, templateDir });

    const issues = runFullScan({ orgDir, db, roleSkillsDir });
    const errors = issues.filter(i => i.severity === 'error');
    if (errors.length > 0) {
      // Print errors for debugging
      for (const e of errors) console.error(`  [${e.code}] ${e.message}`);
    }
    expect(errors).toHaveLength(0);
  });

  it('returns warnings from post-provisioning checks', () => {
    const result = instantiateFromManifest(SOFTWARE_STARTUP_MANIFEST, { db, orgDir, templateDir });

    // Warnings are collected but not fatal
    expect(result.warnings).toBeDefined();
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('writes title to manager IDENTITY.md when provided', () => {
    instantiateFromManifest(SOFTWARE_STARTUP_MANIFEST, { db, orgDir, templateDir });

    const maya = db.prepare('SELECT folder FROM people WHERE alias = ?').get('maya') as any;
    const identity = fs.readFileSync(path.join(orgDir, maya.folder, 'IDENTITY.md'), 'utf-8');
    expect(identity).toContain('title: Engineering Lead');
  });
});
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `npx vitest run tests/org/instantiate.test.ts`
Expected: FAIL — `instantiateFromManifest` not exported

- [ ] **Step 8: Implement `instantiateFromManifest()`**

Add to `src/org/manifest.ts`:

```typescript
import Database from 'better-sqlite3';
import { provision } from './provision.js';

export interface InstantiateOptions {
  db: Database.Database;
  orgDir: string;
  templateDir: string;
}

export interface InstantiateResult {
  agentsCreated: Array<{ alias: string; name: string; folder: string }>;
  warnings: string[];
}

/**
 * Create a full org from a manifest.
 * Agents are provisioned in topological order (managers before reports).
 */
export function instantiateFromManifest(
  rawManifest: Parameters<typeof parseManifest>[0],
  opts: InstantiateOptions,
): InstantiateResult {
  const manifest = parseManifest(rawManifest);
  const sorted = topologicalSort(manifest.agents);

  const agentsCreated: InstantiateResult['agentsCreated'] = [];
  const allWarnings: string[] = [];

  for (const agent of sorted) {
    const result = provision(
      {
        alias: agent.alias,
        name: agent.name,
        roleTemplate: agent.role,
        reportsTo: agent.reports_to === 'super-user' ? 'super-user' : agent.reports_to,
        vibe: agent.vibe,
      },
      opts.db,
      opts.orgDir,
      opts.templateDir,
    );

    // Write title to frontmatter if provided
    if (agent.title) {
      const identityPath = path.join(result.dir, 'IDENTITY.md');
      let content = fs.readFileSync(identityPath, 'utf-8');
      content = content.replace(/^title:.*$/m, `title: ${agent.title}`);
      fs.writeFileSync(identityPath, content);
    }

    agentsCreated.push({ alias: agent.alias, name: agent.name, folder: result.folder });
    allWarnings.push(...result.warnings);
  }

  return { agentsCreated, warnings: allWarnings };
}
```

Note: `provision()` uses `reportsTo` as an alias and looks it up in the DB. For agents that report to super-user, the alias is `'super-user'` which is seeded in the people table by `ChatDb.init()`.

- [ ] **Step 9: Run tests to verify they pass**

Run: `npx vitest run tests/org/instantiate.test.ts`
Expected: PASS (all 7 tests)

- [ ] **Step 10: Commit**

```bash
git add src/org/manifest.ts tests/org/instantiate.test.ts
git commit -m "feat(org-template): instantiateFromManifest creates full org from manifest"
```

---

### Task 3: Create the software-startup manifest

**Files:**
- Create: `org-templates/software-startup/manifest.json`

- [ ] **Step 11: Write the manifest file**

```json
{
  "name": "Software Startup",
  "description": "Small product team — CEO leads two cross-functional squads, each with a manager, PM, 2 SWEs, and a QA.",
  "agents": [
    {
      "alias": "hiro",
      "name": "Hiro Tanaka",
      "role": "chief-executive",
      "reports_to": "super-user"
    },
    {
      "alias": "zoe",
      "name": "Zoe Chen",
      "role": "agent-resources",
      "reports_to": "hiro"
    },
    {
      "alias": "maya",
      "name": "Maya Patel",
      "role": "manager",
      "reports_to": "hiro",
      "title": "Engineering Lead"
    },
    {
      "alias": "sam",
      "name": "Sam Rivera",
      "role": "manager",
      "reports_to": "hiro",
      "title": "Engineering Lead"
    },
    {
      "alias": "jin",
      "name": "Jin Park",
      "role": "product-manager",
      "reports_to": "maya"
    },
    {
      "alias": "jules",
      "name": "Jules Moreau",
      "role": "product-manager",
      "reports_to": "sam"
    },
    {
      "alias": "kai",
      "name": "Kai Nakamura",
      "role": "software-engineer",
      "reports_to": "maya"
    },
    {
      "alias": "lena",
      "name": "Lena Kowalski",
      "role": "software-engineer",
      "reports_to": "maya"
    },
    {
      "alias": "ava",
      "name": "Ava Thompson",
      "role": "qa-engineer",
      "reports_to": "maya"
    },
    {
      "alias": "rio",
      "name": "Rio Santos",
      "role": "software-engineer",
      "reports_to": "sam"
    },
    {
      "alias": "noor",
      "name": "Noor Ali",
      "role": "software-engineer",
      "reports_to": "sam"
    },
    {
      "alias": "tess",
      "name": "Tess Bergman",
      "role": "qa-engineer",
      "reports_to": "sam"
    }
  ]
}
```

- [ ] **Step 12: Write a test that loads the actual manifest file**

Add to `tests/org/manifest.test.ts`:

```typescript
import { loadManifest } from '../../src/org/manifest.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ORG_TEMPLATES_DIR = path.resolve(__dirname, '../../org-templates');

describe('loadManifest', () => {
  it('loads software-startup manifest from disk', () => {
    const manifest = loadManifest('software-startup', ORG_TEMPLATES_DIR);
    expect(manifest.name).toBe('Software Startup');
    expect(manifest.agents).toHaveLength(12);

    // Check all aliases are human names
    for (const agent of manifest.agents) {
      expect(agent.alias).not.toMatch(/^(ceo|ar|pm|qa|eng|swe|mgr)/);
    }

    // Check exactly one root
    const roots = manifest.agents.filter(a => a.reports_to === 'super-user');
    expect(roots).toHaveLength(1);
    expect(roots[0].alias).toBe('hiro');
  });

  it('has all required role templates', () => {
    const manifest = loadManifest('software-startup', ORG_TEMPLATES_DIR);
    const roles = new Set(manifest.agents.map(a => a.role));
    expect(roles).toContain('chief-executive');
    expect(roles).toContain('agent-resources');
    expect(roles).toContain('manager');
    expect(roles).toContain('software-engineer');
    expect(roles).toContain('qa-engineer');
    expect(roles).toContain('product-manager');
  });
});
```

- [ ] **Step 13: Run tests to verify they pass**

Run: `npx vitest run tests/org/manifest.test.ts`
Expected: PASS

- [ ] **Step 14: Commit**

```bash
git add org-templates/software-startup/manifest.json tests/org/manifest.test.ts
git commit -m "feat(org-template): software-startup manifest — 12 agents, 2 squads"
```

---

### Task 4: Extend `hive init` with `--template` option

**Files:**
- Modify: `src/org/scaffold.ts`
- Modify: `src/cli.ts`

- [ ] **Step 15: Add `scaffoldFromManifest()` to scaffold.ts**

This function creates org/ORG.md and the data/ directory with a seeded DB, then calls `instantiateFromManifest()`.

Add to `src/org/scaffold.ts`:

```typescript
import Database from 'better-sqlite3';
import { loadManifest, instantiateFromManifest } from './manifest.js';

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
```

- [ ] **Step 16: Extend `hive init` CLI with --template**

In `src/cli.ts`, modify the `hive init` command (currently at line 97):

Replace the existing `hive init` action with:

```typescript
program
  .command('init')
  .description('Bootstrap a new organization')
  .requiredOption('--mission <mission>', 'Organization mission statement')
  .option('--timezone <tz>', 'Organization timezone', 'America/Los_Angeles')
  .option('--template <name>', 'Org template to use (e.g., "software-startup")')
  .action(async (opts) => {
    const targetDir = process.cwd();
    const orgDir = path.join(targetDir, 'org');

    if (fs.existsSync(orgDir)) {
      console.error(chalk.red('org/ directory already exists. Cannot re-initialize.'));
      process.exit(1);
    }

    if (opts.template) {
      // Template-based init
      const { scaffoldFromManifest } = await import('./org/scaffold.js');

      try {
        const result = scaffoldFromManifest({
          targetDir,
          mission: opts.mission,
          timezone: opts.timezone,
          templateName: opts.template,
        });

        console.log(chalk.green(`✔ Organization bootstrapped from template "${opts.template}"!\n`));
        console.log(`  ${chalk.bold('Mission:')} ${opts.mission}`);
        console.log(`  ${chalk.bold('Agents:')} ${result.agentsCreated.length}`);
        for (const alias of result.agentsCreated) {
          console.log(`    - @${alias}`);
        }

        if (result.warnings.length > 0) {
          console.log('');
          for (const w of result.warnings) {
            console.log(chalk.yellow(`  ⚠ ${w}`));
          }
        }

        console.log(`\n  ${chalk.dim('Next: hive start')}`);
      } catch (err) {
        console.error(chalk.red(`Failed: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
    } else {
      // Default: hardcoded CEO + AR
      const result = scaffold({
        targetDir,
        mission: opts.mission,
        timezone: opts.timezone,
      });

      console.log(chalk.green('✔ Organization bootstrapped!\n'));
      console.log(`  ${chalk.bold('Mission:')} ${opts.mission}`);
      console.log(`  ${chalk.bold('Agents:')} ${result.agentsCreated.join(', ')}`);
      console.log(`\n  ${chalk.dim('Next: hive start')}`);
    }
  });
```

- [ ] **Step 17: Run all tests to verify nothing broke**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 18: Commit**

```bash
git add src/org/scaffold.ts src/cli.ts
git commit -m "feat: hive init --template loads org from manifest"
```

---

### Task 5: End-to-end CLI test for template init

**Files:**
- Create: `tests/cli/init-template.test.ts`

- [ ] **Step 19: Write end-to-end CLI test**

```typescript
// tests/cli/init-template.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';

describe('hive init --template', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-init-tmpl-'));

    // Copy real role-templates and org-templates to tmpDir
    const hiveRoot = path.resolve(process.cwd());
    fs.cpSync(path.join(hiveRoot, 'role-templates'), path.join(tmpDir, 'role-templates'), { recursive: true });
    fs.cpSync(path.join(hiveRoot, 'org-templates'), path.join(tmpDir, 'org-templates'), { recursive: true });

    // Copy role-skills (needed for skill copying during provision)
    fs.cpSync(path.join(hiveRoot, 'role-skills'), path.join(tmpDir, 'role-skills'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a full software-startup org via CLI', () => {
    const cliPath = path.resolve(process.cwd(), 'src/cli.ts');
    const output = execFileSync('npx', [
      'tsx', cliPath, 'init',
      '--mission', 'Build the best product',
      '--template', 'software-startup',
    ], {
      cwd: tmpDir,
      encoding: 'utf-8',
      timeout: 30000,
    });

    expect(output).toContain('bootstrapped from template');
    expect(output).toContain('@hiro');
    expect(output).toContain('@tess');

    // Verify org/ directory structure
    const orgDir = path.join(tmpDir, 'org');
    expect(fs.existsSync(orgDir)).toBe(true);
    const folders = fs.readdirSync(orgDir).filter(f =>
      fs.statSync(path.join(orgDir, f)).isDirectory()
    );
    expect(folders).toHaveLength(12);

    // Verify DB was created with all agents
    const db = new Database(path.join(tmpDir, 'data', 'hive.db'));
    const agents = db.prepare('SELECT alias FROM people WHERE status = ? AND alias != ?').all('active', 'super-user') as { alias: string }[];
    expect(agents).toHaveLength(12);
    db.close();

    // Verify ORG.md
    const orgMd = fs.readFileSync(path.join(orgDir, 'ORG.md'), 'utf-8');
    expect(orgMd).toContain('Build the best product');
  });

  it('runs hive doctor on the created org with no errors', () => {
    const cliPath = path.resolve(process.cwd(), 'src/cli.ts');

    // First, init
    execFileSync('npx', [
      'tsx', cliPath, 'init',
      '--mission', 'Build the best product',
      '--template', 'software-startup',
    ], { cwd: tmpDir, encoding: 'utf-8', timeout: 30000 });

    // Then, doctor
    const doctorOutput = execFileSync('npx', [
      'tsx', cliPath, 'doctor',
    ], { cwd: tmpDir, encoding: 'utf-8', timeout: 30000 });

    expect(doctorOutput).toContain('healthy');
  });
});
```

- [ ] **Step 20: Run the e2e test**

Run: `npx vitest run tests/cli/init-template.test.ts`
Expected: PASS

- [ ] **Step 21: Run full suite one final time**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 22: Run type check**

Run: `npx tsc --noEmit`
Expected: No new errors

- [ ] **Step 23: Commit**

```bash
git add tests/cli/init-template.test.ts
git commit -m "test: end-to-end test for hive init --template software-startup"
```

---

## Org Structure Summary

```
Super User (you)
└── Hiro Tanaka (CEO)
    ├── Zoe Chen (Agent Resources)
    ├── Maya Patel (Engineering Lead)
    │   ├── Jin Park (Product Manager)
    │   ├── Kai Nakamura (SWE)
    │   ├── Lena Kowalski (SWE)
    │   └── Ava Thompson (QA)
    └── Sam Rivera (Engineering Lead)
        ├── Jules Moreau (Product Manager)
        ├── Rio Santos (SWE)
        ├── Noor Ali (SWE)
        └── Tess Bergman (QA)
```

**12 agents** (CEO + AR + 2 managers + 2 PMs + 4 SWEs + 2 QAs), all with human names.
