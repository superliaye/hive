# Channel → Conversation Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all "channel" terminology with "conversation" across the entire codebase. Two communication types: DM and group. "Conversation" = the aggregated view of a particular DM or group.

**Architecture:** Rename DB tables (`channels` → `conversations`, `channel_members` → `conversation_members`), all TypeScript types/classes/properties, API routes, UI components, and CLI text. Since message data was recently cleared, we can use SQLite `ALTER TABLE RENAME` for the DB migration. The `dm:N:M` ID format stays unchanged.

**Tech Stack:** TypeScript, SQLite (better-sqlite3), React, Commander.js, Vitest

---

## File Structure

### Files to rename (old → new):
- `src/chat/channels.ts` → `src/chat/conversations.ts`
- `tests/chat/channels.test.ts` → `tests/chat/conversations.test.ts`
- `packages/dashboard/src/server/routes/channels.ts` → `packages/dashboard/src/server/routes/conversations.ts`
- `packages/dashboard/src/client/pages/ChannelsPage.tsx` → `packages/dashboard/src/client/pages/ConversationsPage.tsx`
- `packages/dashboard/src/client/components/channels/` → `packages/dashboard/src/client/components/conversations/`
  - `ChannelList.tsx` → `ConversationList.tsx`
  - `ChannelFeed.tsx` → `ConversationFeed.tsx`
  - `ChannelMessage.tsx` → `ConversationMessage.tsx`
- `packages/dashboard/src/client/components/home/ChannelActivityCard.tsx` → `packages/dashboard/src/client/components/home/ConversationActivityCard.tsx`

### Files to modify (not rename):
- `src/chat/db.ts` — schema rename
- `src/chat/types.ts` — type renames
- `src/chat/index.ts` — export renames
- `src/chat/access.ts` — variable/method renames
- `src/chat/cursors.ts` — variable renames
- `src/chat/messages.ts` — variable renames
- `src/chat/search.ts` — variable renames
- `src/chat/adapter.ts` — method/variable renames
- `src/chat/cli.ts` — import, variable, help text renames
- `src/daemon/daemon.ts` — method/variable renames
- `src/daemon/check-work.ts` — variable renames
- `src/daemon/types.ts` — property/comment renames
- `src/context.ts` — property renames
- `src/types.ts` — property renames
- `src/cli.ts` — import/variable renames
- `src/gateway/types.ts` — property renames
- `src/gateway/scorer.ts` — function/variable renames
- `src/gateway/triage.ts` — variable renames
- `src/audit/store.ts` — column reference in comments (keep `channel` column name for backward compat)
- `src/audit/logger.ts` — no change needed (uses `channel` as audit field name)
- `packages/dashboard/src/server/router.ts` — route mount rename
- `packages/dashboard/src/server/index.ts` — variable renames
- `packages/dashboard/src/server/sse.ts` — property renames
- `packages/dashboard/src/server/routes/system.ts` — variable rename
- `packages/dashboard/src/server/routes/chat.ts` — variable renames
- `packages/dashboard/src/client/types.ts` — interface rename
- `packages/dashboard/src/client/App.tsx` — route/import rename
- `packages/dashboard/src/client/components/shared.tsx` — function rename
- `packages/dashboard/src/client/components/layout/Sidebar.tsx` — nav label rename
- `packages/dashboard/src/client/components/audit/AuditTable.tsx` — display text
- `packages/dashboard/src/client/pages/ChatPage.tsx` — variable renames
- `packages/dashboard/src/client/components/home/RecentChatCard.tsx` — variable renames
- All test files in `tests/chat/`, `tests/daemon/`, `tests/gateway/`, `tests/context.test.ts`

