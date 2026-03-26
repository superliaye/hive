import { describe, it, expect } from 'vitest';
import { parseIdentityFrontmatter } from '../../src/org/parser.js';

describe('per-agent skill declarations', () => {
  it('parses skills from IDENTITY.md frontmatter', () => {
    const content = `---
name: Test Agent
role: Test Role
model: sonnet
skills: [comms, escalation, scope-guard]
---
# Identity
Test agent.`;

    const identity = parseIdentityFrontmatter(content);
    expect(identity.skills).toEqual(['comms', 'escalation', 'scope-guard']);
  });

  it('returns undefined when no skills declared', () => {
    const content = `---
name: Test Agent
role: Test Role
model: sonnet
---
# Identity`;

    const identity = parseIdentityFrontmatter(content);
    expect(identity.skills).toBeUndefined();
  });
});
