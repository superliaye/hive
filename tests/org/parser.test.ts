import { describe, it, expect } from 'vitest';
import { parseOrgTree } from '../../src/org/parser.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/sample-org');

describe('parseOrgTree', () => {
  it('parses the root agent (CEO)', async () => {
    const org = await parseOrgTree(FIXTURE_DIR);
    expect(org.root.identity.name).toBe('Test CEO');
    expect(org.root.identity.role).toBe('Chief Executive Officer');
    expect(org.root.depth).toBe(0);
    expect(org.root.parentId).toBeNull();
  });

  it('discovers nested agents', async () => {
    const org = await parseOrgTree(FIXTURE_DIR);
    expect(org.agents.size).toBe(2); // CEO + eng-1
  });

  it('builds parent-child relationships', async () => {
    const org = await parseOrgTree(FIXTURE_DIR);
    const ceo = org.root;
    expect(ceo.childIds.length).toBeGreaterThan(0);

    const eng1 = org.agents.get(ceo.childIds[0]);
    expect(eng1).toBeDefined();
    expect(eng1!.parentId).toBe(ceo.id);
  });

  it('generates channel definitions from tree', async () => {
    const org = await parseOrgTree(FIXTURE_DIR);
    const channelNames = org.channels.map(c => c.name);
    expect(channelNames).toContain('all-hands');
    expect(channelNames).toContain('board');
  });

  it('derives agent IDs from folder path', async () => {
    const org = await parseOrgTree(FIXTURE_DIR);
    const ids = Array.from(org.agents.keys());
    expect(ids).toContain('ceo');
    expect(ids.some(id => id.includes('eng-1'))).toBe(true);
  });

  it('reads agent md files into config', async () => {
    const org = await parseOrgTree(FIXTURE_DIR);
    const ceo = org.root;
    expect(ceo.files.soul).toContain('Strategic thinker');
    expect(ceo.files.bureau).toContain('Super User');
  });
});
