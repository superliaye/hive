import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatDb } from '../../src/chat/db.js';
import { ConversationStore } from '../../src/chat/conversations.js';
import { MessageStore } from '../../src/chat/messages.js';
import { SearchEngine } from '../../src/chat/search.js';

function seedPeople(db: ChatDb) {
  const raw = db.raw();
  raw.prepare("INSERT INTO people (id, alias, name, role_template, status) VALUES (?, ?, ?, ?, 'active')").run(1, 'ceo', 'Chief Executive', 'chief-executive');
  raw.prepare("INSERT INTO people (id, alias, name, role_template, status) VALUES (?, ?, ?, ?, 'active')").run(2, 'alice', 'Alice Engineer', 'software-engineer');
  raw.prepare("INSERT INTO people (id, alias, name, role_template, status) VALUES (?, ?, ?, ?, 'active')").run(3, 'bob', 'Bob QA', 'qa-engineer');
}

describe('SearchEngine', () => {
  let tmpDir: string;
  let db: ChatDb;
  let conversationStore: ConversationStore;
  let msgStore: MessageStore;
  let search: SearchEngine;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-chat-search-'));
    db = new ChatDb(path.join(tmpDir, 'org-state.db'));
    seedPeople(db);
    conversationStore = new ConversationStore(db);
    msgStore = new MessageStore(db);
    search = new SearchEngine(db);

    conversationStore.ensureDm(1, 2);
    conversationStore.ensureDm(1, 3);
    conversationStore.createGroup('eng-team', 1, [1, 2, 3]);
    msgStore.send('dm:1:2', 1, 'Deploy to staging failed');
    msgStore.send('dm:1:2', 2, 'Checking the deploy logs now');
    msgStore.send('dm:1:2', 2, 'Fixed the config, deploying again');
    msgStore.send('dm:1:3', 1, 'QA report ready?');
    msgStore.send('dm:1:3', 3, 'Report uploaded to drive');
    msgStore.send('eng-team', 1, 'Deploy pipeline is green');
    msgStore.send('eng-team', 2, 'All tests passing');
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('literal search', () => {
    it('finds messages containing pattern across conversations', () => {
      const result = search.search({ pattern: 'Deploy', callerId: 1 });
      expect(result.total).toBe(2); // "Deploy to staging" and "Deploy pipeline"
    });

    it('is case sensitive by default', () => {
      const result = search.search({ pattern: 'deploy', callerId: 1 });
      // lowercase "deploy" matches "deploy logs" and "deploying"
      expect(result.total).toBe(2);
    });

    it('case insensitive with -i flag', () => {
      const result = search.search({ pattern: 'deploy', callerId: 1, caseInsensitive: true });
      expect(result.total).toBe(4);
    });
  });

  describe('regex search', () => {
    it('supports extended regex with -E flag', () => {
      const result = search.search({ pattern: 'deploy.*fail', callerId: 1, regex: true, caseInsensitive: true });
      expect(result.total).toBe(1);
      expect(result.messages[0].content).toContain('failed');
    });
  });

  describe('scope filter', () => {
    it('scopes to DM with specific person', () => {
      const result = search.search({ pattern: 'deploy', callerId: 1, scopeConversationId: 'dm:1:2', caseInsensitive: true });
      expect(result.messages.every(m => m.conversationId === 'dm:1:2')).toBe(true);
    });

    it('scopes to group', () => {
      const result = search.search({ pattern: 'deploy', callerId: 1, scopeConversationId: 'eng-team', caseInsensitive: true });
      expect(result.messages.every(m => m.conversationId === 'eng-team')).toBe(true);
    });
  });

  describe('--from filter', () => {
    it('filters by sender', () => {
      const result = search.search({ pattern: 'deploy', callerId: 1, fromPersonId: 2, caseInsensitive: true });
      expect(result.messages.every(m => m.senderId === 2)).toBe(true);
    });
  });

  describe('composable filters', () => {
    it('--from + scope (DM) combined', () => {
      const result = search.search({
        pattern: 'deploy',
        callerId: 1,
        scopeConversationId: 'dm:1:2',
        fromPersonId: 2,
        caseInsensitive: true,
      });
      expect(result.messages.every(m => m.senderId === 2 && m.conversationId === 'dm:1:2')).toBe(true);
    });

    it('--from + scope (group) combined', () => {
      const result = search.search({
        pattern: 'tests',
        callerId: 1,
        scopeConversationId: 'eng-team',
        fromPersonId: 2,
        caseInsensitive: true,
      });
      expect(result.messages.every(m => m.senderId === 2 && m.conversationId === 'eng-team')).toBe(true);
    });
  });

  describe('access control', () => {
    it('only returns messages from conversations caller is a member of', () => {
      const result = search.search({ pattern: 'staging', callerId: 3 });
      expect(result.total).toBe(0);
    });

    it('alice cannot see dm:1:3 messages', () => {
      const result = search.search({ pattern: 'report', callerId: 2 });
      expect(result.total).toBe(0);
    });
  });

  describe('pagination', () => {
    it('respects --limit', () => {
      const result = search.search({ pattern: 'deploy', callerId: 1, caseInsensitive: true, limit: 2 });
      expect(result.messages).toHaveLength(2);
      expect(result.total).toBe(4);
    });

    it('respects --offset', () => {
      const result = search.search({ pattern: 'deploy', callerId: 1, caseInsensitive: true, limit: 2, offset: 2 });
      expect(result.messages).toHaveLength(2);
      expect(result.showing.offset).toBe(2);
    });
  });

  describe('time filters', () => {
    it('filters by --after date', () => {
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      const result = search.search({ pattern: 'deploy', callerId: 1, after: yesterday, caseInsensitive: true });
      expect(result.total).toBeGreaterThan(0);
    });

    it('filters by --before date', () => {
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      const result = search.search({ pattern: 'deploy', callerId: 1, before: yesterday, caseInsensitive: true });
      expect(result.total).toBe(0);
    });
  });

  describe('validation', () => {
    it('requires at least one filter', () => {
      expect(() => search.search({ callerId: 1 }))
        .toThrow('At least one of: pattern, scope');
    });
  });
});
