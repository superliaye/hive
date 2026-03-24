# Memory Protocol

How you remember things between cycles.

## How Memory Works

You don't persist between activations. Every time you wake up, you start fresh — except for what's written down.

You have two kinds of memory:

**MEMORY.md** — your notebook. This is always in your prompt when you're activated. It's what you *know*. You write to it deliberately. It should contain the things you'd want to tell yourself if you lost all context and had to start over.

**Daily logs** (`memory/YYYY-MM-DD.md`) — your activity record. After each of your activations, the gateway captures what you were given (messages, events, priorities context) and what you did (responses, actions, decisions). One file per day, appended per cycle. You don't write these — the gateway does.

## Searching Your Past

You have a memory search skill:

```
hive memory search "query"
```

Use it when you need context from past activations — what you discussed, decided, or did. The search uses both keyword and semantic matching, so natural language queries work ("what did I discuss with eng-lead about the API?" or "last scaling decision").

Recent logs carry more weight than old ones (temporal decay), but nothing is lost — a decision from weeks ago will still surface if it's semantically relevant to your query.

**When to search:**
- Before making a decision that might repeat or contradict a past one
- When a collaborator references something you don't have context for
- When picking up work that was paused days ago

**When not to search:**
- For things already in your MEMORY.md (it's in your prompt, just read it)
- For things in other persistent stores (GitHub issues, priorities, etc.)

## What to Remember

Write to MEMORY.md when you learn something you'll need again:

- A decision and why it was made ("Chose X over Y because Z")
- Something about how a collaborator works ("platform-eng prefers explicit specs, doesn't like ambiguity")
- A fact about the system you're working on ("Dashboard port is 3001, auth tokens expire after 24h")
- A pattern you discovered ("When QA rejects, it's usually missing edge case tests")
- Context from a 1:1 that changes how you should work going forward

## What NOT to Remember

Don't clutter your notebook with things that belong elsewhere:

- Task completions → those are DONE priorities
- Routine messages → those are already in daily logs
- Things in GitHub issues, audit logs, or other persistent stores → don't duplicate
- Temporary facts that won't matter in 3 days

## Keeping Memory Useful

Your MEMORY.md is in your prompt every single cycle. If it's full of stale or irrelevant entries, it wastes your attention and makes you slower.

Periodically:
- Remove entries that are no longer true or no longer matter
- Consolidate entries that say similar things
- Rewrite entries to be clearer — your future self will thank you

Think of it like cleaning your desk. A cluttered notebook is worse than an empty one.

## Daily Logs

You may review recent daily logs and promote anything important to MEMORY.md. Most daily log entries are routine — only promote what you'd actually want to see next time you wake up.

Old daily logs fade naturally through temporal decay in search. Don't hoard information in MEMORY.md that lives in the logs.
