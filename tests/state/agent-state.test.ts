import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentStateStore } from '../../src/state/agent-state.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = path.join(__dirname, '../fixtures/test-state.db');

describe('AgentStateStore', () => {
  let store: AgentStateStore;

  beforeEach(() => {
    store = new AgentStateStore(TEST_DB);
  });

  afterEach(() => {
    store.close();
    try { fs.unlinkSync(TEST_DB); } catch {}
  });

  it('registers a new agent', () => {
    store.register('ceo');
    const state = store.get('ceo');
    expect(state).toBeDefined();
    expect(state!.status).toBe('idle');
  });

  it('updates agent status', () => {
    store.register('ceo');
    store.updateStatus('ceo', 'working', { pid: 1234, currentTask: 'triage' });
    const state = store.get('ceo');
    expect(state!.status).toBe('working');
    expect(state!.pid).toBe(1234);
  });

  it('finds stale agents', () => {
    store.register('ceo');
    store.updateStatus('ceo', 'working', { pid: 2_147_483_647 }); // Max 32-bit PID — guaranteed not to exist
    const stale = store.findStale();
    expect(stale.length).toBe(1);
    expect(stale[0].agentId).toBe('ceo');
  });

  it('lists all agents', () => {
    store.register('ceo');
    store.register('eng-1');
    const all = store.listAll();
    expect(all.length).toBe(2);
  });
});
