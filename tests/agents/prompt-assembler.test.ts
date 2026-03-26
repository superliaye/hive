import { describe, it, expect } from 'vitest';
import { assemblePrompt } from '../../src/agents/prompt-assembler.js';
import { loadAgentFiles } from '../../src/agents/config-loader.js';
import type { AgentConfig, Person } from '../../src/types.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CEO_DIR = path.resolve(__dirname, '../fixtures/sample-org/1-ceo');

const ceoPerson: Person = {
  id: 1,
  alias: 'ceo',
  name: 'Test CEO',
  roleTemplate: 'Chief Executive Officer',
  status: 'active',
};

async function buildCeoConfig(): Promise<AgentConfig> {
  const { files, identity } = await loadAgentFiles(CEO_DIR);
  return {
    person: ceoPerson,
    dir: CEO_DIR,
    reportsTo: null,
    directReports: [],
    files,
    identity,
  };
}

describe('assemblePrompt', () => {
  it('concatenates all md files with section dividers', async () => {
    const config = await buildCeoConfig();
    const prompt = assemblePrompt(config);
    expect(prompt).toContain('Strategic thinker');
    expect(prompt).toContain('Super User');
  });

  it('includes all file content', async () => {
    const config = await buildCeoConfig();
    const prompt = assemblePrompt(config);
    expect(prompt).toContain('Strategic thinker');
    expect(prompt).toContain('Super User');
  });

  it('separates sections clearly', async () => {
    const config = await buildCeoConfig();
    const prompt = assemblePrompt(config);
    // Sections should be separated by dividers
    expect(prompt).toContain('---');
  });
});
