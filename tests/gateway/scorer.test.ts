import { describe, it, expect } from 'vitest';
import {
  scoreMessage,
  getHierarchyScore,
  getConversationWeight,
  computeRecencyDecay,
} from '../../src/gateway/scorer.js';
import type { AgentConfig } from '../../src/types.js';
import type { ScoringWeights } from '../../src/gateway/types.js';
import { DEFAULT_SCORING_WEIGHTS } from '../../src/gateway/types.js';

function makePerson(alias: string, overrides: Partial<import('../../src/types.js').Person> = {}): import('../../src/types.js').Person {
  return {
    id: 1,
    alias,
    name: alias.toUpperCase(),
    status: 'active' as const,
    ...overrides,
  };
}

function makeAgent(alias: string, overrides: Partial<AgentConfig> = {}): AgentConfig {
  const person = overrides.person ?? makePerson(alias);
  return {
    person,
    identity: { name: person.name, role: person.name, model: 'sonnet' },
    dir: `/tmp/org/${person.id}-${alias}`,
    reportsTo: null,
    directReports: [],
    files: {
      identity: '', soul: '', bureau: '', priorities: '', routine: '', memory: '', triageLog: '', protocols: '', skills: '',
    },
    ...overrides,
  };
}

describe('getHierarchyScore', () => {
  it('returns 10 for messages from manager (reportsTo)', () => {
    const agent = makeAgent('vp-eng', { reportsTo: makePerson('ceo', { id: 2 }) });
    expect(getHierarchyScore('ceo', agent)).toBe(10);
  });

  it('returns 5 for messages from peer (same reportsTo)', () => {
    const vpPerson = makePerson('vp-eng', { id: 3 });
    const agent = makeAgent('eng-1', { reportsTo: vpPerson });
    expect(getHierarchyScore('eng-2', agent, new Map([
      ['eng-1', makeAgent('eng-1', { reportsTo: vpPerson })],
      ['eng-2', makeAgent('eng-2', { person: makePerson('eng-2', { id: 4 }), reportsTo: vpPerson })],
      ['vp-eng', makeAgent('vp-eng', { person: vpPerson, directReports: [makePerson('eng-1'), makePerson('eng-2', { id: 4 })] })],
    ]))).toBe(5);
  });

  it('returns 3 for messages from direct report', () => {
    const agent = makeAgent('vp-eng', { directReports: [makePerson('eng-1', { id: 2 }), makePerson('eng-2', { id: 3 })] });
    expect(getHierarchyScore('eng-1', agent)).toBe(3);
  });

  it('returns 1 for messages from unknown sender', () => {
    const agent = makeAgent('ceo');
    expect(getHierarchyScore('random-agent', agent)).toBe(1);
  });

  it('returns 10 for super-user sender (always high)', () => {
    const agent = makeAgent('ceo');
    expect(getHierarchyScore('super-user', agent)).toBe(10);
  });
});

describe('getConversationWeight', () => {
  it('returns 8 for dm: conversations', () => {
    expect(getConversationWeight('dm:ceo-eng-1')).toBe(8);
  });

  it('returns 5 for non-dm conversations', () => {
    expect(getConversationWeight('eng-backend')).toBe(5);
  });

  it('returns 5 for named conversations', () => {
    const agent = makeAgent('eng-1');
    expect(getConversationWeight('all-hands', agent)).toBe(5);
  });
});

describe('computeRecencyDecay', () => {
  it('returns 10 for messages from right now', () => {
    const now = new Date();
    expect(computeRecencyDecay(now)).toBe(10);
  });

  it('returns ~5 for messages from 12 hours ago', () => {
    const twelvHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
    const score = computeRecencyDecay(twelvHoursAgo);
    expect(score).toBeGreaterThanOrEqual(4.5);
    expect(score).toBeLessThanOrEqual(5.5);
  });

  it('returns 0 for messages from 24+ hours ago', () => {
    const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000);
    expect(computeRecencyDecay(yesterday)).toBe(0);
  });

  it('never returns negative values', () => {
    const ancient = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    expect(computeRecencyDecay(ancient)).toBe(0);
  });
});

describe('scoreMessage', () => {
  it('computes weighted score in 0-10 range', () => {
    const agent = makeAgent('eng-1', { reportsTo: makePerson('vp-eng', { id: 2 }) });
    const score = scoreMessage(
      {
        messageId: 'msg-1',
        conversation: 'test-channel',
        sender: 'vp-eng',
        content: 'Important update',
        timestamp: new Date(),
        mentions: ['eng-1'],
        metadata: { urgent: true },
      },
      agent,
      DEFAULT_SCORING_WEIGHTS,
    );
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(10);
  });

  it('scores urgent messages from manager higher than non-urgent from unknown', () => {
    const agent = makeAgent('eng-1', { reportsTo: makePerson('vp-eng', { id: 2 }) });
    const urgentFromManager = scoreMessage(
      {
        messageId: 'msg-1',
        conversation: 'eng-backend',
        sender: 'vp-eng',
        content: 'Deploy fix NOW',
        timestamp: new Date(),
        mentions: ['eng-1'],
        metadata: { urgent: true },
      },
      agent,
      DEFAULT_SCORING_WEIGHTS,
    );
    const normalFromUnknown = scoreMessage(
      {
        messageId: 'msg-2',
        conversation: 'all-hands',
        sender: 'random-person',
        content: 'FYI something happened',
        timestamp: new Date(Date.now() - 20 * 60 * 60 * 1000),
      },
      agent,
      DEFAULT_SCORING_WEIGHTS,
    );
    expect(urgentFromManager).toBeGreaterThan(normalFromUnknown);
  });

  it('respects custom scoring weights', () => {
    const agent = makeAgent('eng-1', { reportsTo: makePerson('vp-eng', { id: 2 }) });
    const mentionHeavy: ScoringWeights = {
      authority: 0.05,
      urgency: 0.05,
      conversation: 0.05,
      recency: 0.05,
      mention: 0.80,
    };
    const withMention = scoreMessage(
      {
        messageId: 'msg-1',
        conversation: 'all-hands',
        sender: 'random',
        content: 'Hey @eng-1',
        timestamp: new Date(),
        mentions: ['eng-1'],
      },
      agent,
      mentionHeavy,
    );
    const withoutMention = scoreMessage(
      {
        messageId: 'msg-2',
        conversation: 'all-hands',
        sender: 'random',
        content: 'General announcement',
        timestamp: new Date(),
      },
      agent,
      mentionHeavy,
    );
    expect(withMention).toBeGreaterThan(withoutMention);
    // With 80% mention weight, difference should be very large
    expect(withMention - withoutMention).toBeGreaterThan(5);
  });

  it('returns sorted scored messages from rankMessages', async () => {
    const { rankMessages } = await import('../../src/gateway/scorer.js');
    const agent = makeAgent('eng-1', { reportsTo: makePerson('vp-eng', { id: 2 }) });
    const messages = [
      {
        messageId: 'msg-low',
        conversation: 'all-hands',
        sender: 'unknown',
        content: 'whatever',
        timestamp: new Date(Date.now() - 23 * 60 * 60 * 1000),
      },
      {
        messageId: 'msg-high',
        conversation: 'test-channel',
        sender: 'vp-eng',
        content: 'Urgent fix needed',
        timestamp: new Date(),
        mentions: ['eng-1'],
        metadata: { urgent: true },
      },
    ];
    const ranked = rankMessages(messages, agent, DEFAULT_SCORING_WEIGHTS);
    expect(ranked[0].messageId).toBe('msg-high');
    expect(ranked[1].messageId).toBe('msg-low');
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });
});
