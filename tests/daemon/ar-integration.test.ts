import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseOrgFlat } from '../../src/org/parser.js';
import { detectNewAgents } from '../../src/daemon/hot-reload.js';
import type { Person } from '../../src/types.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('AR integration', () => {
  let tmpDir: string;

  /** People records that simulate what the DB would return. */
  function basePeople(): Person[] {
    return [
      { id: 1, alias: 'ceo', name: 'CEO', roleTemplate: 'CEO', status: 'active', folder: '1-ceo' },
      { id: 2, alias: 'ar', name: 'AR', roleTemplate: 'Agent Resources Manager', status: 'active', folder: '2-ar', reportsTo: 1 },
    ];
  }

  function writeAgent(dir: string, name: string, role: string, bureau = '# Bureau\n') {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'IDENTITY.md'), `---\nname: ${name}\nrole: ${role}\nmodel: sonnet\n---\n`);
    fs.writeFileSync(path.join(dir, 'SOUL.md'), '# Soul\n');
    fs.writeFileSync(path.join(dir, 'BUREAU.md'), bureau);
    fs.writeFileSync(path.join(dir, 'PRIORITIES.md'), '# Priorities\n');
    fs.writeFileSync(path.join(dir, 'ROUTINE.md'), '# Routine\n');
    fs.writeFileSync(path.join(dir, 'MEMORY.md'), '# Memory\n');
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-ar-int-'));
    writeAgent(path.join(tmpDir, '1-ceo'), 'CEO', 'CEO');
    writeAgent(path.join(tmpDir, '2-ar'), 'AR', 'Agent Resources Manager');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects a new agent created by AR', async () => {
    const people = basePeople();
    const orgBefore = await parseOrgFlat(tmpDir, people);
    expect(orgBefore.agents.has('ceo')).toBe(true);
    expect(orgBefore.agents.has('ar')).toBe(true);
    expect(orgBefore.agents.has('frontend-eng')).toBe(false);

    // Simulate AR creating a new agent folder
    writeAgent(
      path.join(tmpDir, '3-frontend-eng'),
      'Frontend Engineer',
      'Frontend Engineer',
    );

    // Add the new person to the people list (as AR would insert into DB)
    const updatedPeople: Person[] = [
      ...people,
      { id: 3, alias: 'frontend-eng', name: 'Frontend Engineer', roleTemplate: 'Frontend Engineer', status: 'active', folder: '3-frontend-eng', reportsTo: 1 },
    ];

    const orgAfter = await parseOrgFlat(tmpDir, updatedPeople);
    const diff = detectNewAgents(orgBefore.agents, orgAfter.agents);

    expect(diff.added).toContain('frontend-eng');
    expect(diff.removed).toEqual([]);
    expect(orgAfter.agents.has('frontend-eng')).toBe(true);
  });

  it('detects agent removal', async () => {
    const people = basePeople();
    const orgBefore = await parseOrgFlat(tmpDir, people);
    expect(orgBefore.agents.has('ar')).toBe(true);

    // Simulate archiving the AR agent folder
    fs.rmSync(path.join(tmpDir, '2-ar'), { recursive: true });

    const orgAfter = await parseOrgFlat(tmpDir, people);
    const diff = detectNewAgents(orgBefore.agents, orgAfter.agents);

    expect(diff.removed).toContain('ar');
    expect(diff.added).toEqual([]);
  });
});
