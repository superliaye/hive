/**
 * E2E test for memory search with realistic data.
 * Uses real embeddings via @huggingface/transformers (slow, ~10s first run).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { MemoryStore } from '../../src/memory/store.js';
import { indexAgent } from '../../src/memory/indexer.js';
import { searchMemory } from '../../src/memory/search.js';

describe('Memory Search E2E', () => {
  let store: MemoryStore;
  let tmpDir: string;
  let agentDir: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-memory-e2e-'));
    agentDir = path.join(tmpDir, 'agent');
    const memoryDir = path.join(agentDir, 'memory');
    fs.mkdirSync(memoryDir, { recursive: true });

    // Write realistic agent memory files
    fs.writeFileSync(path.join(agentDir, 'MEMORY.md'), `# Memory

## Key Decisions
- 2026-03-20: Adopted SQLite for all persistence (comms, audit, state). Rationale: single-file, WAL mode, no external deps.
- 2026-03-21: Chose nomic-embed-text-v1.5 for embeddings. 768-dim, runs locally, good quality for retrieval.
- 2026-03-22: Implemented hybrid BM25 + vector search. Weights: 0.3 text, 0.7 vector. 30-day temporal decay.

## Architecture Notes
- Channel topology: dm:<agent-id> for 1:1, team-<id> for team channels. No #all-hands to avoid N*M scaling.
- Triage pipeline: score → triage (haiku) → classify ACT_NOW/NOTE/QUEUE/IGNORE.
- Memory is per-agent SQLite with FTS5 + sqlite-vec. Each agent has its own store.
`);

    fs.writeFileSync(path.join(memoryDir, '2026-03-22.md'), `# Daily Log: 2026-03-22

- Fixed triage JSON parsing: Claude CLI wraps output in envelope, haiku adds code fences
- Token counting was wrong: only counting input_tokens, missing cache_creation and cache_read
- All timestamps showed "just now" because SQLite UTC datetimes were parsed as local time
- Deployed dashboard with real-time SSE updates for channel activity
- CEO successfully delegated task to platform-eng via hive post
`);

    fs.writeFileSync(path.join(memoryDir, '2026-03-23.md'), `# Daily Log: 2026-03-23

- Added vector memory search using sqlite-vec + nomic-embed-text
- Redesigned channel topology for scale: removed #all-hands, added dm: channels
- Sprint planning: next priority is approval workflow for proposals
- Bug: nonexistent-agent.sqlite gets created as side effect of getStore()
- User requested architecture documentation, created ARCHITECTURE.md
`);

    store = new MemoryStore(path.join(tmpDir, 'test.sqlite'));
    await indexAgent(store, agentDir);
  }, 120_000); // Allow time for model download on first run

  afterAll(() => {
    store.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('has indexed multiple chunks', () => {
    expect(store.chunkCount()).toBeGreaterThanOrEqual(3);
  });

  it('finds SQLite decision when searching for database choice', async () => {
    const results = await searchMemory(store, 'what database did we pick and why');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].text).toContain('SQLite');
  }, 30_000);

  it('finds triage bug when searching for JSON parsing issues', async () => {
    const results = await searchMemory(store, 'JSON parsing triage bug');
    expect(results.length).toBeGreaterThan(0);
    const topTexts = results.slice(0, 2).map(r => r.text).join(' ');
    expect(topTexts).toContain('triage');
  }, 30_000);

  it('finds channel topology when searching for scaling architecture', async () => {
    const results = await searchMemory(store, 'how does the channel system scale');
    expect(results.length).toBeGreaterThan(0);
    const topTexts = results.slice(0, 2).map(r => r.text).join(' ');
    expect(topTexts).toMatch(/channel|topology|dm:|all-hands/i);
  }, 30_000);

  it('finds content from daily logs (not just MEMORY.md)', async () => {
    const results = await searchMemory(store, 'approval workflow proposals sprint planning');
    expect(results.length).toBeGreaterThan(0);
    // This content only exists in the 2026-03-23 daily log
    const allText = results.map(r => r.text).join(' ');
    expect(allText).toContain('approval workflow');
  }, 30_000);

  it('returns different top results for different queries', async () => {
    const dbResults = await searchMemory(store, 'database persistence WAL');
    const bugResults = await searchMemory(store, 'timestamp bug fix UTC');

    expect(dbResults[0].text).not.toBe(bugResults[0].text);
  }, 30_000);

  it('scores are differentiated (not all identical)', async () => {
    const results = await searchMemory(store, 'embedding model selection');
    expect(results.length).toBeGreaterThanOrEqual(2);
    // With enough chunks, scores should NOT all be identical
    const scores = results.map(r => r.score);
    const unique = new Set(scores.map(s => s.toFixed(4)));
    expect(unique.size).toBeGreaterThan(1);
  }, 30_000);
});
