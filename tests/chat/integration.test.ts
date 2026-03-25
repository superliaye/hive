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

function seedOrg(db: ChatDb) {
  const raw = db.raw();
  raw.prepare("INSERT INTO people (id, alias, name, role_template, status) VALUES (?, ?, ?, ?, 'active')").run(1, 'ceo', 'Chief Executive', 'chief-executive');
  raw.prepare("INSERT INTO people (id, alias, name, role_template, status) VALUES (?, ?, ?, ?, 'active')").run(2, 'alice', 'Alice Engineer', 'software-engineer');
  raw.prepare("INSERT INTO people (id, alias, name, role_template, status) VALUES (?, ?, ?, ?, 'active')").run(3, 'bob', 'Bob QA', 'qa-engineer');
  raw.prepare("INSERT INTO people (id, alias, name, role_template, status) VALUES (?, ?, ?, ?, 'active')").run(4, 'carol', 'Carol PM', 'product-manager');
}

describe('Chat Integration', () => {
  let tmpDir: string;
  let db: ChatDb;
  let channels: ChannelStore;
  let messages: MessageStore;
  let cursors: CursorStore;
  let search: SearchEngine;
  let access: AccessControl;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-chat-integ-'));
    db = new ChatDb(path.join(tmpDir, 'org-state.db'));
    seedOrg(db);
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

  it('full DM flow: send → inbox → ack → history → search', () => {
    const dm = channels.ensureDm(1, 2);
    const m1 = messages.send(dm.id, 1, 'Hey alice, deploy status?');
    const m2 = messages.send(dm.id, 2, 'Deploy to staging complete');
    const m3 = messages.send(dm.id, 1, 'Great, push to production');

    // Alice checks inbox — sees 2 messages from CEO (excludes own)
    const inbox = cursors.getUnread(2);
    expect(inbox).toHaveLength(1);
    expect(inbox[0].messages).toHaveLength(2);

    // Alice acks up to m1
    cursors.ack(2, dm.id, m1.seq);

    // Alice checks again — only m3 is unread
    const inbox2 = cursors.getUnread(2);
    expect(inbox2[0].messages).toHaveLength(1);
    expect(inbox2[0].messages[0].seq).toBe(m3.seq);

    // History shows all 3 messages
    const hist = messages.history(dm.id);
    expect(hist.total).toBe(3);

    // Search finds deploy messages
    const results = search.search({ pattern: 'deploy', callerId: 1, caseInsensitive: true });
    expect(results.total).toBe(2);
  });

  it('full group flow: create → send → search across channels', () => {
    channels.createGroup('sprint-1', 1, [2, 3, 4]);

    messages.send('sprint-1', 1, 'Sprint kickoff — focus on auth feature');
    messages.send('sprint-1', 2, 'Starting auth backend');
    messages.send('sprint-1', 3, 'QA test plan for auth ready');
    messages.send('sprint-1', 4, 'PRD updated with auth requirements');

    channels.ensureDm(1, 2);
    messages.send('dm:1:2', 1, 'Alice, auth is top priority');

    // Alice searches for "auth" — finds messages from DM + group
    const results = search.search({ pattern: 'auth', callerId: 2, caseInsensitive: true });
    expect(results.total).toBe(5);

    // Bob searches for "auth" — only group results (not in DM with alice)
    const bobResults = search.search({ pattern: 'auth', callerId: 3, caseInsensitive: true });
    expect(bobResults.total).toBe(4);

    // Search with --from filter
    const fromCeo = search.search({ pattern: 'auth', callerId: 2, fromPersonId: 1, caseInsensitive: true });
    expect(fromCeo.total).toBe(2);
  });

  it('access control: non-CEO cannot message super-user', () => {
    expect(() => access.validateSend(2, 0)).toThrow('Only CEO can message super-user');
  });

  it('access control: CEO can message super-user', () => {
    expect(() => access.validateSend(1, 0)).not.toThrow();
    channels.ensureDm(0, 1);
    const msg = messages.send('dm:0:1', 1, 'Board update: Q1 results');
    expect(msg.seq).toBe(1);
  });

  it('group lifecycle: create → add → remove → delete', () => {
    channels.createGroup('temp', 1, [2, 3]);

    channels.addMember('temp', 4);
    const info = channels.getGroupInfo('temp');
    expect(info.memberCount).toBe(4);

    channels.removeMember('temp', 3);
    const info2 = channels.getGroupInfo('temp');
    expect(info2.memberCount).toBe(3);

    messages.send('temp', 1, 'Last message before archive');
    channels.deleteGroup('temp');

    const list = channels.listGroups(1);
    expect(list.find(g => g.id === 'temp')).toBeUndefined();

    // Messages preserved after delete
    const hist = messages.history('temp');
    expect(hist.total).toBe(1);
  });
});
