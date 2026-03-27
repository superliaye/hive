import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { AgentStateStore } from '../../src/state/agent-state.js';
import {
  detectStaleAgents,
  recoverStaleAgents,
  type RecoveryReport,
} from '../../src/orchestrator/crash-recovery.js';

describe('Crash Recovery', () => {
  let tmpDir: string;
  let stateStore: AgentStateStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-crash-'));
    stateStore = new AgentStateStore(path.join(tmpDir, 'orchestrator.db'));
  });

  afterEach(() => {
    stateStore.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('detectStaleAgents', () => {
    it('returns empty array when no agents are in working state', () => {
      stateStore.register('eng-1');
      stateStore.updateStatus('eng-1', 'idle');
      const stale = detectStaleAgents(stateStore);
      expect(stale).toEqual([]);
    });

    it('detects agents with working status but dead PID', () => {
      stateStore.register('eng-1');
      stateStore.updateStatus('eng-1', 'working', { pid: 999999999, currentTask: 'doing stuff' });
      const stale = detectStaleAgents(stateStore);
      expect(stale).toHaveLength(1);
      expect(stale[0].agentId).toBe('eng-1');
    });

    it('does NOT flag agents with working status and live PID', () => {
      stateStore.register('eng-1');
      stateStore.updateStatus('eng-1', 'working', { pid: process.pid, currentTask: 'alive' });
      const stale = detectStaleAgents(stateStore);
      expect(stale).toEqual([]);
    });

    it('detects agents with working status and no PID', () => {
      stateStore.register('eng-1');
      stateStore.updateStatus('eng-1', 'working');
      const stale = detectStaleAgents(stateStore);
      expect(stale).toHaveLength(1);
    });
  });

  describe('recoverStaleAgents', () => {
    it('resets stale agents to idle and returns recovery report', () => {
      stateStore.register('eng-1');
      stateStore.register('eng-2');
      stateStore.updateStatus('eng-1', 'working', { pid: 999999999, currentTask: 'building API' });
      stateStore.updateStatus('eng-2', 'working', { pid: 999999998, currentTask: 'writing tests' });

      const report = recoverStaleAgents(stateStore);

      expect(report.recoveredAgents).toHaveLength(2);
      expect(report.recoveredAgents[0].agentId).toBe('eng-1');
      expect(report.recoveredAgents[0].previousTask).toBe('building API');
      expect(report.recoveredAgents[1].agentId).toBe('eng-2');

      // Verify state was reset to idle (ready for fresh start)
      const eng1 = stateStore.get('eng-1');
      expect(eng1?.status).toBe('idle');
      const eng2 = stateStore.get('eng-2');
      expect(eng2?.status).toBe('idle');
    });

    it('resets errored agents from previous session to idle', () => {
      stateStore.register('eng-1');
      stateStore.updateStatus('eng-1', 'errored', { currentTask: 'Rate-limited' });

      const report = recoverStaleAgents(stateStore);

      expect(report.recoveredAgents).toHaveLength(1);
      expect(stateStore.get('eng-1')?.status).toBe('idle');
    });

    it('returns empty report when no stale agents exist', () => {
      stateStore.register('eng-1');
      stateStore.updateStatus('eng-1', 'idle');
      const report = recoverStaleAgents(stateStore);
      expect(report.recoveredAgents).toEqual([]);
    });
  });
});
