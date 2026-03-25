import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatDb } from '../../src/chat/db.js';
import { ChannelStore } from '../../src/chat/channels.js';
import { MessageStore } from '../../src/chat/messages.js';

function seedPeople(db: ChatDb) {
  const raw = db.raw();
  raw.prepare("INSERT INTO people (id, alias, name, role_template, status) VALUES (?, ?, ?, ?, 'active')").run(1, 'ceo', 'Chief Executive', 'chief-executive');
  raw.prepare("INSERT INTO people (id, alias, name, role_template, status) VALUES (?, ?, ?, ?, 'active')").run(2, 'alice', 'Alice Engineer', 'software-engineer');
  raw.prepare("INSERT INTO people (id, alias, name, role_template, status) VALUES (?, ?, ?, ?, 'active')").run(3, 'bob', 'Bob QA', 'qa-engineer');
}

describe('MessageStore', () => {
  let tmpDir: string;
  let db: ChatDb;
  let channelStore: ChannelStore;
  let messages: MessageStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-chat-msg-'));
    db = new ChatDb(path.join(tmpDir, 'org-state.db'));
    seedPeople(db);
    channelStore = new ChannelStore(db);
    messages = new MessageStore(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('send', () => {
    it('returns per-channel sequential seq id', () => {
      channelStore.ensureDm(1, 2);
      const msg1 = messages.send('dm:1:2', 1, 'hello');
      const msg2 = messages.send('dm:1:2', 2, 'hi back');
      expect(msg1.seq).toBe(1);
      expect(msg2.seq).toBe(2);
    });

    it('seq ids are independent per channel', () => {
      channelStore.ensureDm(1, 2);
      channelStore.ensureDm(1, 3);
      messages.send('dm:1:2', 1, 'hello alice');
      messages.send('dm:1:2', 1, 'again alice');
      const msg = messages.send('dm:1:3', 1, 'hello bob');
      expect(msg.seq).toBe(1);
    });

    it('includes sender alias in returned message', () => {
      channelStore.ensureDm(1, 2);
      const msg = messages.send('dm:1:2', 1, 'test');
      expect(msg.senderAlias).toBe('ceo');
    });

    it('stores multiline content', () => {
      channelStore.ensureDm(1, 2);
      const msg = messages.send('dm:1:2', 1, 'line1\nline2\nline3');
      expect(msg.content).toBe('line1\nline2\nline3');
    });
  });

  describe('history', () => {
    beforeEach(() => {
      channelStore.ensureDm(1, 2);
      for (let i = 1; i <= 30; i++) {
        messages.send('dm:1:2', i % 2 === 0 ? 2 : 1, `message ${i}`);
      }
    });

    it('returns last 20 by default', () => {
      const result = messages.history('dm:1:2');
      expect(result.messages).toHaveLength(20);
      expect(result.total).toBe(30);
      expect(result.messages[0].seq).toBe(11);
      expect(result.messages[19].seq).toBe(30);
    });

    it('respects --limit', () => {
      const result = messages.history('dm:1:2', { limit: 5 });
      expect(result.messages).toHaveLength(5);
      expect(result.messages[0].seq).toBe(26);
    });

    it('respects --from', () => {
      const result = messages.history('dm:1:2', { from: 25 });
      expect(result.messages).toHaveLength(6);
      expect(result.messages[0].seq).toBe(25);
    });

    it('respects --to', () => {
      const result = messages.history('dm:1:2', { to: 5 });
      expect(result.messages).toHaveLength(5);
      expect(result.messages[4].seq).toBe(5);
    });

    it('respects --from + --to', () => {
      const result = messages.history('dm:1:2', { from: 10, to: 15 });
      expect(result.messages).toHaveLength(6);
      expect(result.messages[0].seq).toBe(10);
      expect(result.messages[5].seq).toBe(15);
    });

    it('respects --from + --limit', () => {
      const result = messages.history('dm:1:2', { from: 10, limit: 3 });
      expect(result.messages).toHaveLength(3);
      expect(result.messages[0].seq).toBe(10);
      expect(result.messages[2].seq).toBe(12);
    });

    it('respects --all', () => {
      const result = messages.history('dm:1:2', { all: true });
      expect(result.messages).toHaveLength(30);
    });

    it('errors when --from > --to', () => {
      expect(() => messages.history('dm:1:2', { from: 20, to: 10 }))
        .toThrow('--from must be <= --to');
    });

    it('returns correct showing range', () => {
      const result = messages.history('dm:1:2', { from: 10, to: 15 });
      expect(result.showing.from).toBe(10);
      expect(result.showing.to).toBe(15);
    });
  });
});
