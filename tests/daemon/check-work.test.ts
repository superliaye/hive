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
    expect(mockTriageMessages).toHaveBeenCalledOnce();
    expect(mockSpawnClaude).not.toHaveBeenCalled();
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

  it('handles NOTE messages by marking as read', async () => {
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
    });
    stateStore.register('ceo');

    const result = await checkWork(ctx);

    expect(result.agentInvoked).toBe(false);
    expect(mockMarkRead).toHaveBeenCalledWith('ceo', ['msg-1']);
  });
});
