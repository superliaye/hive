import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { HiveContext } from '../src/context.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ORG = path.resolve(__dirname, 'fixtures/sample-org');

let tempDir: string;

describe('HiveContext', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-ctx-'));
    fs.cpSync(FIXTURE_ORG, path.join(tempDir, 'org'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates context with valid org dir', async () => {
    const ctx = await HiveContext.create(tempDir);
    try {
      expect(ctx.orgChart).toBeDefined();
      expect(ctx.orgChart.root).toBeDefined();
      expect(ctx.orgChart.agents.size).toBeGreaterThan(0);
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
    expect(fs.existsSync(path.join(tempDir, 'data'))).toBe(false);
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
      expect(channels.length).toBeGreaterThan(0); // channels synced from org tree
    } finally {
      ctx.close();
    }
  });

  it('close() does not throw', async () => {
    const ctx = await HiveContext.create(tempDir);
    expect(() => ctx.close()).not.toThrow();
  });
});
