# Plan 3: Gateway & Orchestrator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the two-stage triage gateway (deterministic scoring + LLM classification), the agent heartbeat loop (triage-decide-act-post cycle), the orchestrator (schedules all agents' heartbeats), `hive start` / `hive stop` commands, and crash recovery. After this plan, `hive start` wakes the entire org and agents process messages autonomously.

**Architecture:** The gateway scores unread messages deterministically (Stage 1) then classifies them via Claude CLI haiku (Stage 2). The heartbeat loop is a single-invocation cycle: fetch unread, triage, act on ACT_NOW messages via Claude CLI, post results, update state. The orchestrator manages all agents' heartbeat timers using `setInterval`, serializing one invocation per agent at a time. `hive start` boots the orchestrator; `hive stop` signals graceful shutdown.

**Tech Stack:** TypeScript, Node.js 20+, Commander.js, better-sqlite3, child_process (Claude CLI spawning), vitest

**Spec:** `docs/specs/2026-03-22-hive-platform-design.md` — sections "Gateway — Two-Stage Message Triage", "Agent Lifecycle", "Crash Recovery & Resilience", and "Concurrency Control"

---

## File Structure

```
hive/
├── src/
│   ├── cli.ts                          # Updated — wire hive start + hive stop
│   ├── gateway/
│   │   ├── scorer.ts                   # Stage 1: deterministic priority scoring
│   │   ├── triage.ts                   # Stage 2: LLM triage via Claude CLI haiku
│   │   └── types.ts                    # Gateway types (TriageResult, ScoredMessage, etc.)
│   ├── orchestrator/
│   │   ├── orchestrator.ts             # Main orchestrator — schedules heartbeats, manages lifecycle
│   │   ├── heartbeat.ts                # Single heartbeat cycle for one agent
│   │   ├── crash-recovery.ts           # Stale agent detection + cleanup on startup
│   │   └── pid-file.ts                 # PID file management for hive start/stop
│   └── ... (existing files unchanged)
├── tests/
│   ├── gateway/
│   │   ├── scorer.test.ts              # Tests for deterministic scoring
│   │   ├── triage.test.ts              # Tests for LLM triage (mocked Claude CLI)
│   │   └── types.test.ts               # Tests for type validation helpers
│   ├── orchestrator/
│   │   ├── orchestrator.test.ts        # Tests for orchestrator lifecycle
│   │   ├── heartbeat.test.ts           # Tests for heartbeat cycle
│   │   ├── crash-recovery.test.ts      # Tests for stale agent detection
│   │   └── pid-file.test.ts            # Tests for PID file management
│   └── fixtures/
│       └── sample-org/                 # (existing, reused)
└── data/
    └── hive.pid                        # Runtime PID file (gitignored)
```

---

### Task 1: Gateway Types

**Files:**
- Create: `src/gateway/types.ts`

- [ ] **Step 1: Create gateway types**

Create `src/gateway/types.ts`:

```typescript
export type TriageClassification = 'ACT_NOW' | 'QUEUE' | 'NOTE' | 'IGNORE';

export interface ScoredMessage {
  messageId: string;
  channel: string;
  sender: string;
  content: string;
  timestamp: Date;
  score: number;               // 0-10, computed by Stage 1
  mentions?: string[];
  metadata?: Record<string, unknown>;
  thread?: string;
}

export interface TriageResult {
  messageId: string;
  classification: TriageClassification;
  reasoning: string;            // LLM's explanation
  score: number;                // Stage 1 score (preserved for audit)
}

export interface ScoringWeights {
  authority: number;   // Default 0.25 — sender hierarchy weight
  urgency: number;     // Default 0.25 — urgent flag weight
  channel: number;     // Default 0.20 — channel priority weight
  recency: number;     // Default 0.15 — message freshness weight
  mention: number;     // Default 0.15 — direct @mention weight
}

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  authority: 0.25,
  urgency: 0.25,
  channel: 0.20,
  recency: 0.15,
  mention: 0.15,
};

export interface TriageBatchInput {
  messages: ScoredMessage[];
  agentId: string;
  priorities: string;          // Content of PRIORITIES.md
  bureau: string;              // Content of BUREAU.md
}

export interface TriageBatchOutput {
  results: TriageResult[];
}

/**
 * Validate that a string is a valid TriageClassification.
 */
export function isTriageClassification(value: string): value is TriageClassification {
  return ['ACT_NOW', 'QUEUE', 'NOTE', 'IGNORE'].includes(value);
}

/**
 * Parse a triage response from Claude CLI JSON output.
 * Expected format:
 * {
 *   "results": [
 *     { "messageId": "...", "classification": "ACT_NOW", "reasoning": "..." },
 *     ...
 *   ]
 * }
 */
export function parseTriageOutput(json: string): TriageBatchOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`Failed to parse triage output as JSON: ${json.slice(0, 200)}`);
  }

  if (!parsed || typeof parsed !== 'object' || !('results' in parsed)) {
    throw new Error('Triage output missing "results" array');
  }

  const obj = parsed as { results: unknown[] };
  if (!Array.isArray(obj.results)) {
    throw new Error('Triage output "results" is not an array');
  }

  const results: TriageResult[] = obj.results.map((item: any, i: number) => {
    if (!item.messageId || typeof item.messageId !== 'string') {
      throw new Error(`Triage result[${i}] missing messageId`);
    }
    if (!item.classification || !isTriageClassification(item.classification)) {
      throw new Error(`Triage result[${i}] has invalid classification: ${item.classification}`);
    }
    return {
      messageId: item.messageId,
      classification: item.classification,
      reasoning: item.reasoning ?? '',
      score: item.score ?? 0,
    };
  });

  return { results };
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd /Users/superliaye/projects/hive
npx tsx --eval "import './src/gateway/types.js'; console.log('gateway types OK')"
```

- [ ] **Step 3: Commit**

```bash
git add src/gateway/types.ts
git commit -m "feat: add gateway types — ScoredMessage, TriageResult, scoring weights, triage output parser"
```

---

### Task 2: Deterministic Scorer — Tests

**Files:**
- Create: `tests/gateway/scorer.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/gateway/scorer.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests (should fail — scorer.ts doesn't exist yet)**

```bash
cd /Users/superliaye/projects/hive
npx vitest run tests/gateway/scorer.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add tests/gateway/scorer.test.ts
git commit -m "test: add failing tests for deterministic message scorer"
```

---

### Task 3: Deterministic Scorer — Implementation

**Files:**
- Create: `src/gateway/scorer.ts`

- [ ] **Step 1: Implement scorer**

Create `src/gateway/scorer.ts`:

```typescript
import type { AgentConfig } from '../types.js';
import type { ScoredMessage, ScoringWeights } from './types.js';

/**
 * Compute hierarchy-based authority score for a message sender.
 * manager=10, super-user=10, peer=5, report=3, unknown=1
 */
export function getHierarchyScore(
  senderId: string,
  agent: AgentConfig,
  orgAgents?: Map<string, AgentConfig>,
): number {
  // Super user always gets max authority
  if (senderId === 'super-user') return 10;

  // Manager (parent) → highest authority
  if (agent.parentId && senderId === agent.parentId) return 10;

  // Direct report → moderate authority
  if (agent.childIds.includes(senderId)) return 3;

  // Peer detection: same parent
  if (orgAgents && agent.parentId) {
    const sender = orgAgents.get(senderId);
    if (sender && sender.parentId === agent.parentId) return 5;
  }

  return 1;
}

/**
 * Compute channel priority weight.
 * #board=10, #incidents=9, #approvals=7, team=5, #leadership=4, #all-hands=3, unknown=2
 */
export function getChannelWeight(
  channel: string,
  agent?: AgentConfig,
): number {
  const channelWeights: Record<string, number> = {
    'board': 10,
    'incidents': 9,
    'approvals': 7,
    'leadership': 4,
    'all-hands': 3,
  };

  if (channelWeights[channel] !== undefined) return channelWeights[channel];

  // Team channel detection: check if the channel name starts with or contains
  // the agent's parent directory name (team prefix extracted from agent ID).
  // e.g., agent "eng-1" with dir ".../engineering/eng-1" → parent dir "engineering"
  //        matches channel "eng-backend" if channel starts with "eng"
  // We use the longest non-numeric segment of the agent ID as the team prefix.
  if (agent) {
    // Extract team prefix: the agent ID prefix before any trailing numeric suffix
    // e.g., "eng-1" → "eng", "vp-eng" → "vp-eng", "backend-eng-2" → "backend-eng"
    const idParts = agent.id.split('-');
    // Drop trailing numeric parts to get team prefix
    while (idParts.length > 1 && /^\d+$/.test(idParts[idParts.length - 1])) {
      idParts.pop();
    }
    const teamPrefix = idParts.join('-');
    // Match if channel starts with or contains the team prefix (min 3 chars to avoid false positives)
    if (teamPrefix.length >= 3 && (channel.startsWith(teamPrefix) || channel.includes(teamPrefix))) {
      return 5;
    }
  }

  return 2;
}

/**
 * Compute recency decay: 10 = just now, linear decay to 0 over 24 hours.
 */
export function computeRecencyDecay(timestamp: Date): number {
  const ageMs = Date.now() - timestamp.getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  const DECAY_WINDOW_HOURS = 24;

  if (ageHours <= 0) return 10;
  if (ageHours >= DECAY_WINDOW_HOURS) return 0;

  return Math.round((1 - ageHours / DECAY_WINDOW_HOURS) * 10 * 10) / 10;
}

/**
 * Score a single message using the deterministic formula.
 * All components are normalized 0-10; weights sum to 1.0.
 * Final score is 0-10.
 */
export function scoreMessage(
  msg: Omit<ScoredMessage, 'score'>,
  agent: AgentConfig,
  weights: ScoringWeights,
  orgAgents?: Map<string, AgentConfig>,
): number {
  const authority = getHierarchyScore(msg.sender, agent, orgAgents);
  const urgency = msg.metadata?.urgent ? 10 : 0;
  const channel = getChannelWeight(msg.channel, agent);
  const recency = computeRecencyDecay(msg.timestamp);
  const mention = msg.mentions?.includes(agent.id) ? 10 : 0;

  const raw = (authority * weights.authority)
    + (urgency * weights.urgency)
    + (channel * weights.channel)
    + (recency * weights.recency)
    + (mention * weights.mention);

  // Clamp to 0-10 range
  return Math.round(Math.max(0, Math.min(10, raw)) * 100) / 100;
}

/**
 * Rank a batch of messages by score (highest first).
 * Returns ScoredMessage[] with score attached.
 */
export function rankMessages(
  messages: Omit<ScoredMessage, 'score'>[],
  agent: AgentConfig,
  weights: ScoringWeights,
  orgAgents?: Map<string, AgentConfig>,
): ScoredMessage[] {
  return messages
    .map((msg) => ({
      ...msg,
      score: scoreMessage(msg, agent, weights, orgAgents),
    }))
    .sort((a, b) => b.score - a.score);
}
```

- [ ] **Step 2: Run tests (should pass)**

```bash
cd /Users/superliaye/projects/hive
npx vitest run tests/gateway/scorer.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/gateway/scorer.ts
git commit -m "feat: implement deterministic message scorer — hierarchy, channel, recency, urgency, mentions"
```

---

### Task 4: LLM Triage — Tests

**Files:**
- Create: `tests/gateway/triage.test.ts`

- [ ] **Step 1: Write failing tests (mock Claude CLI)**

Create `tests/gateway/triage.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ScoredMessage, TriageBatchOutput } from '../../src/gateway/types.js';

