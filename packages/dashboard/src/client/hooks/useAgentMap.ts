import { useMemo } from 'react';
import { useApi } from './useApi';
import type { Agent } from '../types';

/** Map of agentId → Agent for looking up display info from an alias. */
export function useAgentMap() {
  const { data: agents } = useApi<Agent[]>('/api/agents');
  return useMemo(() => {
    const map = new Map<string, Agent>();
    if (agents) {
      for (const a of agents) map.set(a.id, a);
    }
    return map;
  }, [agents]);
}

/** Format an agent's display label: "Name, Title" or just the alias if not found. */
export function agentLabel(agent: Agent | undefined, fallback: string): string {
  if (!agent) return fallback;
  const title = agent.role;
  return title ? `${agent.name}, ${title}` : agent.name;
}

/** Short label for tight spaces: "Name" with title as separate element. */
export function agentNameAndTitle(agent: Agent | undefined, fallback: string): { name: string; title: string | null } {
  if (!agent) return { name: fallback, title: null };
  return { name: agent.name, title: agent.role || null };
}
