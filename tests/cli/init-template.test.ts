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

    // Copy real role-templates, org-templates, and role-skills to tmpDir
    const hiveRoot = path.resolve(process.cwd());
    fs.cpSync(path.join(hiveRoot, 'role-templates'), path.join(tmpDir, 'role-templates'), { recursive: true });
    fs.cpSync(path.join(hiveRoot, 'org-templates'), path.join(tmpDir, 'org-templates'), { recursive: true });
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