// Mock the spawner module so we never invoke real Claude CLI
vi.mock('../../src/agents/spawner.js', () => ({
  spawnClaude: vi.fn(),
  buildClaudeArgs: vi.fn((...args: unknown[]) => ['--mock']),
  buildTriageArgs: vi.fn((prompt: string) => ['--mock-triage']),
}));

import { triageMessages, buildTriagePrompt } from '../../src/gateway/triage.js';
import { spawnClaude } from '../../src/agents/spawner.js';

const mockSpawnClaude = vi.mocked(spawnClaude);

function makeScoredMessage(overrides: Partial<ScoredMessage> = {}): ScoredMessage {
  return {
    messageId: 'msg-1',
    channel: 'eng-backend',
    sender: 'vp-eng',
    content: 'Please review the PR',
    timestamp: new Date('2026-03-22T10:00:00Z'),
    score: 7.5,
    ...overrides,
  };
}

describe('buildTriagePrompt', () => {
  it('includes agent priorities and bureau', () => {
    const prompt = buildTriagePrompt(
      '## Current Sprint\n1. Build API endpoint',
      '## Position\nReports to: VP Eng',
    );
    expect(prompt).toContain('Current Sprint');
    expect(prompt).toContain('Reports to: VP Eng');
  });

  it('includes triage classification instructions', () => {
    const prompt = buildTriagePrompt('priorities', 'bureau');
    expect(prompt).toContain('ACT_NOW');
    expect(prompt).toContain('QUEUE');
    expect(prompt).toContain('NOTE');
    expect(prompt).toContain('IGNORE');
  });

  it('includes JSON output format instructions', () => {
    const prompt = buildTriagePrompt('priorities', 'bureau');
    expect(prompt).toContain('messageId');
    expect(prompt).toContain('classification');
    expect(prompt).toContain('reasoning');
  });
});

describe('triageMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty results for empty message batch', async () => {
    const results = await triageMessages([], {
      agentId: 'eng-1',
      agentDir: '/tmp/org/ceo/engineering/eng-1',
      priorities: 'Build stuff',
      bureau: 'Reports to vp-eng',
    });
    expect(results).toEqual([]);
    expect(mockSpawnClaude).not.toHaveBeenCalled();
  });

  it('invokes Claude CLI with correct args and parses response', async () => {
    const mockResponse: TriageBatchOutput = {
      results: [
        { messageId: 'msg-1', classification: 'ACT_NOW', reasoning: 'PR needs review urgently', score: 7.5 },
        { messageId: 'msg-2', classification: 'IGNORE', reasoning: 'Not relevant', score: 2.0 },
      ],
    };

    mockSpawnClaude.mockResolvedValue({
      stdout: JSON.stringify(mockResponse),
      stderr: '',
      exitCode: 0,
      durationMs: 500,
      tokensIn: 200,
      tokensOut: 100,
    });

    const messages = [
      makeScoredMessage({ messageId: 'msg-1', score: 7.5 }),
      makeScoredMessage({ messageId: 'msg-2', content: 'Random noise', score: 2.0 }),
    ];

    const results = await triageMessages(messages, {
      agentId: 'eng-1',
      agentDir: '/tmp/org/ceo/engineering/eng-1',
      priorities: 'Build API endpoint',
      bureau: 'Reports to vp-eng',
    });

    expect(results).toHaveLength(2);
    expect(results[0].classification).toBe('ACT_NOW');
    expect(results[1].classification).toBe('IGNORE');
    expect(mockSpawnClaude).toHaveBeenCalledOnce();
  });

  it('handles Claude CLI failure gracefully — returns all as QUEUE', async () => {
    mockSpawnClaude.mockResolvedValue({
      stdout: 'not json at all',
      stderr: 'some error',
      exitCode: 1,
      durationMs: 200,
    });

    const messages = [makeScoredMessage()];
    const results = await triageMessages(messages, {
      agentId: 'eng-1',
      agentDir: '/tmp/org/ceo/engineering/eng-1',
      priorities: '',
      bureau: '',
    });

    expect(results).toHaveLength(1);
    expect(results[0].classification).toBe('QUEUE');
    expect(results[0].reasoning).toContain('fallback');
  });

  it('handles malformed JSON from Claude CLI — returns all as QUEUE', async () => {
    mockSpawnClaude.mockResolvedValue({
      stdout: '{"results": "not an array"}',
      stderr: '',
      exitCode: 0,
      durationMs: 300,
    });

    const messages = [makeScoredMessage()];
    const results = await triageMessages(messages, {
      agentId: 'eng-1',
      agentDir: '/tmp/org/ceo/engineering/eng-1',
      priorities: '',
      bureau: '',
    });

    expect(results).toHaveLength(1);
    expect(results[0].classification).toBe('QUEUE');
  });

  it('preserves Stage 1 scores in triage results', async () => {
    mockSpawnClaude.mockResolvedValue({
      stdout: JSON.stringify({
        results: [
          { messageId: 'msg-1', classification: 'ACT_NOW', reasoning: 'urgent' },
        ],
      }),
      stderr: '',
      exitCode: 0,
      durationMs: 100,
    });

    const messages = [makeScoredMessage({ messageId: 'msg-1', score: 8.3 })];
    const results = await triageMessages(messages, {
      agentId: 'eng-1',
      agentDir: '/tmp/org/ceo/engineering/eng-1',
      priorities: '',
      bureau: '',
    });

    expect(results[0].score).toBe(8.3);
  });
});
```

- [ ] **Step 2: Run tests (should fail — triage.ts doesn't exist yet)**

```bash
cd /Users/superliaye/projects/hive
npx vitest run tests/gateway/triage.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add tests/gateway/triage.test.ts
git commit -m "test: add failing tests for LLM triage with mocked Claude CLI"
```

---

### Task 5: LLM Triage — Implementation

**Files:**
- Create: `src/gateway/triage.ts`

- [ ] **Step 1: Implement triage**

Create `src/gateway/triage.ts`:

```typescript
import type { ScoredMessage, TriageResult, TriageBatchOutput } from './types.js';
import { parseTriageOutput } from './types.js';
import { spawnClaude, buildTriageArgs } from '../agents/spawner.js';

export interface TriageOptions {
  agentId: string;
  agentDir: string;
  priorities: string;
  bureau: string;
  timeoutMs?: number;
}

/**
 * Build the system prompt for the triage LLM call.
 * Includes classification instructions, agent context, and expected output format.
 */
export function buildTriagePrompt(priorities: string, bureau: string): string {
  return `You are a message triage assistant. Your job is to classify incoming messages for an agent.

## Agent Context

### Priorities
${priorities}

### Bureau (Organizational Position)
${bureau}

## Classification Rules

Classify each message into exactly one category:

- **ACT_NOW** — Requires immediate attention. The agent should stop current work and address this. Examples: direct requests from manager, urgent incidents, blocking issues, direct @mentions with questions.
- **QUEUE** — Important but not urgent. Add to the agent's backlog for the next work cycle. Examples: new task assignments, non-urgent requests, FYI that needs follow-up.
- **NOTE** — Contains useful information but requires no action. Extract key info for memory. Examples: announcements, status updates from peers, context that may be useful later.
- **IGNORE** — Not relevant to this agent. Mark as read and drop. Examples: messages for other teams, social chatter, duplicate information.

## Output Format

Respond with ONLY a JSON object in this exact format (no markdown, no code fences):

{
  "results": [
    {
      "messageId": "<id of the message>",
      "classification": "ACT_NOW" | "QUEUE" | "NOTE" | "IGNORE",
      "reasoning": "<brief 1-sentence explanation>"
    }
  ]
}

Classify ALL messages in the batch. One entry per message. Use the messageId from each message.`;
}

/**
 * Format scored messages as input for the triage LLM.
 */
function formatMessagesForTriage(messages: ScoredMessage[]): string {
  return JSON.stringify(
    messages.map((m) => ({
      messageId: m.messageId,
      channel: m.channel,
      sender: m.sender,
      content: m.content,
      timestamp: m.timestamp.toISOString(),
      score: m.score,
      mentions: m.mentions ?? [],
      thread: m.thread,
    })),
    null,
    2,
  );
}

/**
 * Create fallback triage results when Claude CLI fails.
 * Defaults all messages to QUEUE so nothing is lost.
 */
function createFallbackResults(messages: ScoredMessage[], reason: string): TriageResult[] {
  return messages.map((m) => ({
    messageId: m.messageId,
    classification: 'QUEUE' as const,
    reasoning: `Triage fallback — ${reason}`,
    score: m.score,
  }));
}

/**
 * Run Stage 2 triage: invoke Claude CLI haiku to classify scored messages.
 *
 * If the message batch is empty, returns immediately.
 * If Claude CLI fails or returns invalid JSON, falls back to QUEUE for all messages.
 */
export async function triageMessages(
  messages: ScoredMessage[],
  opts: TriageOptions,
): Promise<TriageResult[]> {
  if (messages.length === 0) return [];

  const systemPrompt = buildTriagePrompt(opts.priorities, opts.bureau);
  const input = formatMessagesForTriage(messages);
  const args = buildTriageArgs(systemPrompt);

  let result;
  try {
    result = await spawnClaude(args, {
      cwd: opts.agentDir,
      input,
      timeoutMs: opts.timeoutMs ?? 60_000,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'spawn failed';
    return createFallbackResults(messages, reason);
  }

  if (result.exitCode !== 0) {
    return createFallbackResults(messages, `claude exited with code ${result.exitCode}`);
  }

  let parsed: TriageBatchOutput;
  try {
    parsed = parseTriageOutput(result.stdout);
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'parse failed';
    return createFallbackResults(messages, reason);
  }

  // Merge: preserve Stage 1 scores, match by messageId
  const scoreMap = new Map(messages.map((m) => [m.messageId, m.score]));
  return parsed.results.map((r) => ({
    ...r,
    score: scoreMap.get(r.messageId) ?? r.score,
  }));
}
```

- [ ] **Step 2: Run tests (should pass)**

```bash
cd /Users/superliaye/projects/hive
npx vitest run tests/gateway/triage.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/gateway/triage.ts
git commit -m "feat: implement LLM triage — Claude CLI haiku classification with fallback to QUEUE"
```

---

### Task 6: PID File Management — Tests + Implementation

**Files:**
- Create: `tests/orchestrator/pid-file.test.ts`
- Create: `src/orchestrator/pid-file.ts`

- [ ] **Step 1: Write tests**

Create `tests/orchestrator/pid-file.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { PidFile } from '../../src/orchestrator/pid-file.js';

describe('PidFile', () => {
  let tmpDir: string;
  let pidPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-pid-'));
    pidPath = path.join(tmpDir, 'hive.pid');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes current PID to file', () => {
    const pf = new PidFile(pidPath);
    pf.write();
    const content = fs.readFileSync(pidPath, 'utf-8').trim();
    expect(parseInt(content, 10)).toBe(process.pid);
  });

  it('reads existing PID from file', () => {
    fs.writeFileSync(pidPath, '12345\n');
    const pf = new PidFile(pidPath);
    expect(pf.read()).toBe(12345);
  });

  it('returns null when no PID file exists', () => {
    const pf = new PidFile(pidPath);
    expect(pf.read()).toBeNull();
  });

  it('removes PID file', () => {
    const pf = new PidFile(pidPath);
    pf.write();
    expect(fs.existsSync(pidPath)).toBe(true);
    pf.remove();
    expect(fs.existsSync(pidPath)).toBe(false);
  });

  it('detects if existing PID is alive (current process)', () => {
    fs.writeFileSync(pidPath, `${process.pid}\n`);
    const pf = new PidFile(pidPath);
    expect(pf.isRunning()).toBe(true);
  });

  it('detects if existing PID is dead', () => {
    // Use an impossibly high PID that won't exist
    fs.writeFileSync(pidPath, '999999999\n');
    const pf = new PidFile(pidPath);
    expect(pf.isRunning()).toBe(false);
  });

  it('returns false for isRunning when no PID file exists', () => {
    const pf = new PidFile(pidPath);
    expect(pf.isRunning()).toBe(false);
  });
});
```

- [ ] **Step 2: Implement PidFile**

Create `src/orchestrator/pid-file.ts`:

```typescript
import fs from 'fs';
import path from 'path';

