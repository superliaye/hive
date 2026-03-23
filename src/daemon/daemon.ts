import type { DaemonConfig, CheckWorkResult } from './types.js';
import type { AgentConfig } from '../types.js';
import { LaneManager } from './lane.js';
import { DirectChannelRegistry, parseBureauDirectChannels } from './direct-channel.js';
import { checkWork, type CheckWorkContext } from './check-work.js';
import { PidFile } from '../orchestrator/pid-file.js';
import { recoverStaleAgents, formatRecoveryAlert } from '../orchestrator/crash-recovery.js';

const CRASH_MAX_COUNT = 3;
const CRASH_WINDOW_MS = 10 * 60 * 1000;

export class Daemon {
  private config: DaemonConfig;
  private pidFile: PidFile;
  private lanes = new LaneManager();
  private directChannels: DirectChannelRegistry;
  private running = false;
  private tickTimers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private crashHistory = new Map<string, number[]>();
  /** Per-agent decay index for exponential backoff when messages found but no work needed */
  private decayIndex = new Map<string, number>();

  constructor(config: DaemonConfig) {
    this.config = config;
    this.pidFile = new PidFile(config.pidFilePath);

    this.directChannels = new DirectChannelRegistry(
      (agentId) => this.enqueueCheckWork(agentId),
      config.coalesceMs ?? 100,
    );
  }

  async start(): Promise<void> {
    if (this.running) throw new Error('Daemon is already running');

    if (this.pidFile.isRunning()) {
      const pid = this.pidFile.read();
      throw new Error(`Another daemon is already running (PID: ${pid})`);
    }

    this.pidFile.write();
    this.running = true;

    // Register agents in state store
    for (const [id] of this.config.orgChart.agents) {
      this.config.state.register(id);
    }

    // Run crash recovery
    const report = recoverStaleAgents(this.config.state);
    if (report.recoveredAgents.length > 0) {
      const alert = formatRecoveryAlert(report);
      if (alert) {
        try {
          await this.config.comms.postMessage('incidents', 'orchestrator', alert);
        } catch { /* best effort */ }
      }
    }

    // Register direct channels from BUREAU.md
    for (const [id, agent] of this.config.orgChart.agents) {
      const directDefs = parseBureauDirectChannels(agent.files.bureau);
      if (directDefs.length > 0) {
        this.directChannels.register(id, directDefs.map(d => d.channel));
      }
    }

    // Schedule periodic ticks per agent
    const tickMs = this.config.tickIntervalMs ?? 600_000;
    for (const [id] of this.config.orgChart.agents) {
      const timer = setInterval(() => {
        if (!this.running) return;
        this.enqueueCheckWork(id);
      }, tickMs);
      this.tickTimers.set(id, timer);
    }
  }

  async stop(): Promise<void> {
    this.running = false;

    // Clear all timers
    for (const timer of this.tickTimers.values()) {
      clearInterval(timer);
    }
    this.tickTimers.clear();

    // Clear pending direct channel triggers
    this.directChannels.clearAll();

    // Drain all lanes (wait for in-flight work)
    await this.lanes.drainAll();

    // Cleanup — only remove PID file. Stores are owned by the caller
    // and will be closed by the caller when it shuts down.
    this.pidFile.remove();
  }

  /**
   * Signal that a message arrived on a channel.
   * If it's a direct channel for any agent, triggers coalesced CheckWork.
   */
  signalChannel(channel: string): void {
    this.directChannels.signal(channel);
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Enqueue a CheckWork cycle for an agent in its lane.
   * The lane ensures only one CheckWork runs per agent at a time.
   */
  private enqueueCheckWork(agentId: string): void {
    if (!this.running) return;

    const agent = this.config.orgChart.agents.get(agentId);
    if (!agent) return;

    // Skip if crash-rate-limited
    if (this.isCrashRateLimited(agentId)) {
      this.config.state.updateStatus(agentId, 'errored', {
        currentTask: `Rate-limited: ${CRASH_MAX_COUNT}+ crashes in ${CRASH_WINDOW_MS / 60_000} min`,
      });
      return;
    }

    const lane = this.lanes.get(agentId);
    lane.enqueue(async () => {
      const result = await this.runCheckWork(agent);

      // If work was performed, reset decay and immediately re-check
      if (result.recheckImmediately && this.running) {
        this.decayIndex.delete(agentId);
        const recheck = await this.runCheckWork(agent);
        // Don't chain further — one recheck is enough per cycle
        return recheck;
      }

      // If messages found but no work done, schedule recheck with exponential decay
      if (result.inboxCount > 0 && !result.agentInvoked && this.running) {
        const schedule = this.config.decayScheduleMs ?? [30_000, 60_000, 180_000];
        const idx = this.decayIndex.get(agentId) ?? 0;
        const delayMs = schedule[Math.min(idx, schedule.length - 1)];
        this.decayIndex.set(agentId, idx + 1);
        setTimeout(() => this.enqueueCheckWork(agentId), delayMs);
      } else if (result.inboxCount === 0) {
        // Empty inbox — reset decay
        this.decayIndex.delete(agentId);
      }

      return result;
    }).catch(err => {
      console.error(`[daemon] CheckWork error for ${agentId}:`, err);
    });
  }

  private async runCheckWork(agent: AgentConfig): Promise<CheckWorkResult> {
    const ctx: CheckWorkContext = {
      agent,
      stateStore: this.config.state,
      orgAgents: this.config.orgChart.agents,
      getUnread: async (agentId) => {
        const messages = await this.config.comms.getUnread(agentId);
        return messages.map(m => ({
          id: m.id,
          channel: m.channel,
          sender: m.sender,
          content: m.content,
          timestamp: m.timestamp,
          thread: m.thread,
          metadata: m.metadata as Record<string, unknown> | undefined,
          mentions: m.mentions,
        }));
      },
      markRead: (agentId, ids) => this.config.comms.markRead(agentId, ids),
      postMessage: async (agentId, channel, content, opts) => {
        await this.config.comms.postMessage(channel, agentId, content, opts);
      },
    };

    const result = await checkWork(ctx);

    if (result.error) {
      const rateLimited = this.recordCrash(agent.id);
      if (rateLimited) {
        this.config.state.updateStatus(agent.id, 'errored', {
          currentTask: `Rate-limited after ${CRASH_MAX_COUNT} crashes: ${result.error}`,
        });
      }
    }

    return result;
  }

  private recordCrash(agentId: string): boolean {
    const now = Date.now();
    const crashes = this.crashHistory.get(agentId) ?? [];
    crashes.push(now);
    const recent = crashes.filter(t => now - t < CRASH_WINDOW_MS);
    this.crashHistory.set(agentId, recent);
    return recent.length >= CRASH_MAX_COUNT;
  }

  private isCrashRateLimited(agentId: string): boolean {
    const now = Date.now();
    const crashes = this.crashHistory.get(agentId) ?? [];
    return crashes.filter(t => now - t < CRASH_WINDOW_MS).length >= CRASH_MAX_COUNT;
  }
}
