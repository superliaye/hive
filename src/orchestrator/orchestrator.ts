/**
 * @deprecated Use {@link import('../daemon/daemon.js').Daemon} instead.
 * The Orchestrator is replaced by the Daemon gateway architecture which provides:
 * - Per-agent work lanes (concurrency=1) instead of raw interval scheduling
 * - Direct channel triggers with coalesced debouncing
 * - Zero LLM cost when inbox is empty
 * - Agent-owned PRIORITIES.md management
 */
import type { AgentConfig, OrgChart } from '../types.js';
import { AgentStateStore } from '../state/agent-state.js';
import { PidFile } from './pid-file.js';
import { recoverStaleAgents, formatRecoveryAlert } from './crash-recovery.js';
import { runHeartbeat, type HeartbeatContext, type HeartbeatResult, type UnreadMessage } from './heartbeat.js';

export interface OrchestratorConfig {
  orgChart: OrgChart;
  stateDbPath: string;
  pidFilePath: string;

  // Agent scheduling
  persistentAgentIds: string[];        // Agent IDs that run on tight heartbeat
  persistentIntervalMs: number;        // e.g., 600_000 (10 min)
  onDemandIntervalMs: number;          // e.g., 7_200_000 (2 hours)

  // Comms callbacks — injected from the CLI layer
  getUnread: (agentId: string) => Promise<UnreadMessage[]>;
  markRead: (agentId: string, messageIds: string[]) => Promise<void>;
  postMessage: (agentId: string, channel: string, content: string, opts?: { thread?: string }) => Promise<void>;

  // File callbacks — injected from the CLI layer
  appendToMemory: (agentId: string, content: string) => Promise<void>;
  appendToPriorities: (agentId: string, content: string) => Promise<void>;
}

/**
 * Crash rate limiter: tracks crash timestamps per agent.
 * If an agent crashes MAX_CRASHES times within WINDOW_MS, it is kept
 * in errored state and heartbeats are skipped until the window expires.
 */
const CRASH_MAX_COUNT = 3;
const CRASH_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

export class Orchestrator {
  private config: OrchestratorConfig;
  private stateStore: AgentStateStore;
  private pidFile: PidFile;
  private running = false;
  private intervals: NodeJS.Timeout[] = [];
  private inFlightHeartbeats: Map<string, Promise<HeartbeatResult>> = new Map();

  /** Crash history: agentId → array of crash timestamps (epoch ms). */
  private crashHistory: Map<string, number[]> = new Map();

  constructor(config: OrchestratorConfig) {
    this.config = config;
    this.stateStore = new AgentStateStore(config.stateDbPath);
    this.pidFile = new PidFile(config.pidFilePath);
  }

  /**
   * Start the orchestrator:
   * 1. Check for duplicate instance
   * 2. Write PID file
   * 3. Register all agents
   * 4. Run crash recovery
   * 5. Schedule heartbeats
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error('Orchestrator is already running');
    }

    // Check if another instance is running
    if (this.pidFile.isRunning()) {
      const existingPid = this.pidFile.read();
      throw new Error(`Another orchestrator is already running (PID: ${existingPid})`);
    }

    // Write PID file
    this.pidFile.write();
    this.running = true;

    // Register all agents in state store
    for (const [id] of this.config.orgChart.agents) {
      this.stateStore.register(id);
    }

    // Run crash recovery
    const report = recoverStaleAgents(this.stateStore);
    if (report.recoveredAgents.length > 0) {
      const alert = formatRecoveryAlert(report);
      if (alert) {
        try {
          await this.config.postMessage('orchestrator', 'incidents', alert);
        } catch {
          // Best-effort alert — don't fail start
        }
      }
    }

    // Schedule heartbeats
    this.scheduleHeartbeats();
  }

  /**
   * Stop the orchestrator:
   * 1. Clear all intervals
   * 2. Wait for in-flight heartbeats to complete
   * 3. Remove PID file
   * 4. Close state store
   */
  async stop(): Promise<void> {
    this.running = false;

    // Clear all scheduled intervals
    for (const interval of this.intervals) {
      clearInterval(interval);
    }
    this.intervals = [];

    // Wait for in-flight heartbeats
    if (this.inFlightHeartbeats.size > 0) {
      await Promise.allSettled(this.inFlightHeartbeats.values());
      this.inFlightHeartbeats.clear();
    }

    // Cleanup
    this.pidFile.remove();
    this.stateStore.close();
  }

  /**
   * Trigger an immediate heartbeat for a specific agent.
   * Used for on-demand agents when a relevant message arrives.
   */
  async triggerAgent(agentId: string): Promise<HeartbeatResult | null> {
    const agent = this.config.orgChart.agents.get(agentId);
    if (!agent) return null;
    return this.executeHeartbeat(agent);
  }

