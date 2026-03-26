import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from '../../src/memory/store.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('MemoryStore', () => {
  let store: MemoryStore;
  let dbPath: string;

  beforeEach(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-memory-'));
    dbPath = path.join(tmpDir, 'test.sqlite');
    store = new MemoryStore(dbPath);
  });

  afterEach(() => {
    store.close();
    try { fs.unlinkSync(dbPath); } catch {}
  });

  it('starts empty', () => {
    expect(store.chunkCount()).toBe(0);
    expect(store.indexedFiles()).toEqual([]);
  });

  it('inserts and retrieves chunks', () => {
    const embedding = new Float32Array(768).fill(0.1);
    store.upsertFile('/test/file.md', 'abc123', Date.now(), [
      { id: 'chunk-1', startLine: 0, endLine: 10, text: 'Hello world', embedding },
      { id: 'chunk-2', startLine: 11, endLine: 20, text: 'Goodbye world', embedding },
    ]);

    expect(store.chunkCount()).toBe(2);
    expect(store.indexedFiles()).toEqual(['/test/file.md']);

    const chunk = store.getChunk('chunk-1');
    expect(chunk).not.toBeNull();
    expect(chunk!.text).toBe('Hello world');
    expect(chunk!.path).toBe('/test/file.md');
  });

  it('detects unchanged files by hash', () => {
    const embedding = new Float32Array(768).fill(0.1);
    store.upsertFile('/test/file.md', 'abc123', Date.now(), [
      { id: 'chunk-1', startLine: 0, endLine: 10, text: 'Hello', embedding },
    ]);

    expect(store.getFileHash('/test/file.md')).toBe('abc123');
    expect(store.getFileHash('/nonexistent.md')).toBeNull();
  });

  it('replaces chunks on re-index', () => {
    const embedding = new Float32Array(768).fill(0.1);
    store.upsertFile('/test/file.md', 'hash1', Date.now(), [
      { id: 'chunk-old', startLine: 0, endLine: 10, text: 'Old content', embedding },
    ]);
    expect(store.chunkCount()).toBe(1);

    store.upsertFile('/test/file.md', 'hash2', Date.now(), [
      { id: 'chunk-new-1', startLine: 0, endLine: 5, text: 'New content 1', embedding },
      { id: 'chunk-new-2', startLine: 6, endLine: 10, text: 'New content 2', embedding },
    ]);
    expect(store.chunkCount()).toBe(2);
    expect(store.getChunk('chunk-old')).toBeNull();
    expect(store.getChunk('chunk-new-1')!.text).toBe('New content 1');
  });

  it('removes stale files', () => {
    const embedding = new Float32Array(768).fill(0.1);
    store.upsertFile('/test/a.md', 'h1', Date.now(), [
      { id: 'c1', startLine: 0, endLine: 5, text: 'File A', embedding },
    ]);
    store.upsertFile('/test/b.md', 'h2', Date.now(), [
      { id: 'c2', startLine: 0, endLine: 5, text: 'File B', embedding },
    ]);
    expect(store.chunkCount()).toBe(2);

    store.removeFile('/test/a.md');
    expect(store.chunkCount()).toBe(1);
    expect(store.indexedFiles()).toEqual(['/test/b.md']);
  });

  it('FTS search returns matching chunks', () => {
    const embedding = new Float32Array(768).fill(0.1);
    store.upsertFile('/test/file.md', 'h1', Date.now(), [
      { id: 'c1', startLine: 0, endLine: 5, text: 'The quick brown fox jumps over the lazy dog', embedding },
      { id: 'c2', startLine: 6, endLine: 10, text: 'Lorem ipsum dolor sit amet', embedding },
    ]);

    const results = store.searchFts('quick brown fox');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe('c1');
  });

  it('vector search returns nearest chunks', () => {
    const emb1 = new Float32Array(768).fill(0);
    emb1[0] = 1.0; // Point in one direction
    const emb2 = new Float32Array(768).fill(0);
    emb2[1] = 1.0; // Point in another direction

    store.upsertFile('/test/file.md', 'h1', Date.now(), [
      { id: 'c1', startLine: 0, endLine: 5, text: 'Direction A', embedding: emb1 },
      { id: 'c2', startLine: 6, endLine: 10, text: 'Direction B', embedding: emb2 },
    ]);

    // Query near direction A
    const query = new Float32Array(768).fill(0);
    query[0] = 0.9;
    query[1] = 0.1;

    const results = store.searchVec(query, 2);
    expect(results.length).toBe(2);
    expect(results[0].id).toBe('c1'); // Nearest to direction A
    expect(results[0].distance).toBeLessThan(results[1].distance);
  });

  it('getChunks returns multiple chunks by ID', () => {
    const embedding = new Float32Array(768).fill(0.1);
    store.upsertFile('/test/file.md', 'h1', Date.now(), [
      { id: 'c1', startLine: 0, endLine: 5, text: 'Chunk 1', embedding },
      { id: 'c2', startLine: 6, endLine: 10, text: 'Chunk 2', embedding },
      { id: 'c3', startLine: 11, endLine: 15, text: 'Chunk 3', embedding },
    ]);

    const chunks = store.getChunks(['c1', 'c3', 'nonexistent']);
    expect(chunks.size).toBe(2);
    expect(chunks.get('c1')!.text).toBe('Chunk 1');
    expect(chunks.get('c3')!.text).toBe('Chunk 3');
  });
});
