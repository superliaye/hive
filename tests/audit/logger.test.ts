import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AuditLogger } from '../../src/audit/logger.js';
import { AuditStore } from '../../src/audit/store.js';
import type { SpawnResult } from '../../src/types.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = path.join(__dirname, '../fixtures/test-audit-logger.db');

describe('AuditLogger', () => {
  let store: AuditStore;
  let logger: AuditLogger;

  beforeEach(() => {
    store = new AuditStore(TEST_DB);
    logger = new AuditLogger(store);
  });

  afterEach(() => {
    store.close();
    try { fs.unlinkSync(TEST_DB); } catch {}
  });

  it('forwards cache token counts from SpawnResult to audit store', () => {
    const result: SpawnResult = {
      stdout: 'Some response text here',
      stderr: '',
      exitCode: 0,
      durationMs: 5000,
      tokensIn: 1504,
      tokensOut: 736,
      cacheReadTokens: 1200,
      cacheCreationTokens: 300,
    };

    logger.logAgentInvocation('ceo', 'checkWork', 'sonnet', result, {
      inputSummary: '1 ACT_NOW message(s) from #board',
      channel: 'board',
    });

    const entries = store.getInvocations({ agentId: 'ceo' });
    expect(entries.length).toBe(1);
    expect(entries[0].cacheReadTokens).toBe(1200);
    expect(entries[0].cacheCreationTokens).toBe(300);
    expect(entries[0].tokensIn).toBe(1504);
    expect(entries[0].tokensOut).toBe(736);
  });

  it('stores null for cache tokens when SpawnResult has no cache data', () => {
    const result: SpawnResult = {
      stdout: 'Response',
      stderr: '',
      exitCode: 0,
      durationMs: 3000,
      tokensIn: 500,
      tokensOut: 200,
    };

    logger.logAgentInvocation('eng-1', 'checkWork', 'sonnet', result);

    const entries = store.getInvocations({ agentId: 'eng-1' });
    expect(entries.length).toBe(1);
    expect(entries[0].cacheReadTokens).toBeNull();
    expect(entries[0].cacheCreationTokens).toBeNull();
    expect(entries[0].tokensIn).toBe(500);
  });
});
