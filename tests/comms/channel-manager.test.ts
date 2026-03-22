import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ChannelManager } from '../../src/comms/channel-manager.js';
import { SqliteCommsProvider } from '../../src/comms/sqlite-provider.js';
import { parseOrgTree } from '../../src/org/parser.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/sample-org');

describe('ChannelManager', () => {
  let provider: SqliteCommsProvider;
  let manager: ChannelManager;
  let dbPath: string;

  beforeEach(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-chanmgr-'));
    dbPath = path.join(tmpDir, 'comms.db');
    provider = new SqliteCommsProvider(dbPath);
    manager = new ChannelManager(provider);
  });

  afterEach(() => {
    provider.close();
    const dir = path.dirname(dbPath);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('syncFromOrgTree', () => {
    it('creates all-hands channel with all agents', async () => {
      const org = await parseOrgTree(FIXTURE_DIR);
      await manager.syncFromOrgTree(org);
      const channels = await provider.listChannels();
      const allHands = channels.find(c => c.name === 'all-hands');
      expect(allHands).toBeDefined();
      expect(allHands!.members.length).toBe(org.agents.size);
    });

    it('creates board channel with CEO only', async () => {
      const org = await parseOrgTree(FIXTURE_DIR);
      await manager.syncFromOrgTree(org);
      const channels = await provider.listChannels();
      const board = channels.find(c => c.name === 'board');
      expect(board).toBeDefined();
      expect(board!.members).toContain('ceo');
    });

    it('creates leadership channel', async () => {
      const org = await parseOrgTree(FIXTURE_DIR);
      await manager.syncFromOrgTree(org);
      const channels = await provider.listChannels();
      const leadership = channels.find(c => c.name === 'leadership');
      expect(leadership).toBeDefined();
      expect(leadership!.members).toContain('ceo');
    });

    it('creates approvals channel', async () => {
      const org = await parseOrgTree(FIXTURE_DIR);
      await manager.syncFromOrgTree(org);
      const channels = await provider.listChannels();
      const approvals = channels.find(c => c.name === 'approvals');
      expect(approvals).toBeDefined();
    });

    it('is idempotent — running twice does not duplicate channels', async () => {
      const org = await parseOrgTree(FIXTURE_DIR);
      await manager.syncFromOrgTree(org);
      await manager.syncFromOrgTree(org);
      const channels = await provider.listChannels();
      const boardChannels = channels.filter(c => c.name === 'board');
      expect(boardChannels).toHaveLength(1);
    });
  });

  describe('ensureChannel', () => {
    it('creates a channel if it does not exist', async () => {
      const channel = await manager.ensureChannel('project-alpha', ['eng-1', 'pm-1']);
      expect(channel.name).toBe('project-alpha');
      expect(channel.members).toContain('eng-1');
    });

    it('returns existing channel without error', async () => {
      await manager.ensureChannel('project-alpha', ['eng-1']);
      const channel = await manager.ensureChannel('project-alpha', ['eng-1', 'pm-1']);
      expect(channel.name).toBe('project-alpha');
    });
  });

  describe('getChannelsForAgent', () => {
    it('returns channels the agent is a member of', async () => {
      const org = await parseOrgTree(FIXTURE_DIR);
      await manager.syncFromOrgTree(org);
      const channels = await manager.getChannelsForAgent('ceo');
      const names = channels.map(c => c.name);
      expect(names).toContain('all-hands');
      expect(names).toContain('board');
      expect(names).toContain('leadership');
    });
  });
});
