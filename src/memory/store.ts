/**
 * Per-agent memory store backed by SQLite with FTS5 + sqlite-vec.
 * Each agent gets its own .sqlite file under data/memory/{agentId}.sqlite.
 */
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { DIMS } from './embedder.js';

export interface Chunk {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  text: string;
  hash: string;
  updatedAt: number; // epoch ms
}

export interface ChunkWithScore extends Chunk {
  score: number;
}

export class MemoryStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    sqliteVec.load(this.db);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY,
        hash TEXT NOT NULL,
        mtime INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        text TEXT NOT NULL,
        hash TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path);
    `);

    // FTS5 virtual table for BM25 text search
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        text,
        id UNINDEXED,
        path UNINDEXED,
        start_line UNINDEXED,
        end_line UNINDEXED
      );
    `);

    // sqlite-vec virtual table for vector similarity
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(
        id TEXT PRIMARY KEY,
        embedding FLOAT[${DIMS}]
      );
    `);
  }

  /** Check if a file needs re-indexing based on content hash. */
  getFileHash(filePath: string): string | null {
    const row = this.db.prepare('SELECT hash FROM files WHERE path = ?').get(filePath) as { hash: string } | undefined;
    return row?.hash ?? null;
  }

  /** Remove all chunks for a given file path. */
  removeFile(filePath: string): void {
    const chunkIds = this.db.prepare('SELECT id FROM chunks WHERE path = ?').all(filePath) as { id: string }[];
    if (chunkIds.length === 0) return;

    const deleteChunks = this.db.prepare('DELETE FROM chunks WHERE path = ?');
    const deleteFts = this.db.prepare('DELETE FROM chunks_fts WHERE id = ?');
    const deleteVec = this.db.prepare('DELETE FROM chunks_vec WHERE id = ?');
    const deleteFile = this.db.prepare('DELETE FROM files WHERE path = ?');

    this.db.transaction(() => {
      for (const { id } of chunkIds) {
        deleteFts.run(id);
        deleteVec.run(id);
      }
      deleteChunks.run(filePath);
      deleteFile.run(filePath);
    })();
  }

  /** Insert chunks for a file along with their embeddings. */
  upsertFile(filePath: string, hash: string, mtime: number, chunks: { id: string; startLine: number; endLine: number; text: string; embedding: Float32Array }[]): void {
    const upsertFileStmt = this.db.prepare(`
      INSERT OR REPLACE INTO files (path, hash, mtime) VALUES (?, ?, ?)
    `);
    const insertChunk = this.db.prepare(`
      INSERT OR REPLACE INTO chunks (id, path, start_line, end_line, text, hash, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertFts = this.db.prepare(`
      INSERT OR REPLACE INTO chunks_fts (id, path, start_line, end_line, text)
      VALUES (?, ?, ?, ?, ?)
    `);
    // vec0 doesn't support OR REPLACE, so delete first
    const deleteVec = this.db.prepare('DELETE FROM chunks_vec WHERE id = ?');
    const insertVec = this.db.prepare(`
      INSERT INTO chunks_vec (id, embedding) VALUES (?, ?)
    `);

    const now = Date.now();

    this.db.transaction(() => {
      // Remove old chunks for this file
      this.removeFile(filePath);

      upsertFileStmt.run(filePath, hash, mtime);

      for (const chunk of chunks) {
        insertChunk.run(chunk.id, filePath, chunk.startLine, chunk.endLine, chunk.text, hash, now);
        insertFts.run(chunk.id, filePath, chunk.startLine, chunk.endLine, chunk.text);
        deleteVec.run(chunk.id);
        insertVec.run(chunk.id, Buffer.from(chunk.embedding.buffer));
      }
    })();
  }

  /** BM25 full-text search. Returns chunk IDs with BM25 scores (lower = more relevant). */
  searchFts(query: string, limit: number = 20): { id: string; score: number }[] {
    // Sanitize: strip FTS5 special characters, keep only words
    const sanitized = query.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!sanitized) return [];
    return this.db.prepare(`
      SELECT id, rank as score FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY rank LIMIT ?
    `).all(sanitized, limit) as { id: string; score: number }[];
  }

  /** Vector similarity search. Returns chunk IDs with L2 distances. */
  searchVec(embedding: Float32Array, limit: number = 20): { id: string; distance: number }[] {
    return this.db.prepare(`
      SELECT id, distance FROM chunks_vec WHERE embedding MATCH ? ORDER BY distance LIMIT ?
    `).all(Buffer.from(embedding.buffer), limit) as { id: string; distance: number }[];
  }

  /** Get a chunk by ID. */
  getChunk(id: string): Chunk | null {
    const row = this.db.prepare('SELECT * FROM chunks WHERE id = ?').get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      path: row.path,
      startLine: row.start_line,
      endLine: row.end_line,
      text: row.text,
      hash: row.hash,
      updatedAt: row.updated_at,
    };
  }

  /** Get multiple chunks by IDs. */
  getChunks(ids: string[]): Map<string, Chunk> {
    const result = new Map<string, Chunk>();
    if (ids.length === 0) return result;
    const stmt = this.db.prepare('SELECT * FROM chunks WHERE id = ?');
    for (const id of ids) {
      const row = stmt.get(id) as any;
      if (row) {
        result.set(id, {
          id: row.id,
          path: row.path,
          startLine: row.start_line,
          endLine: row.end_line,
          text: row.text,
          hash: row.hash,
          updatedAt: row.updated_at,
        });
      }
    }
    return result;
  }

  /** Total number of indexed chunks. */
  chunkCount(): number {
    return (this.db.prepare('SELECT COUNT(*) as c FROM chunks').get() as { c: number }).c;
  }

  /** List all indexed file paths. */
  indexedFiles(): string[] {
    return (this.db.prepare('SELECT path FROM files').all() as { path: string }[]).map(r => r.path);
  }

  close(): void {
    this.db.close();
  }
}
