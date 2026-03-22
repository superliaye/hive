import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import type { AgentConfig } from '../../src/types.js';
import type { TriageResult } from '../../src/gateway/types.js';
import { AgentStateStore } from '../../src/state/agent-state.js';

// Mock the spawner — never invoke real Claude CLI
vi.mock('../../src/agents/spawner.js', () => ({
  spawnClaude: vi.fn(),
  buildClaudeArgs: vi.fn(() => ['--mock']),
  buildTriageArgs: vi.fn(() => ['--mock-triage']),
}));

// Mock the triage module
vi.mock('../../src/gateway/triage.js', () => ({
  triageMessages: vi.fn(),
  buildTriagePrompt: vi.fn(() => 'mock triage prompt'),
}));

// Mock the scorer module
vi.mock('../../src/gateway/scorer.js', () => ({
  rankMessages: vi.fn(() => []),
  scoreMessage: vi.fn(() => 5),
  getHierarchyScore: vi.fn(() => 5),
  getChannelWeight: vi.fn(() => 5),
  computeRecencyDecay: vi.fn(() => 5),
}));

import { runHeartbeat, type HeartbeatContext, type HeartbeatResult } from '../../src/orchestrator/heartbeat.js';
import { spawnClaude } from '../../src/agents/spawner.js';
import { triageMessages } from '../../src/gateway/triage.js';
import { rankMessages } from '../../src/gateway/scorer.js';

const mockSpawnClaude = vi.mocked(spawnClaude);
const mockTriageMessages = vi.mocked(triageMessages);
const mockRankMessages = vi.mocked(rankMessages);

function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'eng-1',
    identity: { name: 'Engineer 1', role: 'Backend Engineer', model: 'sonnet', tools: ['Read', 'Write'] },
    dir: '/tmp/org/ceo/engineering/eng-1',
    depth: 2,
    parentId: 'vp-eng',
    childIds: [],
    files: {
      identity: '---\nname: Engineer 1\nrole: Backend Engineer\nmodel: sonnet\ntools: [Read, Write]\n---\n# Identity',
      soul: '# Soul\nPragmatic.',
      bureau: '# Bureau\nReports to: VP Eng',
      priorities: '# Priorities\n1. Build API',
      routine: '# Routine\nHeartbeat every 30min',
      memory: '# Memory',
    },
    ...overrides,
  };
}

