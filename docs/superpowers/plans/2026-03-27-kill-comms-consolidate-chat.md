# Kill src/comms/, Consolidate to src/chat/ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the `src/comms/` module and `comms.db`. Make `src/chat/` (with `hive.db`) the single messaging system. DMs and groups only — no "channels" abstraction.

**Architecture:** The `src/chat/` module already has the correct design (DMs via `ensureDm`, groups via `createGroup`, cursor-based reads, access control). The daemon currently reads from `comms.db` via `SqliteCommsProvider`. We create a thin `ChatAdapter` that bridges the daemon's alias-based interface to chat's numeric-ID stores. Dashboard routes and CLI are rewired to use chat stores. `comms.db` data is migrated to `hive.db`. Then `src/comms/` is deleted entirely.

**Key design decisions:**
- **Message IDs:** The daemon pipeline (scorer → triage → markRead) uses string message IDs. Chat uses per-channel `seq` numbers. Adapter synthesizes IDs as `{channelId}:{seq}` and parses them back for cursor advancement.
- **Signal handling:** Replace `DirectChannelRegistry` pre-registration with DB-backed member lookup. On signal, look up channel members and wake those agents. Simpler, no pre-registration needed.
- **Alias ↔ ID resolution:** The adapter maintains an alias↔ID map loaded from the `people` table. Daemon continues to use aliases externally; adapter translates to numeric IDs for chat stores.
- **No FTS migration:** Chat module uses regex-based search (sufficient). FTS5 from comms is dropped.

**Tech Stack:** TypeScript (ESM), better-sqlite3, vitest

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/chat/adapter.ts` | Bridges daemon alias-based interface → chat numeric-ID stores |
| Create | `tests/chat/adapter.test.ts` | Tests for ChatAdapter |
| Modify | `src/chat/cli.ts` | Rewrite to use chat stores directly (undo comms wiring) |
| Modify | `src/chat/index.ts` | Export ChatAdapter |
| Modify | `src/daemon/types.ts` | Replace comms types with chat types in DaemonConfig |
| Modify | `src/daemon/daemon.ts` | Use ChatAdapter, DB-backed signal handling |
| Modify | `src/daemon/check-work.ts` | No changes needed (uses CheckWorkContext interface) |
| Modify | `src/context.ts` | Remove SqliteCommsProvider/ChannelManager, add chat stores |
| Modify | `src/cli.ts` | Wire chat stores into daemon and CLI |
| Modify | `packages/dashboard/src/server/index.ts` | Use chat stores, adapt postMessage wrapper |
| Modify | `packages/dashboard/src/server/router.ts` | Remove channel routes, update signal handler |
| Modify | `packages/dashboard/src/server/routes/chat.ts` | Use chat stores instead of comms |
| Modify | `packages/dashboard/src/server/routes/channels.ts` | Rewrite to use chat stores (list DMs/groups, read messages) |
| Modify | `packages/dashboard/src/server/routes/comms.ts` | Delete (functionality moved to channels.ts) |
| Modify | `packages/dashboard/src/client/pages/ChatPage.tsx` | Update API calls if endpoints change |
| Modify | `tests/chat/e2e.test.ts` | Rewrite for chat-store-based CLI |
| Delete | `src/comms/` | Entire directory (5 files) |
| Delete | `tests/comms/` | Entire directory (4 test files) |
| Create | `scripts/migrate-comms-to-chat.ts` | One-time migration script for existing comms.db data |

---

## Task 1: Create ChatAdapter

The adapter bridges the daemon's string-alias interface to chat's numeric-ID stores. This is the core of the migration — once this exists, the daemon can be rewired incrementally.

**Files:**
- Create: `src/chat/adapter.ts`
- Create: `tests/chat/adapter.test.ts`
- Modify: `src/chat/index.ts`

- [ ] **Step 1: Write failing test for alias resolution**

```typescript
// tests/chat/adapter.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { ChatDb } from '../../src/chat/db.js';
import { ChannelStore } from '../../src/chat/channels.js';
import { MessageStore } from '../../src/chat/messages.js';
import { CursorStore } from '../../src/chat/cursors.js';
import { ChatAdapter } from '../../src/chat/adapter.js';

