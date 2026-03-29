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
2. **memory/*.md** — Agent-written daily notes (if any)

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

## Triage Log (separate from memory)

Triage results (NOTE/QUEUE/IGNORE/ACT_NOW classifications) are stored in a separate
per-agent `triage-log.db` SQLite database — NOT in the memory system. The daemon writes
all triage decisions there, and the last N entries are fed to the agent's system prompt
at spawn time. See [daemon.md](daemon.md) for details.
