# Data Stores

All storage uses SQLite in WAL mode for concurrent reads.

## Databases

| Database | Path | Purpose |
|----------|------|---------|
| hive.db | `data/hive.db` | People, conversations, messages, cursors, search |
| orchestrator.db | `data/orchestrator.db` | Agent state, followups |
| audit.db | `data/audit.db` | Invocation logs, token tracking |
| memory/{id}.sqlite | `data/memory/{agentId}.sqlite` | Per-agent semantic memory |

## hive.db

### people
```sql
CREATE TABLE people (
  id        INTEGER PRIMARY KEY,
  alias     TEXT UNIQUE NOT NULL,
  name      TEXT NOT NULL,
  roleTemplate TEXT,
  status    TEXT DEFAULT 'active',
  folder    TEXT NOT NULL,
  reportsTo INTEGER REFERENCES people(id),
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### conversations
```sql
CREATE TABLE conversations (
  id        TEXT PRIMARY KEY,   -- "dm:1:4" or "engineering"
  type      TEXT NOT NULL,      -- "dm" or "group"
  createdBy INTEGER,
  deleted   INTEGER DEFAULT 0,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### conversation_members
```sql
CREATE TABLE conversation_members (
  conversationId TEXT REFERENCES conversations(id),
  personId       INTEGER,
  joinedAt       DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (conversationId, personId)
);
```

### messages
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

### cursors
```sql
CREATE TABLE cursors (
  personId       INTEGER,
  conversationId TEXT,
  lastSeq        INTEGER DEFAULT 0,
  updatedAt      DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (personId, conversationId)
);
```

## orchestrator.db

### agent_state
```sql
CREATE TABLE agent_state (
  agent_id        TEXT PRIMARY KEY,
  status          TEXT,     -- idle, active, working, disposed, errored
  last_invocation DATETIME,
  last_heartbeat  DATETIME,
  current_task    TEXT,
  pid             INTEGER
);
```

### followups
```sql
CREATE TABLE followups (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id         TEXT NOT NULL,
  description      TEXT NOT NULL,
  check_command    TEXT,
  backoff_schedule TEXT NOT NULL,
  attempt          INTEGER DEFAULT 0,
  next_check_at    DATETIME NOT NULL,
  last_check_exit  INTEGER,
  last_check_output TEXT,
  status           TEXT DEFAULT 'open',
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  closed_at        DATETIME
);
```

## audit.db

### invocations
```sql
CREATE TABLE invocations (
  id                     TEXT PRIMARY KEY,
  agent_id               TEXT,
  invocation_type        TEXT,    -- checkWork, followup, memory, proposal
  model                  TEXT,
  tokens_in              INTEGER,
  tokens_out             INTEGER,
  cache_read_tokens      INTEGER,
  cache_creation_tokens  INTEGER,
  duration_ms            INTEGER,
  input_summary          TEXT,
  output_summary         TEXT,
  action_summary         TEXT,
  channel                TEXT,
  timestamp              DATETIME
);
```
