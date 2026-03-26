import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import type { AgentConfig, OrgChart, Person } from '../../src/types.js';

// Mock Claude CLI — the only external dependency
vi.mock('../../src/agents/spawner.js', () => ({
  spawnClaude: vi.fn(),
  buildClaudeArgs: vi.fn(() => ['--mock']),
  buildTriageArgs: vi.fn(() => ['--mock-triage']),
}));

import { scoreMessage, rankMessages } from '../../src/gateway/scorer.js';
import { DEFAULT_SCORING_WEIGHTS, parseTriageOutput } from '../../src/gateway/types.js';
import { triageMessages } from '../../src/gateway/triage.js';
import { runHeartbeat, type HeartbeatContext, type UnreadMessage } from '../../src/orchestrator/heartbeat.js';
import { Orchestrator, type OrchestratorConfig } from '../../src/orchestrator/orchestrator.js';
import { AgentStateStore } from '../../src/state/agent-state.js';
import { recoverStaleAgents } from '../../src/orchestrator/crash-recovery.js';
import { spawnClaude } from '../../src/agents/spawner.js';

const mockSpawnClaude = vi.mocked(spawnClaude);

const ceoPerson: Person = { id: 1, alias: 'ceo', name: 'CEO', status: 'active', folder: '1-ceo' };
const vpEngPerson: Person = { id: 2, alias: 'vp-eng', name: 'VP Engineering', status: 'active', folder: '2-vp-eng', reportsTo: 1 };

function makeAgent(alias: string, overrides: Partial<AgentConfig> = {}): AgentConfig {
  const isRoot = alias === 'ceo';
  const person: Person = isRoot
    ? ceoPerson
    : { id: 3, alias, name: alias, status: 'active', folder: `3-${alias}`, reportsTo: 1 };
  return {
    person,
    identity: { name: alias, role: 'Engineer', model: 'sonnet' },
    dir: `/tmp/org/${person.folder}`,
    reportsTo: isRoot ? null : ceoPerson,
    directReports: [],
    files: {
      identity: `---\nname: ${alias}\nrole: Engineer\nmodel: sonnet\n---`,
      soul: '# Soul',
      bureau: '# Bureau\nReports to: CEO',
      priorities: '# Priorities\n## Backlog',
      routine: '# Routine',
      memory: '# Memory',
      protocols: '',
      skills: '',
    },
    ...overrides,
  };
}

describe('Gateway + Orchestrator Integration', () => {
  let tmpDir: string;
  let stateStore: AgentStateStore;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-integration-'));
    stateStore = new AgentStateStore(path.join(tmpDir, 'orchestrator.db'));
  });

  afterEach(() => {
    stateStore.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('End-to-end scoring + triage + heartbeat', () => {
    it('processes a batch of messages through the full pipeline', async () => {
      const agent = makeAgent('eng-1', {
        reportsTo: vpEngPerson,
      });
      stateStore.register('eng-1');

      // Stage 1: Score messages
      const messages = [
        { messageId: 'msg-urgent', channel: 'incidents', sender: 'vp-eng', content: 'Production is down!', timestamp: new Date(), metadata: { urgent: true }, mentions: ['eng-1'] },
        { messageId: 'msg-normal', channel: 'eng-backend', sender: 'peer', content: 'Can you review this PR?', timestamp: new Date() },
        { messageId: 'msg-noise', channel: 'all-hands', sender: 'random', content: 'Happy Friday everyone!', timestamp: new Date(Date.now() - 20 * 60 * 60 * 1000) },
      ];

      const ranked = rankMessages(messages, agent, DEFAULT_SCORING_WEIGHTS);

      // Urgent incident from manager with mention should rank highest
      expect(ranked[0].messageId).toBe('msg-urgent');
      expect(ranked[0].score).toBeGreaterThan(7);

      // Stale social message should rank lowest
      expect(ranked[ranked.length - 1].messageId).toBe('msg-noise');

      // Stage 2: Mock triage LLM response
      mockSpawnClaude.mockResolvedValueOnce({
        stdout: JSON.stringify({
          results: [
            { messageId: 'msg-urgent', classification: 'ACT_NOW', reasoning: 'Production incident' },
            { messageId: 'msg-normal', classification: 'QUEUE', reasoning: 'Non-urgent PR review' },
            { messageId: 'msg-noise', classification: 'IGNORE', reasoning: 'Social chatter' },
          ],
        }),
        stderr: '',
        exitCode: 0,
        durationMs: 300,
        tokensIn: 150,
        tokensOut: 80,
      });

      const triageResults = await triageMessages(ranked, {
        agentId: 'eng-1',
        agentDir: agent.dir,
        priorities: agent.files.priorities,
        bureau: agent.files.bureau,
      });

      expect(triageResults).toHaveLength(3);
      expect(triageResults.find(r => r.messageId === 'msg-urgent')?.classification).toBe('ACT_NOW');
      expect(triageResults.find(r => r.messageId === 'msg-normal')?.classification).toBe('QUEUE');
      expect(triageResults.find(r => r.messageId === 'msg-noise')?.classification).toBe('IGNORE');
    });
  });

  describe('Crash recovery integration', () => {
    it('recovers stale agents and resumes normal operation', () => {
      stateStore.register('eng-1');
      stateStore.register('eng-2');
      stateStore.updateStatus('eng-1', 'working', { pid: 999999999, currentTask: 'stuck task' });
      stateStore.updateStatus('eng-2', 'idle');

      const report = recoverStaleAgents(stateStore);

      expect(report.recoveredAgents).toHaveLength(1);
      expect(report.recoveredAgents[0].agentId).toBe('eng-1');

      // eng-1 should be errored, eng-2 should be unchanged
      expect(stateStore.get('eng-1')?.status).toBe('errored');
      expect(stateStore.get('eng-2')?.status).toBe('idle');
    });
  });

  describe('parseTriageOutput edge cases', () => {
    it('handles well-formed output', () => {
      const output = parseTriageOutput(JSON.stringify({
        results: [
          { messageId: 'msg-1', classification: 'ACT_NOW', reasoning: 'important' },
        ],
      }));
      expect(output.results).toHaveLength(1);
      expect(output.results[0].classification).toBe('ACT_NOW');
    });

    it('throws on invalid JSON', () => {
      expect(() => parseTriageOutput('not json')).toThrow(/Failed to parse/);
    });

    it('throws on missing results array', () => {
      expect(() => parseTriageOutput('{"foo": "bar"}')).toThrow(/missing "results"/);
    });

    it('throws on invalid classification', () => {
      expect(() => parseTriageOutput(JSON.stringify({
        results: [{ messageId: 'msg-1', classification: 'INVALID' }],
      }))).toThrow(/invalid classification/);
    });
  });
});
