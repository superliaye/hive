import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const FIXTURE_ORG = path.resolve(__dirname, '../fixtures/sample-org');

let tempDir: string;

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
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
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
