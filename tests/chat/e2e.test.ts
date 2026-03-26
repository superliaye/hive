import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatDb } from '../../src/chat/db.js';
import { buildChatCommand } from '../../src/chat/cli.js';
import { Command } from 'commander';

function seedPeople(db: ChatDb) {
  const raw = db.raw();
  raw.prepare("INSERT INTO people (id, alias, name, role_template, status) VALUES (?, ?, ?, ?, 'active')").run(1, 'ceo', 'Chief Executive', 'chief-executive');
  raw.prepare("INSERT INTO people (id, alias, name, role_template, status) VALUES (?, ?, ?, ?, 'active')").run(2, 'alice', 'Alice Engineer', 'software-engineer');
  raw.prepare("INSERT INTO people (id, alias, name, role_template, status) VALUES (?, ?, ?, ?, 'active')").run(3, 'bob', 'Bob QA', 'qa-engineer');
  raw.prepare("INSERT INTO people (id, alias, name, role_template, status) VALUES (?, ?, ?, ?, 'active')").run(4, 'carol', 'Carol PM', 'product');
}

/**
 * E2E test helper: runs a CLI command and captures stdout.
 * Sets HIVE_AGENT_ID env var to simulate agent identity.
 */
async function runCli(db: ChatDb, args: string[], agentId: string = '1'): Promise<string> {
  const oldEnv = process.env.HIVE_AGENT_ID;
  process.env.HIVE_AGENT_ID = agentId;

  const program = new Command();
  program.exitOverride();
  const chatCmd = buildChatCommand(db);
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

async function runCliExpectError(db: ChatDb, args: string[], agentId: string = '1'): Promise<string> {
  try {
    await runCli(db, args, agentId);
    throw new Error('Expected command to throw');
  } catch (err: any) {
    return err.message;
  }
}

describe('E2E: CLI Commands', () => {
  let tmpDir: string;
  let db: ChatDb;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-chat-e2e-'));
    db = new ChatDb(path.join(tmpDir, 'org-state.db'));
    seedPeople(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('send + confirmation output', () => {
    it('DM send prints "Sent seq N to channel"', async () => {
      const out = await runCli(db, ['send', '@alice', 'hello world']);
      expect(out).toMatch(/Sent seq 1 to dm:1:2/);
    });

    it('sequential sends increment seq', async () => {
      await runCli(db, ['send', '@alice', 'msg1']);
      const out = await runCli(db, ['send', '@alice', 'msg2']);
      expect(out).toMatch(/Sent seq 2/);
    });

    it('group send works', async () => {
      await runCli(db, ['group', 'create', 'eng-team', '@alice', '@bob']);
      const out = await runCli(db, ['send', '#eng-team', 'standup time']);
      expect(out).toMatch(/Sent seq 1 to eng-team/);
    });
  });

  describe('send error handling', () => {
    it('missing HIVE_AGENT_ID gives clear error', async () => {
      const err = await runCliExpectError(db, ['send', '@alice', 'hi'], '');
      expect(err).toContain('HIVE_AGENT_ID not set');
    });

    it('self-message blocked', async () => {
      const err = await runCliExpectError(db, ['send', '@ceo', 'hi'], '1');
      expect(err).toContain('Cannot send message to yourself');
    });

    it('unknown alias gives helpful error', async () => {
      const err = await runCliExpectError(db, ['send', '@nobody', 'hi']);
      expect(err).toContain('Person "nobody" not found');
    });

    it('unknown group gives helpful error', async () => {
      const err = await runCliExpectError(db, ['send', '#nonexistent', 'hi']);
      expect(err).toContain('Group "nonexistent" not found');
    });

    it('non-CEO cannot message super-user', async () => {
      const err = await runCliExpectError(db, ['send', '@super-user', 'hi'], '2');
      expect(err).toContain('Only CEO can message super-user');
    });

    it('CEO can message super-user', async () => {
      const out = await runCli(db, ['send', '@super-user', 'board update'], '1');
      expect(out).toMatch(/Sent seq 1 to dm:0:1/);
    });
  });

  describe('inbox', () => {
    it('shows "No unread messages" when empty', async () => {
      const out = await runCli(db, ['inbox']);
      expect(out).toContain('No unread messages');
    });

    it('shows unread messages grouped by channel', async () => {
      // CEO sends to alice and bob
      await runCli(db, ['send', '@alice', 'task for alice'], '1');
      await runCli(db, ['send', '@bob', 'task for bob'], '1');

      // Alice checks inbox — sees message from CEO
      const out = await runCli(db, ['inbox'], '2');
      expect(out).toContain('dm:1:2');
      expect(out).toContain('task for alice');
      expect(out).toContain('1 unread');
      // Alice should NOT see bob's message
      expect(out).not.toContain('task for bob');
    });

    it('excludes own messages from inbox', async () => {
      // Alice sends to CEO — alice's own message should not appear in alice's inbox
      await runCli(db, ['send', '@ceo', 'status update'], '2');
      const out = await runCli(db, ['inbox'], '2');
      expect(out).toContain('No unread messages');
    });
  });

  describe('ack', () => {
    it('advancing cursor reduces unread', async () => {
      await runCli(db, ['send', '@alice', 'msg1'], '1');
      await runCli(db, ['send', '@alice', 'msg2'], '1');

      // Alice acks through seq 1
      const ackOut = await runCli(db, ['ack', '@ceo', '1'], '2');
      expect(ackOut).toContain('Cursor advanced to seq 1');

      // Alice inbox now shows only msg2
      const inbox = await runCli(db, ['inbox'], '2');
      expect(inbox).toContain('msg2');
      expect(inbox).not.toContain('msg1\n'); // msg1 content not in output
    });
  });

  describe('history', () => {
    it('shows header with total count and seq range', async () => {
      await runCli(db, ['send', '@alice', 'msg1']);
      await runCli(db, ['send', '@alice', 'msg2']);
      await runCli(db, ['send', '@alice', 'msg3']);

      const out = await runCli(db, ['history', '@alice']);
      expect(out).toContain('3 of 3');
      expect(out).toContain('dm:1:2');
      expect(out).toContain('seq 1-3');
    });

    it('--limit restricts output', async () => {
      for (let i = 1; i <= 10; i++) {
        await runCli(db, ['send', '@alice', `msg${i}`]);
      }
      const out = await runCli(db, ['history', '@alice', '--limit', '3']);
      expect(out).toContain('3 of 10');
      // Should show last 3 messages
      expect(out).toContain('msg8');
      expect(out).toContain('msg9');
      expect(out).toContain('msg10');
    });

    it('--from shows messages from seq onwards', async () => {
      for (let i = 1; i <= 5; i++) {
        await runCli(db, ['send', '@alice', `msg${i}`]);
      }
      const out = await runCli(db, ['history', '@alice', '--from', '3']);
      expect(out).toContain('msg3');
      expect(out).toContain('msg4');
      expect(out).toContain('msg5');
      expect(out).not.toContain('msg1');
      expect(out).not.toContain('msg2');
    });

    it('--all shows everything', async () => {
      for (let i = 1; i <= 25; i++) {
        await runCli(db, ['send', '@alice', `msg${i}`]);
      }
      const out = await runCli(db, ['history', '@alice', '--all']);
      expect(out).toContain('25 of 25');
    });

    it('non-member cannot view history', async () => {
      await runCli(db, ['send', '@alice', 'secret'], '1');
      const err = await runCliExpectError(db, ['history', '@ceo'], '3');
      expect(err).toContain('No DM history with @ceo');
    });
  });

  describe('search', () => {
    beforeEach(async () => {
      // Seed messages across channels
      await runCli(db, ['send', '@alice', 'Deploy to staging failed'], '1');
      await runCli(db, ['send', '@ceo', 'Checking deploy logs'], '2');
      await runCli(db, ['send', '@bob', 'QA report ready'], '1');
      await runCli(db, ['group', 'create', 'eng-team', '@alice', '@bob'], '1');
      await runCli(db, ['send', '#eng-team', 'Deploy pipeline green'], '1');
    });

    it('literal search across all channels', async () => {
      const out = await runCli(db, ['search', 'Deploy']);
      expect(out).toMatch(/Found \d+ results/);
      expect(out).toContain('Deploy');
    });

    it('scoped search to DM', async () => {
      const out = await runCli(db, ['search', '@alice', 'deploy'], '1');
      // Should only show results from dm:1:2, not eng-team
      expect(out).not.toContain('eng-team');
    });

    it('scoped search to group', async () => {
      const out = await runCli(db, ['search', '#eng-team', '-i', 'deploy'], '1');
      expect(out).toContain('eng-team');
      expect(out).not.toContain('dm:');
    });

    it('--from filter shows only messages from sender', async () => {
      const out = await runCli(db, ['search', '--from', 'alice', 'deploy'], '1');
      // Only alice's message about deploy logs
      const lines = out.split('\n').filter(l => l.includes('|'));
      for (const line of lines) {
        expect(line).toContain('alice');
      }
    });

    it('bob cannot see dm:1:2 results', async () => {
      const out = await runCli(db, ['search', 'staging'], '3');
      expect(out).toContain('Found 0 results');
    });
  });

  describe('group management', () => {
    it('full group lifecycle: create → list → info → add → remove → delete', async () => {
      // Create
      const createOut = await runCli(db, ['group', 'create', 'eng-team', '@alice', '@bob']);
      expect(createOut).toContain('eng-team');
      expect(createOut).toContain('created');

      // List
      const listOut = await runCli(db, ['group', 'list']);
      expect(listOut).toContain('#eng-team');

      // Info
      const infoOut = await runCli(db, ['group', 'info', '#eng-team']);
      expect(infoOut).toContain('Members (3)');
      expect(infoOut).toContain('@ceo');
      expect(infoOut).toContain('@alice');
      expect(infoOut).toContain('@bob');

      // Add carol
      const addOut = await runCli(db, ['group', 'add', '#eng-team', '@carol']);
      expect(addOut).toContain('Added @carol');

      const infoOut2 = await runCli(db, ['group', 'info', '#eng-team']);
      expect(infoOut2).toContain('Members (4)');

      // Remove bob
      const removeOut = await runCli(db, ['group', 'remove', '#eng-team', '@bob']);
      expect(removeOut).toContain('Removed @bob');

      const infoOut3 = await runCli(db, ['group', 'info', '#eng-team']);
      expect(infoOut3).toContain('Members (3)');
      expect(infoOut3).not.toContain('@bob');

      // Delete
      const deleteOut = await runCli(db, ['group', 'delete', '#eng-team']);
      expect(deleteOut).toContain('deleted');

      // No longer in list
      const listOut2 = await runCli(db, ['group', 'list']);
      expect(listOut2).not.toContain('eng-team');
    });

    it('group create errors', async () => {
      const err1 = await runCliExpectError(db, ['group', 'create', 'Bad Name', '@alice']);
      expect(err1).toContain('kebab-case');

      const err2 = await runCliExpectError(db, ['group', 'create', 'solo', '@ceo']);
      expect(err2).toContain('at least 2 members');
    });

    it('non-member cannot view group info', async () => {
      await runCli(db, ['group', 'create', 'private', '@alice', '@bob'], '1');
      const err = await runCliExpectError(db, ['group', 'info', '#private'], '4');
      expect(err).toContain('not a member');
    });

    it('group list shows "No groups" when empty', async () => {
      const out = await runCli(db, ['group', 'list'], '2');
      expect(out).toContain('No groups');
    });
  });

  describe('multi-agent conversation flow', () => {
    it('CEO delegates, agents respond, CEO reviews', async () => {
      // CEO sends tasks
      await runCli(db, ['send', '@alice', 'Implement auth module'], '1');
      await runCli(db, ['send', '@bob', 'Write auth test plan'], '1');

      // Alice checks inbox and responds
      const aliceInbox = await runCli(db, ['inbox'], '2');
      expect(aliceInbox).toContain('Implement auth module');
      await runCli(db, ['send', '@ceo', 'Auth module done, PR #42'], '2');
      await runCli(db, ['ack', '@ceo', '1'], '2');

      // Bob checks inbox and responds
      const bobInbox = await runCli(db, ['inbox'], '3');
      expect(bobInbox).toContain('Write auth test plan');
      await runCli(db, ['send', '@ceo', 'Test plan uploaded'], '3');
      await runCli(db, ['ack', '@ceo', '1'], '3');

      // CEO reviews responses
      const ceoInbox = await runCli(db, ['inbox'], '1');
      expect(ceoInbox).toContain('Auth module done');
      expect(ceoInbox).toContain('Test plan uploaded');

      // CEO searches for auth-related messages (case-insensitive)
      const searchOut = await runCli(db, ['search', '-i', 'auth'], '1');
      expect(searchOut).toMatch(/Found 3 results/);
    });
  });

  describe('cross-functional group workflow', () => {
    it('creates group, discusses, searches across DM + group', async () => {
      // Create cross-func group
      await runCli(db, ['group', 'create', 'sprint-1', '@alice', '@bob', '@carol'], '1');

      // Group discussion
      await runCli(db, ['send', '#sprint-1', 'Sprint goal: ship auth'], '1');
      await runCli(db, ['send', '#sprint-1', 'Backend auth started'], '2');
      await runCli(db, ['send', '#sprint-1', 'QA ready for auth'], '3');
      await runCli(db, ['send', '#sprint-1', 'PRD updated for auth'], '4');

      // CEO also DMs alice privately
      await runCli(db, ['send', '@alice', 'auth is priority #1'], '1');

      // Alice searches for "auth" (case-sensitive) — sees group + DM
      const aliceSearch = await runCli(db, ['search', 'auth'], '2');
      expect(aliceSearch).toMatch(/Found 5 results/);

      // Bob searches — only sees group (not in alice's DM)
      const bobSearch = await runCli(db, ['search', 'auth'], '3');
      expect(bobSearch).toMatch(/Found 4 results/);

      // Scoped search within group only
      const groupSearch = await runCli(db, ['search', '#sprint-1', 'auth'], '1');
      expect(groupSearch).toMatch(/Found 4 results/);
    });
  });
});
