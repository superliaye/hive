import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatDb } from '../../src/chat/db.js';
import { ConversationStore } from '../../src/chat/conversations.js';
import { MessageStore } from '../../src/chat/messages.js';
import { CursorStore } from '../../src/chat/cursors.js';
import { SearchEngine } from '../../src/chat/search.js';
import { AccessControl } from '../../src/chat/access.js';
import { ChatAdapter } from '../../src/chat/adapter.js';
import { buildChatCommand, type ChatCliDeps } from '../../src/chat/cli.js';
import { Command } from 'commander';

function seedPeople(db: ChatDb) {
  const raw = db.raw();
  raw.prepare("INSERT INTO people (id, alias, name, role_template, status) VALUES (?, ?, ?, ?, 'active')").run(1, 'ceo', 'Chief Executive', 'chief-executive');
  raw.prepare("INSERT INTO people (id, alias, name, role_template, status) VALUES (?, ?, ?, ?, 'active')").run(2, 'alice', 'Alice Engineer', 'software-engineer');
  raw.prepare("INSERT INTO people (id, alias, name, role_template, status) VALUES (?, ?, ?, ?, 'active')").run(3, 'bob', 'Bob QA', 'qa-engineer');
}

/**
 * E2E test helper: runs a CLI command and captures stdout.
 * Uses hive.db for messaging and people resolution.
 */
async function runCli(deps: ChatCliDeps, args: string[], agentId: string = '1'): Promise<string> {
  const oldEnv = process.env.HIVE_AGENT_ID;
  process.env.HIVE_AGENT_ID = agentId;

  const program = new Command();
  program.exitOverride();
  const chatCmd = buildChatCommand(deps);
  program.addCommand(chatCmd);

  const chunks: string[] = [];
  const origWrite = process.stdout.write;
  process.stdout.write = ((chunk: any) => {
    chunks.push(String(chunk));
    return true;
  }) as any;

  try {
    await program.parseAsync(['node', 'hive', 'chat', ...args]);
    return chunks.join('');
  } finally {
    process.stdout.write = origWrite;
    process.env.HIVE_AGENT_ID = oldEnv;
  }
}

async function runCliExpectError(deps: ChatCliDeps, args: string[], agentId: string = '1'): Promise<string> {
  try {
    await runCli(deps, args, agentId);
    throw new Error('Expected command to throw');
  } catch (err: any) {
    return err.message;
  }
}

