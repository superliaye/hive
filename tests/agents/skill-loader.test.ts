import { describe, it, expect } from 'vitest';
import { resolveSkillsForAgent } from '../../src/agents/skill-loader.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SKILLS_FIXTURE = path.resolve(__dirname, '../fixtures/sample-skills');

describe('resolveSkillsForAgent', () => {
  it('returns shared skills for any agent', () => {
    const skills = resolveSkillsForAgent('engineer', SKILLS_FIXTURE);
    // Fixture has shared/comms skill
    expect(skills.shared.length).toBe(1);
  });

  it('maps role keywords to skill directories', () => {
    const mapping = resolveSkillsForAgent('ceo', SKILLS_FIXTURE);
    expect(mapping.roleDir).toBe('ceo');
  });

  it('maps engineering roles correctly', () => {
    const mapping = resolveSkillsForAgent('Backend Software Engineer', SKILLS_FIXTURE);
    expect(mapping.roleDir).toBe('engineering');
  });

  it('resolves role-specific skills from fixture', () => {
    const skills = resolveSkillsForAgent('engineer', SKILLS_FIXTURE);
    expect(skills.role.length).toBe(1); // engineering/code-review
  });
});
