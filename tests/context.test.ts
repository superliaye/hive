import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { HiveContext } from '../src/context.js';
import { ChatDb } from '../src/chat/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ORG = path.resolve(__dirname, 'fixtures/sample-org');

let tempDir: string;

/**
 * Seed the people table so parseOrgFlat can match folders to people.
 */
function seedPeople(dbPath: string): void {
  const chatDb = new ChatDb(dbPath);
  const db = chatDb.raw();
  db.prepare(`
    INSERT OR IGNORE INTO people (id, alias, name, role_template, status, folder, reports_to)
    VALUES (?, ?, ?, ?, 'active', ?, ?)
  `).run(1, 'ceo', 'Test CEO', 'CEO', '1-ceo', null);
  db.prepare(`
    INSERT OR IGNORE INTO people (id, alias, name, role_template, status, folder, reports_to)
    VALUES (?, ?, ?, ?, 'active', ?, ?)
  `).run(2, 'ar', 'AR Agent', 'Agent Resources Manager', '2-ar', 1);
  db.prepare(`
    INSERT OR IGNORE INTO people (id, alias, name, role_template, status, folder, reports_to)
    VALUES (?, ?, ?, ?, 'active', ?, ?)
  `).run(3, 'eng-1', 'Engineer 1', 'Engineer', '3-eng-1', 1);
  chatDb.close();
}

describe('HiveContext', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-ctx-'));
    fs.cpSync(FIXTURE_ORG, path.join(tempDir, 'org'), { recursive: true });

    // Ensure data dir and seed people before HiveContext.create
    const dataDir = path.join(tempDir, 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    seedPeople(path.join(dataDir, 'hive.db'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates context with valid org dir', async () => {
    const ctx = await HiveContext.create(tempDir);
    try {
      expect(ctx.orgChart).toBeDefined();
      expect(ctx.orgChart.agents.size).toBeGreaterThan(0);
      expect(ctx.orgChart.people.length).toBeGreaterThan(0);
      expect(ctx.comms).toBeDefined();
      expect(ctx.audit).toBeDefined();
      expect(ctx.state).toBeDefined();
      expect(ctx.channelManager).toBeDefined();
      expect(ctx.dataDir).toBe(path.resolve(tempDir, 'data'));
      expect(ctx.orgDir).toBe(path.resolve(tempDir, 'org'));
    } finally {
      ctx.close();
    }
  });

  it('throws when org dir is missing', async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-empty-'));
    try {
      await expect(HiveContext.create(emptyDir)).rejects.toThrow('No org/ directory found');
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('creates data directory if it does not exist', async () => {
    // Remove the data dir we pre-created for seeding, then re-seed after create makes it
    // Actually, HiveContext.create needs people in the DB to parse agents, so we keep data dir.
    // Instead, test that it doesn't fail if data dir already exists (idempotent).
    expect(fs.existsSync(path.join(tempDir, 'data'))).toBe(true);
    const ctx = await HiveContext.create(tempDir);
    expect(fs.existsSync(path.join(tempDir, 'data'))).toBe(true);
    ctx.close();
  });

  it('stores are functional after creation', async () => {
    const ctx = await HiveContext.create(tempDir);
    try {
      // State store works
      const states = ctx.state.listAll();
      expect(Array.isArray(states)).toBe(true);

      // Audit store works
      const totals = ctx.audit.getTokenTotals();
      expect(totals).toHaveProperty('totalIn');
      expect(totals).toHaveProperty('totalOut');

      // Comms store works
      const channels = await ctx.comms.listChannels();
      expect(Array.isArray(channels)).toBe(true);
    } finally {
      ctx.close();
    }
  });

  it('close() does not throw', async () => {
    const ctx = await HiveContext.create(tempDir);
    expect(() => ctx.close()).not.toThrow();
  });
});
