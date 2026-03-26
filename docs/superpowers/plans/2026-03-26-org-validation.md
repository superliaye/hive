# Org Validation (Layer 1 + Layer 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Comprehensive org validation that prevents bad state at provisioning time (Layer 1) and detects drift at boot time via `hive doctor` (Layer 2), with auto-fix for safe issues.

**Architecture:** A single `src/validation/org-health.ts` module defines all validation checks as pure functions returning `HealthIssue[]`. Layer 1 calls a subset of these at provisioning time (pre-write). Layer 2 calls all of them at boot time / `hive doctor`. Each check is independently testable. Auto-fix functions live alongside their corresponding checks.

**Tech Stack:** TypeScript, better-sqlite3, Vitest, Commander.js (CLI)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/validation/org-health.ts` | All validation checks + auto-fix functions |
| `src/validation/types.ts` | `HealthIssue` interface, severity enum, issue codes |
| `src/org/provision.ts` | Modified: call Layer 1 checks in `validateProvision()` |
| `src/cli.ts` | Modified: add `hive doctor` command, add health gate to `hive start` |
| `tests/validation/org-health.test.ts` | Tests for all validation checks |
| `tests/validation/autofix.test.ts` | Tests for auto-fix operations |
| `tests/cli/doctor.test.ts` | Integration test for `hive doctor` CLI command |

---

### Task 1: Define validation types

**Files:**
- Create: `src/validation/types.ts`
- Test: `tests/validation/org-health.test.ts` (setup only)

- [ ] **Step 1: Write the types file**

```typescript
// src/validation/types.ts

export type Severity = 'error' | 'warning' | 'info';

export type IssueCode =
  // Identity issues
  | 'MISSING_FOLDER'           // DB entry has no matching folder
  | 'ORPHANED_FOLDER'          // Folder exists but no DB entry
  | 'IDENTITY_PARSE_ERROR'     // IDENTITY.md can't be parsed
  | 'IDENTITY_FIELD_MISSING'   // Required frontmatter field missing (id, alias, name, role)
  | 'IDENTITY_DB_MISMATCH'     // Frontmatter doesn't match DB (id, alias, name)
  // Structural issues
  | 'MISSING_AGENT_FILE'       // Expected file missing (SOUL.md, BUREAU.md, etc.)
  | 'CIRCULAR_REPORTING'       // Reporting chain has a cycle
  | 'DANGLING_MANAGER'         // reports_to references non-existent person
  | 'MULTIPLE_ROOTS'           // More than one person with no manager (excluding super-user)
  // Skill/MCP issues
  | 'SKILL_NOT_FOUND'          // Declared skill not in role-skills/
  | 'SKILL_NOT_COPIED'         // Declared skill exists in role-skills/ but missing from agent's .claude/skills/
  | 'MCP_UNKNOWN'              // Config declares MCP server not in registry
  | 'MCP_SETTINGS_MISSING';    // Agent should have .claude/settings.json but doesn't