describe('E2E: hive chat CLI', () => {
  let tmpDir: string;
  let chatDb: ChatDb;
  let conversationStore: ConversationStore;
  let messageStore: MessageStore;
  let cursorStore: CursorStore;
  let searchEngine: SearchEngine;
  let accessControl: AccessControl;
  let chatAdapter: ChatAdapter;
  let deps: ChatCliDeps;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-chat-e2e-'));
    chatDb = new ChatDb(path.join(tmpDir, 'hive.db'));
    seedPeople(chatDb);
    conversationStore = new ConversationStore(chatDb);
    messageStore = new MessageStore(chatDb);
    cursorStore = new CursorStore(chatDb);
    searchEngine = new SearchEngine(chatDb);
    accessControl = new AccessControl(chatDb);
    chatAdapter = new ChatAdapter(chatDb, conversationStore, messageStore, cursorStore);
    deps = { db: chatDb, conversations: conversationStore, messages: messageStore, cursors: cursorStore, search: searchEngine, access: accessControl, dashboardPort: 0 };
  });

  afterEach(() => {
    chatDb.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('send', () => {
    it('DM send creates conversation and posts message', async () => {
      const out = await runCli(deps, ['send', '@alice', 'hello world']);
      expect(out).toMatch(/Sent to @alice/);

      // Verify message is in the chat store
      const unread = chatAdapter.getUnread('alice');
      expect(unread).toHaveLength(1);
      expect(unread[0].content).toBe('hello world');
      expect(unread[0].sender).toBe('ceo');
    });

    it('multiple sends accumulate in conversation', async () => {
      await runCli(deps, ['send', '@alice', 'msg1']);
      await runCli(deps, ['send', '@alice', 'msg2']);

      const unread = chatAdapter.getUnread('alice');
      expect(unread).toHaveLength(2);
      expect(unread[0].content).toBe('msg1');
      expect(unread[1].content).toBe('msg2');
    });

    it('missing HIVE_AGENT_ID gives clear error', async () => {
      const err = await runCliExpectError(deps, ['send', '@alice', 'hi'], '');
      expect(err).toContain('HIVE_AGENT_ID not set');
    });
  });

  describe('inbox', () => {
    it('shows "No unread messages" when empty', async () => {
      const out = await runCli(deps, ['inbox']);
      expect(out).toContain('No unread messages');
    });

    it('shows unread messages grouped by conversation', async () => {
      // CEO sends to alice
      await runCli(deps, ['send', '@alice', 'task for alice'], '1');

      // Alice checks inbox — sees message from CEO
      const out = await runCli(deps, ['inbox'], '2');
      expect(out).toContain('@ceo');
      expect(out).toContain('task for alice');
      expect(out).toContain('1 unread');
    });

    it('excludes own messages from inbox', async () => {
      // Alice sends to CEO — should not appear in alice's inbox
      await runCli(deps, ['send', '@ceo', 'status update'], '2');
      const out = await runCli(deps, ['inbox'], '2');
      expect(out).toContain('No unread messages');
    });
  });

  describe('ack', () => {
    it('marks messages as read', async () => {
      await runCli(deps, ['send', '@alice', 'msg1'], '1');

      // Alice has 1 unread
      let inbox = await runCli(deps, ['inbox'], '2');
      expect(inbox).toContain('1 unread');

      // Alice acks dm with CEO (the person who sent the message)
      await runCli(deps, ['ack', '@ceo'], '2');

      // Alice has 0 unread
      inbox = await runCli(deps, ['inbox'], '2');
      expect(inbox).toContain('No unread messages');
    });
  });

  describe('history', () => {
    it('shows message history for a conversation', async () => {
      await runCli(deps, ['send', '@alice', 'msg1']);
      await runCli(deps, ['send', '@alice', 'msg2']);
      await runCli(deps, ['send', '@alice', 'msg3']);

      const out = await runCli(deps, ['history', '@alice']);
      expect(out).toContain('Showing 3 of 3');
      expect(out).toContain('msg1');
      expect(out).toContain('msg3');
    });

    it('--limit restricts output', async () => {
      for (let i = 1; i <= 5; i++) {
        await runCli(deps, ['send', '@alice', `msg${i}`]);
      }
      const out = await runCli(deps, ['history', '@alice', '--limit', '2']);
      expect(out).toContain('Showing 2 of 5');
    });
  });

  describe('search', () => {
    it('finds messages matching pattern', async () => {
      await runCli(deps, ['send', '@alice', 'Deploy to staging failed'], '1');
      await runCli(deps, ['send', '@bob', 'QA report ready'], '1');

      const out = await runCli(deps, ['search', 'Deploy']);
      expect(out).toContain('Deploy');
    });
  });

  describe('multi-agent conversation flow', () => {
    it('CEO delegates, agents respond, CEO reviews', async () => {
      // CEO sends tasks
      await runCli(deps, ['send', '@alice', 'Implement auth module'], '1');
      await runCli(deps, ['send', '@bob', 'Write auth test plan'], '1');

      // Alice checks inbox and responds
      const aliceInbox = await runCli(deps, ['inbox'], '2');
      expect(aliceInbox).toContain('Implement auth module');
      await runCli(deps, ['send', '@ceo', 'Auth module done, PR #42'], '2');

      // Bob checks inbox and responds
      const bobInbox = await runCli(deps, ['inbox'], '3');
      expect(bobInbox).toContain('Write auth test plan');
      await runCli(deps, ['send', '@ceo', 'Test plan uploaded'], '3');

      // CEO reviews responses
      const ceoInbox = await runCli(deps, ['inbox'], '1');
      expect(ceoInbox).toContain('Auth module done');
      expect(ceoInbox).toContain('Test plan uploaded');
    });
  });

  describe('data flow verification', () => {
    it('messages written via CLI are visible to ChatAdapter.getUnread', async () => {
      // CEO sends to alice
      await runCli(deps, ['send', '@alice', 'urgent task'], '1');

      // Verify daemon's getUnread would pick this up
      const unread = chatAdapter.getUnread('alice');
      expect(unread).toHaveLength(1);
      expect(unread[0].content).toBe('urgent task');
      expect(unread[0].sender).toBe('ceo');
    });

    it('messages marked read via CLI are invisible to getUnread', async () => {
      await runCli(deps, ['send', '@alice', 'task1'], '1');

      // Alice acks DM with CEO (the person who sent the message)
      await runCli(deps, ['ack', '@ceo'], '2');

      // getUnread should return empty
      const unread = chatAdapter.getUnread('alice');
      expect(unread).toHaveLength(0);
    });

    it('bidirectional DM conversation works', async () => {
      // CEO → alice
      await runCli(deps, ['send', '@alice', 'do this'], '1');
      // alice → CEO
      await runCli(deps, ['send', '@ceo', 'done'], '2');

      // CEO sees alice's reply
      const ceoUnread = chatAdapter.getUnread('ceo');
      expect(ceoUnread.some(m => m.content === 'done')).toBe(true);

      // alice sees CEO's message
      const aliceUnread = chatAdapter.getUnread('alice');
      expect(aliceUnread.some(m => m.content === 'do this')).toBe(true);
    });
  });
});
