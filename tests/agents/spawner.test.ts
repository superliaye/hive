import { describe, it, expect } from 'vitest';
import { buildClaudeArgs, buildTriageArgs } from '../../src/agents/spawner.js';

describe('buildClaudeArgs', () => {
  it('builds correct args for print mode invocation', () => {
    const args = buildClaudeArgs({
      model: 'sonnet',
      systemPrompt: 'You are a test agent.',
    });
    expect(args).toContain('-p');
    expect(args).toContain('--model');
    expect(args).toContain('sonnet');
    expect(args).toContain('--system-prompt');
    expect(args).toContain('You are a test agent.');
  });

  it('includes output-format json when specified', () => {
    const args = buildClaudeArgs({
      model: 'haiku',
      systemPrompt: 'Triage messages.',
      outputFormat: 'json',
    });
    expect(args).toContain('--output-format');
    expect(args).toContain('json');
  });
});

describe('buildTriageArgs', () => {
  it('uses haiku model for triage', () => {
    const args = buildTriageArgs('Triage prompt here');
    expect(args).toContain('haiku');
    expect(args).toContain('json');
  });
});
