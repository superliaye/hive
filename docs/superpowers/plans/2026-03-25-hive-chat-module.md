# Hive Chat Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `src/chat/` module — a local messaging system with DM + Group channels, Kafka-style read cursors, grep-aligned search, and a full CLI.

**Architecture:** New `src/chat/` module with 8 source files (db, channels, messages, cursors, search, access, cli, types). Stores data in `org-state.db` alongside existing `people` table. Replaces `src/comms/` which used a separate `comms.db`. Uses `better-sqlite3` with WAL mode. CLI uses `commander` subcommands registered under `hive chat`.

**Migration note:** `src/comms/` is NOT deleted in this plan. The new `src/chat/` module is built alongside it. Old commands (`hive post`, `hive observe`) are removed from `src/cli.ts` and the old `hive chat <message>` is replaced with the new subcommand tree. The daemon (`src/daemon/`) may still reference `comms/` — migrating the daemon is out of scope for this plan. `src/context.ts` retains its comms wiring for now.

**People table ownership:** `ChatDb` creates the `people` table with `CREATE TABLE IF NOT EXISTS` to be self-contained for testing. In production, the `people` table will be created and populated by the org scaffolding module (`src/org/scaffold.ts`) before chat is used. Both use the same schema.

**Tech Stack:** TypeScript (ESM), better-sqlite3 (WAL), commander (CLI), vitest (tests), chalk (output formatting)

---

## File Map

| File | Responsibility |
|------|---------------|
| `src/chat/db.ts` | Open DB, create/migrate chat tables (channels, channel_members, messages, read_cursors), export ChatDb class |
| `src/chat/channels.ts` | DM lazy creation, Group CRUD, membership management, channel resolution from `@alias`/`#group` |
| `src/chat/messages.ts` | Send messages (with seq ID return), history (--from/--to/--limit/--all), per-channel seq IDs |
| `src/chat/cursors.ts` | Per-person per-channel read cursors, inbox (grouped by channel), ack |
| `src/chat/search.ts` | Cross-channel search with grep-aligned flags (-i, -E, --from, --after/--before, scope) |
| `src/chat/access.ts` | Validation: super-user rules, self-message block, channel membership checks |
| `src/chat/cli.ts` | Commander subcommands for `hive chat`, arg parsing, output formatting |
| `src/chat/types.ts` | ChatMessage, ChatChannel, DmChannel, GroupChannel, SearchResult, HistoryResult types |
| `src/chat/index.ts` | Public API barrel export |
| `tests/chat/db.test.ts` | Schema creation, migration idempotency |
| `tests/chat/channels.test.ts` | DM lazy creation, group CRUD, naming rules, membership |
| `tests/chat/messages.test.ts` | Send, per-channel seq IDs, history with all flag combos |
| `tests/chat/cursors.test.ts` | Read cursors, inbox grouping, ack, crash safety |
| `tests/chat/search.test.ts` | Literal, regex, filters, pagination, access scoping |
| `tests/chat/access.test.ts` | Super-user rules, self-message, channel visibility |
| `tests/chat/cli.test.ts` | Arg parsing, error messages, output format, missing env |

**Note:** Search is split into its own file (`search.ts`) instead of living in `messages.ts` because it has significant complexity (regex mode, FTS5, cross-channel, composable filters, pagination). This keeps `messages.ts` focused on single-channel operations.

**Note:** Access control is split into `access.ts` because the rules are referenced by multiple modules (messages, channels, search, CLI) and need to be testable independently.

---

## Task 1: Types and DB Schema

**Files:**
- Create: `src/chat/types.ts`
- Create: `src/chat/db.ts`
- Create: `tests/chat/db.test.ts`

- [ ] **Step 1: Write types**

```typescript
// src/chat/types.ts

export interface Person {
  id: number;
  alias: string;
  name: string;
  roleTemplate: string | null;
  status: string;
  folder: string | null;
}

export type ChannelType = 'dm' | 'group';

export interface ChatChannel {
  id: string;           // 'dm:1:2' or group name
  type: ChannelType;
  createdBy: number;    // person_id of creator
  createdAt: string;
  deleted: boolean;
}

export interface ChannelMember {
  channelId: string;
  personId: number;
  joinedAt: string;
}

export interface ChatMessage {
  seq: number;          // per-channel sequential ID
  channelId: string;
  senderId: number;
  senderAlias: string;
  content: string;
  timestamp: string;
}

export interface HistoryResult {
  messages: ChatMessage[];
  total: number;
  channelId: string;
  showing: { from: number; to: number };
}

export interface SearchResult {
  messages: ChatMessage[];
  total: number;
  showing: { offset: number; limit: number };
}

export interface ReadCursor {
  personId: number;
  channelId: string;
  lastSeq: number;
  updatedAt: string;
}

export interface UnreadGroup {
  channelId: string;
  channelType: ChannelType;
  messages: ChatMessage[];
}
```

- [ ] **Step 2: Write failing DB test**

```typescript
// tests/chat/db.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatDb } from '../../src/chat/db.js';

describe('ChatDb', () => {
  let tmpDir: string;
  let db: ChatDb;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-chat-db-'));
    db = new ChatDb(path.join(tmpDir, 'org-state.db'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates chat tables on init', () => {
    const tables = db.raw()
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain('channels');
    expect(names).toContain('channel_members');
    expect(names).toContain('messages');
    expect(names).toContain('read_cursors');
  });

  it('is idempotent — calling init twice does not error', () => {
    const db2 = new ChatDb(path.join(tmpDir, 'org-state.db'));
    db2.close();
  });

  it('enables WAL mode', () => {
    const result = db.raw().pragma('journal_mode') as { journal_mode: string }[];
    expect(result[0].journal_mode).toBe('wal');
  });

  it('enables foreign keys', () => {
    const result = db.raw().pragma('foreign_keys') as { foreign_keys: number }[];
    expect(result[0].foreign_keys).toBe(1);
  });

  it('seeds super-user in people table if not exists', () => {
    const row = db.raw().prepare('SELECT * FROM people WHERE id = 0').get() as any;
    expect(row).toBeDefined();
    expect(row.alias).toBe('super-user');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /Users/superliaye/projects/hive && npx vitest run tests/chat/db.test.ts`
Expected: FAIL — module `../../src/chat/db.js` not found

- [ ] **Step 4: Implement ChatDb**