/**
 * Manages a PID file for the orchestrator process.
 * Used by `hive start` / `hive stop` to detect if an orchestrator is already running.
 */
export class PidFile {
  constructor(private filePath: string) {}

  /**
   * Write the current process PID to the file.
   */
  write(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.filePath, `${process.pid}\n`);
  }

  /**
   * Read the PID from the file. Returns null if file doesn't exist.
   */
  read(): number | null {
    try {
      const content = fs.readFileSync(this.filePath, 'utf-8').trim();
      const pid = parseInt(content, 10);
      return isNaN(pid) ? null : pid;
    } catch {
      return null;
    }
  }

  /**
   * Remove the PID file.
   */
  remove(): void {
    try {
      fs.unlinkSync(this.filePath);
    } catch {
      // File may not exist — that's fine
    }
  }

  /**
   * Check if the process referenced by the PID file is still running.
   */
  isRunning(): boolean {
    const pid = this.read();
    if (pid === null) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}
```

- [ ] **Step 3: Run tests (should pass)**

```bash
cd /Users/superliaye/projects/hive
npx vitest run tests/orchestrator/pid-file.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/orchestrator/pid-file.ts tests/orchestrator/pid-file.test.ts
git commit -m "feat: add PID file management for orchestrator start/stop detection"
```

---

### Task 7: Crash Recovery — Tests

**Files:**
- Create: `tests/orchestrator/crash-recovery.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/orchestrator/crash-recovery.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { AgentStateStore } from '../../src/state/agent-state.js';
import {
  detectStaleAgents,
  recoverStaleAgents,
  type RecoveryReport,
} from '../../src/orchestrator/crash-recovery.js';

