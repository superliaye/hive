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
 * 1. Mark each as 'errored' in the state store
 * 2. Return a recovery report for the orchestrator to alert CEO
 *
 * The next heartbeat cycle will re-invoke errored agents normally.
 */
export function recoverStaleAgents(stateStore: AgentStateStore): RecoveryReport {
  const stale = detectStaleAgents(stateStore);
  const recoveredAgents: RecoveredAgent[] = [];

  for (const agent of stale) {
    stateStore.updateStatus(agent.agentId, 'errored', {
      currentTask: `RECOVERED: ${agent.currentTask ?? 'unknown task'}`,
    });

    recoveredAgents.push({
      agentId: agent.agentId,
      previousTask: agent.currentTask,
      previousPid: agent.pid,
    });
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
