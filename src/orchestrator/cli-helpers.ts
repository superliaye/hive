import type { AgentConfig, OrgChart } from '../types.js';
import type { OrchestratorConfig } from './orchestrator.js';
import type { UnreadMessage } from './heartbeat.js';
import fs from 'fs/promises';
import path from 'path';

export type ScheduleType = 'persistent' | 'on-demand';

/**
 * Determine if an agent should be persistent or on-demand.
 *
 * Rules:
 * 1. Depth 0-1 (CEO, VPs) → persistent by default
 * 2. ROUTINE.md contains "on-demand" → on-demand regardless of depth
 * 3. ROUTINE.md contains tight heartbeat (< 30min) → persistent
 * 4. All others → on-demand
 */
export function parseAgentScheduleType(agent: AgentConfig): ScheduleType {
  const routine = agent.files.routine.toLowerCase();

  // Explicit override in ROUTINE.md
  if (routine.includes('type: on-demand') || routine.includes('type:on-demand')) {
    return 'on-demand';
  }

  // Top-level agents (no manager) are persistent by default
  if (!agent.reportsTo) {
    return 'persistent';
  }

  // Check for tight heartbeat in ROUTINE.md
  const heartbeatMatch = routine.match(/heartbeat\s*\(every\s*(\d+)\s*min/);
  if (heartbeatMatch) {
    const minutes = parseInt(heartbeatMatch[1], 10);
    if (minutes <= 30) return 'persistent';
  }

  return 'on-demand';
}

/**
 * Build an OrchestratorConfig from CLI context.
 * This is the bridge between the CLI layer and the orchestrator.
 */
export function buildStartConfig(opts: {
  orgChart: OrgChart;
  dataDir: string;
  persistentIntervalMs?: number;
  onDemandIntervalMs?: number;
  commsProvider?: {
    getUnread: (agentId: string) => Promise<UnreadMessage[]>;
    markRead: (agentId: string, messageIds: string[]) => Promise<void>;
    postMessage: (agentId: string, channel: string, content: string, opts?: { thread?: string }) => Promise<void>;
  };
}): OrchestratorConfig {
  const { orgChart, dataDir } = opts;

  // Classify agents
  const persistentAgentIds: string[] = [];
  for (const [id, agent] of orgChart.agents) {
    if (parseAgentScheduleType(agent) === 'persistent') {
      persistentAgentIds.push(id);
    }
  }

  // Default comms callbacks (no-op if no provider wired yet)
  const defaultComms = {
    getUnread: async () => [] as UnreadMessage[],
    markRead: async () => {},
    postMessage: async () => {},
  };
  const comms = opts.commsProvider ?? defaultComms;

  return {
    orgChart,
    stateDbPath: path.join(dataDir, 'orchestrator.db'),
    pidFilePath: path.join(dataDir, 'hive.pid'),
    persistentAgentIds,
    persistentIntervalMs: opts.persistentIntervalMs ?? 600_000,    // 10 min default
    onDemandIntervalMs: opts.onDemandIntervalMs ?? 7_200_000,      // 2 hours default
    getUnread: comms.getUnread,
    markRead: comms.markRead,
    postMessage: comms.postMessage,
    appendToMemory: async (agentId: string, content: string) => {
      const agent = orgChart.agents.get(agentId);
      if (!agent) return;
      const today = new Date().toISOString().slice(0, 10);
      const memoryFile = path.join(agent.dir, 'memory', `${today}.md`);
      const memoryDir = path.join(agent.dir, 'memory');
      try {
        await fs.mkdir(memoryDir, { recursive: true });
        await fs.appendFile(memoryFile, `${content}\n`);
      } catch {
        // Best effort
      }
    },
    appendToPriorities: async (agentId: string, content: string) => {
      const agent = orgChart.agents.get(agentId);
      if (!agent) return;
      const prioritiesFile = path.join(agent.dir, 'PRIORITIES.md');
      try {
        const existing = await fs.readFile(prioritiesFile, 'utf-8');
        // Append under "## Backlog" section, or at the end
        if (existing.includes('## Backlog')) {
          const updated = existing.replace('## Backlog', `## Backlog\n${content}`);
          await fs.writeFile(prioritiesFile, updated);
        } else {
          await fs.appendFile(prioritiesFile, `\n## Backlog\n${content}\n`);
        }
      } catch {
        // If file doesn't exist, create it
        await fs.writeFile(prioritiesFile, `# Priorities\n\n## Backlog\n${content}\n`);
      }
    },
  };
}