describe('Crash Recovery', () => {
  let tmpDir: string;
  let stateStore: AgentStateStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-crash-'));
    stateStore = new AgentStateStore(path.join(tmpDir, 'orchestrator.db'));
  });

  afterEach(() => {
    stateStore.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('detectStaleAgents', () => {
    it('returns empty array when no agents are in working state', () => {
      stateStore.register('eng-1');
      stateStore.updateStatus('eng-1', 'idle');
      const stale = detectStaleAgents(stateStore);
      expect(stale).toEqual([]);
    });

    it('detects agents with working status but dead PID', () => {
      stateStore.register('eng-1');
      stateStore.updateStatus('eng-1', 'working', { pid: 999999999, currentTask: 'doing stuff' });
      const stale = detectStaleAgents(stateStore);
      expect(stale).toHaveLength(1);
      expect(stale[0].agentId).toBe('eng-1');
    });

    it('does NOT flag agents with working status and live PID', () => {
      stateStore.register('eng-1');
      stateStore.updateStatus('eng-1', 'working', { pid: process.pid, currentTask: 'alive' });
      const stale = detectStaleAgents(stateStore);
      expect(stale).toEqual([]);
    });

    it('detects agents with working status and no PID', () => {
      stateStore.register('eng-1');
      stateStore.updateStatus('eng-1', 'working');
      const stale = detectStaleAgents(stateStore);
      expect(stale).toHaveLength(1);
    });
  });

  describe('recoverStaleAgents', () => {
    it('marks stale agents as errored and returns recovery report', () => {
      stateStore.register('eng-1');
      stateStore.register('eng-2');
      stateStore.updateStatus('eng-1', 'working', { pid: 999999999, currentTask: 'building API' });
      stateStore.updateStatus('eng-2', 'working', { pid: 999999998, currentTask: 'writing tests' });

      const report = recoverStaleAgents(stateStore);

      expect(report.recoveredAgents).toHaveLength(2);
      expect(report.recoveredAgents[0].agentId).toBe('eng-1');
      expect(report.recoveredAgents[0].previousTask).toBe('building API');
      expect(report.recoveredAgents[1].agentId).toBe('eng-2');

      // Verify state was updated
      const eng1 = stateStore.get('eng-1');
      expect(eng1?.status).toBe('errored');
      const eng2 = stateStore.get('eng-2');
      expect(eng2?.status).toBe('errored');
    });

    it('returns empty report when no stale agents exist', () => {
      stateStore.register('eng-1');
      stateStore.updateStatus('eng-1', 'idle');
      const report = recoverStaleAgents(stateStore);
      expect(report.recoveredAgents).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: Run tests (should fail — crash-recovery.ts doesn't exist yet)**

```bash
cd /Users/superliaye/projects/hive
npx vitest run tests/orchestrator/crash-recovery.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add tests/orchestrator/crash-recovery.test.ts
git commit -m "test: add failing tests for crash recovery — stale agent detection and recovery"
```

---

### Task 8: Crash Recovery — Implementation

**Files:**
- Create: `src/orchestrator/crash-recovery.ts`

- [ ] **Step 1: Implement crash recovery**

Create `src/orchestrator/crash-recovery.ts`:

```typescript
import type { AgentState } from '../types.js';
import type { AgentStateStore } from '../state/agent-state.js';

export interface RecoveredAgent {
  agentId: string;
  previousTask?: string;
  previousPid?: number;
}

export interface RecoveryReport {
  recoveredAgents: RecoveredAgent[];
  timestamp: Date;
}

/**
 * Detect agents that are in 'working' state but whose PID is dead.
 * This indicates a dirty shutdown — the Claude CLI process died but the state wasn't cleaned up.
 */
export function detectStaleAgents(stateStore: AgentStateStore): AgentState[] {
  return stateStore.findStale();
}

/**
 * Recover stale agents:
 * 1. Mark each as 'errored' in the state store
 * 2. Return a recovery report for the orchestrator to alert CEO
 *
 * The next heartbeat cycle will re-invoke errored agents normally.
 */
export function recoverStaleAgents(stateStore: AgentStateStore): RecoveryReport {
  const stale = detectStaleAgents(stateStore);
  const recoveredAgents: RecoveredAgent[] = [];

  for (const agent of stale) {
    stateStore.updateStatus(agent.agentId, 'errored', {
      currentTask: `RECOVERED: ${agent.currentTask ?? 'unknown task'}`,
    });

    recoveredAgents.push({
      agentId: agent.agentId,
      previousTask: agent.currentTask,
      previousPid: agent.pid,
    });
  }

  return {
    recoveredAgents,
    timestamp: new Date(),
  };
}

/**
 * Format recovery report as a human-readable message for posting to #incidents.
 */
export function formatRecoveryAlert(report: RecoveryReport): string {
  if (report.recoveredAgents.length === 0) return '';

  const lines = [
    `**Crash Recovery Report** (${report.timestamp.toISOString()})`,
    '',
    `Found ${report.recoveredAgents.length} agent(s) in stale working state after restart:`,
    '',
  ];

  for (const agent of report.recoveredAgents) {
    lines.push(`- **${agent.agentId}**: was working on "${agent.previousTask ?? 'unknown'}" (PID: ${agent.previousPid ?? 'none'})`);
  }

  lines.push('', 'These agents have been marked as errored and will resume on their next heartbeat cycle.');

  return lines.join('\n');
}
```

- [ ] **Step 2: Run tests (should pass)**

```bash
cd /Users/superliaye/projects/hive
npx vitest run tests/orchestrator/crash-recovery.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/orchestrator/crash-recovery.ts
git commit -m "feat: implement crash recovery — detect stale agents, mark errored, generate alert"
```

---

### Task 9: Agent Heartbeat Loop — Tests

**Files:**
- Create: `tests/orchestrator/heartbeat.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/orchestrator/heartbeat.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import type { AgentConfig } from '../../src/types.js';
import type { TriageResult } from '../../src/gateway/types.js';
import { AgentStateStore } from '../../src/state/agent-state.js';

// Mock the spawner — never invoke real Claude CLI
vi.mock('../../src/agents/spawner.js', () => ({
  spawnClaude: vi.fn(),
  buildClaudeArgs: vi.fn(() => ['--mock']),
  buildTriageArgs: vi.fn(() => ['--mock-triage']),
}));

// Mock the triage module
vi.mock('../../src/gateway/triage.js', () => ({
  triageMessages: vi.fn(),
  buildTriagePrompt: vi.fn(() => 'mock triage prompt'),
}));

// Mock the scorer module
vi.mock('../../src/gateway/scorer.js', () => ({
  rankMessages: vi.fn(() => []),
  scoreMessage: vi.fn(() => 5),
  getHierarchyScore: vi.fn(() => 5),
  getChannelWeight: vi.fn(() => 5),
  computeRecencyDecay: vi.fn(() => 5),
}));

import { runHeartbeat, type HeartbeatContext, type HeartbeatResult } from '../../src/orchestrator/heartbeat.js';
import { spawnClaude } from '../../src/agents/spawner.js';
import { triageMessages } from '../../src/gateway/triage.js';
import { rankMessages } from '../../src/gateway/scorer.js';

const mockSpawnClaude = vi.mocked(spawnClaude);
const mockTriageMessages = vi.mocked(triageMessages);
const mockRankMessages = vi.mocked(rankMessages);

function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'eng-1',
    identity: { name: 'Engineer 1', role: 'Backend Engineer', model: 'sonnet', tools: ['Read', 'Write'] },
    dir: '/tmp/org/ceo/engineering/eng-1',
    depth: 2,
    parentId: 'vp-eng',
    childIds: [],
    files: {
      identity: '---\nname: Engineer 1\nrole: Backend Engineer\nmodel: sonnet\ntools: [Read, Write]\n---\n# Identity',
      soul: '# Soul\nPragmatic.',
      bureau: '# Bureau\nReports to: VP Eng',
      priorities: '# Priorities\n1. Build API',
      routine: '# Routine\nHeartbeat every 30min',
      memory: '# Memory',
    },
    ...overrides,
  };
}

describe('runHeartbeat', () => {
  let tmpDir: string;
  let stateStore: AgentStateStore;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-heartbeat-'));
    stateStore = new AgentStateStore(path.join(tmpDir, 'orchestrator.db'));
  });

  afterEach(() => {
    stateStore.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeContext(overrides: Partial<HeartbeatContext> = {}): HeartbeatContext {
    return {
      agent: makeAgent(),
      stateStore,
      getUnread: vi.fn(async () => []),
      markRead: vi.fn(async () => {}),
      postMessage: vi.fn(async () => {}),
      appendToMemory: vi.fn(async () => {}),
      appendToPriorities: vi.fn(async () => {}),
      orgAgents: new Map(),
      ...overrides,
    };
  }

  it('completes a no-op cycle when there are no unread messages', async () => {
    const ctx = makeContext();
    stateStore.register('eng-1');

    const result = await runHeartbeat(ctx);

    expect(result.messagesProcessed).toBe(0);
    expect(result.actNowCount).toBe(0);
    expect(result.queueCount).toBe(0);
    expect(result.noteCount).toBe(0);
    expect(result.ignoreCount).toBe(0);
    expect(result.workPerformed).toBe(false);
    expect(mockSpawnClaude).not.toHaveBeenCalled();
  });

  it('runs full triage cycle: score → triage → process results', async () => {
    const unreadMessages = [
      {
        id: 'msg-1',
        channel: 'eng-backend',
        sender: 'vp-eng',
        content: 'Deploy the fix now',
        timestamp: new Date(),
        metadata: { urgent: true },
      },
      {
        id: 'msg-2',
        channel: 'all-hands',
        sender: 'random',
        content: 'Lunch at noon',
        timestamp: new Date(),
      },
    ];

    mockRankMessages.mockReturnValue([
      { messageId: 'msg-1', channel: 'eng-backend', sender: 'vp-eng', content: 'Deploy the fix now', timestamp: new Date(), score: 8.5, metadata: { urgent: true } },
      { messageId: 'msg-2', channel: 'all-hands', sender: 'random', content: 'Lunch at noon', timestamp: new Date(), score: 2.0 },
    ]);

    const triageResults: TriageResult[] = [
      { messageId: 'msg-1', classification: 'ACT_NOW', reasoning: 'Manager request, urgent', score: 8.5 },
      { messageId: 'msg-2', classification: 'IGNORE', reasoning: 'Social, irrelevant', score: 2.0 },
    ];
    mockTriageMessages.mockResolvedValue(triageResults);

    // Mock the main work Claude CLI call (for ACT_NOW)
    mockSpawnClaude.mockResolvedValue({
      stdout: 'Fix deployed successfully. Updated the config and ran tests.',
      stderr: '',
      exitCode: 0,
      durationMs: 5000,
      tokensIn: 1000,
      tokensOut: 500,
    });

    const mockMarkRead = vi.fn(async () => {});
    const mockPostMessage = vi.fn(async () => {});

    const ctx = makeContext({
      getUnread: vi.fn(async () => unreadMessages),
      markRead: mockMarkRead,
      postMessage: mockPostMessage,
    });
    stateStore.register('eng-1');

    const result = await runHeartbeat(ctx);

    expect(result.messagesProcessed).toBe(2);
    expect(result.actNowCount).toBe(1);
    expect(result.ignoreCount).toBe(1);
    expect(result.workPerformed).toBe(true);

    // Should have invoked Claude CLI for the ACT_NOW message
    expect(mockSpawnClaude).toHaveBeenCalledOnce();

    // Should have marked IGNORE messages as read
    expect(mockMarkRead).toHaveBeenCalledWith('eng-1', ['msg-2']);
  });

  it('handles QUEUE messages by appending to priorities', async () => {
    mockRankMessages.mockReturnValue([
      { messageId: 'msg-1', channel: 'eng-backend', sender: 'peer', content: 'Can you review PR #42?', timestamp: new Date(), score: 5.0 },
    ]);
    mockTriageMessages.mockResolvedValue([
      { messageId: 'msg-1', classification: 'QUEUE', reasoning: 'Non-urgent review request', score: 5.0 },
    ]);

    const mockAppendToPriorities = vi.fn(async () => {});
    const mockMarkRead = vi.fn(async () => {});

    const ctx = makeContext({
      getUnread: vi.fn(async () => [
        { id: 'msg-1', channel: 'eng-backend', sender: 'peer', content: 'Can you review PR #42?', timestamp: new Date() },
      ]),
      markRead: mockMarkRead,
      appendToPriorities: mockAppendToPriorities,
    });
    stateStore.register('eng-1');

    const result = await runHeartbeat(ctx);

    expect(result.queueCount).toBe(1);
    expect(mockAppendToPriorities).toHaveBeenCalledWith(
      'eng-1',
      expect.stringContaining('review PR #42'),
    );
    expect(mockMarkRead).toHaveBeenCalledWith('eng-1', ['msg-1']);
  });

  it('handles NOTE messages by appending to memory', async () => {
    mockRankMessages.mockReturnValue([
      { messageId: 'msg-1', channel: 'all-hands', sender: 'ceo', content: 'Q2 goals announced', timestamp: new Date(), score: 4.0 },
    ]);
    mockTriageMessages.mockResolvedValue([
      { messageId: 'msg-1', classification: 'NOTE', reasoning: 'Useful context for future', score: 4.0 },
    ]);

    const mockAppendToMemory = vi.fn(async () => {});
    const mockMarkRead = vi.fn(async () => {});

    const ctx = makeContext({
      getUnread: vi.fn(async () => [
        { id: 'msg-1', channel: 'all-hands', sender: 'ceo', content: 'Q2 goals announced', timestamp: new Date() },
      ]),
      markRead: mockMarkRead,
      appendToMemory: mockAppendToMemory,
    });
    stateStore.register('eng-1');

    const result = await runHeartbeat(ctx);

    expect(result.noteCount).toBe(1);
    expect(mockAppendToMemory).toHaveBeenCalledWith(
      'eng-1',
      expect.stringContaining('Q2 goals announced'),
    );
    expect(mockMarkRead).toHaveBeenCalledWith('eng-1', ['msg-1']);
  });

  it('updates agent state to working during invocation and back to idle after', async () => {
    mockRankMessages.mockReturnValue([
      { messageId: 'msg-1', channel: 'board', sender: 'ceo', content: 'Do this now', timestamp: new Date(), score: 9.0 },
    ]);
    mockTriageMessages.mockResolvedValue([
      { messageId: 'msg-1', classification: 'ACT_NOW', reasoning: 'CEO order', score: 9.0 },
    ]);
    mockSpawnClaude.mockResolvedValue({
      stdout: 'Done.',
      stderr: '',
      exitCode: 0,
      durationMs: 1000,
    });

    const ctx = makeContext({
      getUnread: vi.fn(async () => [
        { id: 'msg-1', channel: 'board', sender: 'ceo', content: 'Do this now', timestamp: new Date() },
      ]),
    });
    stateStore.register('eng-1');

    await runHeartbeat(ctx);

    // After heartbeat completes, agent should be idle
    const state = stateStore.get('eng-1');
    expect(state?.status).toBe('idle');
  });

  it('skips heartbeat if agent is already working (concurrency guard)', async () => {
    const ctx = makeContext();
    stateStore.register('eng-1');
    stateStore.updateStatus('eng-1', 'working', { pid: process.pid });

    const result = await runHeartbeat(ctx);

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toContain('already working');
  });

  it('handles Claude CLI crash during main work gracefully', async () => {
    mockRankMessages.mockReturnValue([
      { messageId: 'msg-1', channel: 'board', sender: 'ceo', content: 'urgent', timestamp: new Date(), score: 9.0 },
    ]);
    mockTriageMessages.mockResolvedValue([
      { messageId: 'msg-1', classification: 'ACT_NOW', reasoning: 'urgent', score: 9.0 },
    ]);
    mockSpawnClaude.mockRejectedValue(new Error('Claude CLI segfault'));

    const ctx = makeContext({
      getUnread: vi.fn(async () => [
        { id: 'msg-1', channel: 'board', sender: 'ceo', content: 'urgent', timestamp: new Date() },
      ]),
    });
    stateStore.register('eng-1');

    const result = await runHeartbeat(ctx);

    expect(result.error).toBeDefined();
    expect(result.error).toContain('segfault');

    // Agent should be back to idle, not stuck in working
    const state = stateStore.get('eng-1');
    expect(state?.status).toBe('idle');
  });
});
```

- [ ] **Step 2: Run tests (should fail — heartbeat.ts doesn't exist yet)**

```bash
cd /Users/superliaye/projects/hive
npx vitest run tests/orchestrator/heartbeat.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add tests/orchestrator/heartbeat.test.ts
git commit -m "test: add failing tests for agent heartbeat loop — full triage-decide-act cycle"
```

---

### Task 10: Agent Heartbeat Loop — Implementation

**Files:**
- Create: `src/orchestrator/heartbeat.ts`

- [ ] **Step 1: Implement heartbeat loop**

Create `src/orchestrator/heartbeat.ts`:

```typescript
import type { AgentConfig } from '../types.js';
import type { ScoredMessage, TriageResult } from '../gateway/types.js';
import { DEFAULT_SCORING_WEIGHTS } from '../gateway/types.js';
import { rankMessages } from '../gateway/scorer.js';
import { triageMessages } from '../gateway/triage.js';
import { spawnClaude, buildClaudeArgs } from '../agents/spawner.js';
import { assemblePrompt } from '../agents/prompt-assembler.js';
import type { AgentStateStore } from '../state/agent-state.js';

/**
 * Callback interfaces — injected by the orchestrator.
 * The heartbeat doesn't know where messages come from or how to persist.
 */
export interface HeartbeatContext {
  agent: AgentConfig;
  stateStore: AgentStateStore;
  orgAgents: Map<string, AgentConfig>;

  // Comms callbacks — provided by the orchestrator (wrapping ICommsProvider)
  getUnread: (agentId: string) => Promise<UnreadMessage[]>;
  markRead: (agentId: string, messageIds: string[]) => Promise<void>;
  postMessage: (agentId: string, channel: string, content: string, opts?: { thread?: string }) => Promise<void>;

  // File callbacks — provided by the orchestrator
  appendToMemory: (agentId: string, content: string) => Promise<void>;
  appendToPriorities: (agentId: string, content: string) => Promise<void>;
}

export interface UnreadMessage {
  id: string;
  channel: string;
  sender: string;
  content: string;
  timestamp: Date;
  thread?: string;
  metadata?: Record<string, unknown>;
  mentions?: string[];
}

export interface HeartbeatResult {
  agentId: string;
  messagesProcessed: number;
  actNowCount: number;
  queueCount: number;
  noteCount: number;
  ignoreCount: number;
  workPerformed: boolean;
  durationMs: number;
  error?: string;
  skipped?: boolean;
  skipReason?: string;
}

/**
 * Convert an unread message from comms to a ScoredMessage input (without score).
 */
function toScorerInput(msg: UnreadMessage): Omit<ScoredMessage, 'score'> {
  return {
    messageId: msg.id,
    channel: msg.channel,
    sender: msg.sender,
    content: msg.content,
    timestamp: msg.timestamp,
    thread: msg.thread,
    metadata: msg.metadata,
    mentions: msg.mentions,
  };
}

/**
 * Build the work prompt for ACT_NOW messages.
 * Combines the agent's system prompt with the messages that need action.
 */
function buildWorkInput(messages: ScoredMessage[], triageResults: TriageResult[]): string {
  const actNowResults = triageResults.filter(r => r.classification === 'ACT_NOW');
  const actNowMessages = messages.filter(m =>
    actNowResults.some(r => r.messageId === m.messageId)
  );

  const sections = actNowMessages.map(m => {
    const result = actNowResults.find(r => r.messageId === m.messageId);
    return [
      `## Message from @${m.sender} in #${m.channel}`,
      `> ${m.content}`,
      ``,
      `Triage: ${result?.reasoning ?? 'Needs immediate attention'}`,
    ].join('\n');
  });

  return [
    '# Messages Requiring Action',
    '',
    ...sections,
    '',
    '---',
    '',
    'Review the above messages and take appropriate action. Post your response in the relevant channel(s).',
  ].join('\n');
}

/**
 * Run a single heartbeat cycle for one agent.
 *
 * The heartbeat loop:
 * 1. Check agent state — skip if already working (concurrency guard)
 * 2. Fetch unread messages from comms
 * 3. Stage 1: Score messages deterministically
 * 4. Stage 2: Triage via LLM (Claude CLI haiku)
 * 5. Process results:
 *    - ACT_NOW → invoke Claude CLI for main work → post results
 *    - QUEUE → append to PRIORITIES.md
 *    - NOTE → append to memory/today.md
 *    - IGNORE → mark as read
 * 6. Update agent state
 *
 * This is NOT a loop — it's a single invocation that processes one cycle.
 * The orchestrator calls this on a schedule.
 */
export async function runHeartbeat(ctx: HeartbeatContext): Promise<HeartbeatResult> {
  const start = Date.now();
  const { agent, stateStore } = ctx;

  // Concurrency guard: one invocation per agent at a time
  const currentState = stateStore.get(agent.id);
  if (currentState?.status === 'working') {
    return {
      agentId: agent.id,
      messagesProcessed: 0,
      actNowCount: 0,
      queueCount: 0,
      noteCount: 0,
      ignoreCount: 0,
      workPerformed: false,
      durationMs: Date.now() - start,
      skipped: true,
      skipReason: `Agent ${agent.id} is already working (PID: ${currentState.pid})`,
    };
  }

  // Mark heartbeat timestamp
  stateStore.markHeartbeat(agent.id);

  try {
    // Step 1: Fetch unread messages
    const unread = await ctx.getUnread(agent.id);

    if (unread.length === 0) {
      return {
        agentId: agent.id,
        messagesProcessed: 0,
        actNowCount: 0,
        queueCount: 0,
        noteCount: 0,
        ignoreCount: 0,
        workPerformed: false,
        durationMs: Date.now() - start,
      };
    }

    // Step 2: Stage 1 — Deterministic scoring
    const scorerInputs = unread.map(toScorerInput);
    const ranked = rankMessages(scorerInputs, agent, DEFAULT_SCORING_WEIGHTS, ctx.orgAgents);

    // Step 3: Stage 2 — LLM triage
    const triageResults = await triageMessages(ranked, {
      agentId: agent.id,
      agentDir: agent.dir,
      priorities: agent.files.priorities,
      bureau: agent.files.bureau,
    });

    // Step 4: Process results by classification
    const actNow = triageResults.filter(r => r.classification === 'ACT_NOW');
    const queue = triageResults.filter(r => r.classification === 'QUEUE');
    const note = triageResults.filter(r => r.classification === 'NOTE');
    const ignore = triageResults.filter(r => r.classification === 'IGNORE');

    // Process IGNORE — mark as read immediately
    if (ignore.length > 0) {
      await ctx.markRead(agent.id, ignore.map(r => r.messageId));
    }

    // Process NOTE — append to memory, then mark as read
    for (const noteResult of note) {
      const msg = ranked.find(m => m.messageId === noteResult.messageId);
      if (msg) {
        const entry = `- [${msg.timestamp.toISOString()}] @${msg.sender} in #${msg.channel}: ${msg.content.slice(0, 200)}`;
        await ctx.appendToMemory(agent.id, entry);
      }
    }
    if (note.length > 0) {
      await ctx.markRead(agent.id, note.map(r => r.messageId));
    }

    // Process QUEUE — append to priorities, then mark as read
    for (const queueResult of queue) {
      const msg = ranked.find(m => m.messageId === queueResult.messageId);
      if (msg) {
        const entry = `- [QUEUED] ${msg.content.slice(0, 200)} (from @${msg.sender} in #${msg.channel})`;
        await ctx.appendToPriorities(agent.id, entry);
      }
    }
    if (queue.length > 0) {
      await ctx.markRead(agent.id, queue.map(r => r.messageId));
    }

    // Process ACT_NOW — invoke Claude CLI for main work
    let workPerformed = false;
    if (actNow.length > 0) {
      stateStore.updateStatus(agent.id, 'working', { pid: process.pid, currentTask: `Processing ${actNow.length} urgent message(s)` });

      try {
        const systemPrompt = assemblePrompt(agent);
        const workInput = buildWorkInput(ranked, triageResults);

        const args = buildClaudeArgs({
          model: agent.identity.model,
          systemPrompt,
          tools: agent.identity.tools,
        });

        const workResult = await spawnClaude(args, {
          cwd: agent.dir,
          input: workInput,
          timeoutMs: 300_000, // 5 min for main work
        });

        // Post results to ALL channels that had ACT_NOW messages.
        // Group ACT_NOW messages by channel so each channel gets a response.
        if (workResult.exitCode === 0 && workResult.stdout.trim()) {
          const actNowMessages = ranked.filter(m =>
            actNow.some(r => r.messageId === m.messageId)
          );
          // Group by channel
          const byChannel = new Map<string, ScoredMessage[]>();
          for (const msg of actNowMessages) {
            const existing = byChannel.get(msg.channel) ?? [];
            existing.push(msg);
            byChannel.set(msg.channel, existing);
          }
          // Post response to each channel
          for (const [channel, msgs] of byChannel) {
            // Use the thread of the first message in the channel, if any
            const thread = msgs[0].thread;
            await ctx.postMessage(
              agent.id,
              channel,
              workResult.stdout.trim(),
              thread ? { thread } : undefined,
            );
          }
        }

        workPerformed = true;
      } catch (err) {
        // Main work failed — set agent back to idle and report error
        stateStore.updateStatus(agent.id, 'idle');
        return {
          agentId: agent.id,
          messagesProcessed: unread.length,
          actNowCount: actNow.length,
          queueCount: queue.length,
          noteCount: note.length,
          ignoreCount: ignore.length,
          workPerformed: false,
          durationMs: Date.now() - start,
          error: err instanceof Error ? err.message : String(err),
        };
      }

      // Mark ACT_NOW messages as read after processing
      await ctx.markRead(agent.id, actNow.map(r => r.messageId));
    }

    // Return to idle state
    stateStore.updateStatus(agent.id, 'idle');

    return {
      agentId: agent.id,
      messagesProcessed: unread.length,
      actNowCount: actNow.length,
      queueCount: queue.length,
      noteCount: note.length,
      ignoreCount: ignore.length,
      workPerformed,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    // Catch-all: ensure agent doesn't stay stuck in working state
    stateStore.updateStatus(agent.id, 'idle');
    return {
      agentId: agent.id,
      messagesProcessed: 0,
      actNowCount: 0,
      queueCount: 0,
      noteCount: 0,
      ignoreCount: 0,
      workPerformed: false,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
```

- [ ] **Step 2: Run tests (should pass)**

```bash
cd /Users/superliaye/projects/hive
npx vitest run tests/orchestrator/heartbeat.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/orchestrator/heartbeat.ts
git commit -m "feat: implement agent heartbeat loop — triage, classify, act, post results, update state"
```

---

### Task 11: Orchestrator — Tests

**Files:**
- Create: `tests/orchestrator/orchestrator.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/orchestrator/orchestrator.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import type { AgentConfig, OrgChart } from '../../src/types.js';
import { AgentStateStore } from '../../src/state/agent-state.js';

// Mock heartbeat — we test the orchestrator's scheduling, not heartbeat internals
vi.mock('../../src/orchestrator/heartbeat.js', () => ({
  runHeartbeat: vi.fn(async () => ({
    agentId: 'mock',
    messagesProcessed: 0,
    actNowCount: 0,
    queueCount: 0,
    noteCount: 0,
    ignoreCount: 0,
    workPerformed: false,
    durationMs: 10,
  })),
}));

// Mock crash recovery
vi.mock('../../src/orchestrator/crash-recovery.js', () => ({
  recoverStaleAgents: vi.fn(() => ({ recoveredAgents: [], timestamp: new Date() })),
  formatRecoveryAlert: vi.fn(() => ''),
}));

import { Orchestrator, type OrchestratorConfig } from '../../src/orchestrator/orchestrator.js';
import { runHeartbeat } from '../../src/orchestrator/heartbeat.js';
import { recoverStaleAgents } from '../../src/orchestrator/crash-recovery.js';

const mockRunHeartbeat = vi.mocked(runHeartbeat);
const mockRecoverStale = vi.mocked(recoverStaleAgents);

function makeAgent(id: string, overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id,
    identity: { name: id, role: 'Engineer', model: 'sonnet', tools: [] },
    dir: `/tmp/org/${id}`,
    depth: 1,
    parentId: 'ceo',
    childIds: [],
    files: {
      identity: '', soul: '', bureau: '', priorities: '', routine: '', memory: '',
    },
    ...overrides,
  };
}

function makeOrgChart(agents: AgentConfig[]): OrgChart {
  const agentMap = new Map(agents.map(a => [a.id, a]));
  return {
    root: agents[0],
    agents: agentMap,
    channels: [
      { name: 'all-hands', autoGenerated: true, memberIds: agents.map(a => a.id) },
      { name: 'board', autoGenerated: true, memberIds: ['ceo'] },
    ],
  };
}

describe('Orchestrator', () => {
  let tmpDir: string;
  let stateDbPath: string;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-orch-'));
    stateDbPath = path.join(tmpDir, 'orchestrator.db');
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeConfig(overrides: Partial<OrchestratorConfig> = {}): OrchestratorConfig {
    const ceo = makeAgent('ceo', { depth: 0, parentId: null, childIds: ['eng-1'] });
    const eng1 = makeAgent('eng-1', { depth: 1, parentId: 'ceo' });
    return {
      orgChart: makeOrgChart([ceo, eng1]),
      stateDbPath,
      pidFilePath: path.join(tmpDir, 'hive.pid'),
      persistentAgentIds: ['ceo'],
      persistentIntervalMs: 600_000,    // 10 min
      onDemandIntervalMs: 7_200_000,    // 2 hours
      getUnread: vi.fn(async () => []),
      markRead: vi.fn(async () => {}),
      postMessage: vi.fn(async () => {}),
      appendToMemory: vi.fn(async () => {}),
      appendToPriorities: vi.fn(async () => {}),
      ...overrides,
    };
  }

  it('registers all agents in state store on start', async () => {
    const orch = new Orchestrator(makeConfig());
    await orch.start();

    const stateStore = orch.getStateStore();
    expect(stateStore.get('ceo')).toBeDefined();
    expect(stateStore.get('eng-1')).toBeDefined();

    await orch.stop();
  });

  it('runs crash recovery on start', async () => {
    const orch = new Orchestrator(makeConfig());
    await orch.start();

    expect(mockRecoverStale).toHaveBeenCalledOnce();

    await orch.stop();
  });

  it('schedules persistent agents at the configured interval', async () => {
    const config = makeConfig({ persistentIntervalMs: 1000 });
    const orch = new Orchestrator(config);
    await orch.start();

    // Advance time to trigger heartbeat
    await vi.advanceTimersByTimeAsync(1000);

    expect(mockRunHeartbeat).toHaveBeenCalled();
    const calls = mockRunHeartbeat.mock.calls;
    const ceoCall = calls.find(c => c[0].agent.id === 'ceo');
    expect(ceoCall).toBeDefined();

    await orch.stop();
  });

  it('schedules on-demand agents at a longer interval', async () => {
    const config = makeConfig({
      persistentIntervalMs: 1000,
      onDemandIntervalMs: 5000,
    });
    const orch = new Orchestrator(config);
    await orch.start();

    // At 1s, only persistent agents should fire
    await vi.advanceTimersByTimeAsync(1000);
    const callsAt1s = mockRunHeartbeat.mock.calls.length;

    // At 5s, on-demand agents should also fire
    await vi.advanceTimersByTimeAsync(4000);
    const callsAt5s = mockRunHeartbeat.mock.calls.length;

    expect(callsAt5s).toBeGreaterThan(callsAt1s);

    await orch.stop();
  });

  it('stops gracefully — clears all intervals', async () => {
    const orch = new Orchestrator(makeConfig({ persistentIntervalMs: 1000 }));
    await orch.start();
    expect(orch.isRunning()).toBe(true);

    await orch.stop();
    expect(orch.isRunning()).toBe(false);

    // Advance time — no more heartbeats should fire
    const callsBefore = mockRunHeartbeat.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(mockRunHeartbeat.mock.calls.length).toBe(callsBefore);
  });

  it('writes PID file on start and removes on stop', async () => {
    const pidPath = path.join(tmpDir, 'hive.pid');
    const orch = new Orchestrator(makeConfig({ pidFilePath: pidPath }));

    await orch.start();
    expect(fs.existsSync(pidPath)).toBe(true);
    const pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
    expect(pid).toBe(process.pid);

    await orch.stop();
    expect(fs.existsSync(pidPath)).toBe(false);
  });

  it('rejects start if already running', async () => {
    const orch = new Orchestrator(makeConfig());
    await orch.start();

    await expect(orch.start()).rejects.toThrow(/already running/i);

    await orch.stop();
  });

  it('triggerAgent runs an immediate heartbeat for on-demand agents', async () => {
    const orch = new Orchestrator(makeConfig());
    await orch.start();

    await orch.triggerAgent('eng-1');

    const calls = mockRunHeartbeat.mock.calls;
    const eng1Call = calls.find(c => c[0].agent.id === 'eng-1');
    expect(eng1Call).toBeDefined();

    await orch.stop();
  });

  it('waits for in-flight heartbeats on stop', async () => {
    let resolveHeartbeat: () => void;
    const heartbeatPromise = new Promise<void>((resolve) => { resolveHeartbeat = resolve; });

    mockRunHeartbeat.mockImplementationOnce(async (ctx) => {
      await heartbeatPromise;
      return {
        agentId: ctx.agent.id,
        messagesProcessed: 0,
        actNowCount: 0,
        queueCount: 0,
        noteCount: 0,
        ignoreCount: 0,
        workPerformed: false,
        durationMs: 100,
      };
    });

    const config = makeConfig({ persistentIntervalMs: 100 });
    const orch = new Orchestrator(config);
    await orch.start();

    // Trigger a heartbeat
    await vi.advanceTimersByTimeAsync(100);

    // Start stop — should wait for in-flight
    const stopPromise = orch.stop();
    let stopped = false;
    stopPromise.then(() => { stopped = true; });

    // Not yet stopped — heartbeat still running
    await vi.advanceTimersByTimeAsync(10);
    expect(stopped).toBe(false);

    // Resolve the heartbeat
    resolveHeartbeat!();
    await stopPromise;

    expect(stopped).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests (should fail — orchestrator.ts doesn't exist yet)**

```bash
cd /Users/superliaye/projects/hive
npx vitest run tests/orchestrator/orchestrator.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add tests/orchestrator/orchestrator.test.ts
git commit -m "test: add failing tests for orchestrator — scheduling, start/stop, crash recovery, trigger"
```

---

### Task 12: Orchestrator — Implementation

**Files:**
- Create: `src/orchestrator/orchestrator.ts`

- [ ] **Step 1: Implement orchestrator**

Create `src/orchestrator/orchestrator.ts`:

```typescript
import type { AgentConfig, OrgChart } from '../types.js';
import { AgentStateStore } from '../state/agent-state.js';
import { PidFile } from './pid-file.js';
import { recoverStaleAgents, formatRecoveryAlert } from './crash-recovery.js';
import { runHeartbeat, type HeartbeatContext, type HeartbeatResult, type UnreadMessage } from './heartbeat.js';

export interface OrchestratorConfig {
  orgChart: OrgChart;
  stateDbPath: string;
  pidFilePath: string;

  // Agent scheduling
  persistentAgentIds: string[];        // Agent IDs that run on tight heartbeat
  persistentIntervalMs: number;        // e.g., 600_000 (10 min)
  onDemandIntervalMs: number;          // e.g., 7_200_000 (2 hours)

  // Comms callbacks — injected from the CLI layer
  getUnread: (agentId: string) => Promise<UnreadMessage[]>;
  markRead: (agentId: string, messageIds: string[]) => Promise<void>;
  postMessage: (agentId: string, channel: string, content: string, opts?: { thread?: string }) => Promise<void>;

  // File callbacks — injected from the CLI layer
  appendToMemory: (agentId: string, content: string) => Promise<void>;
  appendToPriorities: (agentId: string, content: string) => Promise<void>;
}

/**
 * Crash rate limiter: tracks crash timestamps per agent.
 * If an agent crashes MAX_CRASHES times within WINDOW_MS, it is kept
 * in errored state and heartbeats are skipped until the window expires.
 */
const CRASH_MAX_COUNT = 3;
const CRASH_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

export class Orchestrator {
  private config: OrchestratorConfig;
  private stateStore: AgentStateStore;
  private pidFile: PidFile;
  private running = false;
  private intervals: NodeJS.Timeout[] = [];
  private inFlightHeartbeats: Map<string, Promise<HeartbeatResult>> = new Map();

  /** Crash history: agentId → array of crash timestamps (epoch ms). */
  private crashHistory: Map<string, number[]> = new Map();

  constructor(config: OrchestratorConfig) {
    this.config = config;
    this.stateStore = new AgentStateStore(config.stateDbPath);
    this.pidFile = new PidFile(config.pidFilePath);
  }

  /**
   * Start the orchestrator:
   * 1. Check for duplicate instance
   * 2. Write PID file
   * 3. Register all agents
   * 4. Run crash recovery
   * 5. Schedule heartbeats
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error('Orchestrator is already running');
    }

    // Check if another instance is running
    if (this.pidFile.isRunning()) {
      const existingPid = this.pidFile.read();
      throw new Error(`Another orchestrator is already running (PID: ${existingPid})`);
    }

    // Write PID file
    this.pidFile.write();
    this.running = true;

    // Register all agents in state store
    for (const [id] of this.config.orgChart.agents) {
      this.stateStore.register(id);
    }

    // Run crash recovery
    const report = recoverStaleAgents(this.stateStore);
    if (report.recoveredAgents.length > 0) {
      const alert = formatRecoveryAlert(report);
      if (alert) {
        try {
          await this.config.postMessage('orchestrator', 'incidents', alert);
        } catch {
          // Best-effort alert — don't fail start
        }
      }
    }

    // Schedule heartbeats
    this.scheduleHeartbeats();
  }

  /**
   * Stop the orchestrator:
   * 1. Clear all intervals
   * 2. Wait for in-flight heartbeats to complete
   * 3. Remove PID file
   * 4. Close state store
   */
  async stop(): Promise<void> {
    this.running = false;

    // Clear all scheduled intervals
    for (const interval of this.intervals) {
      clearInterval(interval);
    }
    this.intervals = [];

    // Wait for in-flight heartbeats
    if (this.inFlightHeartbeats.size > 0) {
      await Promise.allSettled(this.inFlightHeartbeats.values());
      this.inFlightHeartbeats.clear();
    }

    // Cleanup
    this.pidFile.remove();
    this.stateStore.close();
  }

  /**
   * Trigger an immediate heartbeat for a specific agent.
   * Used for on-demand agents when a relevant message arrives.
   */
  async triggerAgent(agentId: string): Promise<HeartbeatResult | null> {
    const agent = this.config.orgChart.agents.get(agentId);
    if (!agent) return null;
    return this.executeHeartbeat(agent);
  }

  /**
   * Check if the orchestrator is currently running.
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get the state store (for testing / CLI status commands).
   */
  getStateStore(): AgentStateStore {
    return this.stateStore;
  }

  /**
   * Schedule heartbeats for all agents based on their type (persistent vs on-demand).
   */
  private scheduleHeartbeats(): void {
    const { orgChart, persistentAgentIds, persistentIntervalMs, onDemandIntervalMs } = this.config;

    for (const [id, agent] of orgChart.agents) {
      const isPersistent = persistentAgentIds.includes(id);
      const intervalMs = isPersistent ? persistentIntervalMs : onDemandIntervalMs;

      const interval = setInterval(() => {
        if (!this.running) return;
        this.executeHeartbeat(agent);
      }, intervalMs);

      this.intervals.push(interval);
    }
  }

  /**
   * Record a crash for an agent and check if it has exceeded the rate limit.
   * Returns true if the agent is now rate-limited (should stay errored).
   */
  private recordCrash(agentId: string): boolean {
    const now = Date.now();
    const crashes = this.crashHistory.get(agentId) ?? [];
    crashes.push(now);

    // Prune crashes outside the window
    const recent = crashes.filter(t => now - t < CRASH_WINDOW_MS);
    this.crashHistory.set(agentId, recent);

    return recent.length >= CRASH_MAX_COUNT;
  }

  /**
   * Check whether an agent is currently crash-rate-limited.
   * Returns true if the agent has crashed CRASH_MAX_COUNT+ times within CRASH_WINDOW_MS.
   */
  private isCrashRateLimited(agentId: string): boolean {
    const now = Date.now();
    const crashes = this.crashHistory.get(agentId) ?? [];
    const recent = crashes.filter(t => now - t < CRASH_WINDOW_MS);
    return recent.length >= CRASH_MAX_COUNT;
  }

  /**
   * Execute a single heartbeat for an agent.
   * Tracks the in-flight promise so `stop()` can wait for it.
   * Checks crash history before scheduling — if the agent has crashed 3+ times
   * in 10 minutes, it stays in errored state and the heartbeat is skipped.
   */
  private async executeHeartbeat(agent: AgentConfig): Promise<HeartbeatResult> {
    // If there's already an in-flight heartbeat for this agent, skip
    if (this.inFlightHeartbeats.has(agent.id)) {
      return {
        agentId: agent.id,
        messagesProcessed: 0,
        actNowCount: 0,
        queueCount: 0,
        noteCount: 0,
        ignoreCount: 0,
        workPerformed: false,
        durationMs: 0,
        skipped: true,
        skipReason: `Heartbeat already in-flight for ${agent.id}`,
      };
    }

    // Crash rate limiting: skip if agent has crashed too many times recently
    if (this.isCrashRateLimited(agent.id)) {
      this.stateStore.updateStatus(agent.id, 'errored', {
        currentTask: `Rate-limited: ${CRASH_MAX_COUNT}+ crashes in ${CRASH_WINDOW_MS / 60_000} min`,
      });
      return {
        agentId: agent.id,
        messagesProcessed: 0,
        actNowCount: 0,
        queueCount: 0,
        noteCount: 0,
        ignoreCount: 0,
        workPerformed: false,
        durationMs: 0,
        skipped: true,
        skipReason: `Agent ${agent.id} is crash-rate-limited (${CRASH_MAX_COUNT}+ crashes in ${CRASH_WINDOW_MS / 60_000} min)`,
      };
    }

    const ctx: HeartbeatContext = {
      agent,
      stateStore: this.stateStore,
      orgAgents: this.config.orgChart.agents,
      getUnread: this.config.getUnread,
      markRead: this.config.markRead,
      postMessage: (agentId, channel, content, opts) =>
        this.config.postMessage(agentId, channel, content, opts),
      appendToMemory: this.config.appendToMemory,
      appendToPriorities: this.config.appendToPriorities,
    };

    const heartbeatPromise = runHeartbeat(ctx);
    this.inFlightHeartbeats.set(agent.id, heartbeatPromise);

    try {
      const result = await heartbeatPromise;
      // Track crashes: if the heartbeat returned an error, record it
      if (result.error) {
        const rateLimited = this.recordCrash(agent.id);
        if (rateLimited) {
          this.stateStore.updateStatus(agent.id, 'errored', {
            currentTask: `Rate-limited after ${CRASH_MAX_COUNT} crashes: ${result.error}`,
          });
        }
      }
      return result;
    } finally {
      this.inFlightHeartbeats.delete(agent.id);
    }
  }
}
```

- [ ] **Step 2: Run tests (should pass)**

```bash
cd /Users/superliaye/projects/hive
npx vitest run tests/orchestrator/orchestrator.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add src/orchestrator/orchestrator.ts
git commit -m "feat: implement orchestrator — heartbeat scheduling, start/stop lifecycle, crash recovery"
```

---

### Task 13: Wire `hive start` and `hive stop` CLI Commands — Tests

**Files:**
- Create: `tests/cli/start-stop.test.ts`

- [ ] **Step 1: Write tests**

Create `tests/cli/start-stop.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the orchestrator module
vi.mock('../../src/orchestrator/orchestrator.js', () => {
  const mockStart = vi.fn(async () => {});
  const mockStop = vi.fn(async () => {});
  const mockIsRunning = vi.fn(() => false);

  return {
    Orchestrator: vi.fn().mockImplementation(() => ({
      start: mockStart,
      stop: mockStop,
      isRunning: mockIsRunning,
      getStateStore: vi.fn(() => ({
        listAll: vi.fn(() => []),
        close: vi.fn(),
      })),
    })),
    __mockStart: mockStart,
    __mockStop: mockStop,
    __mockIsRunning: mockIsRunning,
  };
});

// Mock the org parser
vi.mock('../../src/org/parser.js', () => ({
  parseOrgTree: vi.fn(async () => ({
    root: { id: 'ceo', identity: { name: 'CEO' }, childIds: [] },
    agents: new Map([['ceo', { id: 'ceo', identity: { name: 'CEO' }, childIds: [], files: { routine: '' } }]]),
    channels: [],
  })),
}));

// Mock the PidFile
vi.mock('../../src/orchestrator/pid-file.js', () => ({
  PidFile: vi.fn().mockImplementation(() => ({
    isRunning: vi.fn(() => false),
    read: vi.fn(() => null),
    write: vi.fn(),
    remove: vi.fn(),
  })),
}));

import {
  buildStartConfig,
  parseAgentScheduleType,
} from '../../src/orchestrator/cli-helpers.js';

describe('CLI Helpers', () => {
  describe('parseAgentScheduleType', () => {
    it('classifies CEO as persistent', () => {
      expect(parseAgentScheduleType({
        id: 'ceo',
        depth: 0,
        files: { routine: '## Heartbeat (every 10min)\nCheck #board' },
      } as any)).toBe('persistent');
    });

    it('classifies depth-0 agents as persistent by default', () => {
      expect(parseAgentScheduleType({
        id: 'ceo',
        depth: 0,
        files: { routine: '' },
      } as any)).toBe('persistent');
    });

    it('classifies depth-1 agents as persistent (VPs)', () => {
      expect(parseAgentScheduleType({
        id: 'vp-eng',
        depth: 1,
        files: { routine: '' },
      } as any)).toBe('persistent');
    });

    it('classifies deep agents as on-demand', () => {
      expect(parseAgentScheduleType({
        id: 'eng-1',
        depth: 2,
        files: { routine: '' },
      } as any)).toBe('on-demand');
    });

    it('classifies agents with explicit on-demand routine as on-demand', () => {
      expect(parseAgentScheduleType({
        id: 'eng-1',
        depth: 1,
        files: { routine: '## Schedule\nType: on-demand' },
      } as any)).toBe('on-demand');
    });
  });
});
```

- [ ] **Step 2: Run tests (should fail — cli-helpers.ts doesn't exist yet)**

```bash
cd /Users/superliaye/projects/hive
npx vitest run tests/cli/start-stop.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add tests/cli/start-stop.test.ts
git commit -m "test: add tests for hive start/stop CLI helpers — agent schedule type parsing"
```

---

### Task 14: Wire `hive start` and `hive stop` CLI Commands — Implementation

**Files:**
- Create: `src/orchestrator/cli-helpers.ts`
- Update: `src/cli.ts`

- [ ] **Step 1: Create CLI helpers**

Create `src/orchestrator/cli-helpers.ts`:

```typescript
import type { AgentConfig, OrgChart } from '../types.js';
import type { OrchestratorConfig } from './orchestrator.js';
import type { UnreadMessage } from './heartbeat.js';
import fs from 'fs/promises';
import path from 'path';

export type ScheduleType = 'persistent' | 'on-demand';

/**
 * Determine if an agent should be persistent or on-demand.
 *
 * Rules:
 * 1. Depth 0-1 (CEO, VPs) → persistent by default
 * 2. ROUTINE.md contains "on-demand" → on-demand regardless of depth
 * 3. ROUTINE.md contains tight heartbeat (< 30min) → persistent
 * 4. All others → on-demand
 */
export function parseAgentScheduleType(agent: AgentConfig): ScheduleType {
  const routine = agent.files.routine.toLowerCase();

  // Explicit override in ROUTINE.md
  if (routine.includes('type: on-demand') || routine.includes('type:on-demand')) {
    return 'on-demand';
  }

  // CEO and VPs are persistent by default
  if (agent.depth <= 1) {
    return 'persistent';
  }

  // Check for tight heartbeat in ROUTINE.md
  const heartbeatMatch = routine.match(/heartbeat\s*\(every\s*(\d+)\s*min/);
  if (heartbeatMatch) {
    const minutes = parseInt(heartbeatMatch[1], 10);
    if (minutes <= 30) return 'persistent';
  }

  return 'on-demand';
}

/**
 * Build an OrchestratorConfig from CLI context.
 * This is the bridge between the CLI layer and the orchestrator.
 */
export function buildStartConfig(opts: {
  orgChart: OrgChart;
  dataDir: string;
  persistentIntervalMs?: number;
  onDemandIntervalMs?: number;
  commsProvider?: {
    getUnread: (agentId: string) => Promise<UnreadMessage[]>;
    markRead: (agentId: string, messageIds: string[]) => Promise<void>;
    postMessage: (agentId: string, channel: string, content: string, opts?: { thread?: string }) => Promise<void>;
  };
}): OrchestratorConfig {
  const { orgChart, dataDir } = opts;

  // Classify agents
  const persistentAgentIds: string[] = [];
  for (const [id, agent] of orgChart.agents) {
    if (parseAgentScheduleType(agent) === 'persistent') {
      persistentAgentIds.push(id);
    }
  }

  // Default comms callbacks (no-op if no provider wired yet)
  const defaultComms = {
    getUnread: async () => [] as UnreadMessage[],
    markRead: async () => {},
    postMessage: async () => {},
  };
  const comms = opts.commsProvider ?? defaultComms;

  return {
    orgChart,
    stateDbPath: path.join(dataDir, 'orchestrator.db'),
    pidFilePath: path.join(dataDir, 'hive.pid'),
    persistentAgentIds,
    persistentIntervalMs: opts.persistentIntervalMs ?? 600_000,    // 10 min default
    onDemandIntervalMs: opts.onDemandIntervalMs ?? 7_200_000,      // 2 hours default
    getUnread: comms.getUnread,
    markRead: comms.markRead,
    postMessage: comms.postMessage,
    appendToMemory: async (agentId: string, content: string) => {
      const agent = orgChart.agents.get(agentId);
      if (!agent) return;
      const today = new Date().toISOString().slice(0, 10);
      const memoryFile = path.join(agent.dir, 'memory', `${today}.md`);
      const memoryDir = path.join(agent.dir, 'memory');
      try {
        await fs.mkdir(memoryDir, { recursive: true });
        await fs.appendFile(memoryFile, `${content}\n`);
      } catch {
        // Best effort
      }
    },
    appendToPriorities: async (agentId: string, content: string) => {
      const agent = orgChart.agents.get(agentId);
      if (!agent) return;
      const prioritiesFile = path.join(agent.dir, 'PRIORITIES.md');
      try {
        const existing = await fs.readFile(prioritiesFile, 'utf-8');
        // Append under "## Backlog" section, or at the end
        if (existing.includes('## Backlog')) {
          const updated = existing.replace('## Backlog', `## Backlog\n${content}`);
          await fs.writeFile(prioritiesFile, updated);
        } else {
          await fs.appendFile(prioritiesFile, `\n## Backlog\n${content}\n`);
        }
      } catch {
        // If file doesn't exist, create it
        await fs.writeFile(prioritiesFile, `# Priorities\n\n## Backlog\n${content}\n`);
      }
    },
  };
}
```

- [ ] **Step 2: Update `src/cli.ts` — wire start and stop commands**

Replace the placeholder `hive start` and `hive stop` commands in `src/cli.ts`:

Replace the `start` command block:

```typescript
program
  .command('start')
  .description('Wake the organization')
  .option('--persistent-interval <ms>', 'Heartbeat interval for persistent agents (ms)', '600000')
  .option('--on-demand-interval <ms>', 'Heartbeat interval for on-demand agents (ms)', '7200000')
  .action(async (opts) => {
    const orgDir = getOrgDir();
    const dataDir = getDataDir();
    const { parseOrgTree } = await import('./org/parser.js');
    const { Orchestrator } = await import('./orchestrator/orchestrator.js');
    const { buildStartConfig } = await import('./orchestrator/cli-helpers.js');
    const { PidFile } = await import('./orchestrator/pid-file.js');

    // Check if already running
    const pidFile = new PidFile(path.join(dataDir, 'hive.pid'));
    if (pidFile.isRunning()) {
      console.error(chalk.red(`Hive is already running (PID: ${pidFile.read()}). Use \`hive stop\` first.`));
      process.exit(1);
    }

    console.log(chalk.blue('Parsing org tree...'));
    const orgChart = await parseOrgTree(orgDir);
    console.log(chalk.dim(`Found ${orgChart.agents.size} agents, ${orgChart.channels.length} channels`));

    // Auto-wire comms provider from SQLite
    const { SqliteCommsProvider } = await import('./comms/sqlite-provider.js');
    const { ChannelManager } = await import('./comms/channel-manager.js');

    const commsDb = path.join(dataDir, 'comms.db');
    const commsProvider = new SqliteCommsProvider(commsDb);
    const channelManager = new ChannelManager(commsProvider);

    // Sync channels from the org tree so all org-defined channels exist in the DB
    await channelManager.syncFromOrgChart(orgChart);

    const config = buildStartConfig({
      orgChart,
      dataDir,
      persistentIntervalMs: parseInt(opts.persistentInterval, 10),
      onDemandIntervalMs: parseInt(opts.onDemandInterval, 10),
      commsProvider: {
        getUnread: (agentId) => commsProvider.getUnread(agentId),
        markRead: (agentId, messageIds) => commsProvider.markRead(agentId, messageIds),
        postMessage: (agentId, channel, content, opts) =>
          commsProvider.postMessage(agentId, channel, content, opts),
      },
    });

    const orchestrator = new Orchestrator(config);
    await orchestrator.start();

    console.log(chalk.green(`Hive started (PID: ${process.pid})`));
    console.log(chalk.dim(`Persistent agents: ${config.persistentAgentIds.join(', ') || 'none'}`));
    console.log(chalk.dim(`On-demand agents: ${Array.from(orgChart.agents.keys()).filter(id => !config.persistentAgentIds.includes(id)).join(', ') || 'none'}`));

    // Keep the process alive
    const shutdown = async (signal: string) => {
      console.log(chalk.yellow(`\nReceived ${signal}. Shutting down gracefully...`));
      await orchestrator.stop();
      console.log(chalk.green('Hive stopped.'));
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  });
```

Replace the `stop` command block:

```typescript
program
  .command('stop')
  .description('Graceful shutdown')
  .action(async () => {
    const dataDir = getDataDir();
    const { PidFile } = await import('./orchestrator/pid-file.js');

    const pidFile = new PidFile(path.join(dataDir, 'hive.pid'));
    const pid = pidFile.read();

    if (!pid) {
      console.log(chalk.yellow('No hive.pid file found. Hive may not be running.'));
      process.exit(0);
    }

    if (!pidFile.isRunning()) {
      console.log(chalk.yellow(`Stale PID file found (PID: ${pid} is dead). Cleaning up.`));
      pidFile.remove();
      process.exit(0);
    }

    console.log(chalk.blue(`Sending SIGTERM to Hive process (PID: ${pid})...`));
    try {
      process.kill(pid, 'SIGTERM');
      console.log(chalk.green('Shutdown signal sent. Hive will stop after completing in-flight work.'));
    } catch (err) {
      console.error(chalk.red(`Failed to send signal: ${err instanceof Error ? err.message : err}`));
      process.exit(1);
    }
  });
```

- [ ] **Step 3: Run all tests**

```bash
cd /Users/superliaye/projects/hive
npx vitest run tests/cli/start-stop.test.ts
npx vitest run tests/orchestrator/
```

- [ ] **Step 4: Commit**

```bash
git add src/orchestrator/cli-helpers.ts src/cli.ts
git commit -m "feat: wire hive start and hive stop CLI commands — orchestrator lifecycle via Commander.js"
```

---

### Task 15: Integration Test — Full Pipeline

**Files:**
- Create: `tests/integration/gateway-orchestrator.test.ts`

- [ ] **Step 1: Write integration test**

Create `tests/integration/gateway-orchestrator.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import type { AgentConfig, OrgChart } from '../../src/types.js';

// Mock Claude CLI — the only external dependency
vi.mock('../../src/agents/spawner.js', () => ({
  spawnClaude: vi.fn(),
  buildClaudeArgs: vi.fn(() => ['--mock']),
  buildTriageArgs: vi.fn(() => ['--mock-triage']),
}));

import { scoreMessage, rankMessages } from '../../src/gateway/scorer.js';
import { DEFAULT_SCORING_WEIGHTS, parseTriageOutput } from '../../src/gateway/types.js';
import { triageMessages } from '../../src/gateway/triage.js';
import { runHeartbeat, type HeartbeatContext, type UnreadMessage } from '../../src/orchestrator/heartbeat.js';
import { Orchestrator, type OrchestratorConfig } from '../../src/orchestrator/orchestrator.js';
import { AgentStateStore } from '../../src/state/agent-state.js';
import { recoverStaleAgents } from '../../src/orchestrator/crash-recovery.js';
import { spawnClaude } from '../../src/agents/spawner.js';

const mockSpawnClaude = vi.mocked(spawnClaude);

function makeAgent(id: string, overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id,
    identity: { name: id, role: 'Engineer', model: 'sonnet', tools: ['Read', 'Write'] },
    dir: `/tmp/org/${id}`,
    depth: id === 'ceo' ? 0 : 1,
    parentId: id === 'ceo' ? null : 'ceo',
    childIds: [],
    files: {
      identity: `---\nname: ${id}\nrole: Engineer\nmodel: sonnet\ntools: [Read, Write]\n---`,
      soul: '# Soul',
      bureau: '# Bureau\nReports to: CEO',
      priorities: '# Priorities\n## Backlog',
      routine: '# Routine',
      memory: '# Memory',
    },
    ...overrides,
  };
}

describe('Gateway + Orchestrator Integration', () => {
  let tmpDir: string;
  let stateStore: AgentStateStore;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-integration-'));
    stateStore = new AgentStateStore(path.join(tmpDir, 'orchestrator.db'));
  });

  afterEach(() => {
    stateStore.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('End-to-end scoring + triage + heartbeat', () => {
    it('processes a batch of messages through the full pipeline', async () => {
      const agent = makeAgent('eng-1', { parentId: 'vp-eng' });
      stateStore.register('eng-1');

      // Stage 1: Score messages
      const messages = [
        { messageId: 'msg-urgent', channel: 'incidents', sender: 'vp-eng', content: 'Production is down!', timestamp: new Date(), metadata: { urgent: true }, mentions: ['eng-1'] },
        { messageId: 'msg-normal', channel: 'eng-backend', sender: 'peer', content: 'Can you review this PR?', timestamp: new Date() },
        { messageId: 'msg-noise', channel: 'all-hands', sender: 'random', content: 'Happy Friday everyone!', timestamp: new Date(Date.now() - 20 * 60 * 60 * 1000) },
      ];

      const ranked = rankMessages(messages, agent, DEFAULT_SCORING_WEIGHTS);

      // Urgent incident from manager with mention should rank highest
      expect(ranked[0].messageId).toBe('msg-urgent');
      expect(ranked[0].score).toBeGreaterThan(7);

      // Stale social message should rank lowest
      expect(ranked[ranked.length - 1].messageId).toBe('msg-noise');

      // Stage 2: Mock triage LLM response
      mockSpawnClaude.mockResolvedValueOnce({
        stdout: JSON.stringify({
          results: [
            { messageId: 'msg-urgent', classification: 'ACT_NOW', reasoning: 'Production incident' },
            { messageId: 'msg-normal', classification: 'QUEUE', reasoning: 'Non-urgent PR review' },
            { messageId: 'msg-noise', classification: 'IGNORE', reasoning: 'Social chatter' },
          ],
        }),
        stderr: '',
        exitCode: 0,
        durationMs: 300,
        tokensIn: 150,
        tokensOut: 80,
      });

      const triageResults = await triageMessages(ranked, {
        agentId: 'eng-1',
        agentDir: agent.dir,
        priorities: agent.files.priorities,
        bureau: agent.files.bureau,
      });

      expect(triageResults).toHaveLength(3);
      expect(triageResults.find(r => r.messageId === 'msg-urgent')?.classification).toBe('ACT_NOW');
      expect(triageResults.find(r => r.messageId === 'msg-normal')?.classification).toBe('QUEUE');
      expect(triageResults.find(r => r.messageId === 'msg-noise')?.classification).toBe('IGNORE');
    });
  });

  describe('Crash recovery integration', () => {
    it('recovers stale agents and resumes normal operation', () => {
      stateStore.register('eng-1');
      stateStore.register('eng-2');
      stateStore.updateStatus('eng-1', 'working', { pid: 999999999, currentTask: 'stuck task' });
      stateStore.updateStatus('eng-2', 'idle');

      const report = recoverStaleAgents(stateStore);

      expect(report.recoveredAgents).toHaveLength(1);
      expect(report.recoveredAgents[0].agentId).toBe('eng-1');

      // eng-1 should be errored, eng-2 should be unchanged
      expect(stateStore.get('eng-1')?.status).toBe('errored');
      expect(stateStore.get('eng-2')?.status).toBe('idle');
    });
  });

  describe('parseTriageOutput edge cases', () => {
    it('handles well-formed output', () => {
      const output = parseTriageOutput(JSON.stringify({
        results: [
          { messageId: 'msg-1', classification: 'ACT_NOW', reasoning: 'important' },
        ],
      }));
      expect(output.results).toHaveLength(1);
      expect(output.results[0].classification).toBe('ACT_NOW');
    });

    it('throws on invalid JSON', () => {
      expect(() => parseTriageOutput('not json')).toThrow(/Failed to parse/);
    });

    it('throws on missing results array', () => {
      expect(() => parseTriageOutput('{"foo": "bar"}')).toThrow(/missing "results"/);
    });

    it('throws on invalid classification', () => {
      expect(() => parseTriageOutput(JSON.stringify({
        results: [{ messageId: 'msg-1', classification: 'INVALID' }],
      }))).toThrow(/invalid classification/);
    });
  });
});
```

- [ ] **Step 2: Run integration tests**

```bash
cd /Users/superliaye/projects/hive
npx vitest run tests/integration/gateway-orchestrator.test.ts
```

- [ ] **Step 3: Run full test suite**

```bash
cd /Users/superliaye/projects/hive
npx vitest run
```

- [ ] **Step 4: Commit**

```bash
git add tests/integration/gateway-orchestrator.test.ts
git commit -m "test: add integration tests for gateway + orchestrator pipeline — scoring, triage, crash recovery"
```

---

### Task 16: Final Verification

- [ ] **Step 1: Verify all new files exist**

```bash
cd /Users/superliaye/projects/hive
ls -la src/gateway/
ls -la src/orchestrator/
ls -la tests/gateway/
ls -la tests/orchestrator/
ls -la tests/integration/gateway-orchestrator.test.ts
```

Expected files:
```
src/gateway/types.ts
src/gateway/scorer.ts
src/gateway/triage.ts
src/orchestrator/pid-file.ts
src/orchestrator/crash-recovery.ts
src/orchestrator/heartbeat.ts
src/orchestrator/orchestrator.ts
src/orchestrator/cli-helpers.ts
tests/gateway/scorer.test.ts
tests/gateway/triage.test.ts
tests/orchestrator/pid-file.test.ts
tests/orchestrator/crash-recovery.test.ts
tests/orchestrator/heartbeat.test.ts
tests/orchestrator/orchestrator.test.ts
tests/cli/start-stop.test.ts
tests/integration/gateway-orchestrator.test.ts
```

- [ ] **Step 2: Run full test suite**

```bash
cd /Users/superliaye/projects/hive
npx vitest run
```

- [ ] **Step 3: Verify compilation**

```bash
cd /Users/superliaye/projects/hive
npx tsx --eval "
import './src/gateway/types.js';
import './src/gateway/scorer.js';
import './src/gateway/triage.js';
import './src/orchestrator/pid-file.js';
import './src/orchestrator/crash-recovery.js';
import './src/orchestrator/heartbeat.js';
import './src/orchestrator/orchestrator.js';
import './src/orchestrator/cli-helpers.js';
console.log('All Plan 3 modules compile OK');
"
```

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: Plan 3 complete — gateway, heartbeat loop, orchestrator, hive start/stop, crash recovery"
```
