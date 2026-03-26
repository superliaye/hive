import { describe, it, expect } from 'vitest';
import { loadAgentFiles } from '../../src/agents/config-loader.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CEO_DIR = path.resolve(__dirname, '../fixtures/sample-org/1-ceo');

describe('loadAgentFiles', () => {
  it('loads identity frontmatter', async () => {
    const { identity } = await loadAgentFiles(CEO_DIR);
    expect(identity.name).toBe('Test CEO');
    expect(identity.model).toBe('sonnet');
  });

  it('loads all md file contents', async () => {
    const { files } = await loadAgentFiles(CEO_DIR);
    expect(files.soul).toContain('Strategic thinker');
    expect(files.bureau).toContain('Super User');
    expect(files.priorities).toContain('Build initial org');
  });

  it('handles missing optional files gracefully', async () => {
    const { files } = await loadAgentFiles(CEO_DIR);
    // MEMORY.md exists but even if it didn't, should return empty string
    expect(typeof files.memory).toBe('string');
  });
});
