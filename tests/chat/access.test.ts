import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatDb } from '../../src/chat/db.js';
import { AccessControl } from '../../src/chat/access.js';

function seedPeople(db: ChatDb) {
  const raw = db.raw();
  raw.prepare("INSERT INTO people (id, alias, name, role_template, status) VALUES (?, ?, ?, ?, 'active')").run(1, 'ceo', 'Chief Executive', 'chief-executive');
  raw.prepare("INSERT INTO people (id, alias, name, role_template, status) VALUES (?, ?, ?, ?, 'active')").run(2, 'alice', 'Alice Engineer', 'software-engineer');
  raw.prepare("INSERT INTO people (id, alias, name, role_template, status) VALUES (?, ?, ?, ?, 'active')").run(3, 'bob', 'Bob QA', 'qa-engineer');
}

describe('AccessControl', () => {
  let tmpDir: string;
  let db: ChatDb;
  let access: AccessControl;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-chat-access-'));
    db = new ChatDb(path.join(tmpDir, 'org-state.db'));
    seedPeople(db);
    access = new AccessControl(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('resolvePerson', () => {
    it('resolves valid alias', () => {
      const p = access.resolvePerson('alice');
      expect(p.id).toBe(2);
      expect(p.alias).toBe('alice');
    });

    it('resolves by numeric id', () => {
      const p = access.resolvePerson('2');
      expect(p.id).toBe(2);
    });

    it('throws for unknown alias', () => {
      expect(() => access.resolvePerson('unknown'))
        .toThrow('Person "unknown" not found');
    });
  });

  describe('validateSend', () => {
    it('blocks self-message', () => {
      expect(() => access.validateSend(2, 2))
        .toThrow('Cannot send message to yourself');
    });

    it('allows CEO to message super-user', () => {
      expect(() => access.validateSend(1, 0)).not.toThrow();
    });

    it('blocks non-CEO from messaging super-user', () => {
      expect(() => access.validateSend(2, 0))
        .toThrow('Only CEO can message super-user');
    });

    it('allows normal agent-to-agent messaging', () => {
      expect(() => access.validateSend(2, 3)).not.toThrow();
    });
  });

  describe('validateGroupAdd', () => {
    it('blocks adding super-user to group', () => {
      expect(() => access.validateGroupAdd(0))
        .toThrow('Super-user cannot be added to groups');
    });

    it('allows adding normal agent', () => {
      expect(() => access.validateGroupAdd(2)).not.toThrow();
    });
  });

  describe('requireMembership', () => {
    it('throws if person is not a member of channel', () => {
      const raw = db.raw();
      raw.prepare("INSERT INTO channels (id, type, created_by) VALUES ('test-group', 'group', 1)").run();
      raw.prepare("INSERT INTO channel_members (channel_id, person_id) VALUES ('test-group', 1)").run();

      expect(() => access.requireMembership(2, 'test-group'))
        .toThrow('You are not a member of this channel');
    });

    it('passes if person is a member', () => {
      const raw = db.raw();
      raw.prepare("INSERT INTO channels (id, type, created_by) VALUES ('test-group', 'group', 1)").run();
      raw.prepare("INSERT INTO channel_members (channel_id, person_id) VALUES ('test-group', 1)").run();

      expect(() => access.requireMembership(1, 'test-group')).not.toThrow();
    });
  });

  describe('requireIdentity', () => {
    it('throws when HIVE_AGENT_ID is missing', () => {
      expect(() => AccessControl.requireIdentity(undefined))
        .toThrow('HIVE_AGENT_ID not set');
    });

    it('returns numeric id when set', () => {
      expect(AccessControl.requireIdentity('2')).toBe(2);
    });
  });
});
