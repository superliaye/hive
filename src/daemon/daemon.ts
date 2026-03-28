import type { DaemonConfig, CheckWorkResult } from './types.js';
import type { AgentConfig } from '../types.js';
import { LaneManager } from './lane.js';
import { checkWork, type CheckWorkContext } from './check-work.js';
import { PidFile } from '../orchestrator/pid-file.js';
import { recoverStaleAgents, formatRecoveryAlert } from '../orchestrator/crash-recovery.js';
import { parseOrgFlat } from '../org/parser.js';
import { detectNewAgents } from './hot-reload.js';
import { FollowUpStore } from './followup-store.js';
import { FollowUpScheduler } from './followup-scheduler.js';

const CRASH_MAX_COUNT = 3;
const CRASH_WINDOW_MS = 10 * 60 * 1000;

export class Daemon {
  private config: DaemonConfig;
  private pidFile: PidFile;
  private lanes = new LaneManager();
  private coalesceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private running = false;
  private tickTimers: Map<string, ReturnType<typeof setInterval>> = new Map();
  private crashHistory = new Map<string, number[]>();
  /** Per-agent decay index for exponential backoff when messages found but no work needed */
  private decayIndex = new Map<string, number>();
  private followUpStore: FollowUpStore | undefined;
  private followUpScheduler: FollowUpScheduler | undefined;

  constructor(config: DaemonConfig) {
    this.config = config;
    this.pidFile = new PidFile(config.pidFilePath);
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
          this.config.chatAdapter.postMessage('orchestrator', 'incidents', alert);
        } catch { /* best effort */ }
      }
    }

    // Initialize follow-up tracker
    const pathMod = await import('path');
    this.followUpStore = new FollowUpStore(pathMod.join(this.config.dataDir, 'orchestrator.db'));
    this.followUpScheduler = new FollowUpScheduler({
      store: this.followUpStore,
      lanes: this.lanes,
      stateStore: this.config.state,
      audit: this.config.audit,
      getAgent: (agentId) => this.config.orgChart.agents.get(agentId),
    });
    this.followUpScheduler.start();

    // Index agent memories in background (non-blocking)
    this.config.memory.indexAll(this.config.orgChart.agents, msg => console.log(`[daemon] ${msg}`))
      .then(() => console.log('[daemon] memory indexing complete'))
      .catch(err => console.error('[daemon] memory indexing error:', err));

    // Schedule periodic ticks per agent, staggered to avoid thundering herd
    const tickMs = this.config.tickIntervalMs ?? 600_000;
    const agentIds = [...this.config.orgChart.agents.keys()];
    const staggerMs = Math.floor(tickMs / Math.max(agentIds.length, 1));
    for (let i = 0; i < agentIds.length; i++) {
      const id = agentIds[i];
      setTimeout(() => {
        if (!this.running) return;
        this.enqueueCheckWork(id);
        const timer = setInterval(() => {
          if (!this.running) return;
          this.enqueueCheckWork(id);
        }, tickMs);
        this.tickTimers.set(id, timer);
      }, staggerMs * i);
    }
  }

  async stop(): Promise<void> {
    this.running = false;

    // Stop follow-up scheduler
    this.followUpScheduler?.stop();
    this.followUpStore?.dispose();

    // Clear all timers
    for (const timer of this.tickTimers.values()) {
      clearInterval(timer);
    }
    this.tickTimers.clear();

    // Clear pending coalesce timers
    for (const timer of this.coalesceTimers.values()) clearTimeout(timer);
    this.coalesceTimers.clear();

    // Drain all lanes (wait for in-flight work)
    await this.lanes.drainAll();

    // Cleanup — only remove PID file. Stores are owned by the caller
    // and will be closed by the caller when it shuts down.
    this.pidFile.remove();
  }

  /**
   * Signal that a message arrived on a conversation.
   * Looks up conversation members and triggers coalesced CheckWork for each.
   */
  signalConversation(conversationId: string): void {
    let memberAliases: string[];
    try {
      memberAliases = this.config.chatAdapter.getConversationMembers(conversationId);
    } catch (err) {
      console.debug(`[daemon] signalConversation: could not resolve members for ${conversationId}`);
      return;
    }

    const coalesceMs = this.config.coalesceMs ?? 100;
    for (const alias of memberAliases) {
      if (!this.config.orgChart.agents.has(alias)) continue;

      const existing = this.coalesceTimers.get(alias);
      if (existing) clearTimeout(existing);
      this.coalesceTimers.set(alias, setTimeout(() => {
        this.coalesceTimers.delete(alias);
        this.enqueueCheckWork(alias);
      }, coalesceMs));
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Re-scan org/ directory and register any new agents.
   * Called periodically or after AR creates a new agent.
   */
  async hotReload(): Promise<{ added: string[]; removed: string[] }> {
    if (!this.running) return { added: [], removed: [] };

    const people = this.config.loadPeople?.() ?? [];
    const updatedOrg = await parseOrgFlat(this.config.orgDir, people);
    const { added, removed } = detectNewAgents(
      this.config.orgChart.agents,
      updatedOrg.agents,
    );

    if (added.length === 0 && removed.length === 0) {
      return { added, removed };
    }

    // Refresh people cache if agents changed
    if (added.length > 0 || removed.length > 0) {
      this.config.chatAdapter.refreshPeopleCache();
    }

    // Register new agents
    for (const id of added) {
      const agent = updatedOrg.agents.get(id)!;
      this.config.orgChart.agents.set(id, agent);
      this.config.state.register(id);

      const tickMs = this.config.tickIntervalMs ?? 600_000;
      const timer = setInterval(() => {
        if (!this.running) return;
        this.enqueueCheckWork(id);
      }, tickMs);
      this.tickTimers.set(id, timer);

      console.log(`[daemon] hot-reload: registered new agent ${id}`);
    }

    // Deregister removed agents
    for (const id of removed) {
      this.config.orgChart.agents.delete(id);
      const timer = this.tickTimers.get(id);
      if (timer) {
        clearInterval(timer);
        this.tickTimers.delete(id);
      }
      console.log(`[daemon] hot-reload: deregistered agent ${id}`);
    }

    return { added, removed };
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
      audit: this.config.audit,
      orgAgents: this.config.orgChart.agents,
      getUnread: async (agentId) => {
        return this.config.chatAdapter.getUnread(agentId);
      },
      markRead: async (agentId, messageIds) => {
        this.config.chatAdapter.markRead(agentId, messageIds);
      },
      postMessage: async (agentId, conversationId, content) => {
        this.config.chatAdapter.postMessage(agentId, conversationId, content);
      },
      memorySearch: async (agentId, query, limit) => {
        return this.config.memory.search(agentId, query, limit);
      },
      memoryReindex: async (agentId, agentDir) => {
        await this.config.memory.indexAgent(agentId, agentDir);
      },
      followUpStore: this.followUpStore,
      followUpScheduler: this.followUpScheduler,
    };

    const result = await checkWork(ctx);

    if (result.error) {
      const rateLimited = this.recordCrash(agent.person.alias);
      if (rateLimited) {
        this.config.state.updateStatus(agent.person.alias, 'errored', {
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
