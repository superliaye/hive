import { describe, it, expect } from 'vitest';
import { parseManifest, topologicalSort, loadManifest } from '../../src/org/manifest.js';
import path from 'path';

const ORG_TEMPLATES_DIR = path.resolve(__dirname, '../../org-templates');

describe('parseManifest', () => {
  it('parses a valid manifest', () => {
    const manifest = parseManifest({
      name: 'Test Org',
      description: 'A test org',
      agents: [
        { alias: 'hiro', name: 'Hiro Tanaka', role: 'chief-executive', reports_to: 'super-user' },
        { alias: 'zoe', name: 'Zoe Chen', role: 'agent-resources', reports_to: 'hiro' },
      ],
    });

    expect(manifest.name).toBe('Test Org');
    expect(manifest.agents).toHaveLength(2);
    expect(manifest.agents[0].alias).toBe('hiro');
    expect(manifest.agents[0].role).toBe('chief-executive');
  });

  it('throws on duplicate aliases', () => {
    expect(() => parseManifest({
      name: 'Bad',
      agents: [
        { alias: 'hiro', name: 'Hiro', role: 'chief-executive', reports_to: 'super-user' },
        { alias: 'hiro', name: 'Hiro 2', role: 'manager', reports_to: 'hiro' },
      ],
    })).toThrow('Duplicate alias');
  });

  it('throws when reports_to references unknown alias', () => {
    expect(() => parseManifest({
      name: 'Bad',
      agents: [
        { alias: 'hiro', name: 'Hiro', role: 'chief-executive', reports_to: 'nobody' },
      ],
    })).toThrow('reports_to');
  });

  it('throws when no agent reports to super-user', () => {
    expect(() => parseManifest({
      name: 'Bad',
      agents: [
        { alias: 'hiro', name: 'Hiro', role: 'chief-executive', reports_to: 'zoe' },
        { alias: 'zoe', name: 'Zoe', role: 'manager', reports_to: 'hiro' },
      ],
    })).toThrow('root');
  });
});

describe('topologicalSort', () => {
  it('sorts managers before their reports', () => {
    const agents = [
      { alias: 'kai', name: 'Kai', role: 'software-engineer', reports_to: 'maya' },
      { alias: 'hiro', name: 'Hiro', role: 'chief-executive', reports_to: 'super-user' },
      { alias: 'maya', name: 'Maya', role: 'manager', reports_to: 'hiro' },
    ];

    const sorted = topologicalSort(agents);
    const aliases = sorted.map(a => a.alias);

    expect(aliases.indexOf('hiro')).toBeLessThan(aliases.indexOf('maya'));
    expect(aliases.indexOf('maya')).toBeLessThan(aliases.indexOf('kai'));
  });

  it('handles flat structure (all report to same manager)', () => {
    const agents = [
      { alias: 'hiro', name: 'Hiro', role: 'chief-executive', reports_to: 'super-user' },
      { alias: 'a', name: 'A', role: 'software-engineer', reports_to: 'hiro' },
      { alias: 'b', name: 'B', role: 'software-engineer', reports_to: 'hiro' },
    ];

    const sorted = topologicalSort(agents);
    expect(sorted[0].alias).toBe('hiro');
    expect(sorted).toHaveLength(3);
  });
});

describe('loadManifest', () => {
  it('loads software-startup manifest from disk', () => {
    const manifest = loadManifest('software-startup', ORG_TEMPLATES_DIR);
    expect(manifest.name).toBe('Software Startup');
    expect(manifest.agents).toHaveLength(12);

    // Check all aliases are human names (not role-based)
    for (const agent of manifest.agents) {
      expect(agent.alias).not.toMatch(/^(ceo|ar|pm|qa|eng|swe|mgr)/);
    }

    // Check exactly one root
    const roots = manifest.agents.filter(a => a.reports_to === 'super-user');
    expect(roots).toHaveLength(1);
    expect(roots[0].alias).toBe('hiro');
  });

  it('has all required role templates', () => {
    const manifest = loadManifest('software-startup', ORG_TEMPLATES_DIR);
    const roles = new Set(manifest.agents.map(a => a.role));
    expect(roles).toContain('chief-executive');
    expect(roles).toContain('agent-resources');
    expect(roles).toContain('manager');
    expect(roles).toContain('software-engineer');
    expect(roles).toContain('qa-engineer');
    expect(roles).toContain('product-manager');
  });
});
