import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const FIXTURE_ORG = path.resolve(__dirname, '../fixtures/sample-org');

let tempDir: string;

function seedPeople(dataDir: string): void {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'hive.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // Create only the people table — ChatDb.init() will create the rest
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
    INSERT INTO people (id, alias, name, role_template, status, folder, reports_to) VALUES (2, 'ar', 'AR', 'Agent Resources Manager', 'active', '2-ar', 1);
    INSERT INTO people (id, alias, name, role_template, status, folder, reports_to) VALUES (3, 'eng-1', 'Engineer 1', 'Backend Software Engineer', 'active', '3-eng-1', 1);
  `);
  db.close();
}

function runCli(args: string[]): string {
  return execFileSync('npx', ['tsx', path.join(PROJECT_ROOT, 'src/cli.ts'), ...args], {
    cwd: tempDir,
    encoding: 'utf-8',
    timeout: 10_000,
  });
}

describe('CLI commands', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-test-'));
    fs.cpSync(FIXTURE_ORG, path.join(tempDir, 'org'), { recursive: true });
    seedPeople(path.join(tempDir, 'data'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('hive org prints the org chart', () => {
    const output = runCli(['org']);
    expect(output).toContain('Test CEO');
    expect(output).toContain('Engineer 1');
    expect(output).toContain('[ceo]');
    expect(output).toContain('3 agents');
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
