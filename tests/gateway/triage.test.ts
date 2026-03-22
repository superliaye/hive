import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ScoredMessage, TriageBatchOutput } from '../../src/gateway/types.js';

// Mock the spawner module so we never invoke real Claude CLI
vi.mock('../../src/agents/spawner.js', () => ({
  spawnClaude: vi.fn(),
  buildClaudeArgs: vi.fn((...args: unknown[]) => ['--mock']),
  buildTriageArgs: vi.fn((prompt: string) => ['--mock-triage']),
}));

import { triageMessages, buildTriagePrompt } from '../../src/gateway/triage.js';
import { spawnClaude } from '../../src/agents/spawner.js';

const mockSpawnClaude = vi.mocked(spawnClaude);

function makeScoredMessage(overrides: Partial<ScoredMessage> = {}): ScoredMessage {
  return {
    messageId: 'msg-1',
    channel: 'eng-backend',
    sender: 'vp-eng',
    content: 'Please review the PR',
    timestamp: new Date('2026-03-22T10:00:00Z'),
    score: 7.5,
    ...overrides,
  };
}

describe('buildTriagePrompt', () => {
  it('includes agent priorities and bureau', () => {
    const prompt = buildTriagePrompt(
      '## Current Sprint\n1. Build API endpoint',
      '## Position\nReports to: VP Eng',
    );
    expect(prompt).toContain('Current Sprint');
    expect(prompt).toContain('Reports to: VP Eng');
  });

  it('includes triage classification instructions', () => {
    const prompt = buildTriagePrompt('priorities', 'bureau');
    expect(prompt).toContain('ACT_NOW');
    expect(prompt).toContain('QUEUE');
    expect(prompt).toContain('NOTE');
    expect(prompt).toContain('IGNORE');
  });

  it('includes JSON output format instructions', () => {
    const prompt = buildTriagePrompt('priorities', 'bureau');
    expect(prompt).toContain('messageId');
    expect(prompt).toContain('classification');
    expect(prompt).toContain('reasoning');
  });
});

describe('triageMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty results for empty message batch', async () => {
    const results = await triageMessages([], {
      agentId: 'eng-1',
      agentDir: '/tmp/org/ceo/engineering/eng-1',
      priorities: 'Build stuff',
      bureau: 'Reports to vp-eng',
    });
    expect(results).toEqual([]);
    expect(mockSpawnClaude).not.toHaveBeenCalled();
  });

  it('invokes Claude CLI with correct args and parses response', async () => {
    const mockResponse: TriageBatchOutput = {
      results: [
        { messageId: 'msg-1', classification: 'ACT_NOW', reasoning: 'PR needs review urgently', score: 7.5 },
        { messageId: 'msg-2', classification: 'IGNORE', reasoning: 'Not relevant', score: 2.0 },
      ],
    };

    mockSpawnClaude.mockResolvedValue({
      stdout: JSON.stringify(mockResponse),
      stderr: '',
      exitCode: 0,
      durationMs: 500,
      tokensIn: 200,
      tokensOut: 100,
    });

    const messages = [
      makeScoredMessage({ messageId: 'msg-1', score: 7.5 }),
      makeScoredMessage({ messageId: 'msg-2', content: 'Random noise', score: 2.0 }),
    ];

    const results = await triageMessages(messages, {
      agentId: 'eng-1',
      agentDir: '/tmp/org/ceo/engineering/eng-1',
      priorities: 'Build API endpoint',
      bureau: 'Reports to vp-eng',
    });

    expect(results).toHaveLength(2);
    expect(results[0].classification).toBe('ACT_NOW');
    expect(results[1].classification).toBe('IGNORE');
    expect(mockSpawnClaude).toHaveBeenCalledOnce();
  });

  it('handles Claude CLI failure gracefully — returns all as QUEUE', async () => {
    mockSpawnClaude.mockResolvedValue({
      stdout: 'not json at all',
      stderr: 'some error',
      exitCode: 1,
      durationMs: 200,
    });

    const messages = [makeScoredMessage()];
    const results = await triageMessages(messages, {
      agentId: 'eng-1',
      agentDir: '/tmp/org/ceo/engineering/eng-1',
      priorities: '',
      bureau: '',
    });

    expect(results).toHaveLength(1);
    expect(results[0].classification).toBe('QUEUE');
    expect(results[0].reasoning).toContain('fallback');
  });

  it('handles malformed JSON from Claude CLI — returns all as QUEUE', async () => {
    mockSpawnClaude.mockResolvedValue({
      stdout: '{"results": "not an array"}',
      stderr: '',
      exitCode: 0,
      durationMs: 300,
    });

    const messages = [makeScoredMessage()];
    const results = await triageMessages(messages, {
      agentId: 'eng-1',
      agentDir: '/tmp/org/ceo/engineering/eng-1',
      priorities: '',
      bureau: '',
    });

    expect(results).toHaveLength(1);
    expect(results[0].classification).toBe('QUEUE');
  });

  it('preserves Stage 1 scores in triage results', async () => {
    mockSpawnClaude.mockResolvedValue({
      stdout: JSON.stringify({
        results: [
          { messageId: 'msg-1', classification: 'ACT_NOW', reasoning: 'urgent' },
        ],
      }),
      stderr: '',
      exitCode: 0,
      durationMs: 100,
    });

    const messages = [makeScoredMessage({ messageId: 'msg-1', score: 8.3 })];
    const results = await triageMessages(messages, {
      agentId: 'eng-1',
      agentDir: '/tmp/org/ceo/engineering/eng-1',
      priorities: '',
      bureau: '',
    });

    expect(results[0].score).toBe(8.3);
  });
});
