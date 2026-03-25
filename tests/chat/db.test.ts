import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatDb } from '../../src/chat/db.js';

describe('ChatDb', () => {
  let tmpDir: string;
  let db: ChatDb;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-chat-db-'));
    db = new ChatDb(path.join(tmpDir, 'org-state.db'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates chat tables on init', () => {
    const tables = db.raw()
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain('channels');
    expect(names).toContain('channel_members');
    expect(names).toContain('messages');
    expect(names).toContain('read_cursors');
  });

  it('is idempotent — calling init twice does not error', () => {
    const db2 = new ChatDb(path.join(tmpDir, 'org-state.db'));
    db2.close();
  });

  it('enables WAL mode', () => {
    const result = db.raw().pragma('journal_mode') as { journal_mode: string }[];
    expect(result[0].journal_mode).toBe('wal');
  });

  it('enables foreign keys', () => {
    const result = db.raw().pragma('foreign_keys') as { foreign_keys: number }[];
    expect(result[0].foreign_keys).toBe(1);
  });

  it('seeds super-user in people table if not exists', () => {
    const row = db.raw().prepare('SELECT * FROM people WHERE id = 0').get() as any;
    expect(row).toBeDefined();
    expect(row.alias).toBe('super-user');
  });
});
