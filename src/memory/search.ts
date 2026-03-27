/**
 * Hybrid memory search: BM25 (FTS5) + vector (sqlite-vec) + temporal decay.
 * Weights: 0.3 BM25 + 0.7 vector, with 30-day half-life temporal decay.
 */
import { MemoryStore, type ChunkWithScore } from './store.js';
import { embed } from './embedder.js';

const VECTOR_WEIGHT = 0.7;
const TEXT_WEIGHT = 0.3;
const HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const DECAY_LAMBDA = Math.LN2 / HALF_LIFE_MS;

/** Normalize scores to [0, 1] range using min-max normalization. */
function normalizeScores(items: { id: string; score: number }[]): Map<string, number> {
  if (items.length === 0) return new Map();
  const min = Math.min(...items.map(i => i.score));
  const max = Math.max(...items.map(i => i.score));
  const range = max - min || 1;
  const result = new Map<string, number>();
  for (const item of items) {
    // Invert: lower raw score = more relevant = higher normalized score
    result.set(item.id, 1 - (item.score - min) / range);
  }
  return result;
}

/** Temporal decay factor: exponential decay from chunk's last update. */
function temporalDecay(updatedAt: number, now: number): number {
  const age = now - updatedAt;
  return Math.exp(-DECAY_LAMBDA * age);
}

export interface SearchResult {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  score: number;
}

/**
 * Hybrid search over an agent's memory store.
 * Returns top-k results ranked by combined BM25 + vector + temporal decay.
 */
export async function searchMemory(
  store: MemoryStore,
  query: string,
  limit: number = 10,
): Promise<SearchResult[]> {
  const candidateLimit = Math.max(limit * 3, 30);

  // Run BM25 and vector search in parallel
  const queryEmbedding = await embed(query, 'query');
  const [ftsResults, vecResults] = await Promise.all([
    Promise.resolve(store.searchFts(query, candidateLimit)),
    Promise.resolve(store.searchVec(queryEmbedding, candidateLimit)),
  ]);

  // Normalize scores
  const ftsScores = normalizeScores(
    ftsResults.map(r => ({ id: r.id, score: -r.score })) // BM25 rank is negative (lower = better)
  );
  const vecScores = normalizeScores(
    vecResults.map(r => ({ id: r.id, score: r.distance })) // L2 distance (lower = better)
  );

  // Collect all candidate IDs
  const allIds = new Set([...ftsScores.keys(), ...vecScores.keys()]);
  const chunks = store.getChunks([...allIds]);
  const now = Date.now();

  // Compute hybrid scores
  const scored: SearchResult[] = [];
  for (const id of allIds) {
    const chunk = chunks.get(id);
    if (!chunk) continue;

    const textScore = ftsScores.get(id) ?? 0;
    const vectorScore = vecScores.get(id) ?? 0;
    const decay = temporalDecay(chunk.updatedAt, now);
    const hybridScore = (TEXT_WEIGHT * textScore + VECTOR_WEIGHT * vectorScore) * decay;

    scored.push({
      id: chunk.id,
      path: chunk.path,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      text: chunk.text,
      score: hybridScore,
    });
  }

  // Sort by score descending, take top-k
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
