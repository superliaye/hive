/**
 * Indexes agent memory files (MEMORY.md + memory/*.md) into the per-agent vector store.
 * Chunks markdown by paragraphs, respecting heading boundaries.
 */
import fs from 'fs/promises';
import path from 'path';
import { createHash, randomUUID } from 'crypto';
import { MemoryStore } from './store.js';
import { embedBatch } from './embedder.js';

/** Target chunk size in characters (~100 tokens per 400 chars). */
const CHUNK_CHARS = 1600; // ~400 tokens
const CHUNK_OVERLAP_CHARS = 320; // ~80 tokens

interface RawChunk {
  text: string;
  startLine: number;
  endLine: number;
}

/** Split markdown content into overlapping chunks, breaking at paragraph boundaries. */
export function chunkMarkdown(content: string): RawChunk[] {
  const lines = content.split('\n');
  const chunks: RawChunk[] = [];
  let currentText = '';
  let currentStart = 0;
  let lineIdx = 0;

  function flush() {
    const trimmed = currentText.trim();
    if (trimmed.length > 0) {
      chunks.push({ text: trimmed, startLine: currentStart, endLine: lineIdx - 1 });
    }
  }

  for (lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];

    // Start new chunk on headings if current chunk is substantial
    if (/^#{1,4}\s/.test(line) && currentText.length > CHUNK_OVERLAP_CHARS) {
      flush();
      // Overlap: carry last portion forward
      const overlapStart = Math.max(0, currentText.length - CHUNK_OVERLAP_CHARS);
      currentText = currentText.slice(overlapStart);
      currentStart = Math.max(0, lineIdx - currentText.split('\n').length);
    }

    currentText += line + '\n';

    // Split if chunk exceeds target size (at paragraph boundary)
    if (currentText.length >= CHUNK_CHARS && line.trim() === '') {
      flush();
      const overlapStart = Math.max(0, currentText.length - CHUNK_OVERLAP_CHARS);
      currentText = currentText.slice(overlapStart);
      currentStart = Math.max(0, lineIdx - currentText.split('\n').length);
    }
  }

  flush();
  return chunks;
}

/** Hash file content for change detection. */
function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/** Find all memory files for an agent directory. */
async function findMemoryFiles(agentDir: string): Promise<string[]> {
  const files: string[] = [];

  // MEMORY.md (curated long-term)
  const memoryMd = path.join(agentDir, 'MEMORY.md');
  try {
    await fs.access(memoryMd);
    files.push(memoryMd);
  } catch {}

  // memory/*.md (daily logs)
  const memoryDir = path.join(agentDir, 'memory');
  try {
    const entries = await fs.readdir(memoryDir);
    for (const entry of entries) {
      if (entry.endsWith('.md')) {
        files.push(path.join(memoryDir, entry));
      }
    }
  } catch {}

  return files;
}

/** Index all memory files for an agent, skipping unchanged files. */
export async function indexAgent(store: MemoryStore, agentDir: string, log?: (msg: string) => void): Promise<{ indexed: number; skipped: number; chunks: number }> {
  const files = await findMemoryFiles(agentDir);
  let indexed = 0;
  let skipped = 0;
  let totalChunks = 0;

  for (const filePath of files) {
    const content = await fs.readFile(filePath, 'utf-8');
    const hash = hashContent(content);

    // Skip if unchanged
    if (store.getFileHash(filePath) === hash) {
      skipped++;
      continue;
    }

    const rawChunks = chunkMarkdown(content);
    if (rawChunks.length === 0) {
      skipped++;
      continue;
    }

    log?.(`Indexing ${path.basename(filePath)}: ${rawChunks.length} chunks`);

    // Generate embeddings for all chunks
    const embeddings = await embedBatch(
      rawChunks.map(c => c.text),
      'document',
    );

    const stat = await fs.stat(filePath);
    const preparedChunks = rawChunks.map((c, i) => ({
      id: randomUUID(),
      startLine: c.startLine,
      endLine: c.endLine,
      text: c.text,
      embedding: embeddings[i],
    }));

    store.upsertFile(filePath, hash, stat.mtimeMs, preparedChunks);
    indexed++;
    totalChunks += rawChunks.length;
  }

  // Remove files that no longer exist
  const currentPaths = new Set(files);
  for (const indexed_path of store.indexedFiles()) {
    if (!currentPaths.has(indexed_path)) {
      store.removeFile(indexed_path);
      log?.(`Removed stale: ${path.basename(indexed_path)}`);
    }
  }

  return { indexed, skipped, chunks: totalChunks };
}
