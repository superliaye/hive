import { describe, it, expect } from 'vitest';
import { parseOrgTree } from '../../src/org/parser.js';
import { loadAgentConfig } from '../../src/agents/config-loader.js';
import { assemblePrompt } from '../../src/agents/prompt-assembler.js';
import { buildClaudeArgs } from '../../src/agents/spawner.js';
import { AuditStore } from '../../src/audit/store.js';
import { AgentStateStore } from '../../src/state/agent-state.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/sample-org');
const TEST_AUDIT_DB = path.join(__dirname, '../fixtures/integration-audit.db');
const TEST_STATE_DB = path.join(__dirname, '../fixtures/integration-state.db');

describe('Full pipeline integration', () => {
  it('parses org → loads config → assembles prompt → builds args', async () => {
    // 1. Parse org tree
    const org = await parseOrgTree(FIXTURE_DIR);
    expect(org.agents.size).toBeGreaterThan(0);

    // 2. Load CEO config
    const ceo = org.root;
    expect(ceo.identity.name).toBe('Test CEO');

    // 3. Assemble prompt
    const prompt = assemblePrompt(ceo);
    expect(prompt.length).toBeGreaterThan(100);
    expect(prompt).toContain('CEO');

    // 4. Build claude args
    const args = buildClaudeArgs({
      model: ceo.identity.model,
      systemPrompt: prompt,
      tools: ceo.identity.tools,
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
