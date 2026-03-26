import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ChannelManager } from '../../src/comms/channel-manager.js';
import { SqliteCommsProvider } from '../../src/comms/sqlite-provider.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

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
      await manager.ensureChannel('all-hands', ['ceo', 'eng-1', 'ar']);
      await manager.ensureChannel('board', ['ceo']);
      const channels = await manager.getChannelsForAgent('ceo');
      const names = channels.map(c => c.name);
      expect(names).toContain('all-hands');
      expect(names).toContain('board');
    });

    it('returns empty array for agent with no channels', async () => {
      const channels = await manager.getChannelsForAgent('nobody');
      expect(channels).toHaveLength(0);
    });
  });
});
