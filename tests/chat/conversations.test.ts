import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatDb } from '../../src/chat/db.js';
import { ConversationStore } from '../../src/chat/conversations.js';

function seedPeople(db: ChatDb) {
  const raw = db.raw();
  raw.prepare("INSERT INTO people (id, alias, name, role_template, status) VALUES (?, ?, ?, ?, 'active')").run(1, 'ceo', 'Chief Executive', 'chief-executive');
  raw.prepare("INSERT INTO people (id, alias, name, role_template, status) VALUES (?, ?, ?, ?, 'active')").run(2, 'alice', 'Alice Engineer', 'software-engineer');
  raw.prepare("INSERT INTO people (id, alias, name, role_template, status) VALUES (?, ?, ?, ?, 'active')").run(3, 'bob', 'Bob QA', 'qa-engineer');
  raw.prepare("INSERT INTO people (id, alias, name, role_template, status) VALUES (?, ?, ?, ?, 'active')").run(4, 'carol', 'Carol PM', 'product-manager');
}

describe('ConversationStore', () => {
  let tmpDir: string;
  let db: ChatDb;
  let conversations: ConversationStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-chat-channels-'));
    db = new ChatDb(path.join(tmpDir, 'org-state.db'));
    seedPeople(db);
    conversations = new ConversationStore(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('DM conversations', () => {
    it('creates DM lazily with sorted id', () => {
      const ch = conversations.ensureDm(2, 1);
      expect(ch.id).toBe('dm:1:2');
      expect(ch.type).toBe('dm');
    });

    it('returns existing DM on second call', () => {
      const ch1 = conversations.ensureDm(2, 1);
      const ch2 = conversations.ensureDm(1, 2);
      expect(ch1.id).toBe(ch2.id);
    });

    it('adds both members to DM', () => {
      conversations.ensureDm(2, 1);
      const members = conversations.getMembers('dm:1:2');
      expect(members.map(m => m.personId).sort()).toEqual([1, 2]);
    });
  });

  describe('Group conversations', () => {
    it('creates group with members', () => {
      const ch = conversations.createGroup('eng-team', 1, [1, 2, 3]);
      expect(ch.id).toBe('eng-team');
      expect(ch.type).toBe('group');
    });

    it('rejects invalid group name', () => {
      expect(() => conversations.createGroup('Bad Name!', 1, [1, 2]))
        .toThrow('Group name must be kebab-case');
    });

    it('rejects name over 50 chars', () => {
      const long = 'a'.repeat(51);
      expect(() => conversations.createGroup(long, 1, [1, 2]))
        .toThrow('Group name must be 50 characters or less');
    });

    it('rejects duplicate group name', () => {
      conversations.createGroup('eng-team', 1, [1, 2]);
      expect(() => conversations.createGroup('eng-team', 1, [1, 3]))
        .toThrow('already exists');
    });

    it('rejects group with fewer than 2 members', () => {
      expect(() => conversations.createGroup('solo', 1, [1]))
        .toThrow('Group must have at least 2 members');
    });

    it('auto-joins creator if not in member list', () => {
      conversations.createGroup('eng-team', 1, [2, 3]);
      const members = conversations.getMembers('eng-team');
      expect(members.map(m => m.personId).sort()).toEqual([1, 2, 3]);
    });

    it('lists groups for a person', () => {
      conversations.createGroup('eng-team', 1, [1, 2]);
      conversations.createGroup('qa-team', 1, [1, 3]);
      const groups = conversations.listGroups(2);
      expect(groups).toHaveLength(1);
      expect(groups[0].id).toBe('eng-team');
    });

    it('returns group info with member count and message count', () => {
      conversations.createGroup('eng-team', 1, [1, 2, 3]);
      const info = conversations.getGroupInfo('eng-team');
      expect(info.memberCount).toBe(3);
      expect(info.messageCount).toBe(0);
      expect(info.createdBy).toBe(1);
    });

    it('adds member to group', () => {
      conversations.createGroup('eng-team', 1, [1, 2]);
      conversations.addMember('eng-team', 4);
      const members = conversations.getMembers('eng-team');
      expect(members).toHaveLength(3);
    });

    it('removes member from group', () => {
      conversations.createGroup('eng-team', 1, [1, 2, 3]);
      conversations.removeMember('eng-team', 3);
      const members = conversations.getMembers('eng-team');
      expect(members).toHaveLength(2);
    });

    it('deletes group (soft delete, messages preserved)', () => {
      conversations.createGroup('eng-team', 1, [1, 2]);
      conversations.deleteGroup('eng-team');
      const ch = conversations.getConversation('eng-team');
      expect(ch?.deleted).toBe(true);
    });

    it('deleted group does not appear in listGroups', () => {
      conversations.createGroup('eng-team', 1, [1, 2]);
      conversations.deleteGroup('eng-team');
      const groups = conversations.listGroups(1);
      expect(groups).toHaveLength(0);
    });
  });

  describe('resolveTarget', () => {
    it('resolves @alias to DM conversation id', () => {
      conversations.ensureDm(1, 2);
      const id = conversations.resolveTarget('@alice', 1);
      expect(id).toBe('dm:1:2');
    });

    it('resolves #group to group conversation id', () => {
      conversations.createGroup('eng-team', 1, [1, 2]);
      const id = conversations.resolveTarget('#eng-team', 1);
      expect(id).toBe('eng-team');
    });

    it('throws for unknown @alias', () => {
      expect(() => conversations.resolveTarget('@nobody', 1))
        .toThrow('Person "nobody" not found');
    });

    it('throws for unknown #group', () => {
      expect(() => conversations.resolveTarget('#nope', 1))
        .toThrow('Group "nope" not found');
    });

    it('throws for deleted #group', () => {
      conversations.createGroup('temp', 1, [1, 2]);
      conversations.deleteGroup('temp');
      expect(() => conversations.resolveTarget('#temp', 1))
        .toThrow('Group "temp" not found');
    });
  });
});
