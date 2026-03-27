import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatDb } from '../../src/chat/db.js';
import { ChannelStore } from '../../src/chat/channels.js';
import { MessageStore } from '../../src/chat/messages.js';
import { CursorStore } from '../../src/chat/cursors.js';
import { ChatAdapter } from '../../src/chat/adapter.js';

describe('ChatAdapter', () => {
  let tmpDir: string;
  let db: ChatDb;
  let channels: ChannelStore;
  let messages: MessageStore;
  let cursors: CursorStore;
  let adapter: ChatAdapter;

  /** Insert a person into the people table. */
  function addPerson(id: number, alias: string, name?: string) {
    db.raw().prepare(
      'INSERT OR IGNORE INTO people (id, alias, name, status) VALUES (?, ?, ?, ?)'
    ).run(id, alias, name ?? alias, 'active');
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-adapter-'));
    db = new ChatDb(path.join(tmpDir, 'test.db'));
    channels = new ChannelStore(db);
    messages = new MessageStore(db);
    cursors = new CursorStore(db);
    // super-user (id=0) is auto-seeded by ChatDb
    addPerson(1, 'ceo', 'CEO');
    addPerson(2, 'cto', 'CTO');
    addPerson(3, 'eng-lead', 'Eng Lead');
    adapter = new ChatAdapter(db, channels, messages, cursors);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ---------- resolveAlias / resolveId ----------

  describe('resolveAlias', () => {
    it('maps alias to person ID', () => {
      expect(adapter.resolveAlias('ceo')).toBe(1);
      expect(adapter.resolveAlias('super-user')).toBe(0);
    });

    it('throws for unknown alias', () => {
      expect(() => adapter.resolveAlias('nobody')).toThrow();
    });
  });

  describe('resolveId', () => {
    it('maps person ID to alias', () => {
      expect(adapter.resolveId(1)).toBe('ceo');
      expect(adapter.resolveId(0)).toBe('super-user');
    });

    it('throws for unknown ID', () => {
      expect(() => adapter.resolveId(999)).toThrow();
    });
  });

  // ---------- refreshPeopleCache ----------

  describe('refreshPeopleCache', () => {
    it('picks up newly added people after refresh', () => {
      expect(() => adapter.resolveAlias('new-hire')).toThrow();
      addPerson(10, 'new-hire', 'New Hire');
      adapter.refreshPeopleCache();
      expect(adapter.resolveAlias('new-hire')).toBe(10);
    });
  });

  // ---------- ensureDm ----------

  describe('ensureDm', () => {
    it('creates a DM channel and returns its id', () => {
      const id = adapter.ensureDm('super-user', 'ceo');
      expect(id).toBe('dm:0:1');
    });

    it('is idempotent — returns same id on second call', () => {
      const id1 = adapter.ensureDm('super-user', 'ceo');
      const id2 = adapter.ensureDm('ceo', 'super-user');
      expect(id1).toBe(id2);
    });

    it('throws for unknown alias', () => {
      expect(() => adapter.ensureDm('super-user', 'ghost')).toThrow();
    });
  });

  // ---------- postMessage ----------

  describe('postMessage', () => {
    it('posts a message and returns synthetic id', () => {
      adapter.ensureDm('super-user', 'ceo');
      const msgId = adapter.postMessage('super-user', 'dm:0:1', 'hello');
      expect(msgId).toBe('dm:0:1:1');
    });

    it('increments seq for subsequent messages', () => {
      adapter.ensureDm('super-user', 'ceo');
      const id1 = adapter.postMessage('super-user', 'dm:0:1', 'first');
      const id2 = adapter.postMessage('ceo', 'dm:0:1', 'second');
      expect(id1).toBe('dm:0:1:1');
      expect(id2).toBe('dm:0:1:2');
    });

    it('throws for unknown sender alias', () => {
      expect(() => adapter.postMessage('ghost', 'dm:0:1', 'hello')).toThrow();
    });
  });

  // ---------- getUnread ----------

  describe('getUnread', () => {
    it('returns empty array when no messages', () => {
      expect(adapter.getUnread('ceo')).toEqual([]);
    });

    it('returns unread messages in daemon UnreadMessage format', () => {
      adapter.ensureDm('super-user', 'ceo');
      adapter.postMessage('super-user', 'dm:0:1', 'hey CEO');

      const unread = adapter.getUnread('ceo');
      expect(unread).toHaveLength(1);
      expect(unread[0].id).toBe('dm:0:1:1');
      expect(unread[0].channel).toBe('dm:0:1');
      expect(unread[0].sender).toBe('super-user');
      expect(unread[0].content).toBe('hey CEO');
      expect(unread[0].timestamp).toBeInstanceOf(Date);
    });

    it('does not return messages sent by the requesting user', () => {
      adapter.ensureDm('super-user', 'ceo');
      adapter.postMessage('ceo', 'dm:0:1', 'my own message');

      const unread = adapter.getUnread('ceo');
      expect(unread).toHaveLength(0);
    });

    it('flattens multiple channels into a single array', () => {
      adapter.ensureDm('super-user', 'ceo');
      adapter.ensureDm('cto', 'ceo');
      adapter.postMessage('super-user', 'dm:0:1', 'from boss');
      adapter.postMessage('cto', 'dm:1:2', 'from cto');

      const unread = adapter.getUnread('ceo');
      expect(unread).toHaveLength(2);
      const senders = unread.map(m => m.sender);
      expect(senders).toContain('super-user');
      expect(senders).toContain('cto');
    });
  });

  // ---------- markRead ----------

  describe('markRead', () => {
    it('advances cursor so messages no longer appear unread', () => {
      adapter.ensureDm('super-user', 'ceo');
      adapter.postMessage('super-user', 'dm:0:1', 'msg1');
      adapter.postMessage('super-user', 'dm:0:1', 'msg2');

      const unread = adapter.getUnread('ceo');
      expect(unread).toHaveLength(2);

      adapter.markRead('ceo', unread.map(m => m.id));
      expect(adapter.getUnread('ceo')).toHaveLength(0);
    });

    it('groups by channel and acks max seq per channel', () => {
      adapter.ensureDm('super-user', 'ceo');
      adapter.ensureDm('cto', 'ceo');
      adapter.postMessage('super-user', 'dm:0:1', 'a');
      adapter.postMessage('super-user', 'dm:0:1', 'b');
      adapter.postMessage('cto', 'dm:1:2', 'c');

      const unread = adapter.getUnread('ceo');
      expect(unread).toHaveLength(3);

      adapter.markRead('ceo', unread.map(m => m.id));
      expect(adapter.getUnread('ceo')).toHaveLength(0);
    });

    it('handles partial ack — only marks specified messages', () => {
      adapter.ensureDm('super-user', 'ceo');
      adapter.postMessage('super-user', 'dm:0:1', 'msg1');
      adapter.postMessage('super-user', 'dm:0:1', 'msg2');

      const unread = adapter.getUnread('ceo');
      // Only mark the first message
      adapter.markRead('ceo', [unread[0].id]);
      const remaining = adapter.getUnread('ceo');
      expect(remaining).toHaveLength(1);
      expect(remaining[0].content).toBe('msg2');
    });
  });

  // ---------- getChannelMembers ----------

  describe('getChannelMembers', () => {
    it('returns member aliases for a DM channel', () => {
      adapter.ensureDm('super-user', 'ceo');
      const members = adapter.getChannelMembers('dm:0:1');
      expect(members.sort()).toEqual(['ceo', 'super-user']);
    });

    it('returns empty array for nonexistent channel', () => {
      expect(adapter.getChannelMembers('dm:99:100')).toEqual([]);
    });
  });

  // ---------- synthetic ID format ----------

  describe('synthetic ID format', () => {
    it('uses {channelId}:{seq} format', () => {
      adapter.ensureDm('cto', 'eng-lead');
      const id = adapter.postMessage('cto', 'dm:2:3', 'hi');
      expect(id).toBe('dm:2:3:1');
    });
  });
});
