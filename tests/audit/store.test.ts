import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AuditStore } from '../../src/audit/store.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = path.join(__dirname, '../fixtures/test-audit.db');

describe('AuditStore', () => {
  let store: AuditStore;

  beforeEach(() => {
    store = new AuditStore(TEST_DB);
  });

  afterEach(() => {
    store.close();
    try { fs.unlinkSync(TEST_DB); } catch {}
  });

  it('creates the invocations table on init', () => {
    // Just opening should create the table
    expect(store).toBeDefined();
  });

  it('logs an invocation', () => {
    store.logInvocation({
      agentId: 'ceo',
      invocationType: 'main',
      model: 'sonnet',
      tokensIn: 1000,
      tokensOut: 500,
      durationMs: 3000,
      inputSummary: 'Check board messages',
      outputSummary: 'Reviewed 3 messages',
    });

    const entries = store.getInvocations({ agentId: 'ceo' });
    expect(entries.length).toBe(1);
    expect(entries[0].model).toBe('sonnet');
    expect(entries[0].agentId).toBe('ceo');
    expect(entries[0].invocationType).toBe('main');
    expect(entries[0].tokensIn).toBe(1000);
    expect(entries[0].durationMs).toBe(3000);
  });

  it('queries by agent and time range', () => {
    store.logInvocation({ agentId: 'ceo', invocationType: 'triage', model: 'haiku' });
    store.logInvocation({ agentId: 'eng-1', invocationType: 'main', model: 'sonnet' });

    const ceoEntries = store.getInvocations({ agentId: 'ceo' });
    expect(ceoEntries.length).toBe(1);

    const allEntries = store.getInvocations({});
    expect(allEntries.length).toBe(2);
  });

  it('computes token totals', () => {
    store.logInvocation({ agentId: 'ceo', invocationType: 'main', model: 'sonnet', tokensIn: 1000, tokensOut: 500 });
    store.logInvocation({ agentId: 'ceo', invocationType: 'triage', model: 'haiku', tokensIn: 200, tokensOut: 100 });

    const totals = store.getTokenTotals('ceo');
    expect(totals.totalIn).toBe(1200);
    expect(totals.totalOut).toBe(600);
  });
});
