import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { Daemon } from '../../src/daemon/daemon.js';
import { AgentStateStore } from '../../src/state/agent-state.js';
import { ChatDb } from '../../src/chat/db.js';
import { ChannelStore } from '../../src/chat/channels.js';
import { MessageStore } from '../../src/chat/messages.js';
import { CursorStore } from '../../src/chat/cursors.js';
import { ChatAdapter } from '../../src/chat/adapter.js';
import { AuditStore } from '../../src/audit/store.js';
import { parseOrgFlat } from '../../src/org/parser.js';
import type { Person } from '../../src/types.js';

function mockMemory() {
  return {
    indexAll: vi.fn(async () => {}),
    search: vi.fn(async () => []),
    indexAgent: vi.fn(async () => ({ indexed: 0, skipped: 0, chunks: 0 })),
    getStore: vi.fn(),
    close: vi.fn(),
  } as any;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** People records matching the sample-org fixture folders (1-ceo, 2-ar, 3-eng-1). */
function fixturePeople(): Person[] {
  return [
    { id: 0, alias: 'super-user', name: 'Super User', status: 'active' },
    { id: 1, alias: 'ceo', name: 'Test CEO', roleTemplate: 'CEO', status: 'active', folder: '1-ceo' },
    { id: 2, alias: 'ar', name: 'AR Agent', roleTemplate: 'Agent Resources Manager', status: 'active', folder: '2-ar', reportsTo: 1 },
    { id: 3, alias: 'eng-1', name: 'Engineer 1', roleTemplate: 'Engineer', status: 'active', folder: '3-eng-1', reportsTo: 1 },
  ];
}

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
  let stateStore: AgentStateStore;
  let chatDb: ChatDb;
  let chatAdapter: ChatAdapter;
  let channelStore: ChannelStore;
  let messageStore: MessageStore;
  let cursorStore: CursorStore;
  let audit: AuditStore;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-daemon-int-'));
    stateStore = new AgentStateStore(path.join(tmpDir, 'state.db'));
    chatDb = new ChatDb(path.join(tmpDir, 'hive.db'));
    // Seed people
    const seedPeople = fixturePeople();
    for (const p of seedPeople) {
      chatDb.raw().prepare(
        "INSERT OR IGNORE INTO people (id, alias, name, role_template, status) VALUES (?, ?, ?, ?, 'active')"
      ).run(p.id, p.alias, p.name, p.roleTemplate ?? null);
    }
    channelStore = new ChannelStore(chatDb);
    messageStore = new MessageStore(chatDb);
    cursorStore = new CursorStore(chatDb);
    chatAdapter = new ChatAdapter(chatDb, channelStore, messageStore, cursorStore);
    audit = new AuditStore(path.join(tmpDir, 'audit.db'));
  });

  afterEach(async () => {
    vi.useRealTimers();
    stateStore.close();
    chatDb.close();
    audit.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('direct channel triggers CEO response when message posted to dm:ceo', async () => {
    const fixtureOrg = path.resolve(__dirname, '../fixtures/sample-org');
    const people = fixturePeople();
    const orgChart = await parseOrgFlat(fixtureOrg, people);

    // Ensure dm:ceo channel exists so we can post to it
    const dmChannel = channelStore.ensureDm(0, 1); // super-user (0) → ceo (1)

    const daemon = new Daemon({
      orgChart,
      chatAdapter,
      audit,
      state: stateStore,
      memory: mockMemory(),
      dataDir: tmpDir,
      orgDir: fixtureOrg,
      pidFilePath: path.join(tmpDir, 'hive.pid'),
      tickIntervalMs: 600_000,
      coalesceMs: 50,
      loadPeople: () => people,
    });

    await daemon.start();

    // Post a message to dm:ceo (super-user → CEO)
    messageStore.send(dmChannel.id, 0, 'What is the status?');
    daemon.signalChannel(dmChannel.id);

    // Advance past coalesce window
    vi.advanceTimersByTime(51);

    // Allow async lane processing to complete
    await vi.advanceTimersByTimeAsync(100);

    // CEO should have been invoked and state should be back to idle
    const ceoState = stateStore.get('ceo');
    expect(ceoState?.status).toBe('idle');

    await daemon.stop();
  });

  it('periodic tick processes inbox without direct channel signal', async () => {
    const fixtureOrg = path.resolve(__dirname, '../fixtures/sample-org');
    const people = fixturePeople();
    const orgChart = await parseOrgFlat(fixtureOrg, people);

    // Ensure dm:ceo channel exists
    const dmChannel = channelStore.ensureDm(0, 1); // super-user (0) → ceo (1)

    const daemon = new Daemon({
      orgChart,
      chatAdapter,
      audit,
      state: stateStore,
      memory: mockMemory(),
      dataDir: tmpDir,
      orgDir: fixtureOrg,
      pidFilePath: path.join(tmpDir, 'hive.pid'),
      tickIntervalMs: 600_000,
      coalesceMs: 50,
      loadPeople: () => people,
    });

    await daemon.start();

    // Post a message but DON'T signal — wait for periodic tick
    messageStore.send(dmChannel.id, 0, 'Periodic check');

    // Advance to trigger the 10-minute tick
    vi.advanceTimersByTime(600_001);

    // Allow async processing
    await vi.advanceTimersByTimeAsync(100);

    const ceoState = stateStore.get('ceo');
    expect(ceoState?.status).toBe('idle');

    await daemon.stop();
  });
});
