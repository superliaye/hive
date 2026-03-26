import { describe, it, expect } from 'vitest';
import { detectNewAgents } from '../../src/daemon/hot-reload.js';
import type { AgentConfig } from '../../src/types.js';

describe('hot-reload', () => {
  it('detects agents in new org chart not in current', () => {
    const current = new Map<string, AgentConfig>();
    current.set('ceo', { id: 'ceo' } as AgentConfig);

    const updated = new Map<string, AgentConfig>();
    updated.set('ceo', { id: 'ceo' } as AgentConfig);
    updated.set('ceo-ar', { id: 'ceo-ar' } as AgentConfig);

    const { added, removed } = detectNewAgents(current, updated);
    expect(added).toEqual(['ceo-ar']);
    expect(removed).toEqual([]);
  });

  it('detects removed agents', () => {
    const current = new Map<string, AgentConfig>();
    current.set('ceo', { id: 'ceo' } as AgentConfig);
    current.set('ceo-old', { id: 'ceo-old' } as AgentConfig);

    const updated = new Map<string, AgentConfig>();
    updated.set('ceo', { id: 'ceo' } as AgentConfig);

    const { added, removed } = detectNewAgents(current, updated);
    expect(added).toEqual([]);
    expect(removed).toEqual(['ceo-old']);
  });

  it('returns empty when no changes', () => {
    const agents = new Map<string, AgentConfig>();
    agents.set('ceo', { id: 'ceo' } as AgentConfig);

    const { added, removed } = detectNewAgents(agents, agents);
    expect(added).toEqual([]);
    expect(removed).toEqual([]);
  });
});
