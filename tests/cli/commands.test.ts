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
