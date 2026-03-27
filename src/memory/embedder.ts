/**
 * Singleton local embedder using nomic-embed-text-v1.5 via transformers.js.
 * Lazy-loads the model on first use (~500MB download on first run).
 */

// Dynamic import to avoid loading WASM at module level
let pipelinePromise: Promise<any> | null = null;

const MODEL_ID = 'nomic-ai/nomic-embed-text-v1.5';
const DIMS = 768;

function getPipeline(): Promise<any> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const { pipeline } = await import('@huggingface/transformers');
      return pipeline('feature-extraction', MODEL_ID, {
        dtype: 'q4',
      });
    })();
  }
  return pipelinePromise;
}

/**
 * Embed a single text string. Prepends "search_document: " for indexing
 * or "search_query: " for queries (nomic-embed convention).
 */
export async function embed(text: string, type: 'document' | 'query'): Promise<Float32Array> {
  const extractor = await getPipeline();
  const prefix = type === 'query' ? 'search_query: ' : 'search_document: ';
  const result = await extractor(prefix + text, { pooling: 'mean', normalize: true });
  return new Float32Array(result.data);
}

/**
 * Embed multiple texts in batch. All must be same type.
 */
export async function embedBatch(texts: string[], type: 'document' | 'query'): Promise<Float32Array[]> {
  const extractor = await getPipeline();
  const prefix = type === 'query' ? 'search_query: ' : 'search_document: ';
  const results: Float32Array[] = [];
  // Process in batches of 32 to avoid OOM
  const BATCH = 32;
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH).map(t => prefix + t);
    for (const input of batch) {
      const result = await extractor(input, { pooling: 'mean', normalize: true });
      results.push(new Float32Array(result.data));
    }
  }
  return results;
}

export { DIMS };
