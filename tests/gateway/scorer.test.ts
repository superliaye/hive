import { describe, it, expect } from 'vitest';
import {
  scoreMessage,
  getHierarchyScore,
  getChannelWeight,
  computeRecencyDecay,
} from '../../src/gateway/scorer.js';
import type { AgentConfig } from '../../src/types.js';
import type { ScoringWeights } from '../../src/gateway/types.js';
import { DEFAULT_SCORING_WEIGHTS } from '../../src/gateway/types.js';

function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'ceo',
    identity: { name: 'CEO', role: 'CEO', model: 'sonnet', tools: [] },
    dir: '/tmp/org/ceo',
    depth: 0,
    parentId: null,
    childIds: ['vp-eng'],
    files: {
      identity: '', soul: '', bureau: '', priorities: '', routine: '', memory: '',
    },
    ...overrides,
  };
}

describe('getHierarchyScore', () => {
  it('returns 10 for messages from manager (parentId)', () => {
    const agent = makeAgent({ id: 'vp-eng', parentId: 'ceo' });
    expect(getHierarchyScore('ceo', agent)).toBe(10);
  });

  it('returns 5 for messages from peer (same parent)', () => {
    const agent = makeAgent({ id: 'eng-1', parentId: 'vp-eng' });
    // Peer detection requires orgAgents map — peers share a parent
    expect(getHierarchyScore('eng-2', agent, new Map([
      ['eng-1', makeAgent({ id: 'eng-1', parentId: 'vp-eng' })],
      ['eng-2', makeAgent({ id: 'eng-2', parentId: 'vp-eng' })],
      ['vp-eng', makeAgent({ id: 'vp-eng', parentId: 'ceo', childIds: ['eng-1', 'eng-2'] })],
    ]))).toBe(5);
  });

  it('returns 3 for messages from direct report (childIds)', () => {
    const agent = makeAgent({ id: 'vp-eng', childIds: ['eng-1', 'eng-2'] });
    expect(getHierarchyScore('eng-1', agent)).toBe(3);
  });

  it('returns 1 for messages from unknown sender', () => {
    const agent = makeAgent();
    expect(getHierarchyScore('random-agent', agent)).toBe(1);
  });

  it('returns 10 for super-user sender (always high)', () => {
    const agent = makeAgent();
    expect(getHierarchyScore('super-user', agent)).toBe(10);
  });
});

describe('getChannelWeight', () => {
  it('returns 10 for #board channel', () => {
    expect(getChannelWeight('board')).toBe(10);
  });

  it('returns 9 for #incidents channel', () => {
    expect(getChannelWeight('incidents')).toBe(9);
  });

  it('returns 7 for #approvals channel', () => {
    expect(getChannelWeight('approvals')).toBe(7);
  });

  it('returns 5 for agent team channel', () => {
    const agent = makeAgent({ id: 'eng-1' });
    expect(getChannelWeight('eng-backend', agent)).toBe(5);
  });

  it('returns 3 for #all-hands', () => {
    expect(getChannelWeight('all-hands')).toBe(3);
  });

  it('returns 2 for unknown channels', () => {
    expect(getChannelWeight('random-channel')).toBe(2);
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
    const agent = makeAgent({ id: 'eng-1', parentId: 'vp-eng' });
    const score = scoreMessage(
      {
        messageId: 'msg-1',
        channel: 'board',
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
    const agent = makeAgent({ id: 'eng-1', parentId: 'vp-eng' });
    const urgentFromManager = scoreMessage(
      {
        messageId: 'msg-1',
        channel: 'eng-backend',
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
        channel: 'all-hands',
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
    const agent = makeAgent({ id: 'eng-1', parentId: 'vp-eng' });
    const mentionHeavy: ScoringWeights = {
      authority: 0.05,
      urgency: 0.05,
      channel: 0.05,
      recency: 0.05,
      mention: 0.80,
    };
    const withMention = scoreMessage(
      {
        messageId: 'msg-1',
        channel: 'all-hands',
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
        channel: 'all-hands',
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
    const agent = makeAgent({ id: 'eng-1', parentId: 'vp-eng' });
    const messages = [
      {
        messageId: 'msg-low',
        channel: 'all-hands',
        sender: 'unknown',
        content: 'whatever',
        timestamp: new Date(Date.now() - 23 * 60 * 60 * 1000),
      },
      {
        messageId: 'msg-high',
        channel: 'board',
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
