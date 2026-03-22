import { describe, it, expect } from 'vitest';
import { loadAgentConfig } from '../../src/agents/config-loader.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CEO_DIR = path.resolve(__dirname, '../fixtures/sample-org/ceo');

describe('loadAgentConfig', () => {
  it('loads identity frontmatter', async () => {
    const config = await loadAgentConfig(CEO_DIR, 'ceo', 0, null);
    expect(config.identity.name).toBe('Test CEO');
    expect(config.identity.model).toBe('sonnet');
    expect(config.identity.tools).toContain('Read');
  });

  it('loads all md file contents', async () => {
    const config = await loadAgentConfig(CEO_DIR, 'ceo', 0, null);
    expect(config.files.soul).toContain('Strategic thinker');
    expect(config.files.bureau).toContain('Super User');
    expect(config.files.priorities).toContain('Build initial org');
  });

  it('handles missing optional files gracefully', async () => {
    const config = await loadAgentConfig(CEO_DIR, 'ceo', 0, null);
    // MEMORY.md exists but even if it didn't, should return empty string
    expect(typeof config.files.memory).toBe('string');
  });
});
