import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const ROLE_TEMPLATES_SRC = path.resolve(PROJECT_ROOT, 'role-templates');

let tempDir: string;

// Seed only super-user + CEO (minimal org for agent creation tests)
function seedPeople(dataDir: string): void {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'hive.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS people (
      id INTEGER PRIMARY KEY,
      alias TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      role_template TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      folder TEXT,
      reports_to INTEGER REFERENCES people(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO people (id, alias, name, status, folder) VALUES (0, 'super-user', 'Super User', 'active', NULL);
    INSERT INTO people (id, alias, name, role_template, status, folder) VALUES (1, 'ceo', 'Test CEO', 'Chief Executive Officer', 'active', '1-ceo');
  `);
  db.close();
}

function openDb(): Database.Database {
  return new Database(path.join(tempDir, 'data', 'hive.db'));
}

function runCli(args: string[]): string {
  return execFileSync('npx', ['tsx', path.join(PROJECT_ROOT, 'src/cli.ts'), ...args], {
    cwd: tempDir,
    encoding: 'utf-8',
    timeout: 30_000,
  });
}

function runCliExpectError(args: string[]): string {
  try {
    execFileSync('npx', ['tsx', path.join(PROJECT_ROOT, 'src/cli.ts'), ...args], {
      cwd: tempDir,
      encoding: 'utf-8',
      timeout: 30_000,
    });
    throw new Error('Expected CLI to exit with non-zero code');
  } catch (err: any) {
    // execFileSync throws on non-zero exit; stderr is in err.stderr
    return (err.stderr ?? '') + (err.stdout ?? '');
  }
}

function setupTempDir(): void {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-agent-test-'));

  // Create org/ with CEO folder and BUREAU.md
  const ceoDir = path.join(tempDir, 'org', '1-ceo');
  fs.mkdirSync(ceoDir, { recursive: true });
  fs.writeFileSync(
    path.join(ceoDir, 'BUREAU.md'),
    `## Reporting

Reports to: Board / Super User
Direct reports: none

## Authority

- Full authority over org structure
`,
  );

  // Copy real role-templates/ into temp dir
  fs.cpSync(ROLE_TEMPLATES_SRC, path.join(tempDir, 'role-templates'), { recursive: true });

  // Seed DB
  seedPeople(path.join(tempDir, 'data'));
}

describe('hive agent create', () => {
  beforeEach(() => {
    setupTempDir();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // ── Basic Creation ──

  it('creates a person in the DB with correct fields', () => {
    const output = runCli([
      'agent', 'create',
      '--alias', 'platform-eng',
      '--name', 'Platform Engineer',
      '--template', 'software-engineer',
      '--reports-to', 'ceo',
    ]);

    expect(output).toContain('Agent created');
    expect(output).toContain('@platform-eng');

    const db = openDb();
    const row = db.prepare('SELECT * FROM people WHERE alias = ?').get('platform-eng') as any;
    db.close();

    expect(row).toBeDefined();
    expect(row.alias).toBe('platform-eng');
    expect(row.name).toBe('Platform Engineer');
    expect(row.role_template).toBe('software-engineer');
    expect(row.reports_to).toBe(1); // CEO id
    expect(row.status).toBe('active');
    expect(row.folder).toBe(`${row.id}-platform-eng`);
  });

  it('creates org/{id}-{alias}/ directory with all template files', () => {
    runCli([
      'agent', 'create',
      '--alias', 'backend-eng',
      '--name', 'Backend Engineer',
      '--template', 'software-engineer',
      '--reports-to', 'ceo',
    ]);

    const db = openDb();
    const row = db.prepare('SELECT folder FROM people WHERE alias = ?').get('backend-eng') as any;
    db.close();

    const agentDir = path.join(tempDir, 'org', row.folder);
    expect(fs.existsSync(agentDir)).toBe(true);

    const expectedFiles = ['IDENTITY.md', 'SOUL.md', 'BUREAU.md', 'PRIORITIES.md', 'MEMORY.md'];
    for (const file of expectedFiles) {
      expect(fs.existsSync(path.join(agentDir, file))).toBe(true);
    }
  });

  it('generates IDENTITY.md with correct YAML frontmatter from config.json', () => {
    runCli([
      'agent', 'create',
      '--alias', 'se-1',
      '--name', 'Software Engineer 1',
      '--template', 'software-engineer',
      '--reports-to', 'ceo',
    ]);

    const db = openDb();
    const row = db.prepare('SELECT folder FROM people WHERE alias = ?').get('se-1') as any;
    db.close();

    const identity = fs.readFileSync(
      path.join(tempDir, 'org', row.folder, 'IDENTITY.md'),
      'utf-8',
    );

    // Check frontmatter fields derived from software-engineer/config.json
    expect(identity).toMatch(/^---\n/);
    expect(identity).toContain('name: Software Engineer 1');
    expect(identity).toContain('role: Software Engineer');
    expect(identity).toContain('model: claude-opus-4-6');
    expect(identity).toMatch(/emoji: "🔧"/);
    expect(identity).toContain('hive-comms');
    expect(identity).toContain('code-lifecycle');

    // The template body should still be present after the frontmatter
    expect(identity).toContain('You are a Software Engineer');
  });

  it('generates BUREAU.md with correct reporting line', () => {
    runCli([
      'agent', 'create',
      '--alias', 'se-2',
      '--name', 'Software Engineer 2',
      '--template', 'software-engineer',
      '--reports-to', 'ceo',
    ]);

    const db = openDb();
    const row = db.prepare('SELECT folder FROM people WHERE alias = ?').get('se-2') as any;
    db.close();

    const bureau = fs.readFileSync(
      path.join(tempDir, 'org', row.folder, 'BUREAU.md'),
      'utf-8',
    );

    expect(bureau).toContain('Reports to: @ceo (Test CEO)');
    expect(bureau).toContain('Direct reports: none');
  });

  it("updates manager's BUREAU.md with new direct report", () => {
    runCli([
      'agent', 'create',
      '--alias', 'first-eng',
      '--name', 'First Engineer',
      '--template', 'software-engineer',
      '--reports-to', 'ceo',
    ]);

    const ceoBureau = fs.readFileSync(
      path.join(tempDir, 'org', '1-ceo', 'BUREAU.md'),
      'utf-8',
    );

    expect(ceoBureau).toContain('Direct reports:');
    expect(ceoBureau).toContain('@first-eng');
  });

  // ── Custom Options ──

  it('--vibe flag sets vibe in IDENTITY.md frontmatter', () => {
    runCli([
      'agent', 'create',
      '--alias', 'vibes-eng',
      '--name', 'Vibes Engineer',
      '--template', 'software-engineer',
      '--reports-to', 'ceo',
      '--vibe', 'Relentlessly cheerful and extremely thorough',
    ]);

    const db = openDb();
    const row = db.prepare('SELECT folder FROM people WHERE alias = ?').get('vibes-eng') as any;
    db.close();

    const identity = fs.readFileSync(
      path.join(tempDir, 'org', row.folder, 'IDENTITY.md'),
      'utf-8',
    );

    expect(identity).toContain('vibe: "Relentlessly cheerful and extremely thorough"');
  });

  it('--skills flag adds extra skills merged with template defaults', () => {
    runCli([
      'agent', 'create',
      '--alias', 'multi-eng',
      '--name', 'Multi-Skill Engineer',
      '--template', 'software-engineer',
      '--reports-to', 'ceo',
      '--skills', 'deploy-ops,monitoring',
    ]);

    const db = openDb();
    const row = db.prepare('SELECT folder FROM people WHERE alias = ?').get('multi-eng') as any;
    db.close();

    const identity = fs.readFileSync(
      path.join(tempDir, 'org', row.folder, 'IDENTITY.md'),
      'utf-8',
    );

    // When --skills is provided, those replace config defaults but hive-comms is always included
    expect(identity).toContain('hive-comms');
    expect(identity).toContain('deploy-ops');
    expect(identity).toContain('monitoring');
  });

  // ── Validation Errors ──

  it('rejects duplicate alias with "already exists" error', () => {
    // Create the first agent
    runCli([
      'agent', 'create',
      '--alias', 'dup-eng',
      '--name', 'First',
      '--template', 'software-engineer',
      '--reports-to', 'ceo',
    ]);

    // Try to create another with the same alias
    const output = runCliExpectError([
      'agent', 'create',
      '--alias', 'dup-eng',
      '--name', 'Second',
      '--template', 'software-engineer',
      '--reports-to', 'ceo',
    ]);

    expect(output).toContain('already exists');
  });

  it('rejects non-existent manager with "not found" error', () => {
    const output = runCliExpectError([
      'agent', 'create',
      '--alias', 'orphan-eng',
      '--name', 'Orphan',
      '--template', 'software-engineer',
      '--reports-to', 'nonexistent-manager',
    ]);

    expect(output).toContain('not found');
  });

  it('rejects non-existent template with "not found" error', () => {
    const output = runCliExpectError([
      'agent', 'create',
      '--alias', 'bad-template-eng',
      '--name', 'Bad Template',
      '--template', 'nonexistent-role',
      '--reports-to', 'ceo',
    ]);

    expect(output).toContain('not found');
  });
});

// ── Scaling Scenario: Build a Full Org ──

describe('hive agent create — full org scaling', () => {
  beforeEach(() => {
    setupTempDir();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('builds a full org: CEO + 6 agents across departments', () => {
    // 1. Create AR reporting to CEO
    runCli([
      'agent', 'create',
      '--alias', 'ar',
      '--name', 'Agent Resources',
      '--template', 'agent-resources',
      '--reports-to', 'ceo',
    ]);

    // 2. Create engineering lead reporting to CEO
    runCli([
      'agent', 'create',
      '--alias', 'eng-lead',
      '--name', 'Engineering Lead',
      '--template', 'department-head',
      '--reports-to', 'ceo',
    ]);

    // Get eng-lead's folder for later BUREAU.md checks
    const db1 = openDb();
    const engLeadRow = db1.prepare('SELECT id, folder FROM people WHERE alias = ?').get('eng-lead') as any;
    db1.close();

    // Create eng-lead's BUREAU.md will already exist from provisioning,
    // but we need to ensure the eng-lead folder exists for subsequent manager updates
    expect(fs.existsSync(path.join(tempDir, 'org', engLeadRow.folder, 'BUREAU.md'))).toBe(true);

    // 3. Create 2 software engineers reporting to eng-lead
    runCli([
      'agent', 'create',
      '--alias', 'se-alpha',
      '--name', 'SE Alpha',
      '--template', 'software-engineer',
      '--reports-to', 'eng-lead',
    ]);

    runCli([
      'agent', 'create',
      '--alias', 'se-beta',
      '--name', 'SE Beta',
      '--template', 'software-engineer',
      '--reports-to', 'eng-lead',
    ]);

    // 4. Create QA engineer reporting to eng-lead
    runCli([
      'agent', 'create',
      '--alias', 'qa-1',
      '--name', 'QA Engineer 1',
      '--template', 'qa-engineer',
      '--reports-to', 'eng-lead',
    ]);

    // 5. Create product person reporting to CEO
    runCli([
      'agent', 'create',
      '--alias', 'pa-1',
      '--name', 'Product Analyst 1',
      '--template', 'product-manager',
      '--reports-to', 'ceo',
    ]);

    // ── Verify agent list shows all 7 agents (CEO + 6 new) ──
    const listOutput = runCli(['agent', 'list']);
    expect(listOutput).toContain('@ceo');
    expect(listOutput).toContain('@ar');
    expect(listOutput).toContain('@eng-lead');
    expect(listOutput).toContain('@se-alpha');
    expect(listOutput).toContain('@se-beta');
    expect(listOutput).toContain('@qa-1');
    expect(listOutput).toContain('@pa-1');

    // ── Verify each agent's reports_to is correct in DB ──
    const db = openDb();
    const people = db.prepare(
      'SELECT alias, reports_to FROM people WHERE id > 0 ORDER BY id',
    ).all() as { alias: string; reports_to: number | null }[];

    const ceoId = (db.prepare('SELECT id FROM people WHERE alias = ?').get('ceo') as any).id;
    const engLeadId = (db.prepare('SELECT id FROM people WHERE alias = ?').get('eng-lead') as any).id;

    const reportMap = Object.fromEntries(people.map(p => [p.alias, p.reports_to]));
    expect(reportMap['ceo']).toBeNull(); // CEO reports to nobody
    expect(reportMap['ar']).toBe(ceoId);
    expect(reportMap['eng-lead']).toBe(ceoId);
    expect(reportMap['se-alpha']).toBe(engLeadId);
    expect(reportMap['se-beta']).toBe(engLeadId);
    expect(reportMap['qa-1']).toBe(engLeadId);
    expect(reportMap['pa-1']).toBe(ceoId);
    db.close();

    // ── Verify eng-lead's BUREAU.md lists all 3 direct reports ──
    const engLeadBureau = fs.readFileSync(
      path.join(tempDir, 'org', engLeadRow.folder, 'BUREAU.md'),
      'utf-8',
    );
    expect(engLeadBureau).toContain('@se-alpha');
    expect(engLeadBureau).toContain('@se-beta');
    expect(engLeadBureau).toContain('@qa-1');

    // ── Verify CEO's BUREAU.md lists AR, eng-lead, and pa-1 ──
    const ceoBureau = fs.readFileSync(
      path.join(tempDir, 'org', '1-ceo', 'BUREAU.md'),
      'utf-8',
    );
    expect(ceoBureau).toContain('@ar');
    expect(ceoBureau).toContain('@eng-lead');
    expect(ceoBureau).toContain('@pa-1');
  });
});

// ── Agent List ──

describe('hive agent list', () => {
  beforeEach(() => {
    setupTempDir();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('shows all agents with alias, name, status, and manager', () => {
    // Create a couple of agents so the list has content
    runCli([
      'agent', 'create',
      '--alias', 'list-eng',
      '--name', 'List Engineer',
      '--template', 'software-engineer',
      '--reports-to', 'ceo',
    ]);

    runCli([
      'agent', 'create',
      '--alias', 'list-qa',
      '--name', 'List QA',
      '--template', 'qa-engineer',
      '--reports-to', 'ceo',
    ]);

    const output = runCli(['agent', 'list']);

    // CEO (seeded)
    expect(output).toContain('@ceo');
    expect(output).toContain('Test CEO');

    // Created agents
    expect(output).toContain('@list-eng');
    expect(output).toContain('List Engineer');
    expect(output).toContain('@list-qa');
    expect(output).toContain('List QA');

    // Status and manager references should appear
    expect(output).toContain('active');
  });

  it('shows correct manager alias for each agent', () => {
    runCli([
      'agent', 'create',
      '--alias', 'mgr-test-eng',
      '--name', 'Manager Test Eng',
      '--template', 'software-engineer',
      '--reports-to', 'ceo',
    ]);

    const output = runCli(['agent', 'list']);

    // The list format includes "→ @manager" for each agent
    // mgr-test-eng should show → @ceo
    const lines = output.split('\n');
    const engLine = lines.find(l => l.includes('@mgr-test-eng'));
    expect(engLine).toBeDefined();
    expect(engLine).toContain('@ceo');
  });
});
