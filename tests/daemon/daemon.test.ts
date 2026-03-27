import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import type { AgentConfig, OrgChart } from '../../src/types.js';
import { AgentStateStore } from '../../src/state/agent-state.js';
import { ChatDb } from '../../src/chat/db.js';
import { ConversationStore } from '../../src/chat/conversations.js';
import { MessageStore } from '../../src/chat/messages.js';
import { CursorStore } from '../../src/chat/cursors.js';
import { ChatAdapter } from '../../src/chat/adapter.js';
import { AuditStore } from '../../src/audit/store.js';
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
  const ceoPerson = { id: 1, alias: 'ceo', name: 'CEO', status: 'active' as const };
  const ceoConfig: AgentConfig = {
    person: ceoPerson,
    identity: { id: 1, alias: 'ceo', name: 'CEO', role: 'CEO', model: 'sonnet' },
    dir: '/tmp/org/ceo',
    reportsTo: null,
    directReports: [],
    files: { identity: '', soul: '', bureau: '', priorities: '', routine: '', memory: '', protocols: '', skills: '' },
  };

  return {
    agents: new Map([['ceo', ceoConfig]]),
    people: [ceoPerson],
  };
}

describe('Daemon', () => {
  let tmpDir: string;
  let stateStore: AgentStateStore;
  let chatDb: ChatDb;
  let chatAdapter: ChatAdapter;
  let audit: AuditStore;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-daemon-'));
    stateStore = new AgentStateStore(path.join(tmpDir, 'state.db'));
    chatDb = new ChatDb(path.join(tmpDir, 'hive.db'));
    // Seed ceo (super-user already seeded by ChatDb)
    chatDb.raw().prepare("INSERT OR IGNORE INTO people (id, alias, name, status) VALUES (?, ?, ?, 'active')").run(1, 'ceo', 'CEO');
    const conversationStore = new ConversationStore(chatDb);
    const messageStore = new MessageStore(chatDb);
    const cursorStore = new CursorStore(chatDb);
    chatAdapter = new ChatAdapter(chatDb, conversationStore, messageStore, cursorStore);
    audit = new AuditStore(path.join(tmpDir, 'audit.db'));
  });

  afterEach(async () => {
    vi.useRealTimers();
    stateStore.close();
    chatDb.close();
    audit.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createDaemon() {
    const orgChart = makeOrgChart();

    // Mock memory manager
    const memory = {
      indexAll: vi.fn(async () => {}),
      search: vi.fn(async () => []),
      indexAgent: vi.fn(async () => ({ indexed: 0, skipped: 0, chunks: 0 })),
      getStore: vi.fn(),
      close: vi.fn(),
    } as any;

    return new Daemon({
      orgChart,
      chatAdapter,
      audit,
      state: stateStore,
      memory,
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

  it('triggers immediate checkWork on direct conversation signal', async () => {
    // Create a DM conversation between super-user(0) and ceo(1)
    const conversationStore = new ConversationStore(chatDb);
    const dmConversation = conversationStore.ensureDm(0, 1);

    const daemon = createDaemon();
    await daemon.start();

    // Simulate a message arriving on the DM conversation
    daemon.signalConversation(dmConversation.id);

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
