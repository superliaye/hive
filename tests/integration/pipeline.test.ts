import { describe, it, expect } from 'vitest';
import { parseOrgFlat } from '../../src/org/parser.js';
import { assemblePrompt } from '../../src/agents/prompt-assembler.js';
import { buildClaudeArgs } from '../../src/agents/spawner.js';
import { AuditStore } from '../../src/audit/store.js';
import { AgentStateStore } from '../../src/state/agent-state.js';
import type { Person } from '../../src/types.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/sample-org');
const TEST_AUDIT_DB = path.join(__dirname, '../fixtures/integration-audit.db');
const TEST_STATE_DB = path.join(__dirname, '../fixtures/integration-state.db');

/** People records matching the sample-org fixture folders (1-ceo, 2-ar, 3-eng-1). */
function fixturePeople(): Person[] {
  return [
    { id: 1, alias: 'ceo', name: 'Test CEO', roleTemplate: 'CEO', status: 'active', folder: '1-ceo' },
    { id: 2, alias: 'ar', name: 'AR Agent', roleTemplate: 'Agent Resources Manager', status: 'active', folder: '2-ar', reportsTo: 1 },
    { id: 3, alias: 'eng-1', name: 'Engineer 1', roleTemplate: 'Engineer', status: 'active', folder: '3-eng-1', reportsTo: 1 },
  ];
}

describe('Full pipeline integration', () => {
  it('parses org → loads config → assembles prompt → builds args', async () => {
    // 1. Parse org (flat model with people)
    const people = fixturePeople();
    const org = await parseOrgFlat(FIXTURE_DIR, people);
    expect(org.agents.size).toBeGreaterThan(0);

    // 2. Load CEO config via the agents map
    const ceo = org.agents.get('ceo');
    expect(ceo).toBeDefined();
    expect(ceo!.identity.name).toBe('Test CEO');

    // 3. Assemble prompt
    const prompt = assemblePrompt(ceo!);
    expect(prompt.length).toBeGreaterThan(100);
    expect(prompt).toContain('CEO');

    // 4. Build claude args
    const args = buildClaudeArgs({
      model: ceo!.identity.model,
      systemPrompt: prompt,
      tools: ceo!.identity.tools,
    });
    expect(args).toContain('-p');
    expect(args).toContain('sonnet');
  });

  it('audit and state stores work together', () => {
    const auditStore = new AuditStore(TEST_AUDIT_DB);
    const stateStore = new AgentStateStore(TEST_STATE_DB);

    try {
      // Register agent
      stateStore.register('ceo');
      stateStore.updateStatus('ceo', 'working', { pid: process.pid, currentTask: 'triage' });

      // Log invocation
      auditStore.logInvocation({
        agentId: 'ceo',
        invocationType: 'triage',
        model: 'haiku',
        tokensIn: 500,
        tokensOut: 200,
        durationMs: 1500,
      });

      // Verify
      const state = stateStore.get('ceo');
      expect(state!.status).toBe('working');

      const invocations = auditStore.getInvocations({ agentId: 'ceo' });
      expect(invocations.length).toBe(1);
    } finally {
      auditStore.close();
      stateStore.close();
      try { fs.unlinkSync(TEST_AUDIT_DB); } catch {}
      try { fs.unlinkSync(TEST_STATE_DB); } catch {}
    }
  });
});
