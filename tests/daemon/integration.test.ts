import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { Daemon } from '../../src/daemon/daemon.js';
import { AgentStateStore } from '../../src/state/agent-state.js';
import { SqliteCommsProvider } from '../../src/comms/sqlite-provider.js';
import { AuditStore } from '../../src/audit/store.js';
import { ChannelManager } from '../../src/comms/channel-manager.js';
import { parseOrgTree } from '../../src/org/parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  let comms: SqliteCommsProvider;
  let audit: AuditStore;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-daemon-int-'));
    stateStore = new AgentStateStore(path.join(tmpDir, 'state.db'));
    comms = new SqliteCommsProvider(path.join(tmpDir, 'comms.db'));
    audit = new AuditStore(path.join(tmpDir, 'audit.db'));
  });

  afterEach(async () => {
    vi.useRealTimers();
    stateStore.close();
    comms.close();
    audit.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('direct channel triggers CEO response when message posted to #board', async () => {
    const fixtureOrg = path.resolve(__dirname, '../fixtures/sample-org');
    const orgChart = await parseOrgTree(fixtureOrg);

    const channelManager = new ChannelManager(comms);
    await channelManager.syncFromOrgTree(orgChart);

    const daemon = new Daemon({
      orgChart,
      comms,
      audit,
      state: stateStore,
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

    // Allow async lane processing to complete
    await vi.advanceTimersByTimeAsync(100);

    // CEO should have been invoked and state should be back to idle
    const ceoState = stateStore.get('ceo');
    expect(ceoState?.status).toBe('idle');

    await daemon.stop();
  });

  it('periodic tick processes inbox without direct channel signal', async () => {
    const fixtureOrg = path.resolve(__dirname, '../fixtures/sample-org');
    const orgChart = await parseOrgTree(fixtureOrg);

    const channelManager = new ChannelManager(comms);
    await channelManager.syncFromOrgTree(orgChart);

    const daemon = new Daemon({
      orgChart,
      comms,
      audit,
      state: stateStore,
      channelManager,
      dataDir: tmpDir,
      orgDir: fixtureOrg,
      pidFilePath: path.join(tmpDir, 'hive.pid'),
      tickIntervalMs: 600_000,
      coalesceMs: 50,
    });

    await daemon.start();

    // Post a message but DON'T signal — wait for periodic tick
    await comms.postMessage('board', 'super-user', 'Periodic check');

    // Advance to trigger the 10-minute tick
    vi.advanceTimersByTime(600_001);

    // Allow async processing
    await vi.advanceTimersByTimeAsync(100);

    const ceoState = stateStore.get('ceo');
    expect(ceoState?.status).toBe('idle');

    await daemon.stop();
  });
});
