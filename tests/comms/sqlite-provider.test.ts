import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteCommsProvider } from '../../src/comms/sqlite-provider.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('SqliteCommsProvider', () => {
  let provider: SqliteCommsProvider;
  let dbPath: string;

  beforeEach(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-comms-'));
    dbPath = path.join(tmpDir, 'comms.db');
    provider = new SqliteCommsProvider(dbPath);
  });

  afterEach(() => {
    provider.close();
    // Clean up tmp dir
    const dir = path.dirname(dbPath);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('createChannel', () => {
    it('creates a channel with name and members', async () => {
      const channel = await provider.createChannel('board', ['ceo']);
      expect(channel.name).toBe('board');
      expect(channel.members).toEqual(['ceo']);
      expect(channel.id).toBeDefined();
      expect(channel.createdAt).toBeInstanceOf(Date);
    });

    it('creates a channel without members', async () => {
      const channel = await provider.createChannel('general');
      expect(channel.name).toBe('general');
      expect(channel.members).toEqual([]);
    });

    it('throws when creating duplicate channel name', async () => {
      await provider.createChannel('board', ['ceo']);
      await expect(provider.createChannel('board', ['ceo'])).rejects.toThrow(/already exists/i);
    });
  });

  describe('listChannels', () => {
    it('returns empty list initially', async () => {
      const channels = await provider.listChannels();
      expect(channels).toEqual([]);
    });

    it('returns all created channels', async () => {
      await provider.createChannel('board', ['ceo']);
      await provider.createChannel('all-hands', ['ceo', 'eng-1']);
      const channels = await provider.listChannels();
      expect(channels).toHaveLength(2);
      const names = channels.map(c => c.name);
      expect(names).toContain('board');
      expect(names).toContain('all-hands');
    });
  });

  describe('postMessage', () => {
    it('posts a message to a channel', async () => {
      await provider.createChannel('board', ['ceo']);
      const msg = await provider.postMessage('board', 'super-user', 'Hello CEO');
      expect(msg.id).toBeDefined();
      expect(msg.channel).toBe('board');
      expect(msg.sender).toBe('super-user');
      expect(msg.content).toBe('Hello CEO');
      expect(msg.timestamp).toBeInstanceOf(Date);
    });

    it('posts a threaded reply', async () => {
      await provider.createChannel('board', ['ceo']);
      const parent = await provider.postMessage('board', 'super-user', 'Topic');
      const reply = await provider.postMessage('board', 'ceo', 'Reply', { thread: parent.id });
      expect(reply.thread).toBe(parent.id);
    });

    it('throws when posting to non-existent channel', async () => {
      await expect(
        provider.postMessage('nonexistent', 'user', 'hello'),
      ).rejects.toThrow(/channel.*not found/i);
    });
  });

  describe('readChannel', () => {
    it('reads messages in chronological order', async () => {
      await provider.createChannel('board', ['ceo']);
      await provider.postMessage('board', 'super-user', 'First');
      await provider.postMessage('board', 'ceo', 'Second');
      const messages = await provider.readChannel('board');
      expect(messages).toHaveLength(2);
      expect(messages[0].content).toBe('First');
      expect(messages[1].content).toBe('Second');
    });

    it('respects limit option', async () => {
      await provider.createChannel('board', ['ceo']);
      await provider.postMessage('board', 'user', 'One');
      await provider.postMessage('board', 'user', 'Two');
      await provider.postMessage('board', 'user', 'Three');
      const messages = await provider.readChannel('board', { limit: 2 });
      expect(messages).toHaveLength(2);
      // Should return the 2 most recent, in chronological order
      expect(messages[0].content).toBe('Two');
      expect(messages[1].content).toBe('Three');
    });

    it('respects since option', async () => {
      await provider.createChannel('board', ['ceo']);
      await provider.postMessage('board', 'user', 'Old message');
      const cutoff = new Date();
      // Small delay to ensure timestamp difference
      await new Promise(r => setTimeout(r, 50));
      await provider.postMessage('board', 'user', 'New message');
      const messages = await provider.readChannel('board', { since: cutoff });
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('New message');
    });

    it('returns empty array for channel with no messages', async () => {
      await provider.createChannel('empty', []);
      const messages = await provider.readChannel('empty');
      expect(messages).toEqual([]);
    });
  });

  describe('searchHistory', () => {
    it('finds messages by content keyword', async () => {
      await provider.createChannel('board', ['ceo']);
      await provider.postMessage('board', 'user', 'Deploy the backend service');
      await provider.postMessage('board', 'user', 'Frontend is ready');
      const results = await provider.searchHistory('backend');
      expect(results).toHaveLength(1);
      expect(results[0].content).toContain('backend');
    });

    it('filters by channel', async () => {
      await provider.createChannel('board', ['ceo']);
      await provider.createChannel('engineering', ['eng-1']);
      await provider.postMessage('board', 'user', 'Deploy backend');
      await provider.postMessage('engineering', 'eng-1', 'Deploy backend to staging');
      const results = await provider.searchHistory('backend', { channel: 'engineering' });
      expect(results).toHaveLength(1);
      expect(results[0].channel).toBe('engineering');
    });

    it('filters by sender', async () => {
      await provider.createChannel('board', ['ceo']);
      await provider.postMessage('board', 'super-user', 'Check status');
      await provider.postMessage('board', 'ceo', 'All good');
      const results = await provider.searchHistory('status', { sender: 'super-user' });
      expect(results).toHaveLength(1);
      expect(results[0].sender).toBe('super-user');
    });

    it('returns empty array when no match', async () => {
      await provider.createChannel('board', ['ceo']);
      await provider.postMessage('board', 'user', 'Hello world');
      const results = await provider.searchHistory('zzzznonexistent');
      expect(results).toEqual([]);
    });
  });

  describe('getUnread / markRead', () => {
    it('returns unread messages for an agent', async () => {
      await provider.createChannel('board', ['ceo']);
      await provider.postMessage('board', 'super-user', 'Check this');
      await provider.postMessage('board', 'super-user', 'And this');
      const unread = await provider.getUnread('ceo');
      expect(unread).toHaveLength(2);
    });

    it('does not return messages the agent sent', async () => {
      await provider.createChannel('board', ['ceo']);
      await provider.postMessage('board', 'ceo', 'My own message');
      await provider.postMessage('board', 'super-user', 'From someone else');
      const unread = await provider.getUnread('ceo');
      expect(unread).toHaveLength(1);
      expect(unread[0].sender).toBe('super-user');
    });

    it('marks messages as read', async () => {
      await provider.createChannel('board', ['ceo']);
      const msg1 = await provider.postMessage('board', 'super-user', 'First');
      const msg2 = await provider.postMessage('board', 'super-user', 'Second');
      await provider.markRead('ceo', [msg1.id]);
      const unread = await provider.getUnread('ceo');
      expect(unread).toHaveLength(1);
      expect(unread[0].id).toBe(msg2.id);
    });

    it('markRead is idempotent', async () => {
      await provider.createChannel('board', ['ceo']);
      const msg = await provider.postMessage('board', 'super-user', 'Hello');
      await provider.markRead('ceo', [msg.id]);
      await provider.markRead('ceo', [msg.id]); // second time — no error
      const unread = await provider.getUnread('ceo');
      expect(unread).toHaveLength(0);
    });

    it('only returns messages in channels the agent is a member of', async () => {
      await provider.createChannel('board', ['ceo']);
      await provider.createChannel('engineering', ['eng-1']);
      await provider.postMessage('board', 'super-user', 'For CEO');
      await provider.postMessage('engineering', 'eng-2', 'For eng-1');
      const ceoUnread = await provider.getUnread('ceo');
      expect(ceoUnread).toHaveLength(1);
      expect(ceoUnread[0].content).toBe('For CEO');
      const eng1Unread = await provider.getUnread('eng-1');
      expect(eng1Unread).toHaveLength(1);
      expect(eng1Unread[0].content).toBe('For eng-1');
    });
  });
});
