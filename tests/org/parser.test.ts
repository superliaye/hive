import { describe, it, expect } from 'vitest';
import { parseOrgFlat } from '../../src/org/parser.js';
import type { Person } from '../../src/types.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/sample-org');

const mockPeople: Person[] = [
  { id: 1, alias: 'ceo', name: 'Test CEO', roleTemplate: 'Chief Executive Officer', status: 'active', reportsTo: undefined },
  { id: 2, alias: 'ar', name: 'Test AR', roleTemplate: 'Admin & Routing', status: 'active', reportsTo: 1 },
  { id: 3, alias: 'eng-1', name: 'Test Eng 1', roleTemplate: 'Engineer', status: 'active', reportsTo: 1 },
];

describe('parseOrgFlat', () => {
  it('parses the CEO agent', async () => {
    const org = await parseOrgFlat(FIXTURE_DIR, mockPeople);
    const ceo = org.agents.get('ceo');
    expect(ceo).toBeDefined();
    expect(ceo!.identity.name).toBe('Test CEO');
    expect(ceo!.identity.role).toBe('Chief Executive Officer');
    expect(ceo!.person.alias).toBe('ceo');
  });

  it('discovers all agents', async () => {
    const org = await parseOrgFlat(FIXTURE_DIR, mockPeople);
    expect(org.agents.size).toBe(3); // CEO + AR + eng-1
  });

  it('builds reportsTo relationships from people array', async () => {
    const org = await parseOrgFlat(FIXTURE_DIR, mockPeople);
    const ceo = org.agents.get('ceo')!;
    expect(ceo.reportsTo).toBeNull();
    expect(ceo.directReports.length).toBe(2);

    const eng1 = org.agents.get('eng-1')!;
    expect(eng1.reportsTo).toBeDefined();
    expect(eng1.reportsTo!.alias).toBe('ceo');
  });

  it('returns people array on OrgChart', async () => {
    const org = await parseOrgFlat(FIXTURE_DIR, mockPeople);
    expect(org.people).toHaveLength(3);
    expect(org.people[0].alias).toBe('ceo');
  });

  it('keys agents map by alias', async () => {
    const org = await parseOrgFlat(FIXTURE_DIR, mockPeople);
    const aliases = Array.from(org.agents.keys());
    expect(aliases).toContain('ceo');
    expect(aliases).toContain('ar');
    expect(aliases).toContain('eng-1');
  });

  it('reads agent md files into config', async () => {
    const org = await parseOrgFlat(FIXTURE_DIR, mockPeople);
    const ceo = org.agents.get('ceo')!;
    expect(ceo.files.soul).toContain('Strategic thinker');
    expect(ceo.files.bureau).toContain('Super User');
  });

  it('parses all 5 identity fields from IDENTITY.md frontmatter', async () => {
    const org = await parseOrgFlat(FIXTURE_DIR, mockPeople);

    const ceo = org.agents.get('ceo')!;
    expect(ceo.identity.id).toBe(1);
    expect(ceo.identity.alias).toBe('ceo');
    expect(ceo.identity.name).toBe('Test CEO');
    expect(ceo.identity.role).toBe('Chief Executive Officer');
    expect(ceo.identity.title).toBe('CEO');

    const eng1 = org.agents.get('eng-1')!;
    expect(eng1.identity.id).toBe(3);
    expect(eng1.identity.alias).toBe('eng-1');
    expect(eng1.identity.name).toBe('Engineer 1');
    expect(eng1.identity.role).toBe('Backend Software Engineer');
    expect(eng1.identity.title).toBeUndefined();  // blank title
  });
});
