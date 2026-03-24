# Agent Daemon Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current orchestrator with a daemon gateway architecture where a single process manages per-agent work lanes, processes an inbox FIFO, and supports direct channels for urgent triggers — ensuring agents own their PRIORITIES.md through deliberate internalization rather than raw message dumping.

**Architecture:** Single Node.js process with an async event loop. Each agent gets a "lane" (concurrency=1 queue) that serializes its work. Lanes run concurrently via async child process spawning. A `CheckWork` routine is the sole entry point for agent invocations — triggered either by a periodic timer (10min default) or by a direct channel signal (coalesced within 100ms). When CheckWork fires: read inbox → if empty, return (zero LLM cost) → if messages found, score deterministically → spawn main agent invocation → agent responds, may update its own PRIORITIES.md → immediately re-check. Dashboard chat posts to #board and lets the daemon handle it via the direct channel path.

**Tech Stack:** TypeScript, Node.js async/await, SQLite (better-sqlite3), Claude CLI child processes, Vitest

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `src/daemon/daemon.ts` | Main daemon class — lifecycle, agent lane registration, timer scheduling, direct channel listener, graceful shutdown |
| `src/daemon/lane.ts` | Per-agent work lane — FIFO async queue with concurrency=1, enqueue/drain/clear |
| `src/daemon/check-work.ts` | The CheckWork routine — inbox read → score → spawn agent → re-check loop |
| `src/daemon/direct-channel.ts` | Direct channel registry + coalesced trigger (100ms debounce window) |
| `src/daemon/types.ts` | Daemon-specific types: DaemonConfig, CheckWorkResult, LaneState, DirectChannelConfig |
| `tests/daemon/lane.test.ts` | Lane unit tests |
| `tests/daemon/check-work.test.ts` | CheckWork unit tests |
| `tests/daemon/direct-channel.test.ts` | Direct channel coalescing tests |
| `tests/daemon/daemon.test.ts` | Daemon integration tests |

### Modified Files
| File | Changes |
|------|---------|
| `src/orchestrator/orchestrator.ts` | Deprecate — replaced by `src/daemon/daemon.ts` |
| `src/orchestrator/heartbeat.ts` | Deprecate — replaced by `src/daemon/check-work.ts` |
| `src/cli.ts` | `hive start` creates Daemon instead of Orchestrator; `hive chat` posts to #board only (no direct Claude spawn) |
| `src/comms/cli-commands.ts` | Remove `chatAction`'s direct Claude spawning; keep as message-post-only |
| `src/state/agent-state.ts` | No schema changes — decay tracking is in-memory in the Daemon |
| `src/types.ts` | Add `DirectChannelDef` to `OrgChart`; add `WorkItemState` type |
| `src/context.ts` | Expose daemon-friendly factory that returns context + direct channel config parsed from BUREAU.md |
| `packages/dashboard/src/server/routes/chat.ts` | Remove direct Claude spawn; POST /api/chat just posts to #board, daemon handles the rest |
| `packages/dashboard/src/server/sse.ts` | Remove `emitCeoWorking` special-case; SSE polls agent-state which now reflects working/idle accurately |
| `org/ceo/BUREAU.md` | Add `## Direct Channels` section |
| `org/ceo/PRIORITIES.md` | Restructure with Active/Ready/Blocked/Done sections |

### Kept As-Is
| File | Reason |
|------|--------|
| `src/gateway/scorer.ts` | Deterministic scoring still used in CheckWork |
| `src/gateway/triage.ts` | LLM triage still used — but now only called when inbox has messages |
| `src/agents/spawner.ts` | Claude CLI spawning unchanged |
| `src/agents/prompt-assembler.ts` | Prompt assembly unchanged |
| `src/orchestrator/pid-file.ts` | PID file reused by daemon (already has liveness check) |
| `src/orchestrator/crash-recovery.ts` | Crash recovery reused by daemon |

---

## Task 1: Work Lane Queue

The foundation — a generic async FIFO queue with configurable concurrency per lane. This is the building block that ensures one agent never gets invoked twice concurrently while allowing cross-agent parallelism.

**Files:**
- Create: `src/daemon/lane.ts`
- Test: `tests/daemon/lane.test.ts`

- [ ] **Step 1: Write failing tests for Lane**

```typescript
// tests/daemon/lane.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Lane, LaneManager } from '../../src/daemon/lane.js';

describe('Lane', () => {
  it('executes tasks in FIFO order', async () => {
    const lane = new Lane('test', 1);
    const order: number[] = [];

    await Promise.all([
      lane.enqueue(async () => { order.push(1); }),
      lane.enqueue(async () => { order.push(2); }),
      lane.enqueue(async () => { order.push(3); }),
    ]);

    expect(order).toEqual([1, 2, 3]);
  });

  it('respects concurrency=1 — tasks do not overlap', async () => {
    const lane = new Lane('test', 1);
    let running = 0;
    let maxRunning = 0;

    const task = () => lane.enqueue(async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise(r => setTimeout(r, 10));
      running--;
    });

    await Promise.all([task(), task(), task()]);
    expect(maxRunning).toBe(1);
  });

  it('reports queue size accurately', async () => {
    const lane = new Lane('test', 1);
    let resolve1!: () => void;
    const blocker = new Promise<void>(r => { resolve1 = r; });

    // Enqueue a blocking task
    const p1 = lane.enqueue(() => blocker);
    // Enqueue two more — they should be queued
    const p2 = lane.enqueue(async () => {});
    const p3 = lane.enqueue(async () => {});

    expect(lane.pending).toBe(2);
    expect(lane.active).toBe(1);

    resolve1();
    await Promise.all([p1, p2, p3]);

    expect(lane.pending).toBe(0);
    expect(lane.active).toBe(0);
  });

  it('propagates task errors without blocking the lane', async () => {
    const lane = new Lane('test', 1);

    const p1 = lane.enqueue(async () => { throw new Error('boom'); });
    const p2 = lane.enqueue(async () => 'ok');

    await expect(p1).rejects.toThrow('boom');
    expect(await p2).toBe('ok');
  });

  it('drain() resolves when all tasks complete', async () => {
    const lane = new Lane('test', 1);
    const results: number[] = [];

    lane.enqueue(async () => {
      await new Promise(r => setTimeout(r, 10));
      results.push(1);
    });
    lane.enqueue(async () => { results.push(2); });

    await lane.drain();
    expect(results).toEqual([1, 2]);
  });
});

describe('LaneManager', () => {
  it('creates lanes lazily and retrieves by id', () => {
    const mgr = new LaneManager();
    const lane = mgr.get('agent-1');
    expect(lane).toBeInstanceOf(Lane);
    expect(mgr.get('agent-1')).toBe(lane); // same instance
  });

  it('drainAll waits for all lanes', async () => {
    const mgr = new LaneManager();
    const results: string[] = [];

    mgr.get('a').enqueue(async () => {
      await new Promise(r => setTimeout(r, 10));
      results.push('a');
    });
    mgr.get('b').enqueue(async () => { results.push('b'); });

    await mgr.drainAll();
    expect(results).toContain('a');
    expect(results).toContain('b');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/superliaye/projects/hive && npx vitest run tests/daemon/lane.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement Lane and LaneManager**

```typescript
// src/daemon/lane.ts

