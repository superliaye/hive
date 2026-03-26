import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { instantiateFromManifest } from '../../src/org/manifest.js';
import { runFullScan } from '../../src/validation/org-health.js';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Copy real role-templates and role-skills into temp dir so provision() works.
 * Layout: tmpDir/org/, tmpDir/role-templates/, tmpDir/role-skills/
 * provision() resolves role-skills via path.resolve(orgDir, '..', 'role-skills')
 */
function setupTestDir(): { tmpDir: string; orgDir: string; templateDir: string; roleSkillsDir: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-manifest-'));
  const orgDir = path.join(tmpDir, 'org');
  fs.mkdirSync(orgDir, { recursive: true });

  const hiveRoot = path.resolve(__dirname, '../..');
  const templateDir = path.join(tmpDir, 'role-templates');
  const roleSkillsDir = path.join(tmpDir, 'role-skills');

  fs.cpSync(path.join(hiveRoot, 'role-templates'), templateDir, { recursive: true });
  fs.cpSync(path.join(hiveRoot, 'role-skills'), roleSkillsDir, { recursive: true });

  return { tmpDir, orgDir, templateDir, roleSkillsDir };
}

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE people (
      id INTEGER PRIMARY KEY, alias TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      role_template TEXT, status TEXT NOT NULL DEFAULT 'active', folder TEXT,
      reports_to INTEGER REFERENCES people(id), created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO people (id, alias, name, status) VALUES (0, 'super-user', 'Super User', 'active');
  `);
  return db;
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
    const dirs = setupTestDir();
    tmpDir = dirs.tmpDir;
    orgDir = dirs.orgDir;
    templateDir = dirs.templateDir;
    roleSkillsDir = dirs.roleSkillsDir;
    db = createDb();
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

    const folders = fs.readdirSync(orgDir).filter(f =>
      fs.statSync(path.join(orgDir, f)).isDirectory()
    );
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
    expect(bureau).toContain('Reports to: @maya');
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
      for (const e of errors) console.error(`  [${e.code}] ${e.message}`);
    }
    expect(errors).toHaveLength(0);
  });

  it('returns warnings array from post-provisioning checks', () => {
    const result = instantiateFromManifest(SOFTWARE_STARTUP_MANIFEST, { db, orgDir, templateDir });

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
