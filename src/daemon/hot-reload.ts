import type { AgentConfig } from '../types.js';

export interface HotReloadDiff {
  added: string[];
  removed: string[];
}

/**
 * Compare current and updated agent maps to find additions and removals.
 */
export function detectNewAgents(
  current: Map<string, AgentConfig>,
  updated: Map<string, AgentConfig>,
): HotReloadDiff {
  const currentIds = new Set(current.keys());
  const updatedIds = new Set(updated.keys());

  const added = [...updatedIds].filter(id => !currentIds.has(id));
  const removed = [...currentIds].filter(id => !updatedIds.has(id));

  return { added, removed };
}
