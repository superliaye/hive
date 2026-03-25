import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatDb } from '../../src/chat/db.js';
import { ChannelStore } from '../../src/chat/channels.js';
import { MessageStore } from '../../src/chat/messages.js';
import { CursorStore } from '../../src/chat/cursors.js';
import { SearchEngine } from '../../src/chat/search.js';
import { AccessControl } from '../../src/chat/access.js';

function seedPeople(db: ChatDb) {
  const raw = db.raw();
  raw.prepare("INSERT INTO people (id, alias, name, role_template, status) VALUES (?, ?, ?, ?, 'active')").run(1, 'ceo', 'Chief Executive', 'chief-executive');
  raw.prepare("INSERT INTO people (id, alias, name, role_template, status) VALUES (?, ?, ?, ?, 'active')").run(2, 'alice', 'Alice Engineer', 'software-engineer');
  raw.prepare("INSERT INTO people (id, alias, name, role_template, status) VALUES (?, ?, ?, ?, 'active')").run(3, 'bob', 'Bob QA', 'qa-engineer');
}

describe('Error Handling', () => {
  let tmpDir: string;
  let db: ChatDb;
  let channels: ChannelStore;
  let messages: MessageStore;
  let cursors: CursorStore;
  let search: SearchEngine;
  let access: AccessControl;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-chat-errors-'));
    db = new ChatDb(path.join(tmpDir, 'org-state.db'));
    seedPeople(db);
    channels = new ChannelStore(db);
    messages = new MessageStore(db);
    cursors = new CursorStore(db);
    search = new SearchEngine(db);
    access = new AccessControl(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('AccessControl errors', () => {
    it('requireIdentity throws with helpful message when env missing', () => {
      expect(() => AccessControl.requireIdentity(undefined))
        .toThrow('HIVE_AGENT_ID not set. Are you running inside a hive agent?');
    });

    it('requireIdentity throws for empty string', () => {
      expect(() => AccessControl.requireIdentity(''))
        .toThrow('HIVE_AGENT_ID not set');
    });

    it('resolvePerson error includes the alias tried', () => {
      expect(() => access.resolvePerson('nonexistent'))
        .toThrow('Person "nonexistent" not found');
    });

    it('validateSend self-message error is clear', () => {
      expect(() => access.validateSend(1, 1))
        .toThrow('Cannot send message to yourself');
    });

    it('non-CEO messaging super-user gets clear error', () => {
      expect(() => access.validateSend(2, 0))
        .toThrow('Only CEO can message super-user');
    });

    it('super-user cannot be added to groups', () => {
      expect(() => access.validateGroupAdd(0))
        .toThrow('Super-user cannot be added to groups');
    });

    it('requireMembership throws for non-member', () => {
      channels.createGroup('private', 1, [1, 2]);
      expect(() => access.requireMembership(3, 'private'))
        .toThrow('You are not a member of this channel');
    });
  });

  describe('ChannelStore errors', () => {
    it('resolveTarget with bad prefix throws helpful error', () => {
      expect(() => channels.resolveTarget('badformat', 1))
        .toThrow('Target must start with @ (DM) or # (group)');
    });

    it('resolveTarget with unknown @alias throws', () => {
      expect(() => channels.resolveTarget('@nobody', 1))
        .toThrow('Person "nobody" not found');
    });

    it('resolveTarget with unknown #group throws', () => {
      expect(() => channels.resolveTarget('#nope', 1))
        .toThrow('Group "nope" not found');
    });

    it('resolveTarget with deleted group throws', () => {
      channels.createGroup('temp', 1, [1, 2]);
      channels.deleteGroup('temp');
      expect(() => channels.resolveTarget('#temp', 1))
        .toThrow('Group "temp" not found');
    });

    it('createGroup with invalid name chars throws', () => {
      expect(() => channels.createGroup('Bad Name!', 1, [1, 2]))
        .toThrow('kebab-case');
    });

    it('createGroup with uppercase throws', () => {
      expect(() => channels.createGroup('EngTeam', 1, [1, 2]))
        .toThrow('kebab-case');
    });

    it('createGroup with spaces throws', () => {
      expect(() => channels.createGroup('eng team', 1, [1, 2]))
        .toThrow('kebab-case');
    });

    it('createGroup over 50 chars throws', () => {
      expect(() => channels.createGroup('a'.repeat(51), 1, [1, 2]))
        .toThrow('50 characters or less');
    });

    it('createGroup with fewer than 2 members throws', () => {
      expect(() => channels.createGroup('solo', 1, [1]))
        .toThrow('at least 2 members');
    });

    it('createGroup with empty members and only creator throws', () => {
      expect(() => channels.createGroup('solo', 1, []))
        .toThrow('at least 2 members');
    });

    it('createGroup duplicate name throws', () => {
      channels.createGroup('eng-team', 1, [1, 2]);
      expect(() => channels.createGroup('eng-team', 1, [1, 3]))
        .toThrow('already exists');
    });

    it('createGroup with super-user as member throws', () => {
      expect(() => channels.createGroup('bad', 1, [0, 1, 2]))
        .toThrow('Super-user cannot be added to groups');
    });

    it('createGroup with nonexistent member throws', () => {
      expect(() => channels.createGroup('bad', 1, [1, 999]))
        .toThrow('Person "999" not found');
    });

    it('getGroupInfo for nonexistent group throws', () => {
      expect(() => channels.getGroupInfo('nope'))
        .toThrow('Group "nope" not found');
    });

    it('addMember with super-user throws', () => {
      channels.createGroup('eng', 1, [1, 2]);
      expect(() => channels.addMember('eng', 0))
        .toThrow('Super-user cannot be added to groups');
    });
  });

  describe('MessageStore errors', () => {
    it('history with --from > --to throws', () => {
      channels.ensureDm(1, 2);
      expect(() => messages.history('dm:1:2', { from: 20, to: 10 }))
        .toThrow('--from must be <= --to');
    });

    it('history on empty channel returns zero total', () => {
      channels.ensureDm(1, 2);
      const result = messages.history('dm:1:2');
      expect(result.total).toBe(0);
      expect(result.messages).toHaveLength(0);
    });
  });

  describe('SearchEngine errors', () => {
    it('search with no filters throws', () => {
      expect(() => search.search({ callerId: 1 }))
        .toThrow('At least one of: pattern, scope');
    });

    it('search with invalid regex throws', () => {
      channels.ensureDm(1, 2);
      messages.send('dm:1:2', 1, 'test');
      expect(() => search.search({ pattern: '[invalid', callerId: 1, regex: true }))
        .toThrow(); // RegExp constructor throws
    });

    it('search scoped to non-member channel throws', () => {
      channels.createGroup('private', 1, [1, 2]);
      expect(() => search.search({ pattern: 'test', callerId: 3, scopeChannelId: 'private' }))
        .toThrow('not a member');
    });

    it('search returns empty for agent with no channels', () => {
      const result = search.search({ pattern: 'test', callerId: 3 });
      expect(result.total).toBe(0);
      expect(result.messages).toHaveLength(0);
    });
  });

  describe('CursorStore edge cases', () => {
    it('getUnread returns empty for agent with no channels', () => {
      const unread = cursors.getUnread(3);
      expect(unread).toHaveLength(0);
    });

    it('ack on non-existent channel throws FK constraint', () => {
      // FK constraint: channel_id must reference channels table
      expect(() => cursors.ack(2, 'dm:1:2', 5)).toThrow();
    });
  });
});