/**
 * A FIFO async queue with configurable concurrency.
 * Each agent gets one lane with concurrency=1, ensuring
 * no overlapping invocations per agent while allowing
 * cross-agent parallelism.
 */
export class Lane {
  readonly id: string;
  private readonly maxConcurrent: number;
  private _active = 0;
  private queue: Array<{ task: () => Promise<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void }> = [];

  constructor(id: string, maxConcurrent = 1) {
    this.id = id;
    this.maxConcurrent = maxConcurrent;
  }

  get active(): number { return this._active; }
  get pending(): number { return this.queue.length; }

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ task: task as () => Promise<unknown>, resolve: resolve as (v: unknown) => void, reject });
      this.flush();
    });
  }

  async drain(): Promise<void> {
    while (this._active > 0 || this.queue.length > 0) {
      await new Promise(r => setTimeout(r, 5));
    }
  }

  private flush(): void {
    while (this._active < this.maxConcurrent && this.queue.length > 0) {
      const item = this.queue.shift()!;
      this._active++;
      item.task()
        .then(item.resolve)
        .catch(item.reject)
        .finally(() => {
          this._active--;
          this.flush();
        });
    }
  }
}

/**
 * Manages a set of named lanes.
 * Lazily creates lanes on first access.
 */
export class LaneManager {
  private lanes = new Map<string, Lane>();

  get(id: string, maxConcurrent = 1): Lane {
    let lane = this.lanes.get(id);
    if (!lane) {
      lane = new Lane(id, maxConcurrent);
      this.lanes.set(id, lane);
    }
    return lane;
  }

  async drainAll(): Promise<void> {
    await Promise.all([...this.lanes.values()].map(l => l.drain()));
  }

  allLanes(): Lane[] {
    return [...this.lanes.values()];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/superliaye/projects/hive && npx vitest run tests/daemon/lane.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/daemon/lane.ts tests/daemon/lane.test.ts
git commit -m "feat(daemon): add Lane and LaneManager for per-agent work queues"
```

---

## Task 2: Direct Channel Registry with Coalesced Triggers

Parse `## Direct Channels` from BUREAU.md. When a message arrives on a direct channel, coalesce triggers within a 100ms window to prevent thundering herd, then signal the daemon to enqueue CheckWork for the target agent.

**Files:**
- Create: `src/daemon/direct-channel.ts`
- Test: `tests/daemon/direct-channel.test.ts`
- Modify: `org/ceo/BUREAU.md` (add Direct Channels section)

- [ ] **Step 1: Update CEO BUREAU.md with direct channel config**

Add to the end of `org/ceo/BUREAU.md`:

```markdown
## Direct Channels
- #board — immediate (from super-user)
```

- [ ] **Step 2: Write failing tests for DirectChannelRegistry**

```typescript
// tests/daemon/direct-channel.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DirectChannelRegistry, parseBureauDirectChannels } from '../../src/daemon/direct-channel.js';

describe('parseBureauDirectChannels', () => {
  it('parses direct channels from BUREAU.md content', () => {
    const bureau = `# Bureau
## Position
Reports to: Super User

## Direct Channels
- #board — immediate (from super-user)
- #leadership — immediate (from reports)
`;
    const channels = parseBureauDirectChannels(bureau);
    expect(channels).toEqual([
      { channel: 'board', label: 'immediate (from super-user)' },
      { channel: 'leadership', label: 'immediate (from reports)' },
    ]);
  });

  it('returns empty array when no Direct Channels section', () => {
    const bureau = `# Bureau\n## Position\nReports to: Nobody`;
    expect(parseBureauDirectChannels(bureau)).toEqual([]);
  });
});

