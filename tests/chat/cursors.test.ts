import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatDb } from '../../src/chat/db.js';
import { ChannelStore } from '../../src/chat/channels.js';
import { MessageStore } from '../../src/chat/messages.js';
import { CursorStore } from '../../src/chat/cursors.js';

function seedPeople(db: ChatDb) {
  const raw = db.raw();
  raw.prepare("INSERT INTO people (id, alias, name, role_template, status) VALUES (?, ?, ?, ?, 'active')").run(1, 'ceo', 'Chief Executive', 'chief-executive');
  raw.prepare("INSERT INTO people (id, alias, name, role_template, status) VALUES (?, ?, ?, ?, 'active')").run(2, 'alice', 'Alice Engineer', 'software-engineer');
  raw.prepare("INSERT INTO people (id, alias, name, role_template, status) VALUES (?, ?, ?, ?, 'active')").run(3, 'bob', 'Bob QA', 'qa-engineer');
}

describe('CursorStore', () => {
  let tmpDir: string;
  let db: ChatDb;
  let channelStore: ChannelStore;
  let msgStore: MessageStore;
  let cursors: CursorStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-chat-cursors-'));
    db = new ChatDb(path.join(tmpDir, 'org-state.db'));
    seedPeople(db);
    channelStore = new ChannelStore(db);
    msgStore = new MessageStore(db);
    cursors = new CursorStore(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('getUnread', () => {
    it('returns messages after cursor position', () => {
      channelStore.ensureDm(1, 2);
      msgStore.send('dm:1:2', 1, 'msg1');
      msgStore.send('dm:1:2', 1, 'msg2');
      msgStore.send('dm:1:2', 1, 'msg3');

      const unread = cursors.getUnread(2);
      expect(unread).toHaveLength(1);
      expect(unread[0].channelId).toBe('dm:1:2');
      expect(unread[0].messages).toHaveLength(3);
    });

    it('respects cursor advancement', () => {
      channelStore.ensureDm(1, 2);
      msgStore.send('dm:1:2', 1, 'msg1');
      msgStore.send('dm:1:2', 1, 'msg2');

      cursors.ack(2, 'dm:1:2', 2); // ack through msg2

      msgStore.send('dm:1:2', 1, 'msg3');

      const unread = cursors.getUnread(2);
      expect(unread).toHaveLength(1);
      expect(unread[0].messages).toHaveLength(1);
      expect(unread[0].messages[0].content).toBe('msg3');
    });

    it('returns empty when fully caught up', () => {
      channelStore.ensureDm(1, 2);
      msgStore.send('dm:1:2', 1, 'msg1');
      cursors.ack(2, 'dm:1:2', 1);
      const unread = cursors.getUnread(2);
      expect(unread).toHaveLength(0);
    });

    it('groups by channel', () => {
      channelStore.ensureDm(1, 2);
      channelStore.ensureDm(2, 3);
      msgStore.send('dm:1:2', 1, 'from ceo');
      msgStore.send('dm:2:3', 3, 'from bob');

      const unread = cursors.getUnread(2);
      expect(unread).toHaveLength(2);
    });

    it('excludes messages sent by self', () => {
      channelStore.ensureDm(1, 2);
      msgStore.send('dm:1:2', 2, 'my own msg');
      const unread = cursors.getUnread(2);
      expect(unread).toHaveLength(0);
    });
  });

  describe('ack', () => {
    it('advances cursor', () => {
      channelStore.ensureDm(1, 2);
      msgStore.send('dm:1:2', 1, 'msg1');
      msgStore.send('dm:1:2', 1, 'msg2');
      msgStore.send('dm:1:2', 1, 'msg3');

      cursors.ack(2, 'dm:1:2', 2);

      const unread = cursors.getUnread(2);
      expect(unread[0].messages).toHaveLength(1);
      expect(unread[0].messages[0].seq).toBe(3);
    });

    it('is idempotent — acking same seq twice is fine', () => {
      channelStore.ensureDm(1, 2);
      msgStore.send('dm:1:2', 1, 'msg1');
      cursors.ack(2, 'dm:1:2', 1);
      cursors.ack(2, 'dm:1:2', 1);
      const unread = cursors.getUnread(2);
      expect(unread).toHaveLength(0);
    });

    it('does not go backwards', () => {
      channelStore.ensureDm(1, 2);
      msgStore.send('dm:1:2', 1, 'msg1');
      msgStore.send('dm:1:2', 1, 'msg2');
      cursors.ack(2, 'dm:1:2', 2);
      cursors.ack(2, 'dm:1:2', 1);
      const cursor = cursors.getCursor(2, 'dm:1:2');
      expect(cursor).toBe(2);
    });
  });

  describe('getCursor', () => {
    it('returns 0 for uninitialized cursor', () => {
      const cursor = cursors.getCursor(2, 'dm:1:2');
      expect(cursor).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('ack with seq higher than max message seq advances cursor', () => {
      channelStore.ensureDm(1, 2);
      msgStore.send('dm:1:2', 1, 'msg1');
      cursors.ack(2, 'dm:1:2', 999);
      const cursor = cursors.getCursor(2, 'dm:1:2');
      expect(cursor).toBe(999);
      msgStore.send('dm:1:2', 1, 'msg2');
      const unread = cursors.getUnread(2);
      expect(unread).toHaveLength(0);
    });
  });
});