```typescript
// src/chat/db.ts
import Database from 'better-sqlite3';

export class ChatDb {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS people (
        id INTEGER PRIMARY KEY,
        alias TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        role_template TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        folder TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('dm', 'group')),
        created_by INTEGER NOT NULL REFERENCES people(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        deleted INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS channel_members (
        channel_id TEXT NOT NULL REFERENCES channels(id),
        person_id INTEGER NOT NULL REFERENCES people(id),
        joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (channel_id, person_id)
      );

      CREATE TABLE IF NOT EXISTS messages (
        seq INTEGER NOT NULL,
        channel_id TEXT NOT NULL REFERENCES channels(id),
        sender_id INTEGER NOT NULL REFERENCES people(id),
        content TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (channel_id, seq)
      );

      CREATE TABLE IF NOT EXISTS read_cursors (
        person_id INTEGER NOT NULL REFERENCES people(id),
        channel_id TEXT NOT NULL REFERENCES channels(id),
        last_seq INTEGER NOT NULL DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (person_id, channel_id)
      );

      CREATE INDEX IF NOT EXISTS idx_messages_channel_ts ON messages(channel_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
      CREATE INDEX IF NOT EXISTS idx_channel_members_person ON channel_members(person_id);
    `);

    // Seed super-user if not exists
    this.db.prepare(`
      INSERT OR IGNORE INTO people (id, alias, name, role_template, status, folder)
      VALUES (0, 'super-user', 'Super User', NULL, 'active', NULL)
    `).run();
  }

  /** Expose raw database for modules that need direct access */
  raw(): Database.Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/superliaye/projects/hive && npx vitest run tests/chat/db.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 6: Commit**

```bash
git add src/chat/types.ts src/chat/db.ts tests/chat/db.test.ts
git commit -m "feat(chat): add types and ChatDb with schema + tests"
```

---

## Task 2: Access Control

**Files:**
- Create: `src/chat/access.ts`
- Create: `tests/chat/access.test.ts`

**Why first:** Other modules (channels, messages) call access checks. Implementing this first means channels/messages can import and use it immediately.

- [ ] **Step 1: Write failing access test**

```typescript
// tests/chat/access.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatDb } from '../../src/chat/db.js';
import { AccessControl } from '../../src/chat/access.js';

function seedPeople(db: ChatDb) {
  const raw = db.raw();
  // super-user already seeded by ChatDb
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
      // Create a group channel with only ceo
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/superliaye/projects/hive && npx vitest run tests/chat/access.test.ts`
Expected: FAIL — cannot find `../../src/chat/access.js`

- [ ] **Step 3: Implement AccessControl**

```typescript
// src/chat/access.ts
import type { ChatDb } from './db.js';
import type { Person } from './types.js';

export class AccessControl {
  constructor(private db: ChatDb) {}

  /** Resolve alias or numeric id string to Person. Throws if not found. */
  resolvePerson(aliasOrId: string): Person {
    const raw = this.db.raw();
    // Try numeric id first
    if (/^\d+$/.test(aliasOrId)) {
      const row = raw.prepare('SELECT * FROM people WHERE id = ?').get(Number(aliasOrId)) as any;
      if (row) return this.toPerson(row);
    }
    const row = raw.prepare('SELECT * FROM people WHERE alias = ?').get(aliasOrId) as any;
    if (!row) throw new Error(`Person "${aliasOrId}" not found. Run: hive chat group list`);
    return this.toPerson(row);
  }

  /** Validate that senderId can message targetId. Throws on violation. */
  validateSend(senderId: number, targetId: number): void {
    if (senderId === targetId) {
      throw new Error('Cannot send message to yourself');
    }
    if (targetId === 0) {
      const sender = this.db.raw().prepare('SELECT role_template FROM people WHERE id = ?').get(senderId) as any;
      if (!sender || sender.role_template !== 'chief-executive') {
        throw new Error('Only CEO can message super-user');
      }
    }
  }

  /** Validate that personId can be added to a group. */
  validateGroupAdd(personId: number): void {
    if (personId === 0) {
      throw new Error('Super-user cannot be added to groups');
    }
  }

  /** Throws if personId is not a member of channelId. */
  requireMembership(personId: number, channelId: string): void {
    const row = this.db.raw()
      .prepare('SELECT 1 FROM channel_members WHERE channel_id = ? AND person_id = ?')
      .get(channelId, personId);
    if (!row) {
      throw new Error('You are not a member of this channel');
    }
  }

  /** Get all channel IDs this person is a member of. */
  getAccessibleChannels(personId: number): string[] {
    const rows = this.db.raw()
      .prepare('SELECT channel_id FROM channel_members WHERE person_id = ?')
      .all(personId) as { channel_id: string }[];
    return rows.map(r => r.channel_id);
  }

  /** Parse HIVE_AGENT_ID env var. Throws if missing. */
  static requireIdentity(envValue: string | undefined): number {
    if (envValue === undefined || envValue === '') {
      throw new Error('HIVE_AGENT_ID not set. Are you running inside a hive agent?');
    }
    return Number(envValue);
  }

  private toPerson(row: any): Person {
    return {
      id: row.id,
      alias: row.alias,
      name: row.name,
      roleTemplate: row.role_template,
      status: row.status,
      folder: row.folder,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/superliaye/projects/hive && npx vitest run tests/chat/access.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/chat/access.ts tests/chat/access.test.ts
git commit -m "feat(chat): add AccessControl with person resolution and validation"
```

---

## Task 3: Channels — DM + Group CRUD

**Files:**
- Create: `src/chat/channels.ts`
- Create: `tests/chat/channels.test.ts`

- [ ] **Step 1: Write failing channels test**

```typescript
// tests/chat/channels.test.ts
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
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/superliaye/projects/hive && npx vitest run tests/chat/channels.test.ts`
Expected: FAIL — cannot find `../../src/chat/channels.js`

- [ ] **Step 3: Implement ChannelStore**

