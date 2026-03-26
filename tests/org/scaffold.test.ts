import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { scaffold } from '../../src/org/scaffold.js';
import { parseOrgFlat } from '../../src/org/parser.js';
import type { Person } from '../../src/types.js';

describe('scaffold', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-scaffold-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates org/ with CEO and AR agents', () => {
    const result = scaffold({ targetDir: tmpDir, mission: 'Test mission' });

    expect(result.agentsCreated).toEqual(['ceo', 'ar']);

    // Verify directory structure
    const orgDir = path.join(tmpDir, 'org');
    expect(fs.existsSync(orgDir)).toBe(true);
    expect(fs.existsSync(path.join(orgDir, 'ORG.md'))).toBe(true);

    // CEO files (flat: org/1-ceo/)
    for (const file of ['IDENTITY.md', 'BUREAU.md', 'SOUL.md', 'ROUTINE.md', 'PRIORITIES.md', 'MEMORY.md']) {
      expect(fs.existsSync(path.join(orgDir, '1-ceo', file))).toBe(true);
    }

    // AR files (flat: org/2-ar/)
    for (const file of ['IDENTITY.md', 'BUREAU.md', 'SOUL.md', 'ROUTINE.md', 'PRIORITIES.md', 'MEMORY.md']) {
      expect(fs.existsSync(path.join(orgDir, '2-ar', file))).toBe(true);
    }
  });

  it('writes mission into ORG.md', () => {
    scaffold({ targetDir: tmpDir, mission: 'Build the future' });
    const content = fs.readFileSync(path.join(tmpDir, 'org', 'ORG.md'), 'utf-8');
    expect(content).toContain('Build the future');
  });

  it('uses custom timezone', () => {
    scaffold({ targetDir: tmpDir, mission: 'Test', timezone: 'Europe/London' });
    const content = fs.readFileSync(path.join(tmpDir, 'org', 'ORG.md'), 'utf-8');
    expect(content).toContain('Europe/London');
  });

  it('throws if org/ already exists', () => {
    fs.mkdirSync(path.join(tmpDir, 'org'));
    expect(() => scaffold({ targetDir: tmpDir, mission: 'Test' })).toThrow('already exists');
  });

  it('produces a valid org chart parseable by parseOrgFlat', async () => {
    scaffold({ targetDir: tmpDir, mission: 'Parseable org' });
    const orgDir = path.join(tmpDir, 'org');

    // Create mock people matching what scaffold creates
    const people: Person[] = [
      { id: 1, alias: 'ceo', name: 'CEO', status: 'active', folder: '1-ceo' },
      { id: 2, alias: 'ar', name: 'AR', status: 'active', folder: '2-ar', reportsTo: 1 },
    ];

    const orgChart = await parseOrgFlat(orgDir, people);

    expect(orgChart.agents.size).toBe(2);
    expect(orgChart.agents.has('ceo')).toBe(true);
    expect(orgChart.agents.has('ar')).toBe(true);

    // CEO has no reportsTo
    const ceo = orgChart.agents.get('ceo')!;
    expect(ceo.person.alias).toBe('ceo');
    expect(ceo.reportsTo).toBeNull();
    expect(ceo.directReports.map(p => p.alias)).toContain('ar');

    // AR identity
    const ar = orgChart.agents.get('ar')!;
    expect(ar.identity.role).toBe('Agent Resources Manager');
    expect(ar.identity.skills).toContain('agent-provisioning');
    expect(ar.reportsTo?.alias).toBe('ceo');
  });

  it('CEO has correct skills declared', () => {
    scaffold({ targetDir: tmpDir, mission: 'Skills test' });
    const content = fs.readFileSync(path.join(tmpDir, 'org', '1-ceo', 'IDENTITY.md'), 'utf-8');
    expect(content).toContain('board-protocol');
    expect(content).toContain('hive-comms');
    expect(content).toContain('plan-review');
  });
});