  /**
   * Check if the orchestrator is currently running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get the state store (for testing / CLI status commands).
   */
  getStateStore(): AgentStateStore {
    return this.stateStore;
  }

  /**
   * Schedule heartbeats for all agents based on their type (persistent vs on-demand).
   */
  private scheduleHeartbeats(): void {
    const { orgChart, persistentAgentIds, persistentIntervalMs, onDemandIntervalMs } = this.config;

    for (const [id, agent] of orgChart.agents) {
      const isPersistent = persistentAgentIds.includes(id);
      const intervalMs = isPersistent ? persistentIntervalMs : onDemandIntervalMs;

      const interval = setInterval(() => {
        if (!this.running) return;
        this.executeHeartbeat(agent);
      }, intervalMs);

      this.intervals.push(interval);
    }
  }

  /**
   * Record a crash for an agent and check if it has exceeded the rate limit.
   * Returns true if the agent is now rate-limited (should stay errored).
   */
  private recordCrash(agentId: string): boolean {
    const now = Date.now();
    const crashes = this.crashHistory.get(agentId) ?? [];
    crashes.push(now);

    // Prune crashes outside the window
    const recent = crashes.filter(t => now - t < CRASH_WINDOW_MS);
    this.crashHistory.set(agentId, recent);

    return recent.length >= CRASH_MAX_COUNT;
  }

  /**
   * Check whether an agent is currently crash-rate-limited.
   * Returns true if the agent has crashed CRASH_MAX_COUNT+ times within CRASH_WINDOW_MS.
   */
  private isCrashRateLimited(agentId: string): boolean {
    const now = Date.now();
    const crashes = this.crashHistory.get(agentId) ?? [];
    const recent = crashes.filter(t => now - t < CRASH_WINDOW_MS);
    return recent.length >= CRASH_MAX_COUNT;
  }

  /**
   * Execute a single heartbeat for an agent.
   * Tracks the in-flight promise so `stop()` can wait for it.
   * Checks crash history before scheduling — if the agent has crashed 3+ times
   * in 10 minutes, it stays in errored state and the heartbeat is skipped.
   */
  private async executeHeartbeat(agent: AgentConfig): Promise<HeartbeatResult> {
    // If there's already an in-flight heartbeat for this agent, skip
    if (this.inFlightHeartbeats.has(agent.id)) {
      return {
        agentId: agent.id,
        messagesProcessed: 0,
        actNowCount: 0,
        queueCount: 0,
        noteCount: 0,
        ignoreCount: 0,
        workPerformed: false,
        durationMs: 0,
        skipped: true,
        skipReason: `Heartbeat already in-flight for ${agent.id}`,
      };
    }

    // Crash rate limiting: skip if agent has crashed too many times recently
    if (this.isCrashRateLimited(agent.id)) {
      this.stateStore.updateStatus(agent.id, 'errored', {
        currentTask: `Rate-limited: ${CRASH_MAX_COUNT}+ crashes in ${CRASH_WINDOW_MS / 60_000} min`,
      });
      return {
        agentId: agent.id,
        messagesProcessed: 0,
        actNowCount: 0,
        queueCount: 0,
        noteCount: 0,
        ignoreCount: 0,
        workPerformed: false,
        durationMs: 0,
        skipped: true,
        skipReason: `Agent ${agent.id} is crash-rate-limited (${CRASH_MAX_COUNT}+ crashes in ${CRASH_WINDOW_MS / 60_000} min)`,
      };
    }

    const ctx: HeartbeatContext = {
      agent,
      stateStore: this.stateStore,
      orgAgents: this.config.orgChart.agents,
      getUnread: this.config.getUnread,
      markRead: this.config.markRead,
      postMessage: (agentId, channel, content, opts) =>
        this.config.postMessage(agentId, channel, content, opts),
      appendToMemory: this.config.appendToMemory,
      appendToPriorities: this.config.appendToPriorities,
    };

    const heartbeatPromise = runHeartbeat(ctx);
    this.inFlightHeartbeats.set(agent.id, heartbeatPromise);

    try {
      const result = await heartbeatPromise;
      // Track crashes: if the heartbeat returned an error, record it
      if (result.error) {
        const rateLimited = this.recordCrash(agent.id);
        if (rateLimited) {
          this.stateStore.updateStatus(agent.id, 'errored', {
            currentTask: `Rate-limited after ${CRASH_MAX_COUNT} crashes: ${result.error}`,
          });
        }
      }
      return result;
    } finally {
      this.inFlightHeartbeats.delete(agent.id);
    }
  }
}
