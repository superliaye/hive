import type { OrgChart, Person } from '../types.js';
import type { AgentStateStore } from '../state/agent-state.js';
import type { SqliteCommsProvider } from '../comms/sqlite-provider.js';
import type { AuditStore } from '../audit/store.js';
import type { ChannelManager } from '../comms/channel-manager.js';
import type { MemoryManager } from '../memory/manager.js';

/**
 * Unread message from the inbox — owned by daemon, not the deprecated heartbeat module.
 */
export interface UnreadMessage {
  id: string;
  channel: string;
  sender: string;
  content: string;
  timestamp: Date;
  thread?: string;
  metadata?: Record<string, unknown>;
  mentions?: string[];
}

export interface DaemonConfig {
  orgChart: OrgChart;
  comms: SqliteCommsProvider;
  audit: AuditStore;
  state: AgentStateStore;
  channelManager: ChannelManager;
  memory: MemoryManager;
  dataDir: string;
  orgDir: string;
  pidFilePath: string;

  /** Callback to load people from DB (needed for hot reload). */
  loadPeople?: () => Person[];

  /** Default tick interval when idle (ms). Default: 600_000 (10 min) */
  tickIntervalMs?: number;

  /** Direct channel coalesce window (ms). Default: 100 */
  coalesceMs?: number;

  /** Exponential decay schedule for rapid recheck (ms). Default: [30_000, 60_000, 180_000] */
  decayScheduleMs?: number[];
}

export interface CheckWorkResult {
  agentId: string;
  /** Number of unread messages found in inbox */
  inboxCount: number;
  /** Whether the main agent was invoked (LLM call made) */
  agentInvoked: boolean;
  /** Whether to immediately re-check (e.g., after completing work) */
  recheckImmediately: boolean;
  /** If messages found but no work done, use decay for next check */
  decayIndex?: number;
  /** Duration of this check cycle */
  durationMs: number;
  /** Error message if something went wrong */
  error?: string;
}

/**
 * Work item states for PRIORITIES.md.
 * These are conventions enforced by the agent prompt, not parsed programmatically.
 */
export type WorkItemState = 'ACTIVE' | 'READY' | 'BLOCKED' | 'DEFERRED' | 'DONE';
