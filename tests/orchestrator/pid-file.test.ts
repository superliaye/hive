import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { PidFile } from '../../src/orchestrator/pid-file.js';

describe('PidFile', () => {
  let tmpDir: string;
  let pidPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-pid-'));
    pidPath = path.join(tmpDir, 'hive.pid');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes current PID to file', () => {
    const pf = new PidFile(pidPath);
    pf.write();
    const content = fs.readFileSync(pidPath, 'utf-8').trim();
    expect(parseInt(content, 10)).toBe(process.pid);
  });

  it('reads existing PID from file', () => {
    fs.writeFileSync(pidPath, '12345\n');
    const pf = new PidFile(pidPath);
    expect(pf.read()).toBe(12345);
  });

  it('returns null when no PID file exists', () => {
    const pf = new PidFile(pidPath);
    expect(pf.read()).toBeNull();
  });

  it('removes PID file', () => {
    const pf = new PidFile(pidPath);
    pf.write();
    expect(fs.existsSync(pidPath)).toBe(true);
    pf.remove();
    expect(fs.existsSync(pidPath)).toBe(false);
  });

  it('detects if existing PID is alive (current process)', () => {
    fs.writeFileSync(pidPath, `${process.pid}\n`);
    const pf = new PidFile(pidPath);
    expect(pf.isRunning()).toBe(true);
  });

  it('detects if existing PID is dead', () => {
    // Use an impossibly high PID that won't exist
    fs.writeFileSync(pidPath, '999999999\n');
    const pf = new PidFile(pidPath);
    expect(pf.isRunning()).toBe(false);
  });

  it('returns false for isRunning when no PID file exists', () => {
    const pf = new PidFile(pidPath);
    expect(pf.isRunning()).toBe(false);
  });
});
