import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { provision, validateProvision } from '../../src/org/provision.js';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('provision', () => {
  let tmpDir: string;
  let orgDir: string;
  let templateDir: string;
  let db: Database.Database;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-provision-'));
    orgDir = path.join(tmpDir, 'org');
    templateDir = path.join(tmpDir, 'role-templates');
    fs.mkdirSync(orgDir, { recursive: true });

    // Create a minimal template
    const tmpl = path.join(templateDir, 'software-engineer');
    fs.mkdirSync(tmpl, { recursive: true });
    fs.writeFileSync(path.join(tmpl, 'config.json'), JSON.stringify({
      name: 'Software Engineer',
      model: 'claude-opus-4-6',
      emoji: '🔧',
      skills: ['hive-comms', 'code-lifecycle'],
    }));
    fs.writeFileSync(path.join(tmpl, 'IDENTITY.md'), '# Identity\n\nYou are a Software Engineer.\n');
    fs.writeFileSync(path.join(tmpl, 'SOUL.md'), '# Soul\n\nShip fast, test everything.\n');
    fs.writeFileSync(path.join(tmpl, 'BUREAU.md'), '## Reporting\n\nReports to: [populated on instantiation]\nDirect reports: none\n');
    fs.writeFileSync(path.join(tmpl, 'PRIORITIES.md'), '# Priorities\n\n## Active\n');
    fs.writeFileSync(path.join(tmpl, 'MEMORY.md'), '# Memory\n');

    // In-memory DB with people schema
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE people (
        id INTEGER PRIMARY KEY,
        alias TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        role_template TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        folder TEXT,
        reports_to INTEGER REFERENCES people(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO people (id, alias, name, status) VALUES (0, 'super-user', 'Super User', 'active');
      INSERT INTO people (id, alias, name, role_template, status, folder, reports_to)
        VALUES (1, 'ceo', 'Hive CEO', 'chief-executive', 'active', '1-ceo', 0);
    `);

    // Create CEO folder
    fs.mkdirSync(path.join(orgDir, '1-ceo'), { recursive: true });
    fs.writeFileSync(path.join(orgDir, '1-ceo', 'BUREAU.md'), '## Reporting\n\nReports to: Super User\nDirect reports: none\n');
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('validateProvision', () => {
    it('returns null for valid input', () => {
      const error = validateProvision(
        { alias: 'eng-1', name: 'Engineer One', roleTemplate: 'software-engineer', reportsTo: 'ceo' },
        db, templateDir,
      );
      expect(error).toBeNull();
    });

    it('rejects duplicate alias', () => {
      const error = validateProvision(
        { alias: 'ceo', name: 'Another CEO', roleTemplate: 'software-engineer', reportsTo: 'ceo' },
        db, templateDir,
      );
      expect(error).not.toBeNull();
      expect(error!.code).toBe('ALIAS_EXISTS');
    });

    it('rejects non-existent manager', () => {
      const error = validateProvision(
        { alias: 'eng-1', name: 'Engineer', roleTemplate: 'software-engineer', reportsTo: 'nobody' },
        db, templateDir,
      );
      expect(error).not.toBeNull();
      expect(error!.code).toBe('MANAGER_NOT_FOUND');
    });

    it('rejects non-existent template', () => {
      const error = validateProvision(
        { alias: 'eng-1', name: 'Engineer', roleTemplate: 'nonexistent', reportsTo: 'ceo' },
        db, templateDir,
      );
      expect(error).not.toBeNull();
      expect(error!.code).toBe('TEMPLATE_NOT_FOUND');
    });
  });

  describe('provision', () => {
    it('inserts person into DB with correct fields', () => {
      const result = provision(
        { alias: 'eng-1', name: 'Engineer One', roleTemplate: 'software-engineer', reportsTo: 'ceo' },
        db, orgDir, templateDir,
      );

      expect(result.person.alias).toBe('eng-1');
      expect(result.person.name).toBe('Engineer One');
      expect(result.person.reportsTo).toBe(1); // ceo's ID
      expect(result.person.status).toBe('active');
      expect(result.folder).toBe(`${result.person.id}-eng-1`);
    });

    it('creates org folder from template', () => {
      const result = provision(
        { alias: 'eng-1', name: 'Engineer One', roleTemplate: 'software-engineer', reportsTo: 'ceo' },
        db, orgDir, templateDir,
      );

      expect(fs.existsSync(result.dir)).toBe(true);
      expect(fs.existsSync(path.join(result.dir, 'IDENTITY.md'))).toBe(true);
      expect(fs.existsSync(path.join(result.dir, 'SOUL.md'))).toBe(true);
      expect(fs.existsSync(path.join(result.dir, 'BUREAU.md'))).toBe(true);
      expect(fs.existsSync(path.join(result.dir, 'PRIORITIES.md'))).toBe(true);
      expect(fs.existsSync(path.join(result.dir, 'MEMORY.md'))).toBe(true);
    });

    it('generates IDENTITY.md with frontmatter', () => {
      const result = provision(
        { alias: 'eng-1', name: 'Engineer One', roleTemplate: 'software-engineer', reportsTo: 'ceo', vibe: 'Ships fast' },
        db, orgDir, templateDir,
      );

      const identity = fs.readFileSync(path.join(result.dir, 'IDENTITY.md'), 'utf-8');
      expect(identity).toContain('name: Engineer One');
      expect(identity).toContain('role: Software Engineer');
      expect(identity).toContain('model: claude-opus-4-6');
      expect(identity).toContain('vibe: "Ships fast"');
      expect(identity).toContain('skills: [hive-comms, code-lifecycle]');
      expect(identity).toContain('You are a Software Engineer');
    });

    it('customizes BUREAU.md with reporting', () => {
      const result = provision(
        { alias: 'eng-1', name: 'Engineer One', roleTemplate: 'software-engineer', reportsTo: 'ceo' },
        db, orgDir, templateDir,
      );

      const bureau = fs.readFileSync(path.join(result.dir, 'BUREAU.md'), 'utf-8');
      expect(bureau).toContain('Reports to: @ceo (Hive CEO)');
    });

    it('updates manager BUREAU.md with new direct report', () => {
      provision(
        { alias: 'eng-1', name: 'Engineer One', roleTemplate: 'software-engineer', reportsTo: 'ceo' },
        db, orgDir, templateDir,
      );

      const ceoBureau = fs.readFileSync(path.join(orgDir, '1-ceo', 'BUREAU.md'), 'utf-8');
      expect(ceoBureau).toContain('@eng-1');
    });

    it('throws on duplicate alias', () => {
      expect(() => provision(
        { alias: 'ceo', name: 'Dup', roleTemplate: 'software-engineer', reportsTo: 'ceo' },
        db, orgDir, templateDir,
      )).toThrow('ALIAS_EXISTS');
    });
  });
});
