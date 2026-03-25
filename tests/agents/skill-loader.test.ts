import { describe, it, expect } from 'vitest';
import { resolveSkillsForAgent } from '../../src/agents/skill-loader.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROLE_SKILLS_FIXTURE = path.resolve(__dirname, '../fixtures/sample-role-skills');

describe('resolveSkillsForAgent', () => {
  it('resolves declared skills from role-skills directory', () => {
    const result = resolveSkillsForAgent(ROLE_SKILLS_FIXTURE, ['hive-comms', 'code-review']);
    expect(result.skills.length).toBe(2);
    expect(result.skills[0]).toContain('hive-comms');
    expect(result.skills[1]).toContain('code-review');
  });

  it('skips skills that do not exist', () => {
    const result = resolveSkillsForAgent(ROLE_SKILLS_FIXTURE, ['hive-comms', 'nonexistent']);
    expect(result.skills.length).toBe(1);
    expect(result.skills[0]).toContain('hive-comms');
  });

  it('returns empty for empty declared skills', () => {
    const result = resolveSkillsForAgent(ROLE_SKILLS_FIXTURE, []);
    expect(result.skills.length).toBe(0);
  });

  it('resolves all available skills when declared', () => {
    const result = resolveSkillsForAgent(ROLE_SKILLS_FIXTURE, ['hive-comms', 'code-review', 'agent-provisioning']);
    expect(result.skills.length).toBe(3);
  });
});
