import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  checkFolderDbSync,
  checkIdentityFields,
  checkIdentityDbMatch,
  checkAgentFiles,
  checkReportingChain,
  checkSkills,
  checkMcpSettings,
  runFullScan,
  autoFix,
} from '../../src/validation/org-health.js';
import type { Person } from '../../src/types.js';
import Database from 'better-sqlite3';
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

  // ── Folder/DB sync ──

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

    it('skips people without folders (super-user)', () => {
      const people: Person[] = [
        { id: 0, alias: 'super-user', name: 'Super User', status: 'active' },
      ];

      const issues = checkFolderDbSync(orgDir, people);
      expect(issues).toHaveLength(0);
    });
  });

  // ── Identity fields ──

  describe('checkIdentityFields', () => {
    it('returns no issues for complete frontmatter', () => {
      const dir = path.join(orgDir, '1-ceo');
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'IDENTITY.md'),
        '---\nid: 1\nalias: ceo\nname: CEO\nrole: Chief Executive\n---\n');

      const issues = checkIdentityFields(dir, 'ceo');
      expect(issues).toHaveLength(0);
    });

    it('reports IDENTITY_FIELD_MISSING for missing id', () => {
      const dir = path.join(orgDir, '1-ceo');
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'IDENTITY.md'),
        '---\nalias: ceo\nname: CEO\nrole: Chief Executive\n---\n');

      const issues = checkIdentityFields(dir, 'ceo');
      expect(issues.some(i => i.code === 'IDENTITY_FIELD_MISSING' && i.message.includes('id'))).toBe(true);
    });

    it('reports IDENTITY_PARSE_ERROR for no frontmatter', () => {
      const dir = path.join(orgDir, '1-ceo');
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'IDENTITY.md'), 'no frontmatter here');

      const issues = checkIdentityFields(dir, 'ceo');
      expect(issues.some(i => i.code === 'IDENTITY_PARSE_ERROR')).toBe(true);
    });

    it('reports MISSING_AGENT_FILE when IDENTITY.md absent', () => {
      const dir = path.join(orgDir, '1-ceo');
      fs.mkdirSync(dir);

      const issues = checkIdentityFields(dir, 'ceo');
      expect(issues.some(i => i.code === 'MISSING_AGENT_FILE')).toBe(true);
    });
  });

  // ── Identity/DB match ──

  describe('checkIdentityDbMatch', () => {
    it('returns no issues when frontmatter matches DB', () => {
      const person: Person = { id: 1, alias: 'ceo', name: 'CEO', status: 'active', folder: '1-ceo' };
      const dir = path.join(orgDir, '1-ceo');
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'IDENTITY.md'),
        '---\nid: 1\nalias: ceo\nname: CEO\nrole: Chief Executive\n---\n');

      const issues = checkIdentityDbMatch(dir, person);
      expect(issues).toHaveLength(0);
    });

    it('reports IDENTITY_DB_MISMATCH when alias differs', () => {
      const person: Person = { id: 1, alias: 'ceo', name: 'CEO', status: 'active', folder: '1-ceo' };
      const dir = path.join(orgDir, '1-ceo');
      fs.mkdirSync(dir);
      fs.writeFileSync(path.join(dir, 'IDENTITY.md'),
        '---\nid: 1\nalias: wrong\nname: CEO\nrole: Chief Executive\n---\n');

      const issues = checkIdentityDbMatch(dir, person);
      expect(issues).toHaveLength(1);
      expect(issues[0].code).toBe('IDENTITY_DB_MISMATCH');
      expect(issues[0].autoFixable).toBe(true);
    });
  });

  // ── Agent files ──

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

  // ── Reporting chain ──

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

  // ── Skills ──

  describe('checkSkills', () => {
    it('returns no issues when all skills present', () => {
      const roleSkillsDir = path.join(tmpDir, 'role-skills');
      fs.mkdirSync(path.join(roleSkillsDir, 'hive-comms'), { recursive: true });
      fs.writeFileSync(path.join(roleSkillsDir, 'hive-comms', 'SKILL.md'), '# Comms');

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

      const issues = checkSkills(agentDir, 'ceo', ['nonexistent'], roleSkillsDir);
      expect(issues).toHaveLength(1);
      expect(issues[0].code).toBe('SKILL_NOT_FOUND');
    });

    it('reports SKILL_NOT_COPIED when skill exists but not in agent', () => {
      const roleSkillsDir = path.join(tmpDir, 'role-skills');
      fs.mkdirSync(path.join(roleSkillsDir, 'hive-comms'), { recursive: true });
      fs.writeFileSync(path.join(roleSkillsDir, 'hive-comms', 'SKILL.md'), '# Comms');

      const agentDir = path.join(orgDir, '1-ceo');
      fs.mkdirSync(agentDir, { recursive: true });

      const issues = checkSkills(agentDir, 'ceo', ['hive-comms'], roleSkillsDir);
      expect(issues).toHaveLength(1);
      expect(issues[0].code).toBe('SKILL_NOT_COPIED');
      expect(issues[0].autoFixable).toBe(true);
    });
  });

  // ── MCP ──

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

    it('reports MCP_UNKNOWN for unrecognized MCP server', () => {
      const agentDir = path.join(orgDir, '1-ceo');
      fs.mkdirSync(agentDir, { recursive: true });

      const issues = checkMcpSettings(agentDir, 'ceo', ['unknown-mcp']);
      expect(issues.some(i => i.code === 'MCP_UNKNOWN')).toBe(true);
    });
  });

  // ── Full scan ──

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

    it('returns no errors for a healthy org', () => {
      db.exec(`INSERT INTO people (id, alias, name, role_template, status, folder, reports_to)
        VALUES (1, 'ceo', 'CEO', 'chief-executive', 'active', '1-ceo', 0)`);

      const dir = path.join(orgDir, '1-ceo');
      fs.mkdirSync(dir, { recursive: true });
      for (const f of ['SOUL.md', 'BUREAU.md', 'PRIORITIES.md', 'MEMORY.md']) {
        fs.writeFileSync(path.join(dir, f), `# ${f}`);
      }
      fs.writeFileSync(path.join(dir, 'IDENTITY.md'),
        '---\nid: 1\nalias: ceo\nname: CEO\nrole: Chief Executive\nskills: [hive-comms]\n---\n');

      const roleSkillsDir = path.join(tmpDir, 'role-skills');
      fs.mkdirSync(path.join(roleSkillsDir, 'hive-comms'), { recursive: true });
      fs.writeFileSync(path.join(roleSkillsDir, 'hive-comms', 'SKILL.md'), '# Comms');
      fs.mkdirSync(path.join(dir, '.claude', 'skills', 'hive-comms'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.claude', 'skills', 'hive-comms', 'SKILL.md'), '# Comms');

      const issues = runFullScan({ orgDir, db, roleSkillsDir });
      expect(issues.filter(i => i.severity === 'error')).toHaveLength(0);
    });

    it('catches MISSING_FOLDER when agent folder gone', () => {
      db.exec(`INSERT INTO people (id, alias, name, role_template, status, folder, reports_to)
        VALUES (1, 'ceo', 'CEO', 'chief-executive', 'active', '1-ceo', 0)`);

      const roleSkillsDir = path.join(tmpDir, 'role-skills');
      fs.mkdirSync(roleSkillsDir, { recursive: true });

      const issues = runFullScan({ orgDir, db, roleSkillsDir });
      expect(issues.some(i => i.code === 'MISSING_FOLDER')).toBe(true);
    });

    it('sorts errors before warnings', () => {
      db.exec(`INSERT INTO people (id, alias, name, role_template, status, folder, reports_to)
        VALUES (1, 'ceo', 'CEO', 'chief-executive', 'active', '1-ceo', 0)`);

      const dir = path.join(orgDir, '1-ceo');
      fs.mkdirSync(dir, { recursive: true });
      // Missing IDENTITY.md → error; missing SOUL.md → warning
      fs.writeFileSync(path.join(dir, 'BUREAU.md'), '# Bureau');
      fs.writeFileSync(path.join(dir, 'PRIORITIES.md'), '# Priorities');
      fs.writeFileSync(path.join(dir, 'MEMORY.md'), '# Memory');

      const roleSkillsDir = path.join(tmpDir, 'role-skills');
      fs.mkdirSync(roleSkillsDir, { recursive: true });

      const issues = runFullScan({ orgDir, db, roleSkillsDir });
      const firstError = issues.findIndex(i => i.severity === 'error');
      const firstWarning = issues.findIndex(i => i.severity === 'warning');
      if (firstError >= 0 && firstWarning >= 0) {
        expect(firstError).toBeLessThan(firstWarning);
      }
    });
  });

  // ── Auto-fix ──

  describe('autoFix', () => {
    it('copies missing skills from role-skills/ to agent', () => {
      const roleSkillsDir = path.join(tmpDir, 'role-skills');
      fs.mkdirSync(path.join(roleSkillsDir, 'hive-comms'), { recursive: true });
      fs.writeFileSync(path.join(roleSkillsDir, 'hive-comms', 'SKILL.md'), '# Comms Skill');

      const agentDir = path.join(orgDir, '1-ceo');
      fs.mkdirSync(agentDir, { recursive: true });

      const result = autoFix([{
        severity: 'warning',
        code: 'SKILL_NOT_COPIED',
        agent: 'ceo',
        message: 'Skill "hive-comms" exists in role-skills/ but not copied to @ceo',
        autoFixable: true,
      }], { orgDir, roleSkillsDir });

      expect(result.fixed).toBe(1);
      expect(fs.existsSync(path.join(agentDir, '.claude', 'skills', 'hive-comms', 'SKILL.md'))).toBe(true);
    });

    it('writes MCP settings when missing', () => {
      const roleSkillsDir = path.join(tmpDir, 'role-skills');
      fs.mkdirSync(roleSkillsDir, { recursive: true });

      const agentDir = path.join(orgDir, '1-ceo');
      fs.mkdirSync(agentDir, { recursive: true });

      const result = autoFix([{
        severity: 'warning',
        code: 'MCP_SETTINGS_MISSING',
        agent: 'ceo',
        message: 'MCP settings missing',
        autoFixable: true,
      }], { orgDir, roleSkillsDir, mcpFromConfig: { ceo: ['playwright'] } });

      expect(result.fixed).toBe(1);
      const settings = JSON.parse(fs.readFileSync(path.join(agentDir, '.claude', 'settings.json'), 'utf-8'));
      expect(settings.mcpServers.playwright).toBeDefined();
    });

    it('skips non-auto-fixable issues', () => {
      const roleSkillsDir = path.join(tmpDir, 'role-skills');
      fs.mkdirSync(roleSkillsDir, { recursive: true });

      const result = autoFix([{
        severity: 'error',
        code: 'MISSING_FOLDER',
        agent: 'ghost',
        message: 'Missing folder',
        autoFixable: false,
      }], { orgDir, roleSkillsDir });

      expect(result.fixed).toBe(0);
      expect(result.skipped).toBe(1);
    });
  });
});
