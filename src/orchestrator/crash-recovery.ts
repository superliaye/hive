import type { AgentState } from '../types.js';
import type { AgentStateStore } from '../state/agent-state.js';

export interface RecoveredAgent {
  agentId: string;
  previousTask?: string;
  previousPid?: number;
}

export interface RecoveryReport {
  recoveredAgents: RecoveredAgent[];
  timestamp: Date;
}

/**
 * Detect agents that are in 'working' state but whose PID is dead.
 * This indicates a dirty shutdown — the Claude CLI process died but the state wasn't cleaned up.
 */
export function detectStaleAgents(stateStore: AgentStateStore): AgentState[] {
  return stateStore.findStale();
}

/**
 * Recover stale agents:
 * 1. Reset 'working' agents with dead PIDs back to 'idle' (dirty shutdown)
 * 2. Reset 'errored' agents back to 'idle' (fresh start after restart)
 * 3. Return a recovery report for the orchestrator to alert CEO
 *
 * On clean restart, ALL agents should get a fresh start. The crash rate
 * limiter is in-memory anyway, so errored state from previous sessions
 * is meaningless.
 */
export function recoverStaleAgents(stateStore: AgentStateStore): RecoveryReport {
  const stale = detectStaleAgents(stateStore);
  const recoveredAgents: RecoveredAgent[] = [];

  // Recover agents stuck in 'working' (dirty shutdown)
  for (const agent of stale) {
    stateStore.updateStatus(agent.agentId, 'idle');

    recoveredAgents.push({
      agentId: agent.agentId,
      previousTask: agent.currentTask,
      previousPid: agent.pid,
    });
  }

  // Reset any agents left in 'errored' from previous session
  const allAgents = stateStore.listAll();
  for (const agent of allAgents) {
    if (agent.status === 'errored') {
      stateStore.updateStatus(agent.agentId, 'idle');
      recoveredAgents.push({
        agentId: agent.agentId,
        previousTask: agent.currentTask,
        previousPid: agent.pid,
      });
    }
  }

  return {
    recoveredAgents,
    timestamp: new Date(),
  };
}

/**
 * Format recovery report as a human-readable message for posting to #incidents.
 */
export function formatRecoveryAlert(report: RecoveryReport): string {
  if (report.recoveredAgents.length === 0) return '';

  const lines = [
    `**Crash Recovery Report** (${report.timestamp.toISOString()})`,
    '',
    `Found ${report.recoveredAgents.length} agent(s) in stale working state after restart:`,
    '',
  ];

  for (const agent of report.recoveredAgents) {
    lines.push(`- **${agent.agentId}**: was working on "${agent.previousTask ?? 'unknown'}" (PID: ${agent.previousPid ?? 'none'})`);
  }

  lines.push('', 'These agents have been marked as errored and will resume on their next heartbeat cycle.');

  return lines.join('\n');
}
