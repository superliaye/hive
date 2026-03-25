import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatDb } from '../../src/chat/db.js';
import { ChannelStore } from '../../src/chat/channels.js';

function seedPeople(db: ChatDb) {
  const raw = db.raw();
  raw.prepare("INSERT INTO people (id, alias, name, role_template, status) VALUES (?, ?, ?, ?, 'active')").run(1, 'ceo', 'Chief Executive', 'chief-executive');
  raw.prepare("INSERT INTO people (id, alias, name, role_template, status) VALUES (?, ?, ?, ?, 'active')").run(2, 'alice', 'Alice Engineer', 'software-engineer');
  raw.prepare("INSERT INTO people (id, alias, name, role_template, status) VALUES (?, ?, ?, ?, 'active')").run(3, 'bob', 'Bob QA', 'qa-engineer');
  raw.prepare("INSERT INTO people (id, alias, name, role_template, status) VALUES (?, ?, ?, ?, 'active')").run(4, 'carol', 'Carol PM', 'product-manager');
}

describe('ChannelStore', () => {
  let tmpDir: string;
  let db: ChatDb;
  let channels: ChannelStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-chat-channels-'));
    db = new ChatDb(path.join(tmpDir, 'org-state.db'));
    seedPeople(db);
    channels = new ChannelStore(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('DM channels', () => {
    it('creates DM lazily with sorted id', () => {
      const ch = channels.ensureDm(2, 1);
      expect(ch.id).toBe('dm:1:2');
      expect(ch.type).toBe('dm');
    });

    it('returns existing DM on second call', () => {
      const ch1 = channels.ensureDm(2, 1);
      const ch2 = channels.ensureDm(1, 2);
      expect(ch1.id).toBe(ch2.id);
    });

    it('adds both members to DM', () => {
      channels.ensureDm(2, 1);
      const members = channels.getMembers('dm:1:2');
      expect(members.map(m => m.personId).sort()).toEqual([1, 2]);
    });
  });

  describe('Group channels', () => {
    it('creates group with members', () => {
      const ch = channels.createGroup('eng-team', 1, [1, 2, 3]);
      expect(ch.id).toBe('eng-team');
      expect(ch.type).toBe('group');
    });

    it('rejects invalid group name', () => {
      expect(() => channels.createGroup('Bad Name!', 1, [1, 2]))
        .toThrow('Group name must be kebab-case');
    });

    it('rejects name over 50 chars', () => {
      const long = 'a'.repeat(51);
      expect(() => channels.createGroup(long, 1, [1, 2]))
        .toThrow('Group name must be 50 characters or less');
    });

    it('rejects duplicate group name', () => {
      channels.createGroup('eng-team', 1, [1, 2]);
      expect(() => channels.createGroup('eng-team', 1, [1, 3]))
        .toThrow('already exists');
    });

    it('rejects group with fewer than 2 members', () => {
      expect(() => channels.createGroup('solo', 1, [1]))
        .toThrow('Group must have at least 2 members');
    });

    it('auto-joins creator if not in member list', () => {
      channels.createGroup('eng-team', 1, [2, 3]);
      const members = channels.getMembers('eng-team');
      expect(members.map(m => m.personId).sort()).toEqual([1, 2, 3]);
    });

    it('lists groups for a person', () => {
      channels.createGroup('eng-team', 1, [1, 2]);
      channels.createGroup('qa-team', 1, [1, 3]);
      const groups = channels.listGroups(2);
      expect(groups).toHaveLength(1);
      expect(groups[0].id).toBe('eng-team');
    });

    it('returns group info with member count and message count', () => {
      channels.createGroup('eng-team', 1, [1, 2, 3]);
      const info = channels.getGroupInfo('eng-team');
      expect(info.memberCount).toBe(3);
      expect(info.messageCount).toBe(0);
      expect(info.createdBy).toBe(1);
    });

    it('adds member to group', () => {
      channels.createGroup('eng-team', 1, [1, 2]);
      channels.addMember('eng-team', 4);
      const members = channels.getMembers('eng-team');
      expect(members).toHaveLength(3);
    });

    it('removes member from group', () => {
      channels.createGroup('eng-team', 1, [1, 2, 3]);
      channels.removeMember('eng-team', 3);
      const members = channels.getMembers('eng-team');
      expect(members).toHaveLength(2);
    });

    it('deletes group (soft delete, messages preserved)', () => {
      channels.createGroup('eng-team', 1, [1, 2]);
      channels.deleteGroup('eng-team');
      const ch = channels.getChannel('eng-team');
      expect(ch?.deleted).toBe(true);
    });

    it('deleted group does not appear in listGroups', () => {
      channels.createGroup('eng-team', 1, [1, 2]);
      channels.deleteGroup('eng-team');
      const groups = channels.listGroups(1);
      expect(groups).toHaveLength(0);
    });
  });

  describe('resolveTarget', () => {
    it('resolves @alias to DM channel id', () => {
      channels.ensureDm(1, 2);
      const id = channels.resolveTarget('@alice', 1);
      expect(id).toBe('dm:1:2');
    });

    it('resolves #group to group channel id', () => {
      channels.createGroup('eng-team', 1, [1, 2]);
      const id = channels.resolveTarget('#eng-team', 1);
      expect(id).toBe('eng-team');
    });

    it('throws for unknown @alias', () => {
      expect(() => channels.resolveTarget('@nobody', 1))
        .toThrow('Person "nobody" not found');
    });

    it('throws for unknown #group', () => {
      expect(() => channels.resolveTarget('#nope', 1))
        .toThrow('Group "nope" not found');
    });

    it('throws for deleted #group', () => {
      channels.createGroup('temp', 1, [1, 2]);
      channels.deleteGroup('temp');
      expect(() => channels.resolveTarget('#temp', 1))
        .toThrow('Group "temp" not found');
    });
  });
});