```typescript
// src/chat/channels.ts
import type { ChatDb } from './db.js';
import type { ChatChannel, ChannelMember } from './types.js';
import { AccessControl } from './access.js';

const GROUP_NAME_REGEX = /^[a-z0-9-]+$/;
const GROUP_NAME_MAX_LEN = 50;

export interface GroupInfo {
  id: string;
  createdBy: number;
  createdAt: string;
  memberCount: number;
  messageCount: number;
  members: { personId: number; alias: string }[];
}

export class ChannelStore {
  private access: AccessControl;

  constructor(private db: ChatDb) {
    this.access = new AccessControl(db);
  }

  /** Ensure DM channel exists between two people. Creates lazily. */
  ensureDm(personA: number, personB: number): ChatChannel {
    const raw = this.db.raw();
    const [lo, hi] = personA < personB ? [personA, personB] : [personB, personA];
    const id = `dm:${lo}:${hi}`;

    const existing = raw.prepare('SELECT * FROM channels WHERE id = ?').get(id) as any;
    if (existing) return this.toChannel(existing);

    const txn = raw.transaction(() => {
      raw.prepare('INSERT INTO channels (id, type, created_by) VALUES (?, ?, ?)').run(id, 'dm', lo);
      raw.prepare('INSERT INTO channel_members (channel_id, person_id) VALUES (?, ?)').run(id, lo);
      raw.prepare('INSERT INTO channel_members (channel_id, person_id) VALUES (?, ?)').run(id, hi);
    });
    txn();

    return this.toChannel(raw.prepare('SELECT * FROM channels WHERE id = ?').get(id) as any);
  }

  /** Create a named group channel. */
  createGroup(name: string, creatorId: number, memberIds: number[]): ChatChannel {
    if (!GROUP_NAME_REGEX.test(name)) {
      throw new Error(`Group name must be kebab-case [a-z0-9-]. Got: "${name}"`);
    }
    if (name.length > GROUP_NAME_MAX_LEN) {
      throw new Error(`Group name must be ${GROUP_NAME_MAX_LEN} characters or less`);
    }

    // Ensure creator is in member list
    const allMembers = new Set(memberIds);
    allMembers.add(creatorId);

    if (allMembers.size < 2) {
      throw new Error('Group must have at least 2 members');
    }

    // Validate all members exist and none is super-user
    for (const mid of allMembers) {
      this.access.validateGroupAdd(mid);
      this.access.resolvePerson(String(mid));
    }

    const raw = this.db.raw();

    const existing = raw.prepare('SELECT id FROM channels WHERE id = ?').get(name);
    if (existing) {
      throw new Error(`Group "${name}" already exists`);
    }

    const txn = raw.transaction(() => {
      raw.prepare('INSERT INTO channels (id, type, created_by) VALUES (?, ?, ?)').run(name, 'group', creatorId);
      const ins = raw.prepare('INSERT INTO channel_members (channel_id, person_id) VALUES (?, ?)');
      for (const mid of allMembers) {
        ins.run(name, mid);
      }
    });
    txn();

    return this.toChannel(raw.prepare('SELECT * FROM channels WHERE id = ?').get(name) as any);
  }

  /** Get channel by id. Returns null if not found. */
  getChannel(id: string): ChatChannel | null {
    const row = this.db.raw().prepare('SELECT * FROM channels WHERE id = ?').get(id) as any;
    return row ? this.toChannel(row) : null;
  }

  /** Get members of a channel. */
  getMembers(channelId: string): ChannelMember[] {
    const rows = this.db.raw()
      .prepare('SELECT * FROM channel_members WHERE channel_id = ?')
      .all(channelId) as any[];
    return rows.map(r => ({
      channelId: r.channel_id,
      personId: r.person_id,
      joinedAt: r.joined_at,
    }));
  }

  /** List non-deleted groups a person belongs to. */
  listGroups(personId: number): ChatChannel[] {
    const rows = this.db.raw().prepare(`
      SELECT c.* FROM channels c
      JOIN channel_members cm ON c.id = cm.channel_id
      WHERE cm.person_id = ? AND c.type = 'group' AND c.deleted = 0
      ORDER BY c.created_at DESC
    `).all(personId) as any[];
    return rows.map(r => this.toChannel(r));
  }

  /** Get group info including member count and message count. */
  getGroupInfo(groupId: string): GroupInfo {
    const raw = this.db.raw();
    const ch = raw.prepare('SELECT * FROM channels WHERE id = ? AND type = ?').get(groupId, 'group') as any;
    if (!ch) throw new Error(`Group "${groupId}" not found. Run: hive chat group list`);

    const members = raw.prepare(`
      SELECT cm.person_id, p.alias FROM channel_members cm
      JOIN people p ON cm.person_id = p.id
      WHERE cm.channel_id = ?
    `).all(groupId) as any[];

    const msgCount = raw.prepare('SELECT COUNT(*) as cnt FROM messages WHERE channel_id = ?').get(groupId) as any;

    return {
      id: groupId,
      createdBy: ch.created_by,
      createdAt: ch.created_at,
      memberCount: members.length,
      messageCount: msgCount.cnt,
      members: members.map((m: any) => ({ personId: m.person_id, alias: m.alias })),
    };
  }

  /** Add a member to a group. */
  addMember(groupId: string, personId: number): void {
    this.access.validateGroupAdd(personId);
    this.db.raw()
      .prepare('INSERT OR IGNORE INTO channel_members (channel_id, person_id) VALUES (?, ?)')
      .run(groupId, personId);
  }

  /** Remove a member from a group. */
  removeMember(groupId: string, personId: number): void {
    this.db.raw()
      .prepare('DELETE FROM channel_members WHERE channel_id = ? AND person_id = ?')
      .run(groupId, personId);
  }

  /** Soft-delete a group. Messages are preserved for audit. */
  deleteGroup(groupId: string): void {
    this.db.raw()
      .prepare('UPDATE channels SET deleted = 1 WHERE id = ? AND type = ?')
      .run(groupId, 'group');
  }

  /** Resolve @alias or #group target string to channel id. Creates DM lazily if needed. */
  resolveTarget(target: string, callerId: number): string {
    if (target.startsWith('@')) {
      const alias = target.slice(1);
      const person = this.access.resolvePerson(alias);
      const dm = this.ensureDm(callerId, person.id);
      return dm.id;
    }
    if (target.startsWith('#')) {
      const groupName = target.slice(1);
      const ch = this.getChannel(groupName);
      if (!ch || ch.type !== 'group' || ch.deleted) {
        throw new Error(`Group "${groupName}" not found. Run: hive chat group list`);
      }
      return ch.id;
    }
    throw new Error(`Target must start with @ (DM) or # (group). Got: "${target}"`);
  }

  private toChannel(row: any): ChatChannel {
    return {
      id: row.id,
      type: row.type,
      createdBy: row.created_by,
      createdAt: row.created_at,
      deleted: row.deleted === 1,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/superliaye/projects/hive && npx vitest run tests/chat/channels.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/chat/channels.ts tests/chat/channels.test.ts
git commit -m "feat(chat): add ChannelStore with DM lazy creation and Group CRUD"
```

---

## Task 4: Messages — Send + History

**Files:**
- Create: `src/chat/messages.ts`
- Create: `tests/chat/messages.test.ts`

- [ ] **Step 1: Write failing messages test**

```typescript
// tests/chat/messages.test.ts
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
      expect(msg.seq).toBe(1); // independent from dm:1:2
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
      expect(result.messages).toHaveLength(6); // seq 25-30
      expect(result.messages[0].seq).toBe(25);
    });

    it('respects --to', () => {
      const result = messages.history('dm:1:2', { to: 5 });
      expect(result.messages).toHaveLength(5); // seq 1-5
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/superliaye/projects/hive && npx vitest run tests/chat/messages.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement MessageStore**

```typescript
// src/chat/messages.ts
import type { ChatDb } from './db.js';
import type { ChatMessage, HistoryResult } from './types.js';

export interface HistoryOpts {
  limit?: number;
  from?: number;
  to?: number;
  all?: boolean;
}

const DEFAULT_LIMIT = 20;

export class MessageStore {
  constructor(private db: ChatDb) {}

  /** Send a message to a channel. Returns the message with per-channel seq. Atomic. */
  send(channelId: string, senderId: number, content: string): ChatMessage {
    const raw = this.db.raw();

    // Atomic seq generation + insert in a transaction to prevent race conditions
    const txn = raw.transaction(() => {
      const last = raw.prepare(
        'SELECT MAX(seq) as maxSeq FROM messages WHERE channel_id = ?'
      ).get(channelId) as any;
      const seq = (last?.maxSeq ?? 0) + 1;

      raw.prepare(
        'INSERT INTO messages (seq, channel_id, sender_id, content) VALUES (?, ?, ?, ?)'
      ).run(seq, channelId, senderId, content);

      const sender = raw.prepare('SELECT alias FROM people WHERE id = ?').get(senderId) as any;
      const row = raw.prepare(
        'SELECT * FROM messages WHERE channel_id = ? AND seq = ?'
      ).get(channelId, seq) as any;

      return this.toMessage(row, sender?.alias ?? 'unknown');
    });

    return txn();
  }

  /** Get message history for a channel with flexible range/limit options. */
  history(channelId: string, opts: HistoryOpts = {}): HistoryResult {
    const { from, to, all } = opts;
    const limit = opts.limit ?? DEFAULT_LIMIT;
    const raw = this.db.raw();

    if (from !== undefined && to !== undefined && from > to) {
      throw new Error('--from must be <= --to');
    }

    // Get total message count
    const totalRow = raw.prepare(
      'SELECT COUNT(*) as cnt FROM messages WHERE channel_id = ?'
    ).get(channelId) as any;
    const total = totalRow.cnt;

    // Build query
    const conditions: string[] = ['m.channel_id = ?'];
    const params: any[] = [channelId];

    if (from !== undefined) {
      conditions.push('m.seq >= ?');
      params.push(from);
    }
    if (to !== undefined) {
      conditions.push('m.seq <= ?');
      params.push(to);
    }

    const where = conditions.join(' AND ');
    let query: string;

    if (all) {
      query = `SELECT m.*, p.alias as sender_alias FROM messages m JOIN people p ON m.sender_id = p.id WHERE ${where} ORDER BY m.seq ASC`;
    } else if (from !== undefined) {
      // When --from is set, read forward from that seq
      query = `SELECT m.*, p.alias as sender_alias FROM messages m JOIN people p ON m.sender_id = p.id WHERE ${where} ORDER BY m.seq ASC LIMIT ?`;
      params.push(to !== undefined ? (to - from + 1) : limit);
    } else {
      // Default: last N messages (no --from)
      const effectiveLimit = to !== undefined ? to : limit;
      // Subquery to get last N, then re-sort ascending
      query = `SELECT * FROM (SELECT m.*, p.alias as sender_alias FROM messages m JOIN people p ON m.sender_id = p.id WHERE ${where} ORDER BY m.seq DESC LIMIT ?) ORDER BY seq ASC`;
      params.push(effectiveLimit);
    }

    const rows = raw.prepare(query).all(...params) as any[];
    const messages = rows.map((r: any) => this.toMessage(r, r.sender_alias));

    const showingFrom = messages.length > 0 ? messages[0].seq : 0;
    const showingTo = messages.length > 0 ? messages[messages.length - 1].seq : 0;

    return {
      messages,
      total,
      channelId,
      showing: { from: showingFrom, to: showingTo },
    };
  }

  private toMessage(row: any, senderAlias: string): ChatMessage {
    return {
      seq: row.seq,
      channelId: row.channel_id,
      senderId: row.sender_id,
      senderAlias,
      content: row.content,
      timestamp: row.timestamp,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/superliaye/projects/hive && npx vitest run tests/chat/messages.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/chat/messages.ts tests/chat/messages.test.ts
git commit -m "feat(chat): add MessageStore with per-channel seq IDs and history"
```

---

## Task 5: Read Cursors — Inbox + Ack

**Files:**
- Create: `src/chat/cursors.ts`
- Create: `tests/chat/cursors.test.ts`

- [ ] **Step 1: Write failing cursors test**

```typescript
// tests/chat/cursors.test.ts
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

      cursors.ack(2, 'dm:1:2', 1);

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
      cursors.ack(2, 'dm:1:2', 1); // try to go back
      const cursor = cursors.getCursor(2, 'dm:1:2');
      expect(cursor).toBe(2); // stays at 2
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
      // Future messages 2-999 will be considered "read"
      msgStore.send('dm:1:2', 1, 'msg2'); // seq 2
      const unread = cursors.getUnread(2);
      expect(unread).toHaveLength(0); // msg2 (seq 2) < cursor (999)
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/superliaye/projects/hive && npx vitest run tests/chat/cursors.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement CursorStore**

```typescript
// src/chat/cursors.ts
import type { ChatDb } from './db.js';
import type { ChatMessage, UnreadGroup } from './types.js';

export class CursorStore {
  constructor(private db: ChatDb) {}

  /** Get all unread messages for a person, grouped by channel, chronological. Excludes own messages. */
  getUnread(personId: number): UnreadGroup[] {
    const raw = this.db.raw();

    // Get all channels this person is a member of
    const channels = raw.prepare(
      'SELECT channel_id FROM channel_members WHERE person_id = ?'
    ).all(personId) as { channel_id: string }[];

    const groups: UnreadGroup[] = [];

    for (const { channel_id } of channels) {
      const cursor = this.getCursor(personId, channel_id);

      const rows = raw.prepare(`
        SELECT m.*, p.alias as sender_alias, c.type as channel_type
        FROM messages m
        JOIN people p ON m.sender_id = p.id
        JOIN channels c ON m.channel_id = c.id
        WHERE m.channel_id = ? AND m.seq > ? AND m.sender_id != ?
        ORDER BY m.seq ASC
      `).all(channel_id, cursor, personId) as any[];

      if (rows.length > 0) {
        groups.push({
          channelId: channel_id,
          channelType: rows[0].channel_type,
          messages: rows.map(r => ({
            seq: r.seq,
            channelId: r.channel_id,
            senderId: r.sender_id,
            senderAlias: r.sender_alias,
            content: r.content,
            timestamp: r.timestamp,
          })),
        });
      }
    }

    // Sort groups chronologically by earliest unread message
    groups.sort((a, b) => {
      const aTs = a.messages[0]?.timestamp ?? '';
      const bTs = b.messages[0]?.timestamp ?? '';
      return aTs.localeCompare(bTs);
    });

    return groups;
  }

  /** Advance read cursor for a person on a channel. Never goes backwards. */
  ack(personId: number, channelId: string, seq: number): void {
    this.db.raw().prepare(`
      INSERT INTO read_cursors (person_id, channel_id, last_seq, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT (person_id, channel_id) DO UPDATE SET
        last_seq = MAX(last_seq, excluded.last_seq),
        updated_at = CURRENT_TIMESTAMP
    `).run(personId, channelId, seq);
  }

  /** Get the current cursor position. Returns 0 if no cursor exists. */
  getCursor(personId: number, channelId: string): number {
    const row = this.db.raw().prepare(
      'SELECT last_seq FROM read_cursors WHERE person_id = ? AND channel_id = ?'
    ).get(personId, channelId) as any;
    return row?.last_seq ?? 0;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/superliaye/projects/hive && npx vitest run tests/chat/cursors.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/chat/cursors.ts tests/chat/cursors.test.ts
git commit -m "feat(chat): add CursorStore with Kafka-style read cursors and inbox"
```

---

## Task 6: Search — Grep-Aligned Cross-Channel

**Files:**
- Create: `src/chat/search.ts`
- Create: `tests/chat/search.test.ts`

- [ ] **Step 1: Write failing search test**

```typescript
// tests/chat/search.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ChatDb } from '../../src/chat/db.js';
import { ChannelStore } from '../../src/chat/channels.js';
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
  let channelStore: ChannelStore;
  let msgStore: MessageStore;
  let search: SearchEngine;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-chat-search-'));
    db = new ChatDb(path.join(tmpDir, 'org-state.db'));
    seedPeople(db);
    channelStore = new ChannelStore(db);
    msgStore = new MessageStore(db);
    search = new SearchEngine(db);

    // Seed some messages
    channelStore.ensureDm(1, 2);
    channelStore.ensureDm(1, 3);
    channelStore.createGroup('eng-team', 1, [1, 2, 3]);
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
    it('finds messages containing pattern across channels', () => {
      const result = search.search({ pattern: 'deploy', callerId: 1 });
      expect(result.total).toBe(3); // "Deploy..." in 3 messages
    });

    it('is case sensitive by default', () => {
      const result = search.search({ pattern: 'deploy', callerId: 1 });
      // "Deploy" (capital D) won't match "deploy" (lowercase)
      // Actually: "deploy" matches "deploying" but not "Deploy"
      // Depends on impl — let's test with lowercase match
      const result2 = search.search({ pattern: 'Deploy', callerId: 1 });
      expect(result2.total).toBe(2); // "Deploy to staging" and "Deploy pipeline"
    });

    it('case insensitive with -i flag', () => {
      const result = search.search({ pattern: 'deploy', callerId: 1, caseInsensitive: true });
      expect(result.total).toBe(4); // all deploy/Deploy/deploying
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
      const result = search.search({ pattern: 'deploy', callerId: 1, scopeChannelId: 'dm:1:2', caseInsensitive: true });
      expect(result.messages.every(m => m.channelId === 'dm:1:2')).toBe(true);
    });

    it('scopes to group', () => {
      const result = search.search({ pattern: 'deploy', callerId: 1, scopeChannelId: 'eng-team', caseInsensitive: true });
      expect(result.messages.every(m => m.channelId === 'eng-team')).toBe(true);
    });
  });

  describe('--from filter', () => {
    it('filters by sender', () => {
      const result = search.search({ pattern: 'deploy', callerId: 1, fromPersonId: 2, caseInsensitive: true });
      expect(result.messages.every(m => m.senderId === 2)).toBe(true);
    });
  });

  describe('access control', () => {
    it('only returns messages from channels caller is a member of', () => {
      // bob (id=3) is not in dm:1:2
      const result = search.search({ pattern: 'staging', callerId: 3 });
      expect(result.total).toBe(0);
    });

    it('alice (id=2) cannot see dm:1:3 messages', () => {
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

  describe('validation', () => {
    it('requires at least one filter', () => {
      expect(() => search.search({ callerId: 1 }))
        .toThrow('At least one of: pattern, scope');
    });
  });

  describe('composable filters', () => {
    it('--from + scope (DM) combined', () => {
      const result = search.search({
        pattern: 'deploy',
        callerId: 1,
        scopeChannelId: 'dm:1:2',
        fromPersonId: 2,
        caseInsensitive: true,
      });
      expect(result.messages.every(m => m.senderId === 2 && m.channelId === 'dm:1:2')).toBe(true);
    });

    it('--from + scope (group) combined', () => {
      const result = search.search({
        pattern: 'tests',
        callerId: 1,
        scopeChannelId: 'eng-team',
        fromPersonId: 2,
        caseInsensitive: true,
      });
      expect(result.messages.every(m => m.senderId === 2 && m.channelId === 'eng-team')).toBe(true);
    });
  });

  describe('time filters', () => {
    it('filters by --after date', () => {
      // All messages are "now", so after yesterday should return all
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      const result = search.search({ pattern: 'deploy', callerId: 1, after: yesterday, caseInsensitive: true });
      expect(result.total).toBeGreaterThan(0);
    });

    it('filters by --before date', () => {
      // Before yesterday should return none
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      const result = search.search({ pattern: 'deploy', callerId: 1, before: yesterday, caseInsensitive: true });
      expect(result.total).toBe(0);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/superliaye/projects/hive && npx vitest run tests/chat/search.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement SearchEngine**

```typescript
// src/chat/search.ts
import type { ChatDb } from './db.js';
import type { ChatMessage, SearchResult } from './types.js';
import { AccessControl } from './access.js';

export interface SearchOpts {
  pattern?: string;
  callerId: number;
  scopeChannelId?: string;    // scope to a specific channel
  fromPersonId?: number;       // --from filter
  after?: string;              // YYYY-MM-DD
  before?: string;             // YYYY-MM-DD
  caseInsensitive?: boolean;   // -i
  regex?: boolean;             // -E
  limit?: number;              // default 20
  offset?: number;             // default 0
}

const DEFAULT_LIMIT = 20;

export class SearchEngine {
  private access: AccessControl;

  constructor(private db: ChatDb) {
    this.access = new AccessControl(db);
  }

  search(opts: SearchOpts): SearchResult {
    const {
      pattern,
      callerId,
      scopeChannelId,
      fromPersonId,
      after,
      before,
      caseInsensitive = false,
      regex = false,
      limit = DEFAULT_LIMIT,
      offset = 0,
    } = opts;

    // Must have at least one filter
    if (!pattern && !scopeChannelId && fromPersonId === undefined) {
      throw new Error('At least one of: pattern, scope (@alias/#group), or --from required');
    }

    const raw = this.db.raw();

    // Get accessible channels for caller
    const accessibleChannels = scopeChannelId
      ? [scopeChannelId]
      : this.access.getAccessibleChannels(callerId);

    if (accessibleChannels.length === 0) {
      return { messages: [], total: 0, showing: { offset, limit } };
    }

    // If scoped, verify membership
    if (scopeChannelId) {
      this.access.requireMembership(callerId, scopeChannelId);
    }

    // Fetch candidate messages from accessible channels
    const placeholders = accessibleChannels.map(() => '?').join(',');
    const conditions: string[] = [`m.channel_id IN (${placeholders})`];
    const params: any[] = [...accessibleChannels];

    if (fromPersonId !== undefined) {
      conditions.push('m.sender_id = ?');
      params.push(fromPersonId);
    }

    if (after) {
      conditions.push('m.timestamp >= ?');
      params.push(after + ' 00:00:00');
    }

    if (before) {
      conditions.push('m.timestamp < ?');
      params.push(before + ' 00:00:00');
    }

    const where = conditions.join(' AND ');
    const query = `
      SELECT m.*, p.alias as sender_alias
      FROM messages m
      JOIN people p ON m.sender_id = p.id
      WHERE ${where}
      ORDER BY m.timestamp DESC, m.channel_id, m.seq DESC
    `;

    let rows = raw.prepare(query).all(...params) as any[];

    // Apply pattern filter (literal or regex) in application layer
    if (pattern) {
      if (regex) {
        const flags = caseInsensitive ? 'i' : '';
        const re = new RegExp(pattern, flags);
        rows = rows.filter((r: any) => re.test(r.content));
      } else {
        if (caseInsensitive) {
          const lowerPattern = pattern.toLowerCase();
          rows = rows.filter((r: any) => r.content.toLowerCase().includes(lowerPattern));
        } else {
          rows = rows.filter((r: any) => r.content.includes(pattern));
        }
      }
    }

    const total = rows.length;
    const sliced = rows.slice(offset, offset + limit);

    return {
      messages: sliced.map((r: any) => ({
        seq: r.seq,
        channelId: r.channel_id,
        senderId: r.sender_id,
        senderAlias: r.sender_alias,
        content: r.content,
        timestamp: r.timestamp,
      })),
      total,
      showing: { offset, limit },
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/superliaye/projects/hive && npx vitest run tests/chat/search.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/chat/search.ts tests/chat/search.test.ts
git commit -m "feat(chat): add SearchEngine with grep-aligned cross-channel search"
```

---

## Task 7: CLI — Commander Subcommands

**Files:**
- Create: `src/chat/cli.ts`
- Create: `src/chat/index.ts`
- Create: `tests/chat/cli.test.ts`
- Modify: `src/cli.ts` — wire `hive chat` subcommand

- [ ] **Step 1: Write failing CLI test**

```typescript
// tests/chat/cli.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
}

describe('Chat CLI', () => {
  let tmpDir: string;
  let db: ChatDb;
  let output: string[];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-chat-cli-'));
    db = new ChatDb(path.join(tmpDir, 'org-state.db'));
    seedPeople(db);
    output = [];
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function run(args: string[], agentId: string = '1'): Promise<string> {
    const oldEnv = process.env.HIVE_AGENT_ID;
    process.env.HIVE_AGENT_ID = agentId;

    const program = new Command();
    program.exitOverride();
    const chatCmd = buildChatCommand(db);
    program.addCommand(chatCmd);

    // Capture stdout
    const chunks: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = ((chunk: any) => {
      chunks.push(String(chunk));
      return true;
    }) as any;

    return program.parseAsync(['node', 'hive', 'chat', ...args])
      .then(() => {
        process.stdout.write = origWrite;
        process.env.HIVE_AGENT_ID = oldEnv;
        return chunks.join('');
      })
      .catch((err) => {
        process.stdout.write = origWrite;
        process.env.HIVE_AGENT_ID = oldEnv;
        throw err;
      });
  }

  describe('send', () => {
    it('sends DM and prints confirmation', async () => {
      const out = await run(['send', '@alice', 'hello world']);
      expect(out).toContain('Sent seq 1');
      expect(out).toContain('dm:1:2');
    });

    it('errors when HIVE_AGENT_ID not set', async () => {
      await expect(run(['send', '@alice', 'hello'], ''))
        .rejects.toThrow('HIVE_AGENT_ID not set');
    });

    it('errors on self-message', async () => {
      await expect(run(['send', '@ceo', 'hello'], '1'))
        .rejects.toThrow('Cannot send message to yourself');
    });
  });

  describe('group', () => {
    it('creates group', async () => {
      const out = await run(['group', 'create', 'eng-team', '@alice', '@bob']);
      expect(out).toContain('eng-team');
      expect(out).toContain('created');
    });

    it('lists groups', async () => {
      await run(['group', 'create', 'eng-team', '@alice', '@bob']);
      const out = await run(['group', 'list']);
      expect(out).toContain('eng-team');
    });
  });

  describe('history', () => {
    it('shows history header with total', async () => {
      await run(['send', '@alice', 'msg1']);
      await run(['send', '@alice', 'msg2']);
      const out = await run(['history', '@alice']);
      expect(out).toContain('2 of 2');
      expect(out).toContain('dm:1:2');
    });
  });

  describe('inbox', () => {
    it('shows unread messages grouped by channel', async () => {
      await run(['send', '@alice', 'hey alice'], '1');
      const out = await run(['inbox'], '2');
      expect(out).toContain('dm:1:2');
      expect(out).toContain('hey alice');
    });

    it('shows "No unread messages" when empty', async () => {
      const out = await run(['inbox'], '1');
      expect(out).toContain('No unread messages');
    });
  });

  describe('ack', () => {
    it('advances cursor and reduces inbox', async () => {
      await run(['send', '@alice', 'msg1'], '1');
      await run(['send', '@alice', 'msg2'], '1');
      await run(['ack', '@ceo', '1'], '2');
      const out = await run(['inbox'], '2');
      expect(out).toContain('msg2');
      expect(out).not.toContain('msg1');
    });
  });

  describe('search', () => {
    it('finds messages across channels', async () => {
      await run(['send', '@alice', 'deploy failed'], '1');
      await run(['send', '@bob', 'deploy succeeded'], '1');
      const out = await run(['search', 'deploy']);
      expect(out).toContain('Found 2 results');
    });
  });

  describe('group operations via CLI', () => {
    it('group info shows members', async () => {
      await run(['group', 'create', 'eng-team', '@alice', '@bob']);
      const out = await run(['group', 'info', '#eng-team']);
      expect(out).toContain('@alice');
      expect(out).toContain('@bob');
      expect(out).toContain('Members (3)');
    });

    it('group add/remove members', async () => {
      // Seed carol
      db.raw().prepare("INSERT INTO people (id, alias, name, role_template, status) VALUES (?, ?, ?, ?, 'active')").run(4, 'carol', 'Carol PM', 'product-manager');
      await run(['group', 'create', 'eng-team', '@alice', '@bob']);
      await run(['group', 'add', '#eng-team', '@carol']);
      const out = await run(['group', 'info', '#eng-team']);
      expect(out).toContain('Members (4)');
    });

    it('group delete', async () => {
      await run(['group', 'create', 'eng-team', '@alice', '@bob']);
      await run(['group', 'delete', '#eng-team']);
      const out = await run(['group', 'list']);
      expect(out).not.toContain('eng-team');
    });
  });

  describe('send to group', () => {
    it('sends to group and prints confirmation', async () => {
      await run(['group', 'create', 'eng-team', '@alice', '@bob']);
      const out = await run(['send', '#eng-team', 'team standup']);
      expect(out).toContain('Sent seq 1');
      expect(out).toContain('eng-team');
    });
  });

  describe('error handling', () => {
    it('send to deleted group fails', async () => {
      await run(['group', 'create', 'temp', '@alice', '@bob']);
      await run(['group', 'delete', '#temp']);
      await expect(run(['send', '#temp', 'hello']))
        .rejects.toThrow('not found');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/superliaye/projects/hive && npx vitest run tests/chat/cli.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement CLI and barrel export**

```typescript
// src/chat/index.ts
export { ChatDb } from './db.js';
export { ChannelStore } from './channels.js';
export { MessageStore } from './messages.js';
export { CursorStore } from './cursors.js';
export { SearchEngine } from './search.js';
export { AccessControl } from './access.js';
export { buildChatCommand } from './cli.js';
export type * from './types.js';
```

```typescript
// src/chat/cli.ts
import { Command } from 'commander';
import type { ChatDb } from './db.js';
import { ChannelStore } from './channels.js';
import { MessageStore } from './messages.js';
import { CursorStore } from './cursors.js';
import { SearchEngine } from './search.js';
import { AccessControl } from './access.js';
import type { ChatMessage } from './types.js';

function getCallerId(): number {
  return AccessControl.requireIdentity(process.env.HIVE_AGENT_ID);
}

function formatMessage(msg: ChatMessage): string {
  const ts = msg.timestamp?.replace('T', ' ').replace(/\.\d+Z?$/, '') ?? '';
  return `${msg.channelId} | ${msg.senderAlias} | seq:${msg.seq} | ${ts} | ${msg.content}`;
}

export function buildChatCommand(db: ChatDb): Command {
  const channelStore = new ChannelStore(db);
  const msgStore = new MessageStore(db);
  const cursorStore = new CursorStore(db);
  const searchEngine = new SearchEngine(db);
  const access = new AccessControl(db);

  const chat = new Command('chat')
    .description('Messaging system for agent communication');

  // --- send ---
  chat
    .command('send <target> [message]')
    .description('Send a message. @alias for DM, #group for group. Pipe via stdin if no message arg.')
    .option('--stdin', 'Read message from stdin')
    .action(async (target: string, message: string | undefined, cmdOpts: any) => {
      // Read from stdin if no message argument or --stdin flag
      if (!message || cmdOpts.stdin) {
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) {
          chunks.push(chunk);
        }
        message = Buffer.concat(chunks).toString('utf-8').trimEnd();
      }
      if (!message) {
        throw new Error('Message is required. Provide as argument or pipe via stdin.');
      }
      const callerId = getCallerId();
      const channelId = channelStore.resolveTarget(target, callerId);

      // Validate send permissions
      if (target.startsWith('@')) {
        const alias = target.slice(1);
        const person = access.resolvePerson(alias);
        access.validateSend(callerId, person.id);
      } else {
        access.requireMembership(callerId, channelId);
      }

      const msg = msgStore.send(channelId, callerId, message);
      process.stdout.write(`Sent seq ${msg.seq} to ${channelId}\n`);
    });

  // --- inbox ---
  chat
    .command('inbox')
    .description('Show unread messages grouped by channel')
    .action(() => {
      const callerId = getCallerId();
      const groups = cursorStore.getUnread(callerId);

      if (groups.length === 0) {
        process.stdout.write('No unread messages\n');
        return;
      }

      for (const group of groups) {
        process.stdout.write(`\n--- ${group.channelId} (${group.messages.length} unread) ---\n`);
        for (const msg of group.messages) {
          process.stdout.write(formatMessage(msg) + '\n');
        }
      }
    });

  // --- ack ---
  chat
    .command('ack <target> <seq>')
    .description('Advance read cursor. @alias for DM, #group for group.')
    .action((target: string, seqStr: string) => {
      const callerId = getCallerId();
      const channelId = channelStore.resolveTarget(target, callerId);
      cursorStore.ack(callerId, channelId, Number(seqStr));
      process.stdout.write(`Cursor advanced to seq ${seqStr} on ${channelId}\n`);
    });

  // --- history ---
  chat
    .command('history <target>')
    .description('Show message history. @alias for DM, #group for group.')
    .option('--limit <n>', 'Max messages to return', '20')
    .option('--from <seq>', 'Start from this seq (inclusive)')
    .option('--to <seq>', 'End at this seq (inclusive)')
    .option('--all', 'Show all messages')
    .action((target: string, opts: any) => {
      const callerId = getCallerId();
      const channelId = channelStore.resolveTarget(target, callerId);
      access.requireMembership(callerId, channelId);

      const result = msgStore.history(channelId, {
        limit: opts.all ? undefined : Number(opts.limit),
        from: opts.from ? Number(opts.from) : undefined,
        to: opts.to ? Number(opts.to) : undefined,
        all: opts.all,
      });

      const count = result.messages.length;
      process.stdout.write(
        `Showing ${count} of ${result.total} messages in ${channelId} (seq ${result.showing.from}-${result.showing.to})\n\n`
      );

      for (const msg of result.messages) {
        process.stdout.write(formatMessage(msg) + '\n');
      }
    });

  // --- search ---
  chat
    .command('search [scope] [pattern]')
    .description('Search messages. Scope: @alias (DM), #group. Pattern: literal or regex.')
    .option('--from <alias>', 'Filter by sender alias')
    .option('--after <date>', 'After date (YYYY-MM-DD)')
    .option('--before <date>', 'Before date (YYYY-MM-DD)')
    .option('-i', 'Case insensitive')
    .option('-E', 'Extended regex mode')
    .option('--limit <n>', 'Max results', '20')
    .option('--offset <n>', 'Skip first N results', '0')
    .action((scope: string | undefined, pattern: string | undefined, opts: any) => {
      const callerId = getCallerId();

      // Parse scope — if scope looks like a pattern (no @ or #), shift it
      let scopeChannelId: string | undefined;
      let actualPattern = pattern;

      if (scope && !scope.startsWith('@') && !scope.startsWith('#')) {
        // scope is actually the pattern
        actualPattern = scope;
        scopeChannelId = undefined;
      } else if (scope) {
        scopeChannelId = channelStore.resolveTarget(scope, callerId);
      }

      let fromPersonId: number | undefined;
      if (opts.from) {
        const fromAlias = opts.from.startsWith('@') ? opts.from.slice(1) : opts.from;
        fromPersonId = access.resolvePerson(fromAlias).id;
      }

      const result = searchEngine.search({
        pattern: actualPattern,
        callerId,
        scopeChannelId,
        fromPersonId,
        after: opts.after,
        before: opts.before,
        caseInsensitive: opts.i || false,
        regex: opts.E || false,
        limit: Number(opts.limit),
        offset: Number(opts.offset),
      });

      const start = Number(opts.offset) + 1;
      const end = start + result.messages.length - 1;
      process.stdout.write(`Found ${result.total} results (showing ${start}-${end})\n\n`);

      for (const msg of result.messages) {
        process.stdout.write(formatMessage(msg) + '\n');
      }
    });

  // --- group subcommand ---
  const group = chat
    .command('group')
    .description('Manage group channels');

  group
    .command('create <name> <members...>')
    .description('Create a group channel. Members: @alias @alias ...')
    .action((name: string, members: string[]) => {
      const callerId = getCallerId();
      const memberIds = members.map(m => {
        const alias = m.startsWith('@') ? m.slice(1) : m;
        return access.resolvePerson(alias).id;
      });
      channelStore.createGroup(name, callerId, memberIds);
      process.stdout.write(`Group #${name} created with ${memberIds.length + 1} members\n`);
    });

  group
    .command('list')
    .description('List groups you belong to')
    .action(() => {
      const callerId = getCallerId();
      const groups = channelStore.listGroups(callerId);
      if (groups.length === 0) {
        process.stdout.write('No groups\n');
        return;
      }
      for (const g of groups) {
        process.stdout.write(`#${g.id}\n`);
      }
    });

  group
    .command('info <name>')
    .description('Show group details')
    .action((name: string) => {
      const callerId = getCallerId();
      const groupName = name.startsWith('#') ? name.slice(1) : name;
      access.requireMembership(callerId, groupName);
      const info = channelStore.getGroupInfo(groupName);
      process.stdout.write(`Group: #${info.id}\n`);
      process.stdout.write(`Created by: person ${info.createdBy}\n`);
      process.stdout.write(`Members (${info.memberCount}): ${info.members.map(m => '@' + m.alias).join(', ')}\n`);
      process.stdout.write(`Messages: ${info.messageCount}\n`);
    });

  group
    .command('add <name> <alias>')
    .description('Add member to group')
    .action((name: string, alias: string) => {
      const callerId = getCallerId();
      const groupName = name.startsWith('#') ? name.slice(1) : name;
      access.requireMembership(callerId, groupName);
      const cleanAlias = alias.startsWith('@') ? alias.slice(1) : alias;
      const person = access.resolvePerson(cleanAlias);
      channelStore.addMember(groupName, person.id);
      process.stdout.write(`Added @${person.alias} to #${groupName}\n`);
    });

  group
    .command('remove <name> <alias>')
    .description('Remove member from group (use your own alias to leave)')
    .action((name: string, alias: string) => {
      const callerId = getCallerId();
      const groupName = name.startsWith('#') ? name.slice(1) : name;
      access.requireMembership(callerId, groupName);
      const cleanAlias = alias.startsWith('@') ? alias.slice(1) : alias;
      const person = access.resolvePerson(cleanAlias);
      channelStore.removeMember(groupName, person.id);
      process.stdout.write(`Removed @${person.alias} from #${groupName}\n`);
    });

  group
    .command('delete <name>')
    .description('Delete group (messages preserved for audit)')
    .action((name: string) => {
      const callerId = getCallerId();
      const groupName = name.startsWith('#') ? name.slice(1) : name;
      access.requireMembership(callerId, groupName);
      channelStore.deleteGroup(groupName);
      process.stdout.write(`Group #${groupName} deleted\n`);
    });

  return chat;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/superliaye/projects/hive && npx vitest run tests/chat/cli.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/chat/cli.ts src/chat/index.ts tests/chat/cli.test.ts
git commit -m "feat(chat): add CLI subcommands and barrel export"
```

---

## Task 8: Wire into Main CLI

**Files:**
- Modify: `src/cli.ts` — add `hive chat` subcommand using `buildChatCommand`

- [ ] **Step 1: Wire chat command into main CLI**

In `src/cli.ts`, add the import and register the chat command. The existing `hive chat <message>` command posts to #board — this needs to be replaced with the new chat subcommand tree.

Find the existing `chat` command registration in `src/cli.ts` and replace it:

```typescript
// Add import at top
import { ChatDb, buildChatCommand } from './chat/index.js';

// Replace the existing 'chat' command with:
// Wire chat module — uses org-state.db for storage
const chatDbPath = path.join(getDataDir(), 'org-state.db');
const chatDb = new ChatDb(chatDbPath);
const chatCmd = buildChatCommand(chatDb);
program.addCommand(chatCmd);
```

Remove the old `hive chat` and `hive post` commands (they used the old comms system).

- [ ] **Step 2: Verify the full CLI builds**

Run: `cd /Users/superliaye/projects/hive && npx tsc --noEmit`
Expected: No errors (or only pre-existing errors unrelated to chat module)

- [ ] **Step 3: Run all chat tests together**

Run: `cd /Users/superliaye/projects/hive && npx vitest run tests/chat/`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "feat(chat): wire hive chat subcommands into main CLI"
```

---

## Task 9: Integration — Full Flow Test

**Files:**
- Create: `tests/chat/integration.test.ts`

- [ ] **Step 1: Write integration test covering full send→inbox→history→search→ack flow**

```typescript
// tests/chat/integration.test.ts
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
    // CEO sends to alice
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
    // Create cross-func group
    channels.createGroup('sprint-1', 1, [2, 3, 4]);

    // Multiple people chat
    messages.send('sprint-1', 1, 'Sprint kickoff — focus on auth feature');
    messages.send('sprint-1', 2, 'Starting auth backend');
    messages.send('sprint-1', 3, 'QA test plan for auth ready');
    messages.send('sprint-1', 4, 'PRD updated with auth requirements');

    // Also a DM from CEO to alice
    channels.ensureDm(1, 2);
    messages.send('dm:1:2', 1, 'Alice, auth is top priority');

    // Alice searches for "auth" — finds messages from DM + group
    const results = search.search({ pattern: 'auth', callerId: 2, caseInsensitive: true });
    expect(results.total).toBe(5); // 4 in group + 1 in DM

    // Bob searches for "auth" — only group results (not in DM with alice)
    const bobResults = search.search({ pattern: 'auth', callerId: 3, caseInsensitive: true });
    expect(bobResults.total).toBe(4); // only group

    // Search with --from filter
    const fromCeo = search.search({ pattern: 'auth', callerId: 2, fromPersonId: 1, caseInsensitive: true });
    expect(fromCeo.total).toBe(2); // kickoff + DM
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

    // Add carol
    channels.addMember('temp', 4);
    const info = channels.getGroupInfo('temp');
    expect(info.memberCount).toBe(4);

    // Bob leaves
    channels.removeMember('temp', 3);
    const info2 = channels.getGroupInfo('temp');
    expect(info2.memberCount).toBe(3);

    // Send a message, then delete group
    messages.send('temp', 1, 'Last message before archive');
    channels.deleteGroup('temp');

    // Group doesn't appear in list
    const list = channels.listGroups(1);
    expect(list.find(g => g.id === 'temp')).toBeUndefined();

    // But messages are preserved (for audit)
    const hist = messages.history('temp');
    expect(hist.total).toBe(1);
  });
});
```

- [ ] **Step 2: Run integration test**

Run: `cd /Users/superliaye/projects/hive && npx vitest run tests/chat/integration.test.ts`
Expected: PASS

- [ ] **Step 3: Run full test suite to verify no regressions**

Run: `cd /Users/superliaye/projects/hive && npx vitest run`
Expected: All tests PASS (or only pre-existing failures unrelated to chat)

- [ ] **Step 4: Commit**

```bash
git add tests/chat/integration.test.ts
git commit -m "test(chat): add integration test covering full DM, group, search, access flows"
```

---

## Summary

| Task | Files | What it does |
|------|-------|-------------|
| 1 | types.ts, db.ts | Core types + SQLite schema |
| 2 | access.ts | Person resolution, send/group validation, membership checks |
| 3 | channels.ts | DM lazy creation, Group CRUD, target resolution |
| 4 | messages.ts | Send with per-channel seq, history with --from/--to/--limit/--all |
| 5 | cursors.ts | Kafka-style read cursors, inbox, ack |
| 6 | search.ts | Cross-channel grep-aligned search with filters |
| 7 | cli.ts, index.ts | Commander subcommands, output formatting |
| 8 | cli.ts (modify) | Wire `hive chat` into main CLI |
| 9 | integration.test.ts | Full flow: send→inbox→ack→history→search, access control |

Total: 9 tasks, ~16 source files, TDD throughout.