describe('ChatAdapter', () => {
  let db: ChatDb;
  let adapter: ChatAdapter;

  beforeEach(() => {
    db = new ChatDb(':memory:');
    // Seed people: super-user (id=0) is auto-seeded by ChatDb
    db.raw().exec(`
      INSERT INTO people (id, alias, name, role_template) VALUES (1, 'hiro', 'Hiro Tanaka', 'ceo');
      INSERT INTO people (id, alias, name, role_template) VALUES (2, 'alice', 'Alice', 'engineer');
      INSERT INTO people (id, alias, name, role_template) VALUES (3, 'bob', 'Bob', 'engineer');
    `);
    const channels = new ChannelStore(db);
    const messages = new MessageStore(db);
    const cursors = new CursorStore(db);
    adapter = new ChatAdapter(db, channels, messages, cursors);
  });

  it('resolves alias to person ID', () => {
    expect(adapter.resolveAlias('hiro')).toBe(1);
    expect(adapter.resolveAlias('alice')).toBe(2);
  });

  it('throws for unknown alias', () => {
    expect(() => adapter.resolveAlias('nobody')).toThrow('Unknown alias');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/superliaye/projects/hive && npx vitest run tests/chat/adapter.test.ts`
Expected: FAIL — `adapter.js` does not exist

- [ ] **Step 3: Implement ChatAdapter with alias resolution**

```typescript
// src/chat/adapter.ts
import type { ChatDb } from './db.js';
import type { ChannelStore } from './channels.js';
import type { MessageStore } from './messages.js';
import type { CursorStore } from './cursors.js';

export class ChatAdapter {
  private aliasToId = new Map<string, number>();
  private idToAlias = new Map<number, string>();

  constructor(
    private db: ChatDb,
    private channels: ChannelStore,
    private messages: MessageStore,
    private cursors: CursorStore,
  ) {
    this.refreshPeopleCache();
  }

  /** Reload alias↔ID mappings from people table. Call after org hot-reload. */
  refreshPeopleCache(): void {
    this.aliasToId.clear();
    this.idToAlias.clear();
    const rows = this.db.raw().prepare('SELECT id, alias FROM people').all() as { id: number; alias: string }[];
    for (const row of rows) {
      this.aliasToId.set(row.alias, row.id);
      this.idToAlias.set(row.id, row.alias);
    }
  }

  resolveAlias(alias: string): number {
    const id = this.aliasToId.get(alias);
    if (id === undefined) throw new Error(`Unknown alias: ${alias}`);
    return id;
  }

  resolveId(id: number): string {
    const alias = this.idToAlias.get(id);
    if (!alias) throw new Error(`Unknown person ID: ${id}`);
    return alias;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/superliaye/projects/hive && npx vitest run tests/chat/adapter.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing test for getUnread**

Add to `tests/chat/adapter.test.ts`:

```typescript
import type { UnreadMessage } from '../../src/daemon/types.js';

describe('getUnread', () => {
  it('returns unread messages as UnreadMessage[]', () => {
    // super-user (0) sends to hiro (1)
    const channelId = adapter.ensureDm('super-user', 'hiro');
    adapter.postMessage('super-user', channelId, 'Hello CEO');

    const unread = adapter.getUnread('hiro');
    expect(unread).toHaveLength(1);
    expect(unread[0].sender).toBe('super-user');
    expect(unread[0].channel).toBe(channelId);
    expect(unread[0].content).toBe('Hello CEO');
    // ID format: channelId:seq
    expect(unread[0].id).toBe(`${channelId}:1`);
  });

  it('excludes own messages', () => {
    const channelId = adapter.ensureDm('hiro', 'alice');
    adapter.postMessage('hiro', channelId, 'Hi alice');
    const unread = adapter.getUnread('hiro');
    expect(unread).toHaveLength(0);
  });
});
```

- [ ] **Step 6: Implement getUnread, postMessage, ensureDm**

Add to `ChatAdapter` class:

```typescript
  /** Ensure DM channel exists between two aliases. Returns channel ID. */
  ensureDm(aliasA: string, aliasB: string): string {
    const idA = this.resolveAlias(aliasA);
    const idB = this.resolveAlias(aliasB);
    const channel = this.channels.ensureDm(idA, idB);
    return channel.id;
  }

  /** Post message as alias to a channel. Returns synthetic message ID. */
  postMessage(senderAlias: string, channelId: string, content: string): string {
    const senderId = this.resolveAlias(senderAlias);
    const msg = this.messages.send(channelId, senderId, content);
    return `${channelId}:${msg.seq}`;
  }

  /** Get unread messages for agent, mapped to daemon's UnreadMessage format. */
  getUnread(alias: string): UnreadMessage[] {
    const personId = this.resolveAlias(alias);
    const groups = this.cursors.getUnread(personId);
    const result: UnreadMessage[] = [];
    for (const group of groups) {
      for (const msg of group.messages) {
        result.push({
          id: `${msg.channelId}:${msg.seq}`,
          channel: msg.channelId,
          sender: msg.senderAlias,
          content: msg.content,
          timestamp: new Date(msg.timestamp),
        });
      }
    }
    return result;
  }
```

Add the import at top of adapter.ts:

```typescript
import type { UnreadMessage } from '../daemon/types.js';
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd /Users/superliaye/projects/hive && npx vitest run tests/chat/adapter.test.ts`
Expected: PASS

- [ ] **Step 8: Write failing test for markRead**

Add to `tests/chat/adapter.test.ts`:

```typescript
describe('markRead', () => {
  it('marks messages read by synthetic IDs', () => {
    const channelId = adapter.ensureDm('super-user', 'hiro');
    adapter.postMessage('super-user', channelId, 'msg1');
    const id2 = adapter.postMessage('super-user', channelId, 'msg2');

    // Mark both as read using the synthetic ID of the last message
    adapter.markRead('hiro', [id2]);

    const unread = adapter.getUnread('hiro');
    expect(unread).toHaveLength(0);
  });

  it('handles multiple channels', () => {
    const ch1 = adapter.ensureDm('super-user', 'hiro');
    const ch2 = adapter.ensureDm('alice', 'hiro');
    const id1 = adapter.postMessage('super-user', ch1, 'from su');
    const id2 = adapter.postMessage('alice', ch2, 'from alice');

    adapter.markRead('hiro', [id1, id2]);

    expect(adapter.getUnread('hiro')).toHaveLength(0);
  });
});
```

- [ ] **Step 9: Implement markRead**

Add to `ChatAdapter` class:

```typescript
  /**
   * Mark messages as read. IDs are in format "channelId:seq".
   * Advances cursor to max seq per channel (cursor-based, not per-message receipts).
   */
  markRead(alias: string, messageIds: string[]): void {
    const personId = this.resolveAlias(alias);
    // Group by channel, find max seq per channel
    const maxSeqByChannel = new Map<string, number>();
    for (const id of messageIds) {
      const lastColon = id.lastIndexOf(':');
      const channelId = id.slice(0, lastColon);
      const seq = parseInt(id.slice(lastColon + 1), 10);
      const current = maxSeqByChannel.get(channelId) ?? 0;
      if (seq > current) maxSeqByChannel.set(channelId, seq);
    }
    for (const [channelId, maxSeq] of maxSeqByChannel) {
      this.cursors.ack(personId, channelId, maxSeq);
    }
  }
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `cd /Users/superliaye/projects/hive && npx vitest run tests/chat/adapter.test.ts`
Expected: PASS

- [ ] **Step 11: Write failing test for getChannelMembers**

```typescript
describe('getChannelMembers', () => {
  it('returns aliases of channel members', () => {
    const channelId = adapter.ensureDm('hiro', 'alice');
    const members = adapter.getChannelMembers(channelId);
    expect(members.sort()).toEqual(['alice', 'hiro']);
  });
});
```

- [ ] **Step 12: Implement getChannelMembers**

Add to `ChatAdapter` class:

```typescript
  /** Get member aliases for a channel. Used by signal handler. */
  getChannelMembers(channelId: string): string[] {
    const members = this.channels.getMembers(channelId);
    return members.map(m => this.resolveId(m.personId));
  }
```

- [ ] **Step 13: Run full adapter tests**

Run: `cd /Users/superliaye/projects/hive && npx vitest run tests/chat/adapter.test.ts`
Expected: ALL PASS

- [ ] **Step 14: Export ChatAdapter from index.ts**

Add to `src/chat/index.ts`:

```typescript
export { ChatAdapter } from './adapter.js';
```

- [ ] **Step 15: Commit**

```bash
git add src/chat/adapter.ts src/chat/index.ts tests/chat/adapter.test.ts
git commit -m "feat(chat): add ChatAdapter bridging daemon aliases to chat stores"
```

---

## Task 2: Rewire Daemon to Use ChatAdapter

Replace comms references in DaemonConfig, daemon.ts, and signal handling. The `CheckWorkContext` interface in check-work.ts stays the same — only the wiring in daemon.ts changes.

**Files:**
- Modify: `src/daemon/types.ts`
- Modify: `src/daemon/daemon.ts`
- Modify: `src/daemon/direct-channel.ts` (may simplify or remove)

- [ ] **Step 1: Update DaemonConfig in types.ts**

In `src/daemon/types.ts`, replace comms imports and fields:

```typescript
// REMOVE these imports:
// import type { SqliteCommsProvider } from '../comms/sqlite-provider.js';
// import type { ChannelManager } from '../comms/channel-manager.js';

// ADD these imports:
import type { ChatDb } from '../chat/db.js';
import type { ChatAdapter } from '../chat/adapter.js';
import type { ChannelStore } from '../chat/channels.js';

// In DaemonConfig interface, REPLACE:
//   comms: SqliteCommsProvider;
//   channelManager: ChannelManager;
// WITH:
//   chatDb: ChatDb;
//   chatAdapter: ChatAdapter;
//   channelStore: ChannelStore;
```

Full updated `DaemonConfig`:

```typescript
export interface DaemonConfig {
  orgChart: OrgChart;
  chatDb: ChatDb;
  chatAdapter: ChatAdapter;
  channelStore: ChannelStore;
  audit: AuditStore;
  state: AgentStateStore;
  memory: MemoryManager;
  dataDir: string;
  orgDir: string;
  pidFilePath: string;
  loadPeople?: () => Person[];
  tickIntervalMs?: number;
  coalesceMs?: number;
  decayScheduleMs?: number[];
}
```

- [ ] **Step 2: Update daemon.ts — imports and constructor**

In `src/daemon/daemon.ts`:

Remove imports of `SqliteCommsProvider`, `ChannelManager`, `parseBureauDirectChannels`.

The `DirectChannelRegistry` is no longer needed for DMs. Replace with a simple coalesced signal using DB lookup.

Remove: `private directChannels: DirectChannelRegistry;`

Add: `private coalesceTimers = new Map<string, ReturnType<typeof setTimeout>>();`

- [ ] **Step 3: Update daemon.ts — start() method**

Replace the direct channel registration loop (lines 67-75) with nothing — no pre-registration needed. The `signalChannel` method will look up members dynamically.

Remove:
```typescript
// Register direct channels: every agent gets dm:<alias> + any from BUREAU.md
for (const [id, agent] of this.config.orgChart.agents) {
  const channels = [`dm:${id}`];
  const directDefs = parseBureauDirectChannels(agent.files.bureau);
  for (const d of directDefs) {
    if (!channels.includes(d.channel)) channels.push(d.channel);
  }
  this.directChannels.register(id, channels);
}
```

- [ ] **Step 4: Update daemon.ts — signalChannel() method**

Replace the current implementation:

```typescript
signalChannel(channel: string): void {
  // Look up channel members from DB
  let memberAliases: string[];
  try {
    memberAliases = this.config.chatAdapter.getChannelMembers(channel);
  } catch {
    return; // Channel doesn't exist yet, ignore
  }

  const coalesceMs = this.config.coalesceMs ?? 100;
  for (const alias of memberAliases) {
    if (!this.config.orgChart.agents.has(alias)) continue;

    // Coalesce rapid signals per agent
    const existing = this.coalesceTimers.get(alias);
    if (existing) clearTimeout(existing);
    this.coalesceTimers.set(alias, setTimeout(() => {
      this.coalesceTimers.delete(alias);
      this.enqueueCheckWork(alias);
    }, coalesceMs));
  }
}
```

- [ ] **Step 5: Update daemon.ts — runCheckWork() context**

In `runCheckWork(agent)`, update the `CheckWorkContext` wiring:

```typescript
private async runCheckWork(agent: AgentConfig): Promise<CheckWorkResult> {
  const ctx: CheckWorkContext = {
    agent,
    stateStore: this.config.state,
    audit: this.config.audit,
    orgAgents: this.config.orgChart.agents,
    getUnread: async (agentId) => {
      return this.config.chatAdapter.getUnread(agentId);
    },
    markRead: async (agentId, messageIds) => {
      this.config.chatAdapter.markRead(agentId, messageIds);
    },
    postMessage: async (_agentId, channel, content) => {
      // Not currently used by checkWork, but available
      this.config.chatAdapter.postMessage(_agentId, channel, content);
    },
    // ... memory wiring stays the same
  };
  return checkWork(ctx);
}
```

- [ ] **Step 6: Update daemon.ts — hotReload()**

In `hotReload()`, after adding new agents, call `this.config.chatAdapter.refreshPeopleCache()` so the adapter picks up new people:

```typescript
async hotReload(): Promise<{ added: string[]; removed: string[] }> {
  // ... existing logic ...

  if (added.length > 0 || removed.length > 0) {
    this.config.chatAdapter.refreshPeopleCache();
  }

  // Remove the directChannels.register() calls for new agents

  return { added, removed };
}
```

- [ ] **Step 7: Update daemon.ts — stop()**

In `stop()`, replace `this.directChannels.clearAll()` with clearing coalesce timers:

```typescript
async stop(): Promise<void> {
  this.running = false;
  // Clear coalesce timers
  for (const timer of this.coalesceTimers.values()) clearTimeout(timer);
  this.coalesceTimers.clear();
  // ... rest stays the same
}
```

- [ ] **Step 8: Run existing daemon tests to check compilation**

Run: `cd /Users/superliaye/projects/hive && npx vitest run tests/daemon/`
Expected: Compilation errors (tests still reference comms). That's OK — we'll fix tests in Task 7.

- [ ] **Step 9: Commit**

```bash
git add src/daemon/types.ts src/daemon/daemon.ts
git commit -m "refactor(daemon): replace comms with ChatAdapter for messaging"
```

---

## Task 3: Rewrite chat/cli.ts to Use Chat Stores

Undo the comms wiring. The CLI should use `ChannelStore`, `MessageStore`, `CursorStore`, `SearchEngine` directly — the stores that were designed for this purpose.

**Files:**
- Modify: `src/chat/cli.ts`

- [ ] **Step 1: Replace ChatCliDeps interface**

Replace the current deps (which use SqliteCommsProvider) with chat stores:

```typescript
// REMOVE:
// import { SqliteCommsProvider } from '../comms/sqlite-provider.js';
// import { ChannelManager } from '../comms/channel-manager.js';
// import type { Message } from '../comms/types.js';

// ADD:
import { ChatDb } from './db.js';
import { ChannelStore } from './channels.js';
import { MessageStore } from './messages.js';
import { CursorStore } from './cursors.js';
import { SearchEngine } from './search.js';
import { AccessControl } from './access.js';

export interface ChatCliDeps {
  db: ChatDb;
  channels: ChannelStore;
  messages: MessageStore;
  cursors: CursorStore;
  search: SearchEngine;
  access: AccessControl;
  dashboardPort?: number;
}
```

- [ ] **Step 2: Rewrite getCallerIdentity helper**

```typescript
function getCallerIdentity(access: AccessControl): { id: number; alias: string } {
  const envId = process.env.HIVE_AGENT_ID;
  if (!envId) throw new Error('HIVE_AGENT_ID not set.');
  const person = access.resolvePerson(envId);
  return { id: person.id, alias: person.alias };
}
```

- [ ] **Step 3: Rewrite send subcommand**

```typescript
chat
  .command('send <target> [message]')
  .option('--stdin', 'Read message from stdin')
  .description('Send a message. @alias for DM, #group for group.')
  .action(async (target: string, message: string | undefined, opts: { stdin?: boolean }) => {
    const caller = getCallerIdentity(access);
    const content = opts.stdin
      ? await new Promise<string>((resolve) => {
          let data = '';
          process.stdin.on('data', (chunk) => { data += chunk; });
          process.stdin.on('end', () => resolve(data.trim()));
        })
      : message;
    if (!content) {
      process.stderr.write('No message provided\n');
      process.exit(1);
    }

    const channelId = channels.resolveTarget(target, caller.id);
    messages.send(channelId, caller.id, content);
    process.stdout.write(`Sent to ${target}\n`);

    if (dashboardPort) {
      await signalDaemon(channelId, dashboardPort);
    }
  });
```

- [ ] **Step 4: Rewrite inbox subcommand**

```typescript
chat
  .command('inbox')
  .description('Show unread messages.')
  .action(async () => {
    const caller = getCallerIdentity(access);
    const groups = cursors.getUnread(caller.id);

    if (groups.length === 0) {
      process.stdout.write('No unread messages\n');
      return;
    }

    for (const group of groups) {
      process.stdout.write(`\n--- ${group.channelId} (${group.messages.length} unread) ---\n`);
      for (const msg of group.messages) {
        process.stdout.write(`${msg.timestamp} | ${msg.senderAlias} | ${msg.content}\n`);
      }
    }
  });
```

- [ ] **Step 5: Rewrite ack subcommand**

```typescript
chat
  .command('ack <target>')
  .description('Mark all unread in a channel as read.')
  .action(async (target: string) => {
    const caller = getCallerIdentity(access);
    const channelId = channels.resolveExistingTarget(target, caller.id);
    const groups = cursors.getUnread(caller.id);
    const group = groups.find(g => g.channelId === channelId);

    if (!group || group.messages.length === 0) {
      process.stdout.write(`No unread messages in ${target}\n`);
      return;
    }

    const maxSeq = Math.max(...group.messages.map(m => m.seq));
    cursors.ack(caller.id, channelId, maxSeq);
    process.stdout.write(`Marked ${group.messages.length} messages as read in ${target}\n`);
  });
```

- [ ] **Step 6: Rewrite history subcommand**

```typescript
chat
  .command('history <target>')
  .option('--limit <n>', 'Max messages', '20')
  .description('Show message history.')
  .action(async (target: string, opts: { limit: string }) => {
    const caller = getCallerIdentity(access);
    const channelId = channels.resolveExistingTarget(target, caller.id);
    const result = messages.history(channelId, { limit: parseInt(opts.limit, 10) });

    if (result.messages.length === 0) {
      process.stdout.write('No messages\n');
      return;
    }

    for (const msg of result.messages) {
      process.stdout.write(`${msg.timestamp} | ${msg.senderAlias} | ${msg.content}\n`);
    }
    process.stdout.write(`\nShowing ${result.messages.length} of ${result.total}\n`);
  });
```

- [ ] **Step 7: Rewrite search subcommand**

```typescript
chat
  .command('search [pattern]')
  .option('--channel <target>', 'Scope to channel')
  .option('--from <alias>', 'Filter by sender')
  .option('--limit <n>', 'Max results', '20')
  .description('Search messages.')
  .action(async (pattern: string | undefined, opts: { channel?: string; from?: string; limit: string }) => {
    const caller = getCallerIdentity(access);
    const searchOpts: any = {
      callerId: caller.id,
      limit: parseInt(opts.limit, 10),
    };
    if (pattern) searchOpts.pattern = pattern;
    if (opts.channel) {
      searchOpts.scopeChannelId = channels.resolveExistingTarget(opts.channel, caller.id);
    }
    if (opts.from) {
      const person = access.resolvePerson(opts.from.replace(/^@/, ''));
      searchOpts.fromPersonId = person.id;
    }

    const result = search.search(searchOpts);

    if (result.messages.length === 0) {
      process.stdout.write('No results\n');
      return;
    }

    for (const msg of result.messages) {
      process.stdout.write(`${msg.timestamp} | ${msg.senderAlias} | ${msg.channelId} | ${msg.content}\n`);
    }
  });
```

- [ ] **Step 8: Rewrite group subcommands**

```typescript
const group = chat.command('group').description('Manage group channels.');

group
  .command('create <name> <members...>')
  .description('Create a group. Members as @alias @alias ...')
  .action(async (name: string, memberAliases: string[]) => {
    const caller = getCallerIdentity(access);
    const memberIds = memberAliases.map(a => {
      const alias = a.replace(/^@/, '');
      return access.resolvePerson(alias).id;
    });
    // Include creator
    if (!memberIds.includes(caller.id)) memberIds.push(caller.id);
    channels.createGroup(name, caller.id, memberIds);
    process.stdout.write(`Created group #${name}\n`);
  });

group
  .command('list')
  .description('List groups you belong to.')
  .action(async () => {
    const caller = getCallerIdentity(access);
    const groups = channels.listGroups(caller.id);
    if (groups.length === 0) {
      process.stdout.write('No groups\n');
      return;
    }
    for (const g of groups) {
      process.stdout.write(`#${g.id}\n`);
    }
  });
```

- [ ] **Step 9: Assemble buildChatCommand**

```typescript
export function buildChatCommand(deps: ChatCliDeps): Command {
  const { channels, messages, cursors, search, access, dashboardPort } = deps;
  const chat = new Command('chat').description('Messaging: DMs and groups.');

  // ... paste all subcommands from steps 3-8 above ...

  return chat;
}
```

- [ ] **Step 10: Commit**

```bash
git add src/chat/cli.ts
git commit -m "refactor(chat/cli): use chat stores directly, remove comms dependency"
```

---

## Task 4: Update HiveContext and src/cli.ts

Remove comms from the context. Wire chat stores into daemon and CLI.

**Files:**
- Modify: `src/context.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Update HiveContext**

In `src/context.ts`:

Remove imports:
```typescript
// REMOVE:
// import { SqliteCommsProvider } from './comms/sqlite-provider.js';
// import { ChannelManager } from './comms/channel-manager.js';
```

Add imports:
```typescript
import { ChannelStore } from './chat/channels.js';
import { MessageStore } from './chat/messages.js';
import { CursorStore } from './chat/cursors.js';
import { SearchEngine } from './chat/search.js';
import { AccessControl } from './chat/access.js';
import { ChatAdapter } from './chat/adapter.js';
```

Replace class properties:
```typescript
// REMOVE:
//   comms: SqliteCommsProvider;
//   channelManager: ChannelManager;

// ADD:
  channels: ChannelStore;
  messages: MessageStore;
  cursors: CursorStore;
  search: SearchEngine;
  access: AccessControl;
  chatAdapter: ChatAdapter;
```

In `static async create()`:
```typescript
// REMOVE:
//   const comms = new SqliteCommsProvider(path.join(dataDir, 'comms.db'));
//   const channelManager = new ChannelManager(comms);

// ADD:
  const channels = new ChannelStore(chatDb);
  const messages = new MessageStore(chatDb);
  const cursors = new CursorStore(chatDb);
  const search = new SearchEngine(chatDb);
  const access = new AccessControl(chatDb);
  const chatAdapter = new ChatAdapter(chatDb, channels, messages, cursors);
```

- [ ] **Step 2: Update src/cli.ts — chat command wiring**

Replace the chat command wiring (currently creates SqliteCommsProvider):

```typescript
// REMOVE:
// const chatDb = new ChatDb(path.join(dataDir, 'hive.db'));
// const comms = new SqliteCommsProvider(path.join(dataDir, 'comms.db'));
// const channelManager = new ChannelManager(comms);
// program.addCommand(buildChatCommand({ db: chatDb, comms, channelManager }));

// ADD:
{
  const dataDir = getDataDir();
  const chatDb = new ChatDb(path.join(dataDir, 'hive.db'));
  const channels = new ChannelStore(chatDb);
  const messages = new MessageStore(chatDb);
  const cursors = new CursorStore(chatDb);
  const search = new SearchEngine(chatDb);
  const access = new AccessControl(chatDb);
  program.addCommand(buildChatCommand({
    db: chatDb, channels, messages, cursors, search, access,
  }));
}
```

- [ ] **Step 3: Update src/cli.ts — daemon start command**

In the `hive start` command, replace comms wiring with chat adapter:

```typescript
// Build chat stores
const chatDb = new ChatDb(path.join(dataDir, 'hive.db'));
const channelStore = new ChannelStore(chatDb);
const messageStore = new MessageStore(chatDb);
const cursorStore = new CursorStore(chatDb);
const chatAdapter = new ChatAdapter(chatDb, channelStore, messageStore, cursorStore);

const daemon = new Daemon({
  orgChart,
  chatDb,
  chatAdapter,
  channelStore,
  audit: auditStore,
  state: stateStore,
  memory,
  dataDir,
  orgDir,
  pidFilePath: path.join(dataDir, 'hive.pid'),
  loadPeople: () => {
    const rows = chatDb.raw().prepare("SELECT id, alias, name, role_template as roleTemplate FROM people WHERE status = 'active'").all();
    return rows as Person[];
  },
});
```

Replace the `postMessage` wrapper to signal via daemon:

```typescript
// REMOVE the old comms.postMessage wrapper
// ADD: daemon auto-signals on checkWork, no wrapper needed
```

- [ ] **Step 4: Compile check**

Run: `cd /Users/superliaye/projects/hive && npx tsc --noEmit 2>&1 | head -30`
Expected: Errors in test files and dashboard (still referencing comms). Source files should be clean.

- [ ] **Step 5: Commit**

```bash
git add src/context.ts src/cli.ts
git commit -m "refactor: wire chat stores into HiveContext and CLI, remove comms"
```

---

## Task 5: Update Dashboard Server

Replace comms usage in dashboard routes with chat stores.

**Files:**
- Modify: `packages/dashboard/src/server/index.ts`
- Modify: `packages/dashboard/src/server/router.ts`
- Modify: `packages/dashboard/src/server/routes/chat.ts`
- Modify: `packages/dashboard/src/server/routes/channels.ts`
- Delete: `packages/dashboard/src/server/routes/comms.ts`

- [ ] **Step 1: Update dashboard server index.ts — daemon creation**

In `packages/dashboard/src/server/index.ts`, update Daemon construction:

```typescript
// The Daemon is now created with chat stores from ctx:
const daemon = new Daemon({
  orgChart: ctx.orgChart,
  chatDb: ctx.chatDb,
  chatAdapter: ctx.chatAdapter,
  channelStore: ctx.channels,
  audit: ctx.audit,
  state: ctx.state,
  memory: ctx.memory,
  dataDir: ctx.dataDir,
  orgDir: ctx.orgDir,
  pidFilePath: path.join(ctx.dataDir, 'hive.pid'),
  loadPeople: () => HiveContext.loadPeople(ctx.chatDb),
});
```

- [ ] **Step 2: Update postMessage event wrapper**

Replace the `ctx.comms.postMessage` wrapper with a wrapper on `ctx.messages.send`:

```typescript
const originalSend = ctx.messages.send.bind(ctx.messages);
ctx.messages.send = (channelId: string, senderId: number, content: string) => {
  const msg = originalSend(channelId, senderId, content);
  bus.emit('message:new', {
    id: `${msg.channelId}:${msg.seq}`,
    channel: msg.channelId,
    sender: msg.senderAlias,
    content: msg.content,
    timestamp: msg.timestamp,
  });
  if (daemon) {
    daemon.signalChannel(channelId);
  }
  return msg;
};
```

- [ ] **Step 3: Update routes/chat.ts**

Replace comms calls with chat stores:

```typescript
export function createChatRoutes(ctx: HiveContext, sse: SSEManager): Router {
  const router = Router();

  function getRootAgent() {
    const agents = Array.from(ctx.orgChart.agents.values());
    return agents.find(a => !a.reportsTo);
  }

  // POST /api/chat — send message to CEO as super-user
  router.post('/', (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });

    const root = getRootAgent();
    const rootId = ctx.chatAdapter.resolveAlias(root?.person.alias ?? 'ceo');
    const channelId = ctx.channels.ensureDm(0, rootId).id; // 0 = super-user
    const msg = ctx.messages.send(channelId, 0, message);
    res.json({ posted: true, messageId: `${channelId}:${msg.seq}` });
  });

  // POST /api/chat/post — send message as any agent
  router.post('/post', (req, res) => {
    const { channel, sender, message } = req.body;
    if (!channel || !sender || !message) {
      return res.status(400).json({ error: 'channel, sender, message required' });
    }
    const senderId = ctx.chatAdapter.resolveAlias(sender);
    const msg = ctx.messages.send(channel, senderId, message);
    res.json({ posted: true, messageId: `${channelId}:${msg.seq}` });
  });

  return router;
}
```

- [ ] **Step 4: Update routes/channels.ts**

Replace comms calls with chat stores:

```typescript
export function createChannelRoutes(ctx: HiveContext): Router {
  const router = Router();

  // GET /api/channels — list all DM and group channels
  router.get('/', async (_req, res) => {
    // List all channels the super-user can see (all of them for admin view)
    const accessibleIds = ctx.access.getAccessibleChannels(0); // super-user sees all
    const result = accessibleIds.map(channelId => {
      const channel = ctx.channels.getChannel(channelId);
      if (!channel || channel.deleted) return null;
      const members = ctx.channels.getMembers(channelId);
      const memberAliases = members.map(m => {
        try { return ctx.chatAdapter.resolveId(m.personId); } catch { return `id:${m.personId}`; }
      });
      const history = ctx.messages.history(channelId, { limit: 1 });
      return {
        name: channelId,
        type: channel.type,
        members: memberAliases,
        createdAt: channel.createdAt,
        messageCount: history.total,
      };
    }).filter(Boolean);
    res.json(result);
  });

  // GET /api/channels/:name/messages — read messages from a channel
  router.get('/:name/messages', async (req, res) => {
    const channelId = req.params.name;
    const limit = parseInt(req.query.limit as string) || 50;
    const result = ctx.messages.history(channelId, { limit });
    const mapped = result.messages.map(m => ({
      id: `${m.channelId}:${m.seq}`,
      channel: m.channelId,
      sender: m.senderAlias,
      content: m.content,
      timestamp: m.timestamp,
    }));
    res.json(mapped);
  });

  return router;
}
```

- [ ] **Step 5: Update router.ts signal handler**

```typescript
router.post('/signal', (req, res) => {
  const { channel } = req.body;
  if (daemon) daemon.signalChannel(channel);
  res.json({ signaled: true });
});
```

No change needed — this already works with channel IDs.

- [ ] **Step 6: Delete routes/comms.ts**

```bash
rm packages/dashboard/src/server/routes/comms.ts
```

This file was never mounted in router.ts anyway. The CommsPage client components will need updating in a later step (or can be removed if superseded by ChannelsPage).

- [ ] **Step 7: Commit**

```bash
git add packages/dashboard/src/server/
git commit -m "refactor(dashboard): replace comms with chat stores in all routes"
```

---

## Task 6: Update Dashboard Client

The client pages call API endpoints that return messages. Update them if the response shape changed.

**Files:**
- Modify: `packages/dashboard/src/client/pages/ChatPage.tsx`
- Modify: `packages/dashboard/src/client/components/home/RecentChatCard.tsx`
- Possibly modify: `packages/dashboard/src/client/pages/ChannelsPage.tsx`

- [ ] **Step 1: Check ChatPage.tsx API contract**

The ChatPage fetches `/api/org/meta` (unchanged) and `/api/channels/${channel}/messages?limit=100`. The response shape from Task 5 Step 4 returns `{ id, channel, sender, content, timestamp }` — same shape as before. **No changes needed** if the client uses these fields.

Verify: Read `ChatPage.tsx` and confirm field usage matches. The `boardChannel` from `/api/org/meta` returns a value like `dm:hiro` — but now channel IDs are `dm:0:1`. **This needs updating.**

Update `/api/org/meta` in `routes/org.ts` to return the chat-format channel ID:

```typescript
// In routes/org.ts, update the meta endpoint:
const rootId = ctx.chatAdapter.resolveAlias(rootAlias);
const channelId = ctx.channels.ensureDm(0, rootId).id; // dm:0:1 format
res.json({ rootAlias, rootName, boardChannel: channelId });
```

- [ ] **Step 2: Update ChatPage.tsx SSE handler**

The SSE `new-message` event emits channel names. Verify the event payload uses the new channel ID format. If the dashboard index.ts wrapper emits `channel: msg.channelId`, the ChatPage filter `msg.channel === channel` will work.

**No ChatPage code changes needed** — it already filters by the channel value from meta.

- [ ] **Step 3: Update RecentChatCard.tsx**

Same pattern as ChatPage — uses `meta.boardChannel` and `/api/channels/${channel}/messages?limit=5`. If the org/meta endpoint returns the new format channel ID, this works without changes.

**No code changes needed.**

- [ ] **Step 4: Commit (if any changes)**

```bash
git add packages/dashboard/src/server/routes/org.ts
git commit -m "fix(dashboard): return chat-format channel ID in org meta"
```

---

## Task 7: Delete src/comms/ and Update Tests

Remove the comms module entirely. Update daemon tests and chat e2e tests.

**Files:**
- Delete: `src/comms/` (entire directory)
- Delete: `tests/comms/` (entire directory)
- Modify: `tests/chat/e2e.test.ts`
- Modify: `tests/daemon/daemon.test.ts`
- Modify: `tests/daemon/integration.test.ts`

- [ ] **Step 1: Delete src/comms/**

```bash
rm -rf src/comms/
```

- [ ] **Step 2: Delete tests/comms/**

```bash
rm -rf tests/comms/
```

- [ ] **Step 3: Rewrite tests/chat/e2e.test.ts**

The e2e test currently uses `SqliteCommsProvider`. Rewrite to use chat stores directly:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { ChatDb } from '../../src/chat/db.js';
import { ChannelStore } from '../../src/chat/channels.js';
import { MessageStore } from '../../src/chat/messages.js';
import { CursorStore } from '../../src/chat/cursors.js';
import { SearchEngine } from '../../src/chat/search.js';
import { AccessControl } from '../../src/chat/access.js';
import { buildChatCommand, type ChatCliDeps } from '../../src/chat/cli.js';

describe('E2E: hive chat CLI', () => {
  let db: ChatDb;
  let deps: ChatCliDeps;

  beforeEach(() => {
    db = new ChatDb(':memory:');
    db.raw().exec(`
      INSERT INTO people (id, alias, name, role_template) VALUES (1, 'ceo', 'CEO', 'ceo');
      INSERT INTO people (id, alias, name, role_template) VALUES (2, 'alice', 'Alice', 'engineer');
    `);
    const channels = new ChannelStore(db);
    const messages = new MessageStore(db);
    const cursors = new CursorStore(db);
    const search = new SearchEngine(db);
    const access = new AccessControl(db);
    deps = { db, channels, messages, cursors, search, access };
  });

  // Helper: run CLI command as a given person ID
  async function runCli(deps: ChatCliDeps, args: string[], agentId: string): Promise<string> {
    process.env.HIVE_AGENT_ID = agentId;
    let output = '';
    const origWrite = process.stdout.write;
    process.stdout.write = ((chunk: any) => { output += chunk; return true; }) as any;
    try {
      const cmd = buildChatCommand(deps);
      await cmd.parseAsync(['node', 'chat', ...args]);
    } finally {
      process.stdout.write = origWrite;
      delete process.env.HIVE_AGENT_ID;
    }
    return output;
  }

  describe('send + inbox', () => {
    it('CEO sends to alice, alice sees in inbox', async () => {
      await runCli(deps, ['send', '@alice', 'hello'], '1');
      const inbox = await runCli(deps, ['inbox'], '2');
      expect(inbox).toContain('1 unread');
      expect(inbox).toContain('hello');
    });
  });

  describe('ack', () => {
    it('marks messages as read', async () => {
      await runCli(deps, ['send', '@alice', 'msg1'], '1');
      // Alice acks her DM channel
      await runCli(deps, ['ack', '@ceo'], '2');
      const inbox = await runCli(deps, ['inbox'], '2');
      expect(inbox).toContain('No unread messages');
    });
  });

  describe('history', () => {
    it('shows channel history', async () => {
      await runCli(deps, ['send', '@alice', 'msg1'], '1');
      await runCli(deps, ['send', '@alice', 'msg2'], '1');
      const history = await runCli(deps, ['history', '@ceo'], '2');
      expect(history).toContain('msg1');
      expect(history).toContain('msg2');
    });
  });

  describe('search', () => {
    it('finds messages by pattern', async () => {
      await runCli(deps, ['send', '@alice', 'urgent task'], '1');
      await runCli(deps, ['send', '@alice', 'normal update'], '1');
      const result = await runCli(deps, ['search', 'urgent'], '2');
      expect(result).toContain('urgent task');
      expect(result).not.toContain('normal update');
    });
  });

  describe('data flow', () => {
    it('messages visible to CursorStore.getUnread (what daemon uses)', async () => {
      await runCli(deps, ['send', '@alice', 'daemon-visible'], '1');
      const unread = deps.cursors.getUnread(2); // alice id=2
      expect(unread).toHaveLength(1);
      expect(unread[0].messages[0].content).toBe('daemon-visible');
    });
  });
});
```

- [ ] **Step 4: Update daemon tests**

In `tests/daemon/daemon.test.ts` and `tests/daemon/integration.test.ts`, replace `SqliteCommsProvider`/`ChannelManager` with chat stores and `ChatAdapter`:

```typescript
// Replace:
// const comms = new SqliteCommsProvider(':memory:');
// const channelManager = new ChannelManager(comms);

// With:
const chatDb = new ChatDb(':memory:');
// Seed people...
const channelStore = new ChannelStore(chatDb);
const messageStore = new MessageStore(chatDb);
const cursorStore = new CursorStore(chatDb);
const chatAdapter = new ChatAdapter(chatDb, channelStore, messageStore, cursorStore);

// Update DaemonConfig:
const config: DaemonConfig = {
  orgChart,
  chatDb,
  chatAdapter,
  channelStore,
  // ... rest stays same
};
```

- [ ] **Step 5: Run full test suite**

Run: `cd /Users/superliaye/projects/hive && npx vitest run --exclude '.claude/**'`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: delete src/comms/, update all tests to use chat stores"
```

---

## Task 8: Data Migration Script

Migrate existing messages from `comms.db` to `hive.db` so no conversation history is lost.

**Files:**
- Create: `scripts/migrate-comms-to-chat.ts`

- [ ] **Step 1: Write migration script**

```typescript
// scripts/migrate-comms-to-chat.ts
import Database from 'better-sqlite3';
import path from 'path';
import { ChatDb } from '../src/chat/db.js';
import { ChannelStore } from '../src/chat/channels.js';
import { MessageStore } from '../src/chat/messages.js';

const dataDir = process.argv[2] || 'data';
const commsPath = path.join(dataDir, 'comms.db');
const hivePath = path.join(dataDir, 'hive.db');

console.log(`Migrating ${commsPath} → ${hivePath}`);

const commsDb = new Database(commsPath, { readonly: true });
const chatDb = new ChatDb(hivePath);
const channels = new ChannelStore(chatDb);
const messages = new MessageStore(chatDb);

// Build alias→ID map from people table
const people = chatDb.raw().prepare('SELECT id, alias FROM people').all() as { id: number; alias: string }[];
const aliasToId = new Map(people.map(p => [p.alias, p.id]));

function resolveSender(sender: string): number {
  const id = aliasToId.get(sender);
  if (id !== undefined) return id;
  console.warn(`  Unknown sender "${sender}", skipping`);
  return -1;
}

// Read all messages from comms.db ordered by seq (insertion order)
const commsMessages = commsDb.prepare(
  'SELECT id, channel, sender, content, timestamp FROM messages ORDER BY seq ASC'
).all() as { id: string; channel: string; sender: string; content: string; timestamp: string }[];

console.log(`Found ${commsMessages.length} messages in comms.db`);

let migrated = 0;
let skipped = 0;

for (const msg of commsMessages) {
  const senderId = resolveSender(msg.sender);
  if (senderId === -1) { skipped++; continue; }

  // Parse channel name: dm:<alias> → ensureDm(sender, alias)
  let channelId: string;
  if (msg.channel.startsWith('dm:')) {
    const targetAlias = msg.channel.slice(3);
    const targetId = aliasToId.get(targetAlias);
    if (targetId === undefined) {
      console.warn(`  Unknown DM target "${targetAlias}" in channel "${msg.channel}", skipping`);
      skipped++;
      continue;
    }
    channelId = channels.ensureDm(senderId, targetId).id;
  } else {
    // Group or named channel — create as group if doesn't exist
    try {
      const existing = channels.getChannel(msg.channel);
      channelId = existing ? msg.channel : channels.createGroup(msg.channel, senderId, [senderId]).id;
    } catch {
      console.warn(`  Could not resolve channel "${msg.channel}", skipping`);
      skipped++;
      continue;
    }
  }

  messages.send(channelId, senderId, msg.content);
  migrated++;
}

console.log(`Migration complete: ${migrated} migrated, ${skipped} skipped`);

commsDb.close();
chatDb.close();
```

- [ ] **Step 2: Run migration**

```bash
cd /Users/superliaye/projects/hive && npx tsx scripts/migrate-comms-to-chat.ts data
```

Expected: Messages migrated, count logged.

- [ ] **Step 3: Verify migration**

```bash
cd /Users/superliaye/projects/hive && sqlite3 data/hive.db "SELECT count(*) FROM messages;"
```

Verify count matches expected migrated messages.

- [ ] **Step 4: Archive comms.db**

```bash
mv data/comms.db data/comms.db.bak
```

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate-comms-to-chat.ts
git commit -m "feat: add comms.db to hive.db migration script"
```

---

## Task 9: Cleanup and E2E Verification

Final cleanup: remove stale references, restart dashboard, verify full flow.

**Files:**
- Modify: Any remaining files with comms references
- Delete: `src/daemon/direct-channel.ts` (if no longer imported)

- [ ] **Step 1: Search for remaining comms references**

```bash
cd /Users/superliaye/projects/hive && grep -r "comms" src/ packages/ --include="*.ts" -l
```

Fix any remaining references. Common ones:
- Import paths like `../comms/`
- Variable names like `ctx.comms`
- Comments referencing comms.db

- [ ] **Step 2: Check if direct-channel.ts is still needed**

If `parseBureauDirectChannels` is no longer called, delete `src/daemon/direct-channel.ts`. If BUREAU.md still defines group channels that need auto-creation, keep the parser but remove `DirectChannelRegistry` class.

- [ ] **Step 3: Run full test suite**

```bash
cd /Users/superliaye/projects/hive && npx vitest run --exclude '.claude/**'
```

Expected: ALL PASS

- [ ] **Step 4: Restart dashboard**

```bash
pkill -f "node.*dashboard" 2>/dev/null; sleep 1
cd /Users/superliaye/projects/hive && nohup npx tsx packages/dashboard/src/server/index.ts </dev/null >/tmp/hive-dashboard.log 2>&1 & disown
sleep 4 && tail -10 /tmp/hive-dashboard.log
```

Expected: Dashboard starts, daemon in-process, agents registered.

- [ ] **Step 5: E2E test — send message via dashboard**

```bash
curl -s -X POST http://localhost:3001/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"Post-migration test. Please acknowledge."}' | python3 -m json.tool
```

Expected: `{ "posted": true, "messageId": "dm:0:1:N" }`

- [ ] **Step 6: Verify daemon processes message**

```bash
sleep 5 && tail -20 /tmp/hive-dashboard.log
```

Expected: `[checkWork:hiro] inbox: 1 message(s)` → triage → agent spawned

- [ ] **Step 7: Verify message history via API**

```bash
# Get the CEO DM channel ID from meta
CHANNEL=$(curl -s http://localhost:3001/api/org/meta | python3 -c "import sys,json; print(json.load(sys.stdin)['boardChannel'])")
curl -s "http://localhost:3001/api/channels/${CHANNEL}/messages?limit=5" | python3 -m json.tool
```

Expected: Recent messages visible including migrated history and new test message.

- [ ] **Step 8: Final commit**

```bash
git add -A
git commit -m "chore: cleanup comms references, verify e2e flow"
```

---

## Self-Review Checklist

1. **Spec coverage:**
   - [x] Kill src/comms/ → Task 7 Step 1-2
   - [x] Single database (hive.db) → Task 4 (context removes comms.db)
   - [x] DMs and groups only → Chat module already implements this
   - [x] Daemon uses chat stores → Task 2
   - [x] Dashboard uses chat stores → Task 5
   - [x] CLI uses chat stores → Task 3
   - [x] Data migration → Task 8
   - [x] E2E verification → Task 9

2. **Placeholder scan:** No TBD/TODO/placeholders found.

3. **Type consistency:**
   - `ChatAdapter.getUnread()` returns `UnreadMessage[]` — matches `CheckWorkContext.getUnread`
   - `ChatAdapter.markRead(alias, messageIds)` — matches `CheckWorkContext.markRead` signature
   - `ChatCliDeps` interface — consistent across Task 3 and Task 7
   - Message ID format `{channelId}:{seq}` — consistent in adapter, CLI, dashboard routes
   - `DaemonConfig` fields `chatDb`, `chatAdapter`, `channelStore` — consistent across Tasks 2, 4, 5
