# Chat System

## Overview

SQLite-backed messaging with Kafka-style read cursors. Supports DMs (1:1) and group conversations.

## Conversations (src/chat/conversations.ts)

**DM**: Auto-created on first message. ID format: `dm:{min(a,b)}:{max(a,b)}` (canonical ordering ensures one conversation per pair).

**Group**: Created explicitly via `hive chat group create`. ID is the kebab-case name.

```sql
CREATE TABLE conversations (
  id        TEXT PRIMARY KEY,   -- "dm:1:4" or "engineering"
  type      TEXT NOT NULL,      -- "dm" or "group"
  createdBy INTEGER,
  deleted   INTEGER DEFAULT 0,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE conversation_members (
  conversationId TEXT REFERENCES conversations(id),
  personId       INTEGER,
  joinedAt       DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (conversationId, personId)
);
```

## Messages (src/chat/messages.ts)

Per-conversation sequential numbering. Sent via atomic transaction.

```sql
CREATE TABLE messages (
  seq            INTEGER,
  conversationId TEXT,
  senderId       INTEGER,
  content        TEXT,
  timestamp      DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (conversationId, seq)
);
```

Send flow:
1. Begin transaction
2. `SELECT MAX(seq) FROM messages WHERE conversationId = ?`
3. `INSERT INTO messages (seq, conversationId, senderId, content) VALUES (max+1, ...)`
4. Commit

Synthetic message ID: `{conversationId}:{seq}` (reconstructed on read).

## Read Cursors (src/chat/cursors.ts)

Per-person per-conversation position tracking. Cursor never goes backward.

```sql
CREATE TABLE cursors (
  personId       INTEGER,
  conversationId TEXT,
  lastSeq        INTEGER DEFAULT 0,
  updatedAt      DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (personId, conversationId)
);
```

**Unread query**: `messages WHERE seq > cursor AND senderId != personId`

**Cursor corruption prevention**: Agent subprocesses (spawned by daemon) have `HIVE_DAEMON_SPAWN=1` set, which blocks `hive chat ack` calls. Only the daemon advances cursors after processing messages through the checkWork cycle.

**Audit logging**: Cursor moves are logged with previous/new seq and a warning if cursor jumps ahead of max message seq.

## Access Control (src/chat/access.ts)

DMs: Both participants can read/write. Super-user (person 0) can DM anyone.

Groups: Only members can read/write. Membership managed via `hive chat group add/remove`.

## Chat Adapter (src/chat/adapter.ts)

Bridge between daemon (uses aliases) and chat store (uses person IDs):

```typescript
interface ChatAdapter {
  postMessage(senderAlias, conversationId, content) → syntheticId
  getUnread(alias) → UnreadMessage[]
  markRead(alias, messageIds) → void
  getConversationMembers(conversationId) → aliases[]
}
```

## Search (src/chat/search.ts)

Full-text search across all messages the querying person has access to. Uses SQLite FTS5.
