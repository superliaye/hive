import { describe, it, expect } from 'vitest';
import { assemblePrompt } from '../../src/agents/prompt-assembler.js';
import { loadAgentConfig } from '../../src/agents/config-loader.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CEO_DIR = path.resolve(__dirname, '../fixtures/sample-org/ceo');

describe('assemblePrompt', () => {
  it('concatenates all md files with section markers', async () => {
    const config = await loadAgentConfig(CEO_DIR, 'ceo', 0, null);
    const prompt = assemblePrompt(config);
    expect(prompt).toContain('# Identity');
    expect(prompt).toContain('# Soul');
    expect(prompt).toContain('# Bureau');
    expect(prompt).toContain('# Priorities');
    expect(prompt).toContain('# Routine');
  });

  it('includes all file content', async () => {
    const config = await loadAgentConfig(CEO_DIR, 'ceo', 0, null);
    const prompt = assemblePrompt(config);
    expect(prompt).toContain('Strategic thinker');
    expect(prompt).toContain('Super User');
  });

  it('separates sections clearly', async () => {
    const config = await loadAgentConfig(CEO_DIR, 'ceo', 0, null);
    const prompt = assemblePrompt(config);
    // Sections should be separated by dividers
    expect(prompt).toContain('---');
  });
});