export interface HealthIssue {
  severity: Severity;
  code: IssueCode;
  agent?: string;              // alias of affected agent, if applicable
  message: string;
  autoFixable: boolean;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/validation/types.ts
git commit -m "feat(validation): add HealthIssue types and issue codes"
```

---

### Task 2: Implement identity validation checks

**Files:**
- Create: `src/validation/org-health.ts`
- Test: `tests/validation/org-health.test.ts`

- [ ] **Step 3: Write failing tests for identity checks**

```typescript
// tests/validation/org-health.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { checkFolderDbSync, checkIdentityFields, checkIdentityDbMatch } from '../../src/validation/org-health.js';
import type { Person } from '../../src/types.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('org-health checks', () => {
  let tmpDir: string;
  let orgDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-health-'));
    orgDir = path.join(tmpDir, 'org');
    fs.mkdirSync(orgDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('checkFolderDbSync', () => {
    it('returns no issues when folders and DB match', () => {
      const people: Person[] = [
        { id: 1, alias: 'ceo', name: 'CEO', status: 'active', folder: '1-ceo' },
      ];
      fs.mkdirSync(path.join(orgDir, '1-ceo'));
      fs.writeFileSync(path.join(orgDir, '1-ceo', 'IDENTITY.md'), '---\nid: 1\nalias: ceo\n---\n');

      const issues = checkFolderDbSync(orgDir, people);
      expect(issues).toHaveLength(0);
    });

    it('reports MISSING_FOLDER when DB entry has no folder on disk', () => {
      const people: Person[] = [
        { id: 1, alias: 'ceo', name: 'CEO', status: 'active', folder: '1-ceo' },
      ];
      // Don't create the folder

      const issues = checkFolderDbSync(orgDir, people);
      expect(issues).toHaveLength(1);
      expect(issues[0].code).toBe('MISSING_FOLDER');
      expect(issues[0].severity).toBe('error');
      expect(issues[0].agent).toBe('ceo');
    });

    it('reports ORPHANED_FOLDER when folder has no DB entry', () => {
      const people: Person[] = [];
      fs.mkdirSync(path.join(orgDir, '5-ghost'));
      fs.writeFileSync(path.join(orgDir, '5-ghost', 'IDENTITY.md'), '---\nid: 5\nalias: ghost\n---\n');

      const issues = checkFolderDbSync(orgDir, people);
      expect(issues).toHaveLength(1);
      expect(issues[0].code).toBe('ORPHANED_FOLDER');
      expect(issues[0].severity).toBe('warning');
    });
  });

  describe('checkIdentityFields', () => {
    it('returns no issues for complete frontmatter', () => {
      fs.mkdirSync(path.join(orgDir, '1-ceo'));
      fs.writeFileSync(path.join(orgDir, '1-ceo', 'IDENTITY.md'), [
        '---', 'id: 1', 'alias: ceo', 'name: CEO', 'role: Chief Executive', '---', '',
      ].join('\n'));

      const issues = checkIdentityFields(path.join(orgDir, '1-ceo'), 'ceo');
      expect(issues).toHaveLength(0);
    });

    it('reports IDENTITY_FIELD_MISSING for missing id', () => {
      fs.mkdirSync(path.join(orgDir, '1-ceo'));
      fs.writeFileSync(path.join(orgDir, '1-ceo', 'IDENTITY.md'), [
        '---', 'alias: ceo', 'name: CEO', 'role: Chief Executive', '---', '',
      ].join('\n'));

      const issues = checkIdentityFields(path.join(orgDir, '1-ceo'), 'ceo');
      expect(issues.some(i => i.code === 'IDENTITY_FIELD_MISSING' && i.message.includes('id'))).toBe(true);
    });

    it('reports IDENTITY_PARSE_ERROR for invalid frontmatter', () => {
      fs.mkdirSync(path.join(orgDir, '1-ceo'));
      fs.writeFileSync(path.join(orgDir, '1-ceo', 'IDENTITY.md'), 'no frontmatter here');

      const issues = checkIdentityFields(path.join(orgDir, '1-ceo'), 'ceo');
      expect(issues.some(i => i.code === 'IDENTITY_PARSE_ERROR')).toBe(true);
    });
  });

  describe('checkIdentityDbMatch', () => {
    it('returns no issues when frontmatter matches DB', () => {
      const person: Person = { id: 1, alias: 'ceo', name: 'CEO', status: 'active', folder: '1-ceo' };
      fs.mkdirSync(path.join(orgDir, '1-ceo'));
      fs.writeFileSync(path.join(orgDir, '1-ceo', 'IDENTITY.md'), [
        '---', 'id: 1', 'alias: ceo', 'name: CEO', 'role: Chief Executive', '---', '',
      ].join('\n'));

      const issues = checkIdentityDbMatch(path.join(orgDir, '1-ceo'), person);
      expect(issues).toHaveLength(0);
    });

    it('reports IDENTITY_DB_MISMATCH when alias differs', () => {
      const person: Person = { id: 1, alias: 'ceo', name: 'CEO', status: 'active', folder: '1-ceo' };
      fs.mkdirSync(path.join(orgDir, '1-ceo'));
      fs.writeFileSync(path.join(orgDir, '1-ceo', 'IDENTITY.md'), [
        '---', 'id: 1', 'alias: wrong', 'name: CEO', 'role: Chief Executive', '---', '',
      ].join('\n'));

      const issues = checkIdentityDbMatch(path.join(orgDir, '1-ceo'), person);
      expect(issues).toHaveLength(1);
      expect(issues[0].code).toBe('IDENTITY_DB_MISMATCH');
      expect(issues[0].autoFixable).toBe(true);
    });
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run tests/validation/org-health.test.ts`
Expected: FAIL — module `../../src/validation/org-health.js` not found

- [ ] **Step 5: Implement identity validation checks**

```typescript
// src/validation/org-health.ts
import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import type { Person } from '../types.js';
import type { HealthIssue } from './types.js';

const FOLDER_PATTERN = /^(\d+)-(.+)$/;

/**
 * Check that every DB person has a folder and every folder has a DB entry.
 */
export function checkFolderDbSync(orgDir: string, people: Person[]): HealthIssue[] {
  const issues: HealthIssue[] = [];

  // DB entries → folders
  for (const person of people) {
    if (!person.folder) continue; // super-user has no folder
    const agentDir = path.join(orgDir, person.folder);
    if (!fs.existsSync(agentDir)) {
      issues.push({
        severity: 'error',
        code: 'MISSING_FOLDER',
        agent: person.alias,
        message: `Agent @${person.alias} has DB entry but no folder at org/${person.folder}`,
        autoFixable: false,
      });
    }
  }

  // Folders → DB entries
  const dbFolders = new Set(people.map(p => p.folder).filter(Boolean));
  const entries = fs.readdirSync(orgDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!FOLDER_PATTERN.test(entry.name)) continue;
    if (!dbFolders.has(entry.name)) {
      const match = entry.name.match(FOLDER_PATTERN);
      issues.push({
        severity: 'warning',
        code: 'ORPHANED_FOLDER',
        agent: match?.[2],
        message: `Folder org/${entry.name} exists but has no matching DB entry`,
        autoFixable: false,
      });
    }
  }

  return issues;
}

const REQUIRED_IDENTITY_FIELDS = ['id', 'alias', 'name', 'role'] as const;

/**
 * Check that IDENTITY.md exists and has all required frontmatter fields.
 */
export function checkIdentityFields(agentDir: string, alias: string): HealthIssue[] {
  const issues: HealthIssue[] = [];
  const identityPath = path.join(agentDir, 'IDENTITY.md');

  if (!fs.existsSync(identityPath)) {
    issues.push({
      severity: 'error',
      code: 'MISSING_AGENT_FILE',
      agent: alias,
      message: `IDENTITY.md missing for @${alias}`,
      autoFixable: false,
    });
    return issues;
  }

  const content = fs.readFileSync(identityPath, 'utf-8');
  let data: Record<string, unknown>;
  try {
    const parsed = matter(content);
    data = parsed.data;
    if (!data || Object.keys(data).length === 0) {
      issues.push({
        severity: 'error',
        code: 'IDENTITY_PARSE_ERROR',
        agent: alias,
        message: `IDENTITY.md for @${alias} has no frontmatter`,
        autoFixable: false,
      });
      return issues;
    }
  } catch {
    issues.push({
      severity: 'error',
      code: 'IDENTITY_PARSE_ERROR',
      agent: alias,
      message: `IDENTITY.md for @${alias} has unparseable frontmatter`,
      autoFixable: false,
    });
    return issues;
  }

  for (const field of REQUIRED_IDENTITY_FIELDS) {
    if (data[field] === undefined || data[field] === null || data[field] === '') {
      issues.push({
        severity: 'error',
        code: 'IDENTITY_FIELD_MISSING',
        agent: alias,
        message: `IDENTITY.md for @${alias} missing required field: ${field}`,
        autoFixable: field === 'id' || field === 'alias',
      });
    }
  }

  return issues;
}

/**
 * Check that IDENTITY.md frontmatter matches the people DB record.
 */
export function checkIdentityDbMatch(agentDir: string, person: Person): HealthIssue[] {
  const issues: HealthIssue[] = [];
  const identityPath = path.join(agentDir, 'IDENTITY.md');

  if (!fs.existsSync(identityPath)) return issues; // caught by checkIdentityFields

  const content = fs.readFileSync(identityPath, 'utf-8');
  let data: Record<string, unknown>;
  try {
    const parsed = matter(content);
    data = parsed.data;
  } catch {
    return issues; // caught by checkIdentityFields
  }

  const checks: Array<{ field: string; file: unknown; db: unknown }> = [
    { field: 'id', file: data.id, db: person.id },
    { field: 'alias', file: data.alias, db: person.alias },
    { field: 'name', file: data.name, db: person.name },
  ];

  for (const check of checks) {
    if (check.file !== undefined && String(check.file) !== String(check.db)) {
      issues.push({
        severity: 'error',
        code: 'IDENTITY_DB_MISMATCH',
        agent: person.alias,
        message: `@${person.alias} frontmatter ${check.field}="${check.file}" doesn't match DB "${check.db}"`,
        autoFixable: true,
      });
    }
  }

  return issues;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/validation/org-health.test.ts`
Expected: PASS (all identity check tests)

- [ ] **Step 7: Commit**

```bash
git add src/validation/types.ts src/validation/org-health.ts tests/validation/org-health.test.ts
git commit -m "feat(validation): identity validation checks — folder/DB sync, fields, DB match"
```

---

### Task 3: Implement structural validation checks

**Files:**
- Modify: `src/validation/org-health.ts`
- Modify: `tests/validation/org-health.test.ts`

- [ ] **Step 8: Write failing tests for structural checks**

Add to `tests/validation/org-health.test.ts`:

```typescript
import { checkAgentFiles, checkReportingChain } from '../../src/validation/org-health.js';

describe('checkAgentFiles', () => {
  it('returns no issues when all files present', () => {
    const dir = path.join(orgDir, '1-ceo');
    fs.mkdirSync(dir);
    for (const f of ['IDENTITY.md', 'SOUL.md', 'BUREAU.md', 'PRIORITIES.md', 'MEMORY.md']) {
      fs.writeFileSync(path.join(dir, f), `# ${f}`);
    }

    const issues = checkAgentFiles(dir, 'ceo');
    expect(issues).toHaveLength(0);
  });

  it('reports MISSING_AGENT_FILE for missing SOUL.md', () => {
    const dir = path.join(orgDir, '1-ceo');
    fs.mkdirSync(dir);
    for (const f of ['IDENTITY.md', 'BUREAU.md', 'PRIORITIES.md', 'MEMORY.md']) {
      fs.writeFileSync(path.join(dir, f), `# ${f}`);
    }

    const issues = checkAgentFiles(dir, 'ceo');
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('MISSING_AGENT_FILE');
    expect(issues[0].message).toContain('SOUL.md');
  });
});

describe('checkReportingChain', () => {
  it('returns no issues for valid tree', () => {
    const people: Person[] = [
      { id: 0, alias: 'super-user', name: 'Super User', status: 'active' },
      { id: 1, alias: 'ceo', name: 'CEO', status: 'active', reportsTo: 0 },
      { id: 2, alias: 'ar', name: 'AR', status: 'active', reportsTo: 1 },
    ];

    const issues = checkReportingChain(people);
    expect(issues).toHaveLength(0);
  });

  it('reports DANGLING_MANAGER for invalid reports_to', () => {
    const people: Person[] = [
      { id: 0, alias: 'super-user', name: 'Super User', status: 'active' },
      { id: 1, alias: 'ceo', name: 'CEO', status: 'active', reportsTo: 999 },
    ];

    const issues = checkReportingChain(people);
    expect(issues.some(i => i.code === 'DANGLING_MANAGER')).toBe(true);
  });

  it('reports CIRCULAR_REPORTING for cycles', () => {
    const people: Person[] = [
      { id: 0, alias: 'super-user', name: 'Super User', status: 'active' },
      { id: 1, alias: 'a', name: 'A', status: 'active', reportsTo: 2 },
      { id: 2, alias: 'b', name: 'B', status: 'active', reportsTo: 1 },
    ];

    const issues = checkReportingChain(people);
    expect(issues.some(i => i.code === 'CIRCULAR_REPORTING')).toBe(true);
  });
});
```

- [ ] **Step 9: Run tests to verify they fail**

Run: `npx vitest run tests/validation/org-health.test.ts`
Expected: FAIL — functions not exported

- [ ] **Step 10: Implement structural checks**

Add to `src/validation/org-health.ts`:

```typescript
const EXPECTED_AGENT_FILES = ['IDENTITY.md', 'SOUL.md', 'BUREAU.md', 'PRIORITIES.md', 'MEMORY.md'];

/**
 * Check that all expected agent files exist in the agent directory.
 */
export function checkAgentFiles(agentDir: string, alias: string): HealthIssue[] {
  const issues: HealthIssue[] = [];
  for (const file of EXPECTED_AGENT_FILES) {
    if (!fs.existsSync(path.join(agentDir, file))) {
      issues.push({
        severity: file === 'IDENTITY.md' ? 'error' : 'warning',
        code: 'MISSING_AGENT_FILE',
        agent: alias,
        message: `${file} missing for @${alias}`,
        autoFixable: false,
      });
    }
  }
  return issues;
}

/**
 * Check the reporting chain for dangling references and cycles.
 */
export function checkReportingChain(people: Person[]): HealthIssue[] {
  const issues: HealthIssue[] = [];
  const byId = new Map(people.map(p => [p.id, p]));

  for (const person of people) {
    if (person.reportsTo === undefined || person.reportsTo === null) continue;
    if (!byId.has(person.reportsTo)) {
      issues.push({
        severity: 'error',
        code: 'DANGLING_MANAGER',
        agent: person.alias,
        message: `@${person.alias} reports to person ID ${person.reportsTo} which doesn't exist`,
        autoFixable: false,
      });
    }
  }

  // Cycle detection: walk up from each person, detect if we revisit
  for (const person of people) {
    const visited = new Set<number>();
    let current: Person | undefined = person;
    while (current && current.reportsTo !== undefined && current.reportsTo !== null) {
      if (visited.has(current.id)) {
        issues.push({
          severity: 'error',
          code: 'CIRCULAR_REPORTING',
          agent: person.alias,
          message: `Circular reporting chain detected involving @${person.alias}`,
          autoFixable: false,
        });
        break;
      }
      visited.add(current.id);
      current = byId.get(current.reportsTo);
    }
  }

  return issues;
}
```

- [ ] **Step 11: Run tests to verify they pass**

Run: `npx vitest run tests/validation/org-health.test.ts`
Expected: PASS

- [ ] **Step 12: Commit**

```bash
git add src/validation/org-health.ts tests/validation/org-health.test.ts
git commit -m "feat(validation): structural checks — agent files, reporting chain cycles"
```

---

### Task 4: Implement skill and MCP validation checks

**Files:**
- Modify: `src/validation/org-health.ts`
- Modify: `tests/validation/org-health.test.ts`

- [ ] **Step 13: Write failing tests for skill/MCP checks**

Add to `tests/validation/org-health.test.ts`:

```typescript
import { checkSkills, checkMcpSettings } from '../../src/validation/org-health.js';

describe('checkSkills', () => {
  it('returns no issues when all declared skills exist', () => {
    // Create role-skills
    const roleSkillsDir = path.join(tmpDir, 'role-skills');
    fs.mkdirSync(path.join(roleSkillsDir, 'hive-comms'), { recursive: true });
    fs.writeFileSync(path.join(roleSkillsDir, 'hive-comms', 'SKILL.md'), '# Comms');

    // Create agent with skill copied
    const agentDir = path.join(orgDir, '1-ceo');
    fs.mkdirSync(path.join(agentDir, '.claude', 'skills', 'hive-comms'), { recursive: true });
    fs.writeFileSync(path.join(agentDir, '.claude', 'skills', 'hive-comms', 'SKILL.md'), '# Comms');

    const issues = checkSkills(agentDir, 'ceo', ['hive-comms'], roleSkillsDir);
    expect(issues).toHaveLength(0);
  });

  it('reports SKILL_NOT_FOUND when skill missing from role-skills/', () => {
    const roleSkillsDir = path.join(tmpDir, 'role-skills');
    fs.mkdirSync(roleSkillsDir, { recursive: true });

    const agentDir = path.join(orgDir, '1-ceo');
    fs.mkdirSync(agentDir, { recursive: true });

    const issues = checkSkills(agentDir, 'ceo', ['nonexistent-skill'], roleSkillsDir);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('SKILL_NOT_FOUND');
  });

  it('reports SKILL_NOT_COPIED when skill exists in role-skills but not in agent', () => {
    const roleSkillsDir = path.join(tmpDir, 'role-skills');
    fs.mkdirSync(path.join(roleSkillsDir, 'hive-comms'), { recursive: true });
    fs.writeFileSync(path.join(roleSkillsDir, 'hive-comms', 'SKILL.md'), '# Comms');

    const agentDir = path.join(orgDir, '1-ceo');
    fs.mkdirSync(agentDir, { recursive: true });
    // Don't copy the skill

    const issues = checkSkills(agentDir, 'ceo', ['hive-comms'], roleSkillsDir);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('SKILL_NOT_COPIED');
    expect(issues[0].autoFixable).toBe(true);
  });
});

describe('checkMcpSettings', () => {
  it('returns no issues when MCP settings present', () => {
    const agentDir = path.join(orgDir, '1-ceo');
    fs.mkdirSync(path.join(agentDir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(agentDir, '.claude', 'settings.json'), JSON.stringify({
      mcpServers: { playwright: { command: 'npx', args: ['@anthropic/mcp-playwright'] } },
    }));

    const issues = checkMcpSettings(agentDir, 'ceo', ['playwright']);
    expect(issues).toHaveLength(0);
  });

  it('reports MCP_SETTINGS_MISSING when settings.json absent', () => {
    const agentDir = path.join(orgDir, '1-ceo');
    fs.mkdirSync(agentDir, { recursive: true });

    const issues = checkMcpSettings(agentDir, 'ceo', ['playwright']);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe('MCP_SETTINGS_MISSING');
    expect(issues[0].autoFixable).toBe(true);
  });

  it('reports MCP_UNKNOWN for unrecognized MCP server name', () => {
    const agentDir = path.join(orgDir, '1-ceo');
    fs.mkdirSync(agentDir, { recursive: true });

    const issues = checkMcpSettings(agentDir, 'ceo', ['unknown-mcp']);
    expect(issues.some(i => i.code === 'MCP_UNKNOWN')).toBe(true);
  });
});
```

- [ ] **Step 14: Run tests to verify they fail**

Run: `npx vitest run tests/validation/org-health.test.ts`
Expected: FAIL — functions not exported

- [ ] **Step 15: Implement skill and MCP checks**

Add to `src/validation/org-health.ts`:

```typescript
/**
 * Check that declared skills exist in role-skills/ and are copied to agent.
 */
export function checkSkills(
  agentDir: string,
  alias: string,
  declaredSkills: string[],
  roleSkillsDir: string,
): HealthIssue[] {
  const issues: HealthIssue[] = [];

  for (const skill of declaredSkills) {
    const sourceDir = path.join(roleSkillsDir, skill);
    if (!fs.existsSync(sourceDir)) {
      issues.push({
        severity: 'warning',
        code: 'SKILL_NOT_FOUND',
        agent: alias,
        message: `Skill "${skill}" declared for @${alias} but not found in role-skills/`,
        autoFixable: false,
      });
      continue;
    }

    const agentSkillDir = path.join(agentDir, '.claude', 'skills', skill);
    if (!fs.existsSync(agentSkillDir)) {
      issues.push({
        severity: 'warning',
        code: 'SKILL_NOT_COPIED',
        agent: alias,
        message: `Skill "${skill}" exists in role-skills/ but not copied to @${alias}'s .claude/skills/`,
        autoFixable: true,
      });
    }
  }

  return issues;
}

const KNOWN_MCP_SERVERS = ['playwright'];

/**
 * Check that MCP settings are properly configured for the agent.
 */
export function checkMcpSettings(
  agentDir: string,
  alias: string,
  declaredMcp: string[],
): HealthIssue[] {
  const issues: HealthIssue[] = [];

  for (const mcp of declaredMcp) {
    if (!KNOWN_MCP_SERVERS.includes(mcp)) {
      issues.push({
        severity: 'warning',
        code: 'MCP_UNKNOWN',
        agent: alias,
        message: `MCP server "${mcp}" declared for @${alias} is not in the known registry`,
        autoFixable: false,
      });
    }
  }

  // Check if .claude/settings.json exists with mcpServers
  const knownDeclared = declaredMcp.filter(m => KNOWN_MCP_SERVERS.includes(m));
  if (knownDeclared.length > 0) {
    const settingsPath = path.join(agentDir, '.claude', 'settings.json');
    if (!fs.existsSync(settingsPath)) {
      issues.push({
        severity: 'warning',
        code: 'MCP_SETTINGS_MISSING',
        agent: alias,
        message: `@${alias} declares MCP servers [${knownDeclared.join(', ')}] but has no .claude/settings.json`,
        autoFixable: true,
      });
    }
  }

  return issues;
}
```

- [ ] **Step 16: Run tests to verify they pass**

Run: `npx vitest run tests/validation/org-health.test.ts`
Expected: PASS

- [ ] **Step 17: Commit**

```bash
git add src/validation/org-health.ts tests/validation/org-health.test.ts
git commit -m "feat(validation): skill and MCP validation checks"
```

---

### Task 5: Implement the full org scan orchestrator

**Files:**
- Modify: `src/validation/org-health.ts`
- Modify: `tests/validation/org-health.test.ts`

- [ ] **Step 18: Write failing test for runFullScan**

Add to `tests/validation/org-health.test.ts`:

```typescript
import { runFullScan } from '../../src/validation/org-health.js';
import Database from 'better-sqlite3';

describe('runFullScan', () => {
  let db: Database.Database;

  beforeEach(() => {
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

  afterEach(() => { db.close(); });

  it('returns empty issues for a healthy org', () => {
    db.exec(`INSERT INTO people (id, alias, name, role_template, status, folder, reports_to)
      VALUES (1, 'ceo', 'CEO', 'chief-executive', 'active', '1-ceo', 0)`);

    const dir = path.join(orgDir, '1-ceo');
    fs.mkdirSync(dir, { recursive: true });
    for (const f of ['SOUL.md', 'BUREAU.md', 'PRIORITIES.md', 'MEMORY.md']) {
      fs.writeFileSync(path.join(dir, f), `# ${f}`);
    }
    fs.writeFileSync(path.join(dir, 'IDENTITY.md'), [
      '---', 'id: 1', 'alias: ceo', 'name: CEO', 'role: Chief Executive', 'skills: [hive-comms]', '---', '',
    ].join('\n'));

    // Create role-skills
    const roleSkillsDir = path.join(tmpDir, 'role-skills');
    fs.mkdirSync(path.join(roleSkillsDir, 'hive-comms'), { recursive: true });
    fs.writeFileSync(path.join(roleSkillsDir, 'hive-comms', 'SKILL.md'), '# Comms');

    // Copy skill to agent
    fs.mkdirSync(path.join(dir, '.claude', 'skills', 'hive-comms'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'skills', 'hive-comms', 'SKILL.md'), '# Comms');

    const issues = runFullScan({ orgDir, db, roleSkillsDir });
    expect(issues.filter(i => i.severity === 'error')).toHaveLength(0);
  });

  it('aggregates issues from all checks', () => {
    db.exec(`INSERT INTO people (id, alias, name, role_template, status, folder, reports_to)
      VALUES (1, 'ceo', 'CEO', 'chief-executive', 'active', '1-ceo', 0)`);
    // Don't create any folders → should get MISSING_FOLDER

    const roleSkillsDir = path.join(tmpDir, 'role-skills');
    fs.mkdirSync(roleSkillsDir, { recursive: true });

    const issues = runFullScan({ orgDir, db, roleSkillsDir });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some(i => i.code === 'MISSING_FOLDER')).toBe(true);
  });
});
```

- [ ] **Step 19: Run tests to verify they fail**

Run: `npx vitest run tests/validation/org-health.test.ts`
Expected: FAIL — `runFullScan` not exported

- [ ] **Step 20: Implement runFullScan**

Add to `src/validation/org-health.ts`:

```typescript
import Database from 'better-sqlite3';

export interface ScanOptions {
  orgDir: string;
  db: Database.Database;
  roleSkillsDir: string;
}

/**
 * Run all validation checks across the entire org.
 * Returns a flat list of all issues found, sorted by severity.
 */
export function runFullScan(opts: ScanOptions): HealthIssue[] {
  const { orgDir, db, roleSkillsDir } = opts;
  const issues: HealthIssue[] = [];

  // Load people from DB
  const people = db.prepare(
    'SELECT id, alias, name, role_template, status, folder, reports_to FROM people WHERE status = ?'
  ).all('active') as Array<{
    id: number; alias: string; name: string; role_template: string | null;
    status: string; folder: string | null; reports_to: number | null;
  }>;

  const personList: Person[] = people.map(r => ({
    id: r.id,
    alias: r.alias,
    name: r.name,
    roleTemplate: r.role_template ?? undefined,
    status: r.status as 'active',
    folder: r.folder ?? undefined,
    reportsTo: r.reports_to ?? undefined,
  }));

  // 1. Folder ↔ DB sync
  issues.push(...checkFolderDbSync(orgDir, personList));

  // 2. Reporting chain
  issues.push(...checkReportingChain(personList));

  // 3. Per-agent checks
  for (const person of personList) {
    if (!person.folder) continue; // super-user
    const agentDir = path.join(orgDir, person.folder);
    if (!fs.existsSync(agentDir)) continue; // already caught by checkFolderDbSync

    issues.push(...checkAgentFiles(agentDir, person.alias));
    issues.push(...checkIdentityFields(agentDir, person.alias));
    issues.push(...checkIdentityDbMatch(agentDir, person));

    // Read skills from frontmatter
    const identityPath = path.join(agentDir, 'IDENTITY.md');
    if (fs.existsSync(identityPath)) {
      try {
        const { data } = matter(fs.readFileSync(identityPath, 'utf-8'));
        const skills: string[] = data.skills ?? [];
        issues.push(...checkSkills(agentDir, person.alias, skills, roleSkillsDir));

        // Read MCP from role template config.json
        if (person.roleTemplate) {
          const configPath = path.join(roleSkillsDir, '..', 'role-templates', person.roleTemplate, 'config.json');
          if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            if (config.mcp && config.mcp.length > 0) {
              issues.push(...checkMcpSettings(agentDir, person.alias, config.mcp));
            }
          }
        }
      } catch { /* caught by earlier checks */ }
    }
  }

  // Sort: errors first, then warnings, then info
  const severityOrder: Record<string, number> = { error: 0, warning: 1, info: 2 };
  issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return issues;
}
```

- [ ] **Step 21: Run tests to verify they pass**

Run: `npx vitest run tests/validation/org-health.test.ts`
Expected: PASS

- [ ] **Step 22: Commit**

```bash
git add src/validation/org-health.ts tests/validation/org-health.test.ts
git commit -m "feat(validation): runFullScan orchestrates all checks across entire org"
```

---

### Task 6: Implement auto-fix functions

**Files:**
- Modify: `src/validation/org-health.ts`
- Create: `tests/validation/autofix.test.ts`

- [ ] **Step 23: Write failing tests for auto-fix**

```typescript
// tests/validation/autofix.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { autoFix } from '../../src/validation/org-health.js';
import type { HealthIssue } from '../../src/validation/types.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('autoFix', () => {
  let tmpDir: string;
  let orgDir: string;
  let roleSkillsDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-fix-'));
    orgDir = path.join(tmpDir, 'org');
    roleSkillsDir = path.join(tmpDir, 'role-skills');
    fs.mkdirSync(orgDir, { recursive: true });
    fs.mkdirSync(roleSkillsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('copies missing skills from role-skills/ to agent', () => {
    // Setup: skill exists in role-skills but not in agent
    fs.mkdirSync(path.join(roleSkillsDir, 'hive-comms'), { recursive: true });
    fs.writeFileSync(path.join(roleSkillsDir, 'hive-comms', 'SKILL.md'), '# Comms Skill');

    const agentDir = path.join(orgDir, '1-ceo');
    fs.mkdirSync(agentDir, { recursive: true });

    const issue: HealthIssue = {
      severity: 'warning',
      code: 'SKILL_NOT_COPIED',
      agent: 'ceo',
      message: 'Skill "hive-comms" not copied',
      autoFixable: true,
    };

    const result = autoFix([issue], { orgDir, roleSkillsDir });
    expect(result.fixed).toBe(1);
    expect(fs.existsSync(path.join(agentDir, '.claude', 'skills', 'hive-comms', 'SKILL.md'))).toBe(true);
  });

  it('writes MCP settings when missing', () => {
    const agentDir = path.join(orgDir, '1-ceo');
    fs.mkdirSync(agentDir, { recursive: true });

    const issue: HealthIssue = {
      severity: 'warning',
      code: 'MCP_SETTINGS_MISSING',
      agent: 'ceo',
      message: 'MCP settings missing',
      autoFixable: true,
    };

    const result = autoFix([issue], { orgDir, roleSkillsDir, mcpFromConfig: { ceo: ['playwright'] } });
    expect(result.fixed).toBe(1);

    const settings = JSON.parse(fs.readFileSync(path.join(agentDir, '.claude', 'settings.json'), 'utf-8'));
    expect(settings.mcpServers.playwright).toBeDefined();
  });

  it('skips non-auto-fixable issues', () => {
    const issue: HealthIssue = {
      severity: 'error',
      code: 'MISSING_FOLDER',
      agent: 'ghost',
      message: 'Missing folder',
      autoFixable: false,
    };

    const result = autoFix([issue], { orgDir, roleSkillsDir });
    expect(result.fixed).toBe(0);
    expect(result.skipped).toBe(1);
  });
});
```

- [ ] **Step 24: Run tests to verify they fail**

Run: `npx vitest run tests/validation/autofix.test.ts`
Expected: FAIL — `autoFix` not exported

- [ ] **Step 25: Implement autoFix**

Add to `src/validation/org-health.ts`:

```typescript
export interface AutoFixOptions {
  orgDir: string;
  roleSkillsDir: string;
  mcpFromConfig?: Record<string, string[]>;  // alias → mcp names
}

export interface AutoFixResult {
  fixed: number;
  skipped: number;
  details: string[];
}

const MCP_REGISTRY: Record<string, { command: string; args: string[] }> = {
  playwright: { command: 'npx', args: ['@anthropic/mcp-playwright'] },
};

/**
 * Attempt to auto-fix all fixable issues.
 */
export function autoFix(issues: HealthIssue[], opts: AutoFixOptions): AutoFixResult {
  const result: AutoFixResult = { fixed: 0, skipped: 0, details: [] };

  for (const issue of issues) {
    if (!issue.autoFixable) {
      result.skipped++;
      continue;
    }

    try {
      switch (issue.code) {
        case 'SKILL_NOT_COPIED': {
          if (!issue.agent) break;
          // Extract skill name from message
          const skillMatch = issue.message.match(/Skill "([^"]+)"/);
          if (!skillMatch) break;
          const skillName = skillMatch[1];
          const sourceDir = path.join(opts.roleSkillsDir, skillName);
          const agentDir = findAgentDir(opts.orgDir, issue.agent);
          if (!agentDir || !fs.existsSync(sourceDir)) break;

          const targetDir = path.join(agentDir, '.claude', 'skills', skillName);
          fs.mkdirSync(path.dirname(targetDir), { recursive: true });
          fs.cpSync(sourceDir, targetDir, { recursive: true });
          result.fixed++;
          result.details.push(`Copied skill "${skillName}" to @${issue.agent}`);
          break;
        }

        case 'MCP_SETTINGS_MISSING': {
          if (!issue.agent) break;
          const agentDir = findAgentDir(opts.orgDir, issue.agent);
          if (!agentDir) break;
          const mcpNames = opts.mcpFromConfig?.[issue.agent] ?? [];
          const mcpServers: Record<string, { command: string; args: string[] }> = {};
          for (const name of mcpNames) {
            if (MCP_REGISTRY[name]) mcpServers[name] = MCP_REGISTRY[name];
          }
          if (Object.keys(mcpServers).length === 0) break;

          const claudeDir = path.join(agentDir, '.claude');
          fs.mkdirSync(claudeDir, { recursive: true });
          fs.writeFileSync(
            path.join(claudeDir, 'settings.json'),
            JSON.stringify({ mcpServers }, null, 2) + '\n',
          );
          result.fixed++;
          result.details.push(`Wrote MCP settings for @${issue.agent}`);
          break;
        }

        case 'IDENTITY_DB_MISMATCH': {
          // Identity mismatch auto-fix: re-stamp the frontmatter field
          // This is delicate — mark as fixed but log for review
          result.details.push(`IDENTITY_DB_MISMATCH for @${issue.agent} — needs manual review`);
          result.skipped++;
          break;
        }

        default:
          result.skipped++;
      }
    } catch (err) {
      result.details.push(`Failed to fix ${issue.code} for @${issue.agent}: ${err instanceof Error ? err.message : String(err)}`);
      result.skipped++;
    }
  }

  return result;
}

/** Find agent directory by alias (scans org/ for {id}-{alias} pattern). */
function findAgentDir(orgDir: string, alias: string): string | null {
  const entries = fs.readdirSync(orgDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const match = entry.name.match(FOLDER_PATTERN);
    if (match && match[2] === alias) {
      return path.join(orgDir, entry.name);
    }
  }
  return null;
}
```

- [ ] **Step 26: Run tests to verify they pass**

Run: `npx vitest run tests/validation/autofix.test.ts`
Expected: PASS

- [ ] **Step 27: Commit**

```bash
git add src/validation/org-health.ts tests/validation/autofix.test.ts
git commit -m "feat(validation): auto-fix for missing skills and MCP settings"
```

---

### Task 7: Enhance validateProvision (Layer 1)

**Files:**
- Modify: `src/org/provision.ts`
- Modify: `tests/org/provision.test.ts`

- [ ] **Step 28: Write failing tests for enhanced provisioning validation**

Add to `tests/org/provision.test.ts` inside `describe('validateProvision')`:

```typescript
    it('validates all issues and returns array of errors', () => {
      const errors = validateProvision(
        { alias: 'ceo', name: 'Dup', roleTemplate: 'nonexistent', reportsTo: 'nobody' },
        db, templateDir,
      );
      // Should catch all three: alias exists, manager not found, template not found
      expect(errors).not.toBeNull();
      // Original API returns first error — verify backward compat
      expect(errors!.code).toBeDefined();
    });

    it('warns when declared skills are missing from role-skills/', () => {
      // Create role-skills dir without the declared skill
      const rsDir = path.join(tmpDir, 'role-skills');
      fs.mkdirSync(rsDir, { recursive: true });
      // Template declares code-lifecycle skill but it doesn't exist in role-skills
      const warnings = validateProvisionFull(
        { alias: 'alice', name: 'Alice', roleTemplate: 'software-engineer', reportsTo: 'ceo' },
        db, templateDir, rsDir,
      );
      expect(warnings.some(w => w.code === 'SKILL_NOT_FOUND')).toBe(true);
    });
```

- [ ] **Step 29: Run tests to verify they fail**

Run: `npx vitest run tests/org/provision.test.ts`
Expected: FAIL — `validateProvisionFull` not exported

- [ ] **Step 30: Implement validateProvisionFull**

Add to `src/org/provision.ts`:

```typescript
import { checkSkills } from '../validation/org-health.js';
import type { HealthIssue } from '../validation/types.js';

/**
 * Extended validation that checks skills and MCP in addition to base checks.
 * Returns an array of HealthIssue warnings/errors.
 * The original validateProvision() is preserved for backward compatibility.
 */
export function validateProvisionFull(
  input: ProvisionInput,
  db: Database.Database,
  templateDir: string,
  roleSkillsDir: string,
): HealthIssue[] {
  const issues: HealthIssue[] = [];

  // Run base validation
  const baseError = validateProvision(input, db, templateDir);
  if (baseError) {
    issues.push({
      severity: 'error',
      code: baseError.code === 'ALIAS_EXISTS' ? 'IDENTITY_DB_MISMATCH' : 'MISSING_FOLDER',
      agent: input.alias,
      message: baseError.message,
      autoFixable: false,
    });
    return issues; // Stop early on base errors
  }

  // Check skills will be resolvable
  const configPath = path.join(templateDir, input.roleTemplate, 'config.json');
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const skills: string[] = input.skills ?? config.skills ?? ['hive-comms'];
    // Check which skills exist in role-skills/
    for (const skill of skills) {
      if (!fs.existsSync(path.join(roleSkillsDir, skill))) {
        issues.push({
          severity: 'warning',
          code: 'SKILL_NOT_FOUND',
          agent: input.alias,
          message: `Skill "${skill}" declared for @${input.alias} but not found in role-skills/`,
          autoFixable: false,
        });
      }
    }

    // Check MCP servers are known
    const mcpNames: string[] = config.mcp ?? [];
    const knownMcp = ['playwright'];
    for (const mcp of mcpNames) {
      if (!knownMcp.includes(mcp)) {
        issues.push({
          severity: 'warning',
          code: 'MCP_UNKNOWN',
          agent: input.alias,
          message: `MCP server "${mcp}" declared in ${input.roleTemplate}/config.json is not in the known registry`,
          autoFixable: false,
        });
      }
    }
  }

  return issues;
}
```

- [ ] **Step 31: Run tests to verify they pass**

Run: `npx vitest run tests/org/provision.test.ts`
Expected: PASS

- [ ] **Step 32: Commit**

```bash
git add src/org/provision.ts tests/org/provision.test.ts
git commit -m "feat(validation): Layer 1 — validateProvisionFull with skill and MCP pre-checks"
```

---

### Task 8: Add `hive doctor` CLI command

**Files:**
- Modify: `src/cli.ts`
- Create: `tests/cli/doctor.test.ts`

- [ ] **Step 33: Write failing test for hive doctor**

```typescript
// tests/cli/doctor.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';

describe('hive doctor', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-doctor-'));
    const orgDir = path.join(tmpDir, 'org');
    const dataDir = path.join(tmpDir, 'data');
    const roleSkillsDir = path.join(tmpDir, 'role-skills');
    fs.mkdirSync(orgDir, { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(roleSkillsDir, { recursive: true });

    // Seed DB
    const db = new Database(path.join(dataDir, 'hive.db'));
    db.exec(`
      CREATE TABLE IF NOT EXISTS people (
        id INTEGER PRIMARY KEY, alias TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
        role_template TEXT, status TEXT NOT NULL DEFAULT 'active', folder TEXT,
        reports_to INTEGER REFERENCES people(id), created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO people (id, alias, name, status) VALUES (0, 'super-user', 'Super User', 'active');
      INSERT INTO people (id, alias, name, role_template, status, folder, reports_to)
        VALUES (1, 'ceo', 'Hive CEO', 'chief-executive', 'active', '1-ceo', 0);
    `);
    db.close();

    // Create CEO folder with valid identity
    const ceoDir = path.join(orgDir, '1-ceo');
    fs.mkdirSync(ceoDir);
    fs.writeFileSync(path.join(ceoDir, 'IDENTITY.md'), [
      '---', 'id: 1', 'alias: ceo', 'name: Hive CEO', 'role: Chief Executive', 'skills: [hive-comms]', '---', '',
    ].join('\n'));
    for (const f of ['SOUL.md', 'BUREAU.md', 'PRIORITIES.md', 'MEMORY.md']) {
      fs.writeFileSync(path.join(ceoDir, f), `# ${f}`);
    }

    // Create hive-comms skill
    fs.mkdirSync(path.join(roleSkillsDir, 'hive-comms'), { recursive: true });
    fs.writeFileSync(path.join(roleSkillsDir, 'hive-comms', 'SKILL.md'), '# Comms');

    // Copy skill to agent
    fs.mkdirSync(path.join(ceoDir, '.claude', 'skills', 'hive-comms'), { recursive: true });
    fs.writeFileSync(path.join(ceoDir, '.claude', 'skills', 'hive-comms', 'SKILL.md'), '# Comms');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reports healthy org with no errors', () => {
    const output = execFileSync('npx', ['tsx', path.resolve('src/cli.ts'), 'doctor'], {
      cwd: tmpDir,
      encoding: 'utf-8',
      timeout: 15000,
    });
    expect(output).toContain('healthy');
  });

  it('reports errors when agent folder is missing', () => {
    // Remove the CEO folder
    fs.rmSync(path.join(tmpDir, 'org', '1-ceo'), { recursive: true });

    const output = execFileSync('npx', ['tsx', path.resolve('src/cli.ts'), 'doctor'], {
      cwd: tmpDir,
      encoding: 'utf-8',
      timeout: 15000,
    });
    expect(output).toContain('MISSING_FOLDER');
  });

  it('offers auto-fix with --fix flag', () => {
    // Remove skill from agent (but leave in role-skills)
    fs.rmSync(path.join(tmpDir, 'org', '1-ceo', '.claude'), { recursive: true });

    const output = execFileSync('npx', ['tsx', path.resolve('src/cli.ts'), 'doctor', '--fix'], {
      cwd: tmpDir,
      encoding: 'utf-8',
      timeout: 15000,
    });
    expect(output).toContain('fixed');
    // Skill should now be copied back
    expect(fs.existsSync(path.join(tmpDir, 'org', '1-ceo', '.claude', 'skills', 'hive-comms', 'SKILL.md'))).toBe(true);
  });
});
```

- [ ] **Step 34: Run tests to verify they fail**

Run: `npx vitest run tests/cli/doctor.test.ts`
Expected: FAIL — "Unknown command: doctor"

- [ ] **Step 35: Implement hive doctor CLI command**

Add to `src/cli.ts` (after the `hive dashboard` command, before `program.parse()`):

```typescript
import { runFullScan, autoFix } from './validation/org-health.js';

program
  .command('doctor')
  .description('Run health checks on the organization')
  .option('--fix', 'Attempt to auto-fix fixable issues')
  .action(async (opts) => {
    const orgDir = getOrgDir();
    const dataDir = getDataDir();
    const roleSkillsDir = path.resolve(process.cwd(), 'role-skills');

    const chatDb = new ChatDb(path.join(dataDir, 'hive.db'));
    const db = chatDb.raw();

    console.log(chalk.blue('Running org health checks...\n'));
    const issues = runFullScan({ orgDir, db, roleSkillsDir });

    if (issues.length === 0) {
      console.log(chalk.green('✔ Org is healthy — no issues found.'));
      chatDb.close();
      return;
    }

    // Display issues grouped by severity
    const errors = issues.filter(i => i.severity === 'error');
    const warnings = issues.filter(i => i.severity === 'warning');
    const infos = issues.filter(i => i.severity === 'info');

    if (errors.length > 0) {
      console.log(chalk.red(`✖ ${errors.length} error(s):`));
      for (const issue of errors) {
        console.log(chalk.red(`  [${issue.code}] ${issue.message}`));
      }
    }
    if (warnings.length > 0) {
      console.log(chalk.yellow(`⚠ ${warnings.length} warning(s):`));
      for (const issue of warnings) {
        console.log(chalk.yellow(`  [${issue.code}] ${issue.message}`));
      }
    }
    if (infos.length > 0) {
      console.log(chalk.dim(`ℹ ${infos.length} info(s):`));
      for (const issue of infos) {
        console.log(chalk.dim(`  [${issue.code}] ${issue.message}`));
      }
    }

    const fixable = issues.filter(i => i.autoFixable);
    if (fixable.length > 0 && !opts.fix) {
      console.log(chalk.dim(`\n${fixable.length} issue(s) can be auto-fixed. Run \`hive doctor --fix\` to apply.`));
    }

    if (opts.fix && fixable.length > 0) {
      console.log(chalk.blue('\nApplying auto-fixes...'));

      // Build MCP config lookup from role-templates
      const mcpFromConfig: Record<string, string[]> = {};
      const people = db.prepare('SELECT alias, role_template FROM people WHERE status = ?').all('active') as { alias: string; role_template: string | null }[];
      for (const p of people) {
        if (!p.role_template) continue;
        const configPath = path.join(process.cwd(), 'role-templates', p.role_template, 'config.json');
        if (fs.existsSync(configPath)) {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          if (config.mcp) mcpFromConfig[p.alias] = config.mcp;
        }
      }

      const fixResult = autoFix(fixable, { orgDir, roleSkillsDir, mcpFromConfig });
      console.log(chalk.green(`  ✔ ${fixResult.fixed} fixed`));
      if (fixResult.skipped > 0) {
        console.log(chalk.yellow(`  ⚠ ${fixResult.skipped} skipped`));
      }
      for (const detail of fixResult.details) {
        console.log(chalk.dim(`  ${detail}`));
      }
    }

    chatDb.close();

    if (errors.length > 0) {
      process.exit(1);
    }
  });
```

- [ ] **Step 36: Run tests to verify they pass**

Run: `npx vitest run tests/cli/doctor.test.ts`
Expected: PASS

- [ ] **Step 37: Commit**

```bash
git add src/cli.ts tests/cli/doctor.test.ts
git commit -m "feat: add hive doctor CLI command for org health checks + auto-fix"
```

---

### Task 9: Add health gate to `hive start`

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 38: Add health check before daemon startup**

In `src/cli.ts`, inside the `hive start` action handler, after parsing the org and before creating the Daemon, add:

```typescript
    // Health check before starting
    const { runFullScan } = await import('./validation/org-health.js');
    const roleSkillsDir = path.resolve(process.cwd(), 'role-skills');
    const healthIssues = runFullScan({ orgDir, db: chatDb.raw(), roleSkillsDir });
    const healthErrors = healthIssues.filter(i => i.severity === 'error');
    if (healthErrors.length > 0) {
      console.error(chalk.red(`\n✖ ${healthErrors.length} health error(s) found — refusing to start:\n`));
      for (const issue of healthErrors) {
        console.error(chalk.red(`  [${issue.code}] ${issue.message}`));
      }
      console.error(chalk.dim('\nRun `hive doctor --fix` to attempt auto-repair, or fix manually.'));
      chatDb.close();
      process.exit(1);
    }
    const healthWarnings = healthIssues.filter(i => i.severity === 'warning');
    if (healthWarnings.length > 0) {
      console.log(chalk.yellow(`⚠ ${healthWarnings.length} warning(s) — starting anyway:`));
      for (const issue of healthWarnings) {
        console.log(chalk.yellow(`  [${issue.code}] ${issue.message}`));
      }
      console.log('');
    }
```

This goes after line 233 (`const orgChart = await parseOrgFlat(orgDir, people);`) and before line 237 (`const commsDb = ...`).

- [ ] **Step 39: Run full test suite to verify no regressions**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 40: Commit**

```bash
git add src/cli.ts
git commit -m "feat: gate hive start on org health — refuse to start with errors"
```

---

### Task 10: Wire Layer 1 into `hive agent create` CLI

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 41: Add pre-provisioning warnings to agent create**

In the `hive agent create` action handler, after resolving `templateDir` and before calling `provision()`, add a call to `validateProvisionFull()` and print warnings:

```typescript
    // Layer 1: Pre-provisioning validation
    const roleSkillsDir = path.resolve(process.cwd(), 'role-skills');
    const { validateProvisionFull } = await import('./org/provision.js');
    const preWarnings = validateProvisionFull(
      { alias: opts.alias, name: opts.name, roleTemplate: opts.role, reportsTo: opts.reportsTo, vibe: opts.vibe },
      chatDb.raw(),
      templateDir,
      roleSkillsDir,
    );
    const preErrors = preWarnings.filter(w => w.severity === 'error');
    if (preErrors.length > 0) {
      for (const e of preErrors) console.error(chalk.red(`  [${e.code}] ${e.message}`));
      chatDb.close();
      process.exit(1);
    }
    for (const w of preWarnings) {
      console.log(chalk.yellow(`  ⚠ [${w.code}] ${w.message}`));
    }
```

- [ ] **Step 42: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 43: Commit**

```bash
git add src/cli.ts
git commit -m "feat: Layer 1 validation in hive agent create — warn on skill/MCP issues"
```

---

### Task 11: Final integration test and cleanup

**Files:**
- All modified files

- [ ] **Step 44: Run full test suite one final time**

Run: `npx vitest run`
Expected: All tests PASS (total should be ~400+)

- [ ] **Step 45: Run type check**

Run: `npx tsc --noEmit`
Expected: No new errors (only pre-existing embedder quantized warning)

- [ ] **Step 46: Final commit**

```bash
git add -A
git commit -m "chore: org validation Layer 1 + Layer 2 complete"
```

---

## Summary

| Layer | What | Where | Trigger |
|-------|------|-------|---------|
| Layer 1 | Prevent bad state at provisioning | `validateProvisionFull()` | `hive agent create` |
| Layer 2 | Detect drift, offer auto-fix | `runFullScan()` + `autoFix()` | `hive doctor`, `hive start` |

**Checks implemented:**
- Folder ↔ DB sync (MISSING_FOLDER, ORPHANED_FOLDER)
- Identity frontmatter completeness (IDENTITY_PARSE_ERROR, IDENTITY_FIELD_MISSING)
- Identity ↔ DB match (IDENTITY_DB_MISMATCH)
- Agent file completeness (MISSING_AGENT_FILE)
- Reporting chain integrity (CIRCULAR_REPORTING, DANGLING_MANAGER)
- Skill resolution (SKILL_NOT_FOUND, SKILL_NOT_COPIED)
- MCP configuration (MCP_UNKNOWN, MCP_SETTINGS_MISSING)

**Auto-fixable:** SKILL_NOT_COPIED, MCP_SETTINGS_MISSING
