# Hive — Claude Code Instructions

## Required Reading

Before any architecture or design work, read `ARCHITECTURE.md` in the repo root.
It contains the system overview, module map, data flow, channel topology, and key invariants.

## Project Structure

- `src/` — Core engine (TypeScript)
- `packages/dashboard/` — Web dashboard (Express + React + Vite)
- `org/` — Live org structure (agent config files)
- `data/` — Runtime SQLite databases (gitignored)
- `skills/` — Shared skill definitions for agents
- `tests/` — Vitest test suite

## Development

```bash
npx vitest run                    # Run all tests
npx vitest run tests/gateway/     # Run specific test dir
npx tsx src/cli.ts dashboard      # Start dashboard + daemon
npx vite build                    # Rebuild dashboard client (from packages/dashboard/)
```

## Key Conventions

- Agent communication goes through `hive post` → dashboard API → `signalChannel()`. Never write directly to SQLite for message posting in the daemon.
- SQLite `CURRENT_TIMESTAMP` stores UTC without `Z`. Always use `parseUtcDatetime()` when converting to JS Date.
- Claude CLI with `--output-format json` wraps output in `{"result": "...", "usage": {...}}`. Always unwrap the envelope before parsing.
- Haiku may wrap JSON in markdown code fences. Always strip `` ```json ``` `` before parsing.
- Channel names use `dm:<agent-id>` for 1:1 channels, `team-<id>` for team channels.
- Every agent invocation must log to the audit store with token counts.
- The ACTION tag protocol: agents self-report `ACTION: <summary>` at end of response; haiku fallback if missing.

## Background Processes

Never start long-running servers directly with Bash.
Always fully detach:
```bash
nohup <command> </dev/null >/tmp/<name>.log 2>&1 & disown
```

On macOS, `setsid` is not available — use `nohup ... & disown` instead.

## Change Scope Decision

Before making any change, deliberately decide its scope:

- **Infra** — Improves the hive engine for all orgs (src/, packages/dashboard/, tests/). Example: fixing triage parsing, adding memory search, dashboard features.
- **Org-specific** — Only affects a particular org's agents (org/). Example: updating a CEO's PRIORITIES.md, adding a new team member agent.
- **Both** — Engine change + org config to use it. Example: adding a new skill type (infra) + enabling it for specific agents (org).

Ask yourself: "Would this change matter to a different org using hive?" If yes → infra. If no → org-specific. If both → separate the commits.

## Testing

- All tests use vitest with mocked `spawnClaude` — never invoke real Claude CLI in tests
- Mock the spawner module, not individual functions
- When testing triage output, account for JSON envelope wrapping and code fence stripping

## Troubleshooting Agent Behavior

When an agent does something unexpected (hallucinated action, failed tool call, wrong classification), check these data sources in order:

### 1. Audit Store (`data/audit.db`)
What the daemon recorded about the invocation.
```sql
SELECT invocation_type, agent_id, model, tokens_in, tokens_out, duration_ms,
       input_summary, output_summary, action_summary, timestamp
FROM invocations WHERE agent_id = '<alias>' ORDER BY timestamp DESC LIMIT 5;
```
- `action_summary` is self-reported by the agent (ACTION tag) — it may be hallucinated
- `output_summary` is first 200 chars of agent stdout — truncated, not the full response

### 2. Chat DB (`data/hive.db`)
Verify what messages were actually sent (vs what the agent claimed).
```sql
-- Did the agent actually send messages?
SELECT conversation_id, content, timestamp FROM messages
WHERE sender_id = <person_id> AND timestamp BETWEEN '<start>' AND '<end>'
ORDER BY timestamp;
```
If the agent's ACTION tag says "delegated to @noor" but Chat DB has zero messages from that agent — the `hive chat send` call failed or was never made.

### 3. Claude CLI Transcripts (`~/.claude/projects/`)
Full tool-by-tool transcript of what the agent did during execution.
```bash
# Find transcripts for a specific agent
ls -lt ~/.claude/projects/-Users-superliaye-projects-hive-org-<id>-<alias>/*.jsonl

# Search for specific content
grep -l "keyword" ~/.claude/projects/-Users-superliaye-projects-hive-org-<id>-<alias>/*.jsonl

# Parse transcript to see tool calls and results
cat <transcript>.jsonl | python3 -c "
import sys, json
for line in sys.stdin:
    obj = json.loads(line)
    t = obj.get('type','')
    if t == 'assistant':
        for block in obj.get('message',{}).get('content',[]):
            if block.get('type') == 'tool_use':
                print(f\"TOOL: {block['name']}({json.dumps(block.get('input',{}))[:200]})\")
            elif block.get('type') == 'text':
                print(f\"TEXT: {block['text'][:300]}\")
    elif t == 'tool_result' or t == 'user':
        content = obj.get('message',{}).get('content','')
        if isinstance(content, list):
            for c in content:
                if isinstance(c, dict) and 'tool_result' in str(c.get('type','')):
                    print(f\"RESULT: {str(c.get('content',''))[:250]}\")
                elif isinstance(c, dict) and c.get('type') == 'tool_result':
                    print(f\"RESULT: {str(c.get('content',''))[:250]}\")
"
```
Key things to look for in transcripts:
- `Exit code 1` — tool call failed
- `<tool_use_error>Cancelled: parallel tool call` — one parallel call failed, rest were cancelled
- `HIVE_DAEMON_SPAWN` — agent tried to call `hive chat ack` which is blocked

### 4. Triage Log (`org/<id>-<alias>/triage-log.db`)
What the daemon classified for this agent.
```sql
SELECT classification, sender, conversation, content_snippet, created_at
FROM triage_log ORDER BY created_at DESC LIMIT 10;
```

### 5. Followup Store (`data/orchestrator.db`)
Track followup lifecycle.
```sql
SELECT agent_id, description, status, attempt, next_check_at, last_check_exit
FROM followups WHERE agent_id = '<alias>' ORDER BY created_at DESC;
```

### 6. Agent State (`data/orchestrator.db`)
Check if agent is stuck.
```sql
SELECT agent_id, status, pid, last_heartbeat, current_task
FROM agent_state WHERE agent_id = '<alias>';
```

### Common Failure Patterns

- **Agent says it delegated but Chat DB is empty**: Check transcript — `hive chat send` likely failed (stale `dist/` build, missing env var). Look for `Exit code 1` in tool results.
- **Triage classified manager message as QUEUE**: Haiku LLM returned non-JSON, fallback defaulted to QUEUE. Only super-user has an override. Check daemon logs for "Triage fallback".
- **Agent stuck in 'working'**: PID died without cleanup. Run `hive doctor --fix` or manually set status to idle in `agent_state`.
- **Parallel tool calls cancelled**: One call in a parallel batch failed → Claude Code cancels the rest. Check for `<tool_use_error>Cancelled` in transcript.
