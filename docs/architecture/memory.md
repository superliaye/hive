# Memory System

## Overview

Each agent has semantic memory backed by SQLite with vector embeddings and full-text search. Used during agent invocations to provide relevant context from past interactions.

## Storage

Per-agent SQLite database: `data/memory/{agentId}.sqlite`

```sql
-- Track indexed files
CREATE TABLE files (
  path  TEXT PRIMARY KEY,
  hash  TEXT,
  mtime DATETIME
);

-- Text chunks with embeddings
CREATE TABLE chunks (
  id        INTEGER PRIMARY KEY,
  path      TEXT,
  startLine INTEGER,
  endLine   INTEGER,
  text      TEXT,
  hash      TEXT,
  updatedAt DATETIME
);

-- Full-text search (BM25)
CREATE VIRTUAL TABLE chunks_fts USING fts5(text, content=chunks, content_rowid=id);

-- Vector similarity search
CREATE VIRTUAL TABLE chunks_vec USING vec0(embedding float[384]);
```

## Source Files

Per agent, these files are indexed:

1. **MEMORY.md** — Curated long-term notes (agent-editable, persists across sessions)
2. **memory/*.md** — Daily logs (last 3 days, auto-appended by daemon)

## Indexing

1. Scan source files for changes (hash-based detection)
2. Split into chunks (paragraph boundaries or fixed size)
3. Embed via HuggingFace transformers (local, offline)
4. Store in `chunks` table + FTS5 index + vec0 vector table

Indexing runs on daemon startup (background, non-blocking).

## Search

Hybrid approach combining text and semantic similarity:

1. **BM25 text search** on `chunks_fts`
2. **Vector similarity** on `chunks_vec`
3. Rank combined scores
4. Return top K results with path, line range, text snippet

Used during checkWork to enrich agent context with relevant memories before spawning.

## Daily Logs

Auto-appended by the daemon during checkWork when messages are classified as NOTE or QUEUE:

```markdown
<!-- memory/2026-03-28.md -->
- [2026-03-28T19:30:00Z] @sam in dm:0:4: PRIORITY — Dashboard bug from the board...
- [2026-03-28T19:45:00Z] @noor in dm:4:11: PR OPEN: https://github.com/...
```

Written to memory **before** marking messages as read (crash safety).