describe('DirectChannelRegistry', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('triggers callback for agent when message arrives on direct channel', async () => {
    const onTrigger = vi.fn();
    const registry = new DirectChannelRegistry(onTrigger, 100);
    registry.register('ceo', ['board', 'leadership']);

    registry.signal('board');

    // Should not fire immediately (coalescing window)
    expect(onTrigger).not.toHaveBeenCalled();

    // Advance past the 100ms window
    vi.advanceTimersByTime(101);

    expect(onTrigger).toHaveBeenCalledTimes(1);
    expect(onTrigger).toHaveBeenCalledWith('ceo');
  });

  it('coalesces multiple signals within the window', async () => {
    const onTrigger = vi.fn();
    const registry = new DirectChannelRegistry(onTrigger, 100);
    registry.register('ceo', ['board']);

    registry.signal('board');
    registry.signal('board');
    registry.signal('board');

    vi.advanceTimersByTime(101);

    // Should fire only once despite 3 signals
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it('triggers multiple agents if they share a channel', async () => {
    const onTrigger = vi.fn();
    const registry = new DirectChannelRegistry(onTrigger, 100);
    registry.register('ceo', ['leadership']);
    registry.register('platform-eng', ['leadership']);

    registry.signal('leadership');
    vi.advanceTimersByTime(101);

    expect(onTrigger).toHaveBeenCalledTimes(2);
    const agentIds = onTrigger.mock.calls.map((c: unknown[]) => c[0]);
    expect(agentIds).toContain('ceo');
    expect(agentIds).toContain('platform-eng');
  });

  it('ignores signals for non-direct channels', () => {
    const onTrigger = vi.fn();
    const registry = new DirectChannelRegistry(onTrigger, 100);
    registry.register('ceo', ['board']);

    registry.signal('all-hands');
    vi.advanceTimersByTime(200);

    expect(onTrigger).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /Users/superliaye/projects/hive && npx vitest run tests/daemon/direct-channel.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement DirectChannelRegistry**

```typescript
// src/daemon/direct-channel.ts

export interface DirectChannelDef {
  channel: string;
  label: string;
}

/**
 * Parse ## Direct Channels section from BUREAU.md content.
 * Format: `- #channel-name — description`
 */
export function parseBureauDirectChannels(bureau: string): DirectChannelDef[] {
  const sectionMatch = bureau.match(/## Direct Channels\n([\s\S]*?)(?=\n## |\n$|$)/);
  if (!sectionMatch) return [];

  const lines = sectionMatch[1].trim().split('\n');
  const results: DirectChannelDef[] = [];

  for (const line of lines) {
    const match = line.match(/^- #(\S+)\s*[—–-]\s*(.+)$/);
    if (match) {
      results.push({ channel: match[1], label: match[2].trim() });
    }
  }

  return results;
}

/**
 * Registry that maps channels → agents and coalesces rapid signals
 * within a debounce window before triggering CheckWork.
 *
 * When a message arrives on a direct channel, call signal(channelName).
 * After the coalesce window (default 100ms), onTrigger(agentId) is called
 * once per affected agent, regardless of how many signals arrived.
 */
export class DirectChannelRegistry {
  /** channel → set of agentIds that have this as a direct channel */
  private channelToAgents = new Map<string, Set<string>>();
  /** agentId → pending coalesce timer */
  private pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private onTrigger: (agentId: string) => void,
    private coalesceMs = 100,
  ) {}

  register(agentId: string, channels: string[]): void {
    for (const ch of channels) {
      let agents = this.channelToAgents.get(ch);
      if (!agents) {
        agents = new Set();
        this.channelToAgents.set(ch, agents);
      }
      agents.add(agentId);
    }
  }

  signal(channel: string): void {
    const agents = this.channelToAgents.get(channel);
    if (!agents) return;

    for (const agentId of agents) {
      // If there's already a pending timer for this agent, skip (coalescing)
      if (this.pendingTimers.has(agentId)) continue;

      const timer = setTimeout(() => {
        this.pendingTimers.delete(agentId);
        this.onTrigger(agentId);
      }, this.coalesceMs);

      this.pendingTimers.set(agentId, timer);
    }
  }

  clearAll(): void {
    for (const timer of this.pendingTimers.values()) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/superliaye/projects/hive && npx vitest run tests/daemon/direct-channel.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/daemon/direct-channel.ts tests/daemon/direct-channel.test.ts org/ceo/BUREAU.md
git commit -m "feat(daemon): add DirectChannelRegistry with coalesced triggers"
```

---

## Task 3: Daemon Types

Define all daemon-specific types in one place before implementing CheckWork and Daemon.

**Files:**
- Create: `src/daemon/types.ts`

- [ ] **Step 1: Write daemon types**

```typescript
// src/daemon/types.ts
import type { AgentConfig, OrgChart } from '../types.js';
import type { AgentStateStore } from '../state/agent-state.js';
import type { SqliteCommsProvider } from '../comms/sqlite-provider.js';
import type { AuditStore } from '../audit/store.js';
import type { ChannelManager } from '../comms/channel-manager.js';
import type { DirectChannelDef } from './direct-channel.js';

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
  dataDir: string;
  orgDir: string;
  pidFilePath: string;

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
```

- [ ] **Step 2: Commit**

```bash
git add src/daemon/types.ts
git commit -m "feat(daemon): add daemon type definitions"
```

---

## Task 4: CheckWork Routine

The core work-checking algorithm. This replaces the 6-stage heartbeat pipeline with a cleaner flow: read inbox → if empty return → score → invoke agent → re-check.

**Key changes from current heartbeat:**
1. Empty inbox = zero LLM calls (no triage, no scoring)
2. No `appendToPriorities` callback — agent handles its own PRIORITIES.md via Write tool during main invocation
3. No QUEUE classification dumping — triage only decides ACT_NOW vs skip
4. Re-checks immediately after work completes (catch messages that arrived during work)
5. Returns decay index for exponential backoff when messages found but no work needed

**Files:**
- Create: `src/daemon/check-work.ts`
- Test: `tests/daemon/check-work.test.ts`

- [ ] **Step 1: Write failing tests for CheckWork**

```typescript
// tests/daemon/check-work.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import type { AgentConfig } from '../../src/types.js';
import type { TriageResult } from '../../src/gateway/types.js';
import { AgentStateStore } from '../../src/state/agent-state.js';

// Mock spawner and triage — never invoke real Claude CLI
vi.mock('../../src/agents/spawner.js', () => ({
  spawnClaude: vi.fn(),
  buildClaudeArgs: vi.fn(() => ['--mock']),
  buildTriageArgs: vi.fn(() => ['--mock-triage']),
}));

vi.mock('../../src/gateway/triage.js', () => ({
  triageMessages: vi.fn(),
  buildTriagePrompt: vi.fn(() => 'mock triage prompt'),
}));

vi.mock('../../src/gateway/scorer.js', () => ({
  rankMessages: vi.fn(() => []),
  scoreMessage: vi.fn(() => 5),
  getHierarchyScore: vi.fn(() => 5),
  getChannelWeight: vi.fn(() => 5),
  computeRecencyDecay: vi.fn(() => 5),
}));

import { checkWork, type CheckWorkContext } from '../../src/daemon/check-work.js';
import { spawnClaude } from '../../src/agents/spawner.js';
import { triageMessages } from '../../src/gateway/triage.js';
import { rankMessages } from '../../src/gateway/scorer.js';

const mockSpawnClaude = vi.mocked(spawnClaude);
const mockTriageMessages = vi.mocked(triageMessages);
const mockRankMessages = vi.mocked(rankMessages);

function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'ceo',
    identity: { name: 'CEO', role: 'CEO', model: 'sonnet', tools: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'] },
    dir: '/tmp/org/ceo',
    depth: 0,
    parentId: null,
    childIds: ['eng-1'],
    files: {
      identity: '---\nname: CEO\nrole: CEO\nmodel: sonnet\n---\n# Identity',
      soul: '# Soul',
      bureau: '# Bureau',
      priorities: '# Priorities\n## Ready\n1. Ship Plan 4',
      routine: '# Routine',
      memory: '',
    },
    ...overrides,
  };
}

describe('checkWork', () => {
  let tmpDir: string;
  let stateStore: AgentStateStore;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-checkwork-'));
    stateStore = new AgentStateStore(path.join(tmpDir, 'state.db'));
  });

  afterEach(() => {
    stateStore.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeCtx(overrides: Partial<CheckWorkContext> = {}): CheckWorkContext {
    return {
      agent: makeAgent(),
      stateStore,
      getUnread: vi.fn(async () => []),
      markRead: vi.fn(async () => {}),
      postMessage: vi.fn(async () => {}),
      orgAgents: new Map(),
      ...overrides,
    };
  }

  it('returns immediately with zero LLM calls when inbox is empty', async () => {
    const ctx = makeCtx();
    stateStore.register('ceo');

    const result = await checkWork(ctx);

    expect(result.inboxCount).toBe(0);
    expect(result.agentInvoked).toBe(false);
    expect(result.recheckImmediately).toBe(false);
    expect(mockSpawnClaude).not.toHaveBeenCalled();
    expect(mockTriageMessages).not.toHaveBeenCalled();
  });

  it('invokes agent when inbox has ACT_NOW messages', async () => {
    const unread = [
      { id: 'msg-1', channel: 'board', sender: 'super-user', content: 'What is the status?', timestamp: new Date() },
    ];

    mockRankMessages.mockReturnValue([
      { messageId: 'msg-1', channel: 'board', sender: 'super-user', content: 'What is the status?', timestamp: new Date(), score: 9.0 },
    ]);
    mockTriageMessages.mockResolvedValue([
      { messageId: 'msg-1', classification: 'ACT_NOW', reasoning: 'Super user request', score: 9.0 },
    ]);
    mockSpawnClaude.mockResolvedValue({
      stdout: 'Status: all good.',
      stderr: '',
      exitCode: 0,
      durationMs: 3000,
    });

    const ctx = makeCtx({
      getUnread: vi.fn(async () => unread),
    });
    stateStore.register('ceo');

    const result = await checkWork(ctx);

    expect(result.inboxCount).toBe(1);
    expect(result.agentInvoked).toBe(true);
    expect(result.recheckImmediately).toBe(true);
    expect(mockSpawnClaude).toHaveBeenCalledOnce();
  });

  it('does NOT invoke agent when all messages are NOTE/IGNORE', async () => {
    const unread = [
      { id: 'msg-1', channel: 'all-hands', sender: 'random', content: 'Lunch at noon', timestamp: new Date() },
    ];

    mockRankMessages.mockReturnValue([
      { messageId: 'msg-1', channel: 'all-hands', sender: 'random', content: 'Lunch at noon', timestamp: new Date(), score: 2.0 },
    ]);
    mockTriageMessages.mockResolvedValue([
      { messageId: 'msg-1', classification: 'IGNORE', reasoning: 'Irrelevant', score: 2.0 },
    ]);

    const mockMarkRead = vi.fn(async () => {});
    const ctx = makeCtx({
      getUnread: vi.fn(async () => unread),
      markRead: mockMarkRead,
    });
    stateStore.register('ceo');

    const result = await checkWork(ctx);

    expect(result.agentInvoked).toBe(false);
    // Triage was called (messages existed), but no main agent spawn
    expect(mockTriageMessages).toHaveBeenCalledOnce();
    expect(mockSpawnClaude).not.toHaveBeenCalled();
    // IGNORE messages should be marked as read
    expect(mockMarkRead).toHaveBeenCalledWith('ceo', ['msg-1']);
  });

  it('skips if agent state is already working', async () => {
    const ctx = makeCtx();
    stateStore.register('ceo');
    stateStore.updateStatus('ceo', 'working', { pid: process.pid });

    const result = await checkWork(ctx);

    expect(result.error).toContain('already working');
    expect(result.agentInvoked).toBe(false);
  });

  it('sets agent state to working during invocation and back to idle after', async () => {
    const unread = [
      { id: 'msg-1', channel: 'board', sender: 'super-user', content: 'Do it', timestamp: new Date() },
    ];

    mockRankMessages.mockReturnValue([
      { messageId: 'msg-1', channel: 'board', sender: 'super-user', content: 'Do it', timestamp: new Date(), score: 9.0 },
    ]);
    mockTriageMessages.mockResolvedValue([
      { messageId: 'msg-1', classification: 'ACT_NOW', reasoning: 'Urgent', score: 9.0 },
    ]);

    let statusDuringWork: string | undefined;
    mockSpawnClaude.mockImplementation(async () => {
      statusDuringWork = stateStore.get('ceo')?.status;
      return { stdout: 'Done.', stderr: '', exitCode: 0, durationMs: 1000 };
    });

    const ctx = makeCtx({ getUnread: vi.fn(async () => unread) });
    stateStore.register('ceo');

    await checkWork(ctx);

    expect(statusDuringWork).toBe('working');
    expect(stateStore.get('ceo')?.status).toBe('idle');
  });

  it('returns to idle state even when Claude CLI crashes', async () => {
    const unread = [
      { id: 'msg-1', channel: 'board', sender: 'super-user', content: 'urgent', timestamp: new Date() },
    ];

    mockRankMessages.mockReturnValue([
      { messageId: 'msg-1', channel: 'board', sender: 'super-user', content: 'urgent', timestamp: new Date(), score: 9.0 },
    ]);
    mockTriageMessages.mockResolvedValue([
      { messageId: 'msg-1', classification: 'ACT_NOW', reasoning: 'urgent', score: 9.0 },
    ]);
    mockSpawnClaude.mockRejectedValue(new Error('segfault'));

    const ctx = makeCtx({ getUnread: vi.fn(async () => unread) });
    stateStore.register('ceo');

    const result = await checkWork(ctx);

    expect(result.error).toContain('segfault');
    expect(stateStore.get('ceo')?.status).toBe('idle');
  });

  it('handles NOTE messages by appending to memory', async () => {
    const unread = [
      { id: 'msg-1', channel: 'all-hands', sender: 'ceo', content: 'Q2 goals announced', timestamp: new Date() },
    ];

    mockRankMessages.mockReturnValue([
      { messageId: 'msg-1', channel: 'all-hands', sender: 'ceo', content: 'Q2 goals announced', timestamp: new Date(), score: 4.0 },
    ]);
    mockTriageMessages.mockResolvedValue([
      { messageId: 'msg-1', classification: 'NOTE', reasoning: 'Informational', score: 4.0 },
    ]);

    const mockMarkRead = vi.fn(async () => {});
    const ctx = makeCtx({
      getUnread: vi.fn(async () => unread),
      markRead: mockMarkRead,
      // NOTE: no appendToMemory callback — CheckWork handles memory internally
    });
    stateStore.register('ceo');

    const result = await checkWork(ctx);

    expect(result.agentInvoked).toBe(false);
    expect(mockMarkRead).toHaveBeenCalledWith('ceo', ['msg-1']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/superliaye/projects/hive && npx vitest run tests/daemon/check-work.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement checkWork**

```typescript
// src/daemon/check-work.ts
import type { AgentConfig } from '../types.js';
import type { ScoredMessage, TriageResult } from '../gateway/types.js';
import { DEFAULT_SCORING_WEIGHTS } from '../gateway/types.js';
import { rankMessages } from '../gateway/scorer.js';
import { triageMessages } from '../gateway/triage.js';
import { spawnClaude, buildClaudeArgs } from '../agents/spawner.js';
import { assemblePrompt } from '../agents/prompt-assembler.js';
import type { AgentStateStore } from '../state/agent-state.js';
import type { CheckWorkResult, UnreadMessage } from './types.js';
import fs from 'fs';
import path from 'path';

export interface CheckWorkContext {
  agent: AgentConfig;
  stateStore: AgentStateStore;
  orgAgents: Map<string, AgentConfig>;

  getUnread: (agentId: string) => Promise<UnreadMessage[]>;
  markRead: (agentId: string, messageIds: string[]) => Promise<void>;
  postMessage: (agentId: string, channel: string, content: string, opts?: { thread?: string }) => Promise<void>;
}

function toScorerInput(msg: UnreadMessage): Omit<ScoredMessage, 'score'> {
  return {
    messageId: msg.id,
    channel: msg.channel,
    sender: msg.sender,
    content: msg.content,
    timestamp: msg.timestamp,
    thread: msg.thread,
    metadata: msg.metadata,
    mentions: msg.mentions,
  };
}

function buildWorkInput(messages: ScoredMessage[], triageResults: TriageResult[]): string {
  const actNow = triageResults.filter(r => r.classification === 'ACT_NOW');
  const actNowMessages = messages.filter(m =>
    actNow.some(r => r.messageId === m.messageId)
  );

  const sections = actNowMessages.map(m => {
    const result = actNow.find(r => r.messageId === m.messageId);
    return [
      `## Message from @${m.sender} in #${m.channel}`,
      `> ${m.content}`,
      '',
      `Triage: ${result?.reasoning ?? 'Needs immediate attention'}`,
    ].join('\n');
  });

  return [
    '# Messages Requiring Action',
    '',
    ...sections,
    '',
    '---',
    '',
    'Review the above messages and take appropriate action.',
    'You may update your PRIORITIES.md if these messages change your work priorities.',
    'Post your response in the relevant channel(s).',
  ].join('\n');
}

/**
 * Append a note to the agent's memory file (memory/YYYY-MM-DD.md).
 */
function appendToMemoryFile(agentDir: string, entry: string): void {
  const memoryDir = path.join(agentDir, 'memory');
  if (!fs.existsSync(memoryDir)) {
    fs.mkdirSync(memoryDir, { recursive: true });
  }
  const today = new Date().toISOString().slice(0, 10);
  const memoryFile = path.join(memoryDir, `${today}.md`);
  const existing = fs.existsSync(memoryFile) ? fs.readFileSync(memoryFile, 'utf-8') : '';
  fs.writeFileSync(memoryFile, existing + entry + '\n');
}

/**
 * CheckWork: the sole entry point for agent invocations.
 *
 * Flow:
 * 1. Guard: skip if agent is already working
 * 2. Read inbox (unread messages)
 * 3. If empty → return (ZERO LLM calls)
 * 4. Score deterministically
 * 5. Triage via LLM (haiku) → classify ACT_NOW / NOTE / IGNORE
 *    - No QUEUE classification — agent decides its own priorities during main invocation
 * 6. Process NOTE → append to memory file, mark read
 * 7. Process IGNORE → mark read
 * 8. If any ACT_NOW → set state=working → spawn main agent → post results → set state=idle
 * 9. Mark ACT_NOW as read
 * 10. Return recheckImmediately=true if work was performed (catch new messages)
 */
export async function checkWork(ctx: CheckWorkContext): Promise<CheckWorkResult> {
  const start = Date.now();
  const { agent, stateStore } = ctx;

  // Guard: skip if already working
  const currentState = stateStore.get(agent.id);
  if (currentState?.status === 'working') {
    return {
      agentId: agent.id,
      inboxCount: 0,
      agentInvoked: false,
      recheckImmediately: false,
      durationMs: Date.now() - start,
      error: `Agent ${agent.id} is already working (PID: ${currentState.pid})`,
    };
  }

  // Mark heartbeat
  stateStore.markHeartbeat(agent.id);

  try {
    // Read inbox
    const unread = await ctx.getUnread(agent.id);

    if (unread.length === 0) {
      return {
        agentId: agent.id,
        inboxCount: 0,
        agentInvoked: false,
        recheckImmediately: false,
        durationMs: Date.now() - start,
      };
    }

    // Score deterministically
    const scorerInputs = unread.map(toScorerInput);
    const ranked = rankMessages(scorerInputs, agent, DEFAULT_SCORING_WEIGHTS, ctx.orgAgents);

    // Triage via LLM
    const triageResults = await triageMessages(ranked, {
      agentId: agent.id,
      agentDir: agent.dir,
      priorities: agent.files.priorities,
      bureau: agent.files.bureau,
    });

    const actNow = triageResults.filter(r => r.classification === 'ACT_NOW');
    const notes = triageResults.filter(r => r.classification === 'NOTE');
    const ignore = triageResults.filter(r => r.classification === 'IGNORE');
    // QUEUE is treated same as NOTE in new architecture — agent internalizes during main invocation
    const queue = triageResults.filter(r => r.classification === 'QUEUE');

    // Process IGNORE — mark read
    if (ignore.length > 0) {
      await ctx.markRead(agent.id, ignore.map(r => r.messageId));
    }

    // Process NOTE + QUEUE — append to memory, mark read
    const noteAndQueue = [...notes, ...queue];
    for (const result of noteAndQueue) {
      const msg = ranked.find(m => m.messageId === result.messageId);
      if (msg) {
        const entry = `- [${msg.timestamp.toISOString()}] @${msg.sender} in #${msg.channel}: ${msg.content.slice(0, 200)}`;
        appendToMemoryFile(agent.dir, entry);
      }
    }
    if (noteAndQueue.length > 0) {
      await ctx.markRead(agent.id, noteAndQueue.map(r => r.messageId));
    }

    // Process ACT_NOW — invoke main agent
    let agentInvoked = false;
    if (actNow.length > 0) {
      stateStore.updateStatus(agent.id, 'working', {
        pid: process.pid,
        currentTask: `Processing ${actNow.length} message(s)`,
      });

      try {
        const systemPrompt = assemblePrompt(agent);
        const workInput = buildWorkInput(ranked, triageResults);
        const args = buildClaudeArgs({
          model: agent.identity.model,
          systemPrompt,
          tools: agent.identity.tools,
        });

        const workResult = await spawnClaude(args, {
          cwd: agent.dir,
          input: workInput,
          timeoutMs: 300_000,
        });

        // Post results to channels that had ACT_NOW messages
        if (workResult.exitCode === 0 && workResult.stdout.trim()) {
          const actNowMessages = ranked.filter(m =>
            actNow.some(r => r.messageId === m.messageId)
          );
          const byChannel = new Map<string, ScoredMessage[]>();
          for (const msg of actNowMessages) {
            const existing = byChannel.get(msg.channel) ?? [];
            existing.push(msg);
            byChannel.set(msg.channel, existing);
          }
          for (const [channel, msgs] of byChannel) {
            const thread = msgs[0].thread;
            await ctx.postMessage(agent.id, channel, workResult.stdout.trim(), thread ? { thread } : undefined);
          }
        }

        agentInvoked = true;
      } catch (err) {
        stateStore.updateStatus(agent.id, 'idle');
        return {
          agentId: agent.id,
          inboxCount: unread.length,
          agentInvoked: false,
          recheckImmediately: false,
          durationMs: Date.now() - start,
          error: err instanceof Error ? err.message : String(err),
        };
      }

      await ctx.markRead(agent.id, actNow.map(r => r.messageId));
    }

    // Return to idle
    stateStore.updateStatus(agent.id, 'idle');

    return {
      agentId: agent.id,
      inboxCount: unread.length,
      agentInvoked,
      recheckImmediately: agentInvoked, // Re-check immediately after work
      durationMs: Date.now() - start,
    };
  } catch (err) {
    stateStore.updateStatus(agent.id, 'idle');
    return {
      agentId: agent.id,
      inboxCount: 0,
      agentInvoked: false,
      recheckImmediately: false,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/superliaye/projects/hive && npx vitest run tests/daemon/check-work.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/daemon/check-work.ts tests/daemon/check-work.test.ts
git commit -m "feat(daemon): add CheckWork routine — inbox-first agent invocation"
```

---

## Task 5: Daemon Class

The main daemon — replaces `Orchestrator`. Single process, per-agent lanes, timer scheduling, direct channel integration, graceful shutdown with draining.

**Files:**
- Create: `src/daemon/daemon.ts`
- Test: `tests/daemon/daemon.test.ts`

- [ ] **Step 1: Write failing tests for Daemon**

```typescript
// tests/daemon/daemon.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import type { AgentConfig, OrgChart } from '../../src/types.js';
import { AgentStateStore } from '../../src/state/agent-state.js';
import { SqliteCommsProvider } from '../../src/comms/sqlite-provider.js';
import { AuditStore } from '../../src/audit/store.js';
import { ChannelManager } from '../../src/comms/channel-manager.js';
import { PidFile } from '../../src/orchestrator/pid-file.js';

// Mock check-work to avoid spawning Claude CLI
vi.mock('../../src/daemon/check-work.js', () => ({
  checkWork: vi.fn(async () => ({
    agentId: 'ceo',
    inboxCount: 0,
    agentInvoked: false,
    recheckImmediately: false,
    durationMs: 10,
  })),
}));

import { Daemon } from '../../src/daemon/daemon.js';
import { checkWork } from '../../src/daemon/check-work.js';

const mockCheckWork = vi.mocked(checkWork);

function makeOrgChart(): OrgChart {
  const ceoConfig: AgentConfig = {
    id: 'ceo',
    identity: { name: 'CEO', role: 'CEO', model: 'sonnet', tools: ['Read'] },
    dir: '/tmp/org/ceo',
    depth: 0,
    parentId: null,
    childIds: [],
    files: { identity: '', soul: '', bureau: '## Direct Channels\n- #board — immediate', priorities: '', routine: '', memory: '' },
  };

  return {
    root: ceoConfig,
    agents: new Map([['ceo', ceoConfig]]),
    channels: [{ name: 'board', autoGenerated: false, memberIds: ['ceo'] }, { name: 'all-hands', autoGenerated: true, memberIds: ['ceo'] }],
  };
}

describe('Daemon', () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-daemon-'));
  });

  afterEach(async () => {
    vi.useRealTimers();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createDaemon() {
    const orgChart = makeOrgChart();
    const stateStore = new AgentStateStore(path.join(tmpDir, 'state.db'));
    const comms = new SqliteCommsProvider(path.join(tmpDir, 'comms.db'));
    const audit = new AuditStore(path.join(tmpDir, 'audit.db'));
    const channelManager = new ChannelManager(comms);

    return new Daemon({
      orgChart,
      comms,
      audit,
      state: stateStore,
      channelManager,
      dataDir: tmpDir,
      orgDir: path.join(tmpDir, 'org'),
      pidFilePath: path.join(tmpDir, 'hive.pid'),
      tickIntervalMs: 600_000,
      coalesceMs: 100,
    });
  }

  it('starts, registers agents, and writes PID file', async () => {
    const daemon = createDaemon();
    await daemon.start();

    // PID file should exist
    const pidFile = new PidFile(path.join(tmpDir, 'hive.pid'));
    expect(pidFile.isRunning()).toBe(true);

    await daemon.stop();
  });

  it('prevents duplicate instances', async () => {
    const d1 = createDaemon();
    await d1.start();

    const d2 = createDaemon();
    await expect(d2.start()).rejects.toThrow(/already running/);

    await d1.stop();
  });

  it('schedules periodic ticks that call checkWork', async () => {
    const daemon = createDaemon();
    await daemon.start();

    // Advance past one tick interval
    vi.advanceTimersByTime(600_001);

    // checkWork should have been called at least once
    expect(mockCheckWork).toHaveBeenCalled();

    await daemon.stop();
  });

  it('triggers immediate checkWork on direct channel signal', async () => {
    const daemon = createDaemon();
    await daemon.start();

    // Simulate a message arriving on #board (direct channel for CEO)
    daemon.signalChannel('board');

    // Advance past coalesce window
    vi.advanceTimersByTime(101);

    expect(mockCheckWork).toHaveBeenCalled();

    await daemon.stop();
  });

  it('stops gracefully — drains lanes and removes PID', async () => {
    const daemon = createDaemon();
    await daemon.start();

    await daemon.stop();

    const pidFile = new PidFile(path.join(tmpDir, 'hive.pid'));
    expect(pidFile.isRunning()).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/superliaye/projects/hive && npx vitest run tests/daemon/daemon.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement Daemon**

```typescript
// src/daemon/daemon.ts
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

    // Cleanup — only remove PID file. Stores are owned by the caller (HiveContext)
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/superliaye/projects/hive && npx vitest run tests/daemon/daemon.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/daemon/daemon.ts tests/daemon/daemon.test.ts
git commit -m "feat(daemon): add Daemon class — single-process agent orchestration with lanes"
```

---

## Task 6: Wire CLI to Daemon

Replace `hive start` to use Daemon instead of Orchestrator. Change `hive chat` to post-only (no direct Claude spawn). The daemon handles the response via direct channel.

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/comms/cli-commands.ts`
- Modify: `src/context.ts`
- Test: `tests/cli/commands.test.ts` (update existing)

- [ ] **Step 1: Read current cli.ts to understand `hive start` wiring**

Read `src/cli.ts` — specifically the `start` and `chat` commands.

- [ ] **Step 2: Modify `hive start` to use Daemon**

In `src/cli.ts`, replace the `start` command action. The key change: create a `Daemon` instance instead of `Orchestrator`, and hook up the comms listener to call `daemon.signalChannel()` on every new message.

```typescript
// In the 'start' command action:
import { Daemon } from './daemon/daemon.js';

// Replace Orchestrator creation with:
const daemon = new Daemon({
  orgChart,
  comms: commsProvider,
  audit: auditStore,
  state: new AgentStateStore(path.join(dataDir, 'orchestrator.db')),
  channelManager,
  dataDir,
  orgDir,
  pidFilePath: path.join(dataDir, 'hive.pid'),
  tickIntervalMs: 600_000, // 10 min
});

await daemon.start();

// Hook: signal daemon on every new message for direct channel detection
const originalPostMessage = commsProvider.postMessage.bind(commsProvider);
commsProvider.postMessage = async (channel, sender, content, opts) => {
  const msg = await originalPostMessage(channel, sender, content, opts);
  daemon.signalChannel(channel);
  return msg;
};

// Signal handlers
process.on('SIGINT', async () => { await daemon.stop(); process.exit(0); });
process.on('SIGTERM', async () => { await daemon.stop(); process.exit(0); });
```

- [ ] **Step 3: Modify `hive chat` to post-only**

In `src/comms/cli-commands.ts`, change `chatAction` to only post the message to #board. Remove the Claude CLI spawn. The daemon's direct channel trigger will handle the CEO response.

```typescript
// src/comms/cli-commands.ts — simplified chatAction
export interface ChatActionOpts {
  message: string;
  gateway: MessageGateway;
}

export interface ChatActionResult {
  userMessage: Message;
}

export async function chatAction(opts: ChatActionOpts): Promise<ChatActionResult> {
  const { message, gateway } = opts;

  // Post the super user's message to #board
  const userMessage = await gateway.postMessage('board', 'super-user', message);

  // No direct Claude spawn — the daemon detects #board as a direct channel
  // for the CEO and triggers CheckWork, which invokes the CEO to respond.
  return { userMessage };
}
```

Also update the CLI `chat` command to print a follow-up hint:

```typescript
// In src/cli.ts chat command action, after chatAction returns:
console.log(chalk.green(`Message posted to #board.`));
console.log(chalk.dim(`CEO will respond via daemon. Run: hive observe board -f`));
```

- [ ] **Step 4: Update existing CLI tests**

In `tests/cli/commands.test.ts`, update the chat test to verify post-only behavior (no Claude spawn expectation).

- [ ] **Step 5: Run all CLI tests**

Run: `cd /Users/superliaye/projects/hive && npx vitest run tests/cli/`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts src/comms/cli-commands.ts src/context.ts tests/cli/
git commit -m "feat(daemon): wire hive start to Daemon, make hive chat post-only"
```

---

## Task 7: Dashboard Chat Through Daemon

Remove the direct Claude CLI spawn from the dashboard chat route. Instead, POST /api/chat posts the message to #board, and the server signals the daemon via a shared reference. The frontend already handles SSE-pushed message updates.

**Files:**
- Modify: `packages/dashboard/src/server/routes/chat.ts`
- Modify: `packages/dashboard/src/server/index.ts`
- Modify: `packages/dashboard/src/server/sse.ts`

- [ ] **Step 1: Simplify chat route to post-only**

```typescript
// packages/dashboard/src/server/routes/chat.ts
import { Router } from 'express';
import type { HiveContext } from '../../../../../src/context.js';

export function createChatRoutes(ctx: HiveContext): Router {
  const router = Router();

  // POST /api/chat — post message to #board
  // The daemon detects this as a direct channel signal and triggers CEO CheckWork.
  router.post('/', async (req, res) => {
    const { message } = req.body;
    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    // Check if CEO is already working — inform the user
    const ceoId = ctx.orgChart.root.id;
    const ceoState = ctx.state.get(ceoId);
    const ceoBusy = ceoState?.status === 'working';

    await ctx.comms.postMessage('board', 'super-user', message);

    // Response will arrive via SSE when the daemon processes it
    res.json({
      posted: true,
      ceoBusy,
      message: ceoBusy
        ? 'Message posted. CEO is currently working — will respond when available.'
        : 'Message posted to #board. CEO will respond shortly.',
    });
  });

  return router;
}
```

- [ ] **Step 2: Remove emitCeoWorking from SSEManager**

In `packages/dashboard/src/server/sse.ts`, remove the `emitCeoWorking()` method — agent state changes are now reflected through the normal `agent-state` SSE events because the daemon properly sets `working`/`idle` state.

- [ ] **Step 3: Update router to pass simplified arguments**

In `packages/dashboard/src/server/router.ts`, update the chat route creation to remove the SSE dependency.

- [ ] **Step 4: Run dashboard route tests**

Run: `cd /Users/superliaye/projects/hive && npx vitest run packages/dashboard/src/server/__tests__/routes.test.ts`
Expected: PASS (update test expectations for new response shape)

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/server/routes/chat.ts packages/dashboard/src/server/sse.ts packages/dashboard/src/server/router.ts packages/dashboard/src/server/index.ts packages/dashboard/src/server/__tests__/
git commit -m "feat(dashboard): route chat through daemon, remove direct Claude spawn"
```

---

## Task 8: Update PRIORITIES.md Format and Agent Prompts

Restructure PRIORITIES.md to use the new Active/Ready/Blocked/Done format. Update agent prompts so they know how to manage their own priorities correctly.

**Files:**
- Modify: `org/ceo/PRIORITIES.md`
- Modify: `org/ceo/engineering/platform-eng/PRIORITIES.md`
- Modify: `org/ceo/engineering/qa-eng/PRIORITIES.md`
- Modify: `org/ceo/ROUTINE.md` (remove "Check #board" — daemon handles this)
- Modify: `tests/fixtures/sample-org/ceo/PRIORITIES.md`

- [ ] **Step 1: Restructure CEO PRIORITIES.md**

```markdown
# Priorities

## Active
(none — daemon will set the first Ready item as Active when agent starts working)

## Ready
1. Ship Plan 4: Agent templates, `hive init` bootstrapping, proposal system
2. Validate platform end-to-end: run `hive start`, verify heartbeats fire

## Blocked
(none)

## Deferred
1. Write Canopy integration — external comms provider (blocked on API access)
2. Implement `hive audit` CLI command — audit store exists, no CLI wiring

## Done
- Plans 1–3 complete (2026-03-22)
```

- [ ] **Step 2: Update platform-eng and qa-eng PRIORITIES.md similarly**

Use the same Active/Ready/Blocked/Deferred/Done structure.

- [ ] **Step 3: Update CEO ROUTINE.md**

Remove the "Check #board for super user messages" instruction — the daemon handles this. Replace with:

```markdown
# Routine

## On Invocation
- Process the messages provided by the daemon
- Update PRIORITIES.md if messages change your work priorities
- Respond in the relevant channel
- If delegating work, post to the appropriate team channel

## Priority Management
- Mark items as [ACTIVE] when you start working on them (only one at a time)
- Move completed items to ## Done with date
- Mark items as [BLOCKED @agent reason] when waiting on someone
- Mark items as [DEFERRED reason] when deprioritized with justification

## Schedule
- Active hours: 09:00-18:00 org timezone
```

- [ ] **Step 4: Update test fixtures**

Update `tests/fixtures/sample-org/ceo/PRIORITIES.md` with the new Active/Ready/Blocked/Done format.

Update `tests/fixtures/sample-org/ceo/BUREAU.md` — add Direct Channels section:

```markdown
## Direct Channels
- #board — immediate (from super-user)
```

- [ ] **Step 5: Commit**

```bash
git add org/ tests/fixtures/
git commit -m "feat: restructure PRIORITIES.md format and update agent routines for daemon"
```

---

## Task 9: Integration Test — Full Daemon Cycle

End-to-end test: start daemon → post message to #board → verify CEO invoked via direct channel → verify response posted.

**Files:**
- Create: `tests/daemon/integration.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
// tests/daemon/integration.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { Daemon } from '../../src/daemon/daemon.js';
import { AgentStateStore } from '../../src/state/agent-state.js';
import { SqliteCommsProvider } from '../../src/comms/sqlite-provider.js';
import { AuditStore } from '../../src/audit/store.js';
import { ChannelManager } from '../../src/comms/channel-manager.js';
import { parseOrgTree } from '../../src/org/parser.js';

// Mock Claude CLI — we don't want real LLM calls in tests
vi.mock('../../src/agents/spawner.js', () => ({
  spawnClaude: vi.fn(async () => ({
    stdout: 'Understood, working on it.',
    stderr: '',
    exitCode: 0,
    durationMs: 1000,
  })),
  buildClaudeArgs: vi.fn(() => ['--mock']),
  buildTriageArgs: vi.fn(() => ['--mock-triage']),
}));

vi.mock('../../src/gateway/triage.js', () => ({
  triageMessages: vi.fn(async (messages: any[]) =>
    messages.map((m: any) => ({
      messageId: m.messageId,
      classification: 'ACT_NOW',
      reasoning: 'Test: all messages ACT_NOW',
      score: m.score,
    }))
  ),
  buildTriagePrompt: vi.fn(() => 'mock'),
}));

describe('Daemon Integration', () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-daemon-int-'));
  });

  afterEach(async () => {
    vi.useRealTimers();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('direct channel triggers CEO response when message posted to #board', async () => {
    const fixtureOrg = path.resolve(__dirname, '../fixtures/sample-org');
    const orgChart = await parseOrgTree(fixtureOrg);

    const comms = new SqliteCommsProvider(path.join(tmpDir, 'comms.db'));
    const audit = new AuditStore(path.join(tmpDir, 'audit.db'));
    const state = new AgentStateStore(path.join(tmpDir, 'state.db'));
    const channelManager = new ChannelManager(comms);
    await channelManager.syncFromOrgTree(orgChart);

    const daemon = new Daemon({
      orgChart,
      comms,
      audit,
      state,
      channelManager,
      dataDir: tmpDir,
      orgDir: fixtureOrg,
      pidFilePath: path.join(tmpDir, 'hive.pid'),
      tickIntervalMs: 600_000,
      coalesceMs: 50,
    });

    await daemon.start();

    // Post a message to #board (super-user → CEO)
    await comms.postMessage('board', 'super-user', 'What is the status?');
    daemon.signalChannel('board');

    // Advance past coalesce window
    vi.advanceTimersByTime(51);

    // Allow async lane processing
    await vi.advanceTimersByTimeAsync(100);

    // CEO should have been invoked and state should be back to idle
    const ceoState = state.get('ceo');
    expect(ceoState?.status).toBe('idle');

    await daemon.stop();
  });
});
```

- [ ] **Step 2: Run integration test**

Run: `cd /Users/superliaye/projects/hive && npx vitest run tests/daemon/integration.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/daemon/integration.test.ts
git commit -m "test(daemon): add integration test for direct channel → CEO invocation"
```

---

## Task 10: Deprecate Old Orchestrator, Run Full Suite

Mark old orchestrator as deprecated. Ensure all existing tests still pass. Remove the `appendToPriorities` callback from HeartbeatContext (it's no longer used — agents manage their own PRIORITIES.md via Write tool).

**Files:**
- Modify: `src/orchestrator/orchestrator.ts` (add deprecation comment)
- Modify: `src/orchestrator/heartbeat.ts` (add deprecation comment)
- Create: `src/daemon/index.ts` (barrel export)

- [ ] **Step 1: Add barrel export**

```typescript
// src/daemon/index.ts
export { Daemon } from './daemon.js';
export { Lane, LaneManager } from './lane.js';
export { DirectChannelRegistry, parseBureauDirectChannels } from './direct-channel.js';
export { checkWork, type CheckWorkContext } from './check-work.js';
export type { DaemonConfig, CheckWorkResult, UnreadMessage } from './types.js';
```

- [ ] **Step 2: Add deprecation notice to old orchestrator**

Add `@deprecated Use Daemon from src/daemon/daemon.ts instead.` JSDoc to Orchestrator class and runHeartbeat function.

- [ ] **Step 3: Run full test suite**

Run: `cd /Users/superliaye/projects/hive && npx vitest run`
Expected: All tests PASS (existing orchestrator tests still pass since we didn't delete the old code)

- [ ] **Step 4: Commit**

```bash
git add src/daemon/index.ts src/orchestrator/orchestrator.ts src/orchestrator/heartbeat.ts
git commit -m "feat(daemon): add barrel exports, deprecate old orchestrator"
```

- [ ] **Step 5: Run the full test suite one final time**

Run: `cd /Users/superliaye/projects/hive && npx vitest run`
Expected: ALL PASS