### Naming conventions:
| Old | New |
|-----|-----|
| `channels` (table) | `conversations` |
| `channel_members` (table) | `conversation_members` |
| `channel_id` (column) | `conversation_id` |
| `ChannelType` | `ConversationType` |
| `ChatChannel` | `Conversation` |
| `ChannelMember` | `ConversationMember` |
| `ChannelStore` | `ConversationStore` |
| `channelId` (property) | `conversationId` |
| `channelType` (property) | `conversationType` |
| `channelCount` | `conversationCount` |
| `getChannelMembers()` | `getConversationMembers()` |
| `signalChannel()` | `signalConversation()` |
| `getChannelWeight()` | `getConversationWeight()` |
| `formatChannelName()` | `formatConversationName()` |
| `scopeChannelId` | `scopeConversationId` |
| `accessibleChannels` | `accessibleConversations` |
| `/api/channels` | `/api/conversations` |
| `/channels` (UI route) | `/conversations` |
| `"Channels"` (nav label) | `"Conversations"` |
| `--channel` (CLI flag) | `--in` |

**Note:** The audit store's `channel` column in the DB stays as-is (it's an audit trail column that existed before this rename — renaming it would break audit history). The `channel` property in `LogOpts` and `AuditEntry` also stays (it's a generic audit field).

---

### Task 1: Database schema migration

**Files:**
- Modify: `src/chat/db.ts`

This task adds a migration step to rename existing tables, then updates the schema DDL to use new names.

- [ ] **Step 1: Update schema in db.ts**

Replace the `init()` method's DDL. Add migration logic before the CREATE TABLE statements:

```typescript
private init(): void {
  // Migrate old table names if they exist
  const tables = this.db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='channels'"
  ).get();
  if (tables) {
    this.db.exec(`
      ALTER TABLE channels RENAME TO conversations;
      ALTER TABLE channel_members RENAME TO conversation_members;
    `);
    // Rename columns in dependent tables
    this.db.exec(`
      ALTER TABLE messages RENAME COLUMN channel_id TO conversation_id;
      ALTER TABLE read_cursors RENAME COLUMN channel_id TO conversation_id;
      ALTER TABLE conversation_members RENAME COLUMN channel_id TO conversation_id;
      ALTER TABLE conversations RENAME COLUMN id TO id;
    `);
    // Drop old indexes and recreate with new names
    this.db.exec(`
      DROP INDEX IF EXISTS idx_messages_channel_ts;
      DROP INDEX IF EXISTS idx_channel_members_person;
    `);
  }

  this.db.exec(`
    CREATE TABLE IF NOT EXISTS people (
      id INTEGER PRIMARY KEY,
      alias TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      role_template TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      folder TEXT,
      reports_to INTEGER REFERENCES people(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('dm', 'group')),
      created_by INTEGER NOT NULL REFERENCES people(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS conversation_members (
      conversation_id TEXT NOT NULL REFERENCES conversations(id),
      person_id INTEGER NOT NULL REFERENCES people(id),
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (conversation_id, person_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      seq INTEGER NOT NULL,
      conversation_id TEXT NOT NULL REFERENCES conversations(id),
      sender_id INTEGER NOT NULL REFERENCES people(id),
      content TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (conversation_id, seq)
    );

    CREATE TABLE IF NOT EXISTS read_cursors (
      person_id INTEGER NOT NULL REFERENCES people(id),
      conversation_id TEXT NOT NULL REFERENCES conversations(id),
      last_seq INTEGER NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (person_id, conversation_id)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation_ts ON messages(conversation_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
    CREATE INDEX IF NOT EXISTS idx_conversation_members_person ON conversation_members(person_id);
  `);

  // Seed super-user if not exists
  this.db.prepare(`
    INSERT OR IGNORE INTO people (id, alias, name, role_template, status, folder)
    VALUES (0, 'super-user', 'Super User', NULL, 'active', NULL)
  `).run();
}
```

- [ ] **Step 2: Run existing tests to verify migration works**

Run: `npx vitest run tests/chat/db.test.ts -v`
Expected: All tests pass (tests create fresh DBs, so they'll use new schema directly)

- [ ] **Step 3: Commit**

```bash
git add src/chat/db.ts
git commit -m "feat: migrate DB schema channels → conversations"
```

---

### Task 2: Rename types

**Files:**
- Modify: `src/chat/types.ts`

- [ ] **Step 1: Rename all types and properties**

```typescript
export interface Person {
  id: number;
  alias: string;
  name: string;
  roleTemplate: string | null;
  status: string;
  folder: string | null;
}

export type ConversationType = 'dm' | 'group';

export interface Conversation {
  id: string;
  type: ConversationType;
  createdBy: number;
  createdAt: string;
  deleted: boolean;
}

export interface ConversationMember {
  conversationId: string;
  personId: number;
  joinedAt: string;
}

export interface ChatMessage {
  seq: number;
  conversationId: string;
  senderId: number;
  senderAlias: string;
  content: string;
  timestamp: string;
}

export interface HistoryResult {
  messages: ChatMessage[];
  total: number;
  conversationId: string;
  showing: { from: number; to: number };
}

export interface SearchResult {
  messages: ChatMessage[];
  total: number;
  showing: { offset: number; limit: number };
}

export interface ReadCursor {
  personId: number;
  conversationId: string;
  lastSeq: number;
  updatedAt: string;
}

export interface UnreadGroup {
  conversationId: string;
  conversationType: ConversationType;
  messages: ChatMessage[];
}
```

- [ ] **Step 2: Commit**

```bash
git add src/chat/types.ts
git commit -m "refactor: rename channel types to conversation types"
```

---

### Task 3: Rename ChannelStore → ConversationStore

**Files:**
- Rename: `src/chat/channels.ts` → `src/chat/conversations.ts`
- Rename: `tests/chat/channels.test.ts` → `tests/chat/conversations.test.ts`

- [ ] **Step 1: Rename file and update class**

```bash
git mv src/chat/channels.ts src/chat/conversations.ts
git mv tests/chat/channels.test.ts tests/chat/conversations.test.ts
```

- [ ] **Step 2: Update src/chat/conversations.ts**

Full replacement — rename class to `ConversationStore`, update all SQL to use `conversations`/`conversation_members`/`conversation_id`, update method signatures and return types to use `Conversation`/`ConversationMember`/`conversationId`. Key renames:
- Class: `ChannelStore` → `ConversationStore`
- Import: `ChatChannel` → `Conversation`, `ChannelMember` → `ConversationMember`
- SQL: `channels` → `conversations`, `channel_id` → `conversation_id`, `channel_members` → `conversation_members`
- Method param names: `channelId` → `conversationId`, `groupId` stays (it's a group name, not a "channel")
- `toChannel()` → `toConversation()`
- `getChannel()` → `getConversation()`
- `getMembers()` param: `channelId` → `conversationId`
- `formatForDisplay()` param: `channelId` → `conversationId`
- Help text in errors: "channel" → "conversation" where user-facing
- `resolveTarget()` and `resolveExistingTarget()` — return type is still a string ID, just rename internal vars

- [ ] **Step 3: Update tests/chat/conversations.test.ts**

Update all imports from `channels.js` → `conversations.js`, `ChannelStore` → `ConversationStore`, and property accesses `.channelId` → `.conversationId`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/chat/conversations.test.ts -v`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: rename ChannelStore → ConversationStore"
```

---

### Task 4: Update remaining chat module files

**Files:**
- Modify: `src/chat/access.ts`
- Modify: `src/chat/cursors.ts`
- Modify: `src/chat/messages.ts`
- Modify: `src/chat/search.ts`
- Modify: `src/chat/adapter.ts`
- Modify: `src/chat/index.ts`

- [ ] **Step 1: Update access.ts**

Rename:
- `requireMembership(personId, channelId)` → `requireMembership(personId, conversationId)`
- SQL: `channel_members WHERE channel_id` → `conversation_members WHERE conversation_id`
- `getAccessibleChannels()` → `getAccessibleConversations()`
- SQL: `SELECT channel_id FROM channel_members` → `SELECT conversation_id FROM conversation_members`
- Error: "You are not a member of this channel" → "You are not a member of this conversation"

- [ ] **Step 2: Update cursors.ts**

Rename:
- SQL: `channel_members` → `conversation_members`, `channel_id` → `conversation_id`
- `ack(personId, channelId, seq)` → `ack(personId, conversationId, seq)`
- `getCursor(personId, channelId)` → `getCursor(personId, conversationId)`
- Local vars: `channel_id` → `conversation_id` in destructuring
- SQL: `read_cursors` columns `channel_id` → `conversation_id`

- [ ] **Step 3: Update messages.ts**

Rename:
- `send(channelId, ...)` → `send(conversationId, ...)`
- `history(channelId, ...)` → `history(conversationId, ...)`
- SQL: `channel_id` → `conversation_id`
- `toMessage()` mapper: `channelId: row.channel_id` → `conversationId: row.conversation_id`
- `HistoryResult.channelId` → already renamed in types

- [ ] **Step 4: Update search.ts**

Rename:
- `scopeChannelId` → `scopeConversationId` in `SearchOpts`
- `accessibleChannels` → `accessibleConversations`
- `getAccessibleChannels()` → `getAccessibleConversations()`
- SQL: `m.channel_id` → `m.conversation_id`
- `channelId: r.channel_id` → `conversationId: r.conversation_id`

- [ ] **Step 5: Update adapter.ts**

Rename:
- Import: `ChannelStore` → `ConversationStore`
- Constructor param: `private channels` → `private conversations`
- `ensureDm()`: `this.channels.ensureDm()` → `this.conversations.ensureDm()`
- `postMessage()`: `msg.channelId` → `msg.conversationId`
- `getUnread()`: `msg.channelId` → `msg.conversationId`
- `markRead()`: `channelId` → `conversationId` in local vars
- `getChannelMembers()` → `getConversationMembers()`
- `this.channels.getMembers()` → `this.conversations.getMembers()`

- [ ] **Step 6: Update index.ts**

```typescript
export { ChatDb } from './db.js';
export { ConversationStore } from './conversations.js';
export { MessageStore } from './messages.js';
export { CursorStore } from './cursors.js';
export { SearchEngine } from './search.js';
export { AccessControl } from './access.js';
export { ChatAdapter } from './adapter.js';
export { buildChatCommand } from './cli.js';
export type * from './types.js';
```

- [ ] **Step 7: Run all chat tests**

Run: `npx vitest run tests/chat/ -v`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: rename channel → conversation in chat module internals"
```

---

### Task 5: Update CLI

**Files:**
- Modify: `src/chat/cli.ts`

- [ ] **Step 1: Update imports and variable names**

Rename:
- Import: `ChannelStore` → `ConversationStore`
- `ChatCliDeps.channels` → `ChatCliDeps.conversations`
- Destructure: `const { conversations, messages, cursors, search, access } = deps`
- `channels.resolveTarget()` → `conversations.resolveTarget()`
- `channels.formatForDisplay()` → `conversations.formatForDisplay()`
- `channels.resolveExistingTarget()` → `conversations.resolveExistingTarget()`
- `channels.createGroup()` → `conversations.createGroup()`
- `channels.listGroups()` → `conversations.listGroups()`
- `channels.getMembers()` → `conversations.getMembers()`
- Local var: `channelId` → `conversationId`
- `signalDaemon(channel, port)` → `signalDaemon(conversationId, port)` (param name)
- Help text: `.description('Show unread messages grouped by channel')` → `'Show unread messages grouped by conversation'`
- Help text: `'Manage group channels'` → `'Manage groups'`
- Help text: `'Create a group channel. Members: @alias @alias ...'` → `'Create a group. Members: @alias @alias ...'`
- Help text: `'List channels you belong to'` → `'List groups you belong to'`
- Output: `'No channels'` → `'No groups'`
- Search option: `'--channel <target>'` → `'--in <target>'`
- Help: `'Scope to a channel (@alias or #group)'` → `'Scope to a conversation (@alias or #group)'`
- `opts.channel` → `opts.in`
- Help text: `'Search messages across channels'` → `'Search messages'`
- Help text: `'Mark messages as read. If no seq, marks all unread in that channel.'` → `'Mark messages as read. If no seq, marks all in that conversation.'`

- [ ] **Step 2: Run chat CLI tests**

Run: `npx vitest run tests/chat/e2e.test.ts -v`
Expected: All pass

- [ ] **Step 3: Commit**

```bash
git add src/chat/cli.ts
git commit -m "refactor: rename channel → conversation in CLI commands and help text"
```

---

### Task 6: Update daemon and gateway

**Files:**
- Modify: `src/daemon/daemon.ts`
- Modify: `src/daemon/check-work.ts`
- Modify: `src/daemon/types.ts`
- Modify: `src/gateway/types.ts`
- Modify: `src/gateway/scorer.ts`
- Modify: `src/gateway/triage.ts`

- [ ] **Step 1: Update daemon/types.ts**

Rename:
- `UnreadMessage.channel` → `UnreadMessage.conversation`
- Comment: "Direct channel coalesce window" → "Coalesce window for conversation signals"

- [ ] **Step 2: Update daemon/daemon.ts**

Rename:
- `signalChannel(channel)` → `signalConversation(conversationId)`
- `getChannelMembers()` → `getConversationMembers()`
- Comments: "channel" → "conversation"
- `postMessage` callback: `channel` param name → `conversationId`

- [ ] **Step 3: Update daemon/check-work.ts**

Rename:
- `msg.channel` → `msg.conversation` (throughout)
- `postMessage(agentId, channel, content)` → `postMessage(agentId, conversationId, content)`
- Comments about channels → conversations

- [ ] **Step 4: Update gateway/types.ts**

Rename:
- `ScoredMessage.channel` → `ScoredMessage.conversation`
- Weight name: `channel` → `conversation` in `ScoringWeights`

- [ ] **Step 5: Update gateway/scorer.ts**

Rename:
- `getChannelWeight()` → `getConversationWeight()`
- Param: `channel` → `conversationId`
- Comment: "channel priority weight" → "conversation priority weight"

- [ ] **Step 6: Update gateway/triage.ts**

Rename:
- `channel: m.channel` → `conversation: m.conversation`

- [ ] **Step 7: Run daemon and gateway tests**

Run: `npx vitest run tests/daemon/ tests/gateway/ -v`
Expected: All pass

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: rename channel → conversation in daemon and gateway"
```

---

### Task 7: Update context and top-level wiring

**Files:**
- Modify: `src/context.ts`
- Modify: `src/types.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Update src/types.ts**

Rename any `channel` property references to `conversation` (in metadata types, etc.)

- [ ] **Step 2: Update src/context.ts**

Rename:
- Import: `ChannelStore` → `ConversationStore`
- Property: `channels: ChannelStore` → `conversations: ConversationStore`
- Constructor: wire through with new name

- [ ] **Step 3: Update src/cli.ts**

Rename:
- Import: `ChannelStore` → `ConversationStore`
- `const channels = new ChannelStore(chatDb)` → `const conversations = new ConversationStore(chatDb)`
- Pass `conversations` instead of `channels` to deps

- [ ] **Step 4: Run context test**

Run: `npx vitest run tests/context.test.ts -v`
Expected: Pass

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: rename channel → conversation in context and CLI wiring"
```

---

### Task 8: Update dashboard server

**Files:**
- Rename: `packages/dashboard/src/server/routes/channels.ts` → `packages/dashboard/src/server/routes/conversations.ts`
- Modify: `packages/dashboard/src/server/router.ts`
- Modify: `packages/dashboard/src/server/index.ts`
- Modify: `packages/dashboard/src/server/sse.ts`
- Modify: `packages/dashboard/src/server/routes/system.ts`
- Modify: `packages/dashboard/src/server/routes/chat.ts`

- [ ] **Step 1: Rename and update routes file**

```bash
git mv packages/dashboard/src/server/routes/channels.ts packages/dashboard/src/server/routes/conversations.ts
```

Update the file:
- `createChannelRoutes` → `createConversationRoutes`
- `GET /` (was mounted at `/api/channels`) — update variable names: `channelId` → `conversationId`
- `ctx.channels` → `ctx.conversations` throughout
- `ctx.access.getAccessibleChannels(0)` → `ctx.access.getAccessibleConversations(0)`

- [ ] **Step 2: Update router.ts**

```typescript
import { createConversationRoutes } from './routes/conversations.js';
// ...
router.use('/conversations', createConversationRoutes(ctx));
```

Signal endpoint: rename `channel` → `conversationId` in body, call `daemon.signalConversation()`.

- [ ] **Step 3: Update index.ts**

Rename variable names where they reference channels. Update event bus wrapper to use new method names.

- [ ] **Step 4: Update sse.ts**

Rename `channel` → `conversation` in emitted event payloads.

- [ ] **Step 5: Update system.ts**

`channelCount` → `conversationCount`

- [ ] **Step 6: Update chat.ts routes**

Rename `ctx.channels` → `ctx.conversations`, variable names.

- [ ] **Step 7: Run dashboard server tests**

Run: `npx vitest run packages/dashboard/src/server/__tests__/ -v` (if exists)
Expected: Pass

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: rename channel → conversation in dashboard server"
```

---

### Task 9: Update dashboard client

**Files:**
- Rename: `packages/dashboard/src/client/pages/ChannelsPage.tsx` → `ConversationsPage.tsx`
- Rename: `packages/dashboard/src/client/components/channels/` → `conversations/`
  - `ChannelList.tsx` → `ConversationList.tsx`
  - `ChannelFeed.tsx` → `ConversationFeed.tsx`
  - `ChannelMessage.tsx` → `ConversationMessage.tsx`
- Rename: `packages/dashboard/src/client/components/home/ChannelActivityCard.tsx` → `ConversationActivityCard.tsx`
- Modify: `packages/dashboard/src/client/types.ts`
- Modify: `packages/dashboard/src/client/App.tsx`
- Modify: `packages/dashboard/src/client/components/shared.tsx`
- Modify: `packages/dashboard/src/client/components/layout/Sidebar.tsx`
- Modify: `packages/dashboard/src/client/components/audit/AuditTable.tsx`
- Modify: `packages/dashboard/src/client/pages/ChatPage.tsx`
- Modify: `packages/dashboard/src/client/components/home/RecentChatCard.tsx`

- [ ] **Step 1: Rename files**

```bash
git mv packages/dashboard/src/client/pages/ChannelsPage.tsx packages/dashboard/src/client/pages/ConversationsPage.tsx
mkdir -p packages/dashboard/src/client/components/conversations
git mv packages/dashboard/src/client/components/channels/ChannelList.tsx packages/dashboard/src/client/components/conversations/ConversationList.tsx
git mv packages/dashboard/src/client/components/channels/ChannelFeed.tsx packages/dashboard/src/client/components/conversations/ConversationFeed.tsx
git mv packages/dashboard/src/client/components/channels/ChannelMessage.tsx packages/dashboard/src/client/components/conversations/ConversationMessage.tsx
rmdir packages/dashboard/src/client/components/channels
git mv packages/dashboard/src/client/components/home/ChannelActivityCard.tsx packages/dashboard/src/client/components/home/ConversationActivityCard.tsx
```

- [ ] **Step 2: Update client types.ts**

```typescript
export interface Conversation {
  id: string;
  name: string;
  displayName?: string;
  members: string[];
  createdAt: string;
  autoGenerated: boolean;
  messageCount: number;
}
```

Update `Channel` → `Conversation` everywhere it's referenced.

- [ ] **Step 3: Update App.tsx**

```tsx
import { ConversationsPage } from './pages/ConversationsPage.js';
// ...
<Route path="conversations" element={<ConversationsPage />} />
```

- [ ] **Step 4: Update shared.tsx**

`formatChannelName()` → `formatConversationName()`

- [ ] **Step 5: Update Sidebar.tsx**

Change nav link from `/channels` → `/conversations`, label from "Channels" → "Conversations".

- [ ] **Step 6: Update all renamed component files**

In each renamed file, update:
- Component names (e.g., `ChannelList` → `ConversationList`)
- API endpoints (`/api/channels` → `/api/conversations`)
- Import paths
- Variable names referencing "channel"
- SSE event field names (`channel` → `conversation`)

- [ ] **Step 7: Update AuditTable.tsx**

Display text: keep `#{inv.channel}` as-is (audit field name stays `channel`).

- [ ] **Step 8: Update ChatPage.tsx and RecentChatCard.tsx**

Rename variable references from `channel` → `conversation`, update API endpoints.

- [ ] **Step 9: Verify dashboard builds**

Run: `cd packages/dashboard && npx tsc --noEmit` (or whatever build check exists)
Expected: No type errors

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor: rename channel → conversation in dashboard client"
```

---

### Task 10: Update all test files

**Files:**
- Modify: `tests/chat/adapter.test.ts`
- Modify: `tests/chat/access.test.ts`
- Modify: `tests/chat/cursors.test.ts`
- Modify: `tests/chat/db.test.ts`
- Modify: `tests/chat/e2e.test.ts`
- Modify: `tests/chat/errors.test.ts`
- Modify: `tests/chat/integration.test.ts`
- Modify: `tests/chat/messages.test.ts`
- Modify: `tests/chat/search.test.ts`
- Modify: `tests/context.test.ts`
- Modify: `tests/daemon/check-work.test.ts`
- Modify: `tests/daemon/daemon.test.ts`
- Modify: `tests/daemon/integration.test.ts`
- Modify: `tests/gateway/scorer.test.ts`
- Modify: `tests/gateway/triage.test.ts`
- Modify: `tests/integration/gateway.test.ts`

- [ ] **Step 1: Update all test imports and references**

In every test file:
- `ChannelStore` → `ConversationStore`
- `channels` → `conversations` (variable names)
- `.channelId` → `.conversationId`
- `.channelType` → `.conversationType`
- `getAccessibleChannels` → `getAccessibleConversations`
- `getChannelMembers` → `getConversationMembers`
- `signalChannel` → `signalConversation`
- `getChannelWeight` → `getConversationWeight`
- Import paths: `channels.js` → `conversations.js`
- `msg.channel` → `msg.conversation`

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run --exclude '.claude/**' -v`
Expected: All 378+ tests pass

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor: rename channel → conversation in all test files"
```

---

### Task 11: Final verification and cleanup

- [ ] **Step 1: Grep for any remaining "channel" references**

```bash
grep -ri "channel" src/ packages/dashboard/src/ tests/ --include="*.ts" --include="*.tsx" -l
```

Expected: Only `src/audit/store.ts` and `src/audit/logger.ts` (audit field stays `channel`), and any comments that are acceptable.

- [ ] **Step 2: Run full test suite one final time**

Run: `npx vitest run --exclude '.claude/**'`
Expected: All tests pass

- [ ] **Step 3: Final commit if any stragglers**

```bash
git add -A
git commit -m "refactor: final channel → conversation cleanup"
```