describe('runHeartbeat', () => {
  let tmpDir: string;
  let stateStore: AgentStateStore;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-heartbeat-'));
    stateStore = new AgentStateStore(path.join(tmpDir, 'orchestrator.db'));
  });

  afterEach(() => {
    stateStore.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeContext(overrides: Partial<HeartbeatContext> = {}): HeartbeatContext {
    return {
      agent: makeAgent(),
      stateStore,
      getUnread: vi.fn(async () => []),
      markRead: vi.fn(async () => {}),
      postMessage: vi.fn(async () => {}),
      appendToMemory: vi.fn(async () => {}),
      appendToPriorities: vi.fn(async () => {}),
      orgAgents: new Map(),
      ...overrides,
    };
  }

  it('completes a no-op cycle when there are no unread messages', async () => {
    const ctx = makeContext();
    stateStore.register('eng-1');

    const result = await runHeartbeat(ctx);

    expect(result.messagesProcessed).toBe(0);
    expect(result.actNowCount).toBe(0);
    expect(result.queueCount).toBe(0);
    expect(result.noteCount).toBe(0);
    expect(result.ignoreCount).toBe(0);
    expect(result.workPerformed).toBe(false);
    expect(mockSpawnClaude).not.toHaveBeenCalled();
  });

  it('runs full triage cycle: score → triage → process results', async () => {
    const unreadMessages = [
      {
        id: 'msg-1',
        channel: 'eng-backend',
        sender: 'vp-eng',
        content: 'Deploy the fix now',
        timestamp: new Date(),
        metadata: { urgent: true },
      },
      {
        id: 'msg-2',
        channel: 'all-hands',
        sender: 'random',
        content: 'Lunch at noon',
        timestamp: new Date(),
      },
    ];

    mockRankMessages.mockReturnValue([
      { messageId: 'msg-1', channel: 'eng-backend', sender: 'vp-eng', content: 'Deploy the fix now', timestamp: new Date(), score: 8.5, metadata: { urgent: true } },
      { messageId: 'msg-2', channel: 'all-hands', sender: 'random', content: 'Lunch at noon', timestamp: new Date(), score: 2.0 },
    ]);

    const triageResults: TriageResult[] = [
      { messageId: 'msg-1', classification: 'ACT_NOW', reasoning: 'Manager request, urgent', score: 8.5 },
      { messageId: 'msg-2', classification: 'IGNORE', reasoning: 'Social, irrelevant', score: 2.0 },
    ];
    mockTriageMessages.mockResolvedValue(triageResults);

    // Mock the main work Claude CLI call (for ACT_NOW)
    mockSpawnClaude.mockResolvedValue({
      stdout: 'Fix deployed successfully. Updated the config and ran tests.',
      stderr: '',
      exitCode: 0,
      durationMs: 5000,
      tokensIn: 1000,
      tokensOut: 500,
    });

    const mockMarkRead = vi.fn(async () => {});
    const mockPostMessage = vi.fn(async () => {});

    const ctx = makeContext({
      getUnread: vi.fn(async () => unreadMessages),
      markRead: mockMarkRead,
      postMessage: mockPostMessage,
    });
    stateStore.register('eng-1');

    const result = await runHeartbeat(ctx);

    expect(result.messagesProcessed).toBe(2);
    expect(result.actNowCount).toBe(1);
    expect(result.ignoreCount).toBe(1);
    expect(result.workPerformed).toBe(true);

    // Should have invoked Claude CLI for the ACT_NOW message
    expect(mockSpawnClaude).toHaveBeenCalledOnce();

    // Should have marked IGNORE messages as read
    expect(mockMarkRead).toHaveBeenCalledWith('eng-1', ['msg-2']);
  });

  it('handles QUEUE messages by appending to priorities', async () => {
    mockRankMessages.mockReturnValue([
      { messageId: 'msg-1', channel: 'eng-backend', sender: 'peer', content: 'Can you review PR #42?', timestamp: new Date(), score: 5.0 },
    ]);
    mockTriageMessages.mockResolvedValue([
      { messageId: 'msg-1', classification: 'QUEUE', reasoning: 'Non-urgent review request', score: 5.0 },
    ]);

    const mockAppendToPriorities = vi.fn(async () => {});
    const mockMarkRead = vi.fn(async () => {});

    const ctx = makeContext({
      getUnread: vi.fn(async () => [
        { id: 'msg-1', channel: 'eng-backend', sender: 'peer', content: 'Can you review PR #42?', timestamp: new Date() },
      ]),
      markRead: mockMarkRead,
      appendToPriorities: mockAppendToPriorities,
    });
    stateStore.register('eng-1');

    const result = await runHeartbeat(ctx);

    expect(result.queueCount).toBe(1);
    expect(mockAppendToPriorities).toHaveBeenCalledWith(
      'eng-1',
      expect.stringContaining('review PR #42'),
    );
    expect(mockMarkRead).toHaveBeenCalledWith('eng-1', ['msg-1']);
  });

  it('handles NOTE messages by appending to memory', async () => {
    mockRankMessages.mockReturnValue([
      { messageId: 'msg-1', channel: 'all-hands', sender: 'ceo', content: 'Q2 goals announced', timestamp: new Date(), score: 4.0 },
    ]);
    mockTriageMessages.mockResolvedValue([
      { messageId: 'msg-1', classification: 'NOTE', reasoning: 'Useful context for future', score: 4.0 },
    ]);

    const mockAppendToMemory = vi.fn(async () => {});
    const mockMarkRead = vi.fn(async () => {});

    const ctx = makeContext({
      getUnread: vi.fn(async () => [
        { id: 'msg-1', channel: 'all-hands', sender: 'ceo', content: 'Q2 goals announced', timestamp: new Date() },
      ]),
      markRead: mockMarkRead,
      appendToMemory: mockAppendToMemory,
    });
    stateStore.register('eng-1');

    const result = await runHeartbeat(ctx);

    expect(result.noteCount).toBe(1);
    expect(mockAppendToMemory).toHaveBeenCalledWith(
      'eng-1',
      expect.stringContaining('Q2 goals announced'),
    );
    expect(mockMarkRead).toHaveBeenCalledWith('eng-1', ['msg-1']);
  });

  it('updates agent state to working during invocation and back to idle after', async () => {
    mockRankMessages.mockReturnValue([
      { messageId: 'msg-1', channel: 'board', sender: 'ceo', content: 'Do this now', timestamp: new Date(), score: 9.0 },
    ]);
    mockTriageMessages.mockResolvedValue([
      { messageId: 'msg-1', classification: 'ACT_NOW', reasoning: 'CEO order', score: 9.0 },
    ]);
    mockSpawnClaude.mockResolvedValue({
      stdout: 'Done.',
      stderr: '',
      exitCode: 0,
      durationMs: 1000,
    });

    const ctx = makeContext({
      getUnread: vi.fn(async () => [
        { id: 'msg-1', channel: 'board', sender: 'ceo', content: 'Do this now', timestamp: new Date() },
      ]),
    });
    stateStore.register('eng-1');

    await runHeartbeat(ctx);

    // After heartbeat completes, agent should be idle
    const state = stateStore.get('eng-1');
    expect(state?.status).toBe('idle');
  });

  it('skips heartbeat if agent is already working (concurrency guard)', async () => {
    const ctx = makeContext();
    stateStore.register('eng-1');
    stateStore.updateStatus('eng-1', 'working', { pid: process.pid });

    const result = await runHeartbeat(ctx);

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toContain('already working');
  });

  it('handles Claude CLI crash during main work gracefully', async () => {
    mockRankMessages.mockReturnValue([
      { messageId: 'msg-1', channel: 'board', sender: 'ceo', content: 'urgent', timestamp: new Date(), score: 9.0 },
    ]);
    mockTriageMessages.mockResolvedValue([
      { messageId: 'msg-1', classification: 'ACT_NOW', reasoning: 'urgent', score: 9.0 },
    ]);
    mockSpawnClaude.mockRejectedValue(new Error('Claude CLI segfault'));

    const ctx = makeContext({
      getUnread: vi.fn(async () => [
        { id: 'msg-1', channel: 'board', sender: 'ceo', content: 'urgent', timestamp: new Date() },
      ]),
    });
    stateStore.register('eng-1');

    const result = await runHeartbeat(ctx);

    expect(result.error).toBeDefined();
    expect(result.error).toContain('segfault');

    // Agent should be back to idle, not stuck in working
    const state = stateStore.get('eng-1');
    expect(state?.status).toBe('idle');
  });
});
