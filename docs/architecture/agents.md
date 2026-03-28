# Agents

## What is an Agent

An agent is a Claude CLI process spawned by the daemon to handle work. Agents are stateless — each invocation gets a fresh Claude session with a system prompt assembled from the agent's identity files.

## Spawner (src/agents/spawner.ts)

Spawns Claude CLI as a subprocess:

```typescript
spawnClaude(args, {
  cwd: agentDir,           // Agent's org folder
  input: workContext,      // Messages + memory
  timeoutMs: 300_000,     // 5 min default
  env: { ... }
})
```

**CLI args**: `-p --model <model> --system-prompt <prompt> --permission-mode bypassPermissions --output-format json`

**Environment**:
- `GIT_AUTHOR_NAME`: `"Name (hive/alias)"` — agents sign commits
- `GIT_AUTHOR_EMAIL`: `"alias@hive.local"`
- `HIVE_DAEMON_SPAWN=1` — blocks agent subprocesses from calling `hive chat ack` (prevents cursor corruption)
- `CLAUDECODE` — deleted (allows spawning from within Claude Code)

**Token tracking**: Extracts from Claude CLI JSON output envelope (`usage.input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`).

## Prompt Assembly (src/agents/prompt-assembler.ts)

System prompt sections assembled in order (empty sections filtered out):

1. IDENTITY.md (frontmatter stripped)
2. SOUL.md
3. BUREAU.md
4. PROTOCOLS.md (shared org-wide)
5. Skills (combined from `.claude/skills/*/SKILL.md`)
6. PRIORITIES.md
7. ROUTINE.md
8. MEMORY.md + last 3 days of daily logs
9. ACTION_TAG_INSTRUCTION (injected — see below)

## Required Tags

All agents must emit these tags at the end of their response:

### ACTION Tag (mandatory)
```
ACTION: <3-6 word summary of what you did>
```
Used for audit trail. If missing, haiku generates a summary (fire-and-forget).

### FOLLOWUP Tag (when commitments exist)
```
FOLLOWUP: <description>
| check: <shell command — exit 0 = done, 1 = not done, 2 = skip>
| backoff: <comma-separated intervals, e.g. 10m, 30m, 1h>
```
See [followups.md](followups.md) for details.

## Skills

Skills are markdown files that extend an agent's capabilities:

```
org/{id}-{alias}/.claude/skills/{skill-name}/SKILL.md
```

Skills listed in IDENTITY.md frontmatter (`skills: [hive-comms, git-workflow, delegation]`) are loaded from the agent's `.claude/skills/` directory.

Common skills:
- **hive-comms** — How to use `hive chat` for messaging
- **git-workflow** — PR creation, review requests, branch management
- **delegation** — Manager-only: structured handoff protocol with FOLLOWUP tracking
