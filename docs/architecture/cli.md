# CLI Reference

Entry point: `src/cli.ts` via `hive` command.

## System

| Command | Description |
|---------|-------------|
| `hive init [--mission] [--template] [--timezone]` | Bootstrap a new Hive org |
| `hive start [--tick-interval]` | Start the daemon |
| `hive stop` | Stop the daemon |
| `hive status` | Show agent statuses |
| `hive org` | Print org chart |
| `hive doctor [--fix]` | Run health checks, optionally auto-fix |
| `hive dashboard [--port] [--no-open]` | Start web UI (daemon runs in-process) |

## Agent Management

| Command | Description |
|---------|-------------|
| `hive agent create --alias <a> --name <n> --template <t> --reports-to <m>` | Provision new agent |
| `hive agent list` | List all agents |

## Chat

| Command | Description |
|---------|-------------|
| `hive chat send @alias "message"` | Send DM (signals daemon) |
| `hive chat inbox` | Show unread messages |
| `hive chat ack @alias [seq]` | Mark messages read (blocked when `HIVE_DAEMON_SPAWN=1`) |
| `hive chat history @alias [--limit N]` | Message history |
| `hive chat search <query> [--limit N]` | Full-text search |
| `hive chat group list` | List group conversations |
| `hive chat group create <name>` | Create group conversation |
| `hive chat group add <name> @alias` | Add member to group |
| `hive chat group remove <name> @alias` | Remove member from group |

## Memory

| Command | Description |
|---------|-------------|
| `hive memory search <agent> <query> [-n N]` | Semantic search agent memory |
| `hive memory index` | Re-index all agent memories |
| `hive memory status` | Show indexing status |

## Notes

- `hive chat send` posts the message and signals the daemon via `POST /api/signal` for fast response (~100ms)
- `hive chat ack` is disabled for daemon-spawned agent processes (env: `HIVE_DAEMON_SPAWN=1`) to prevent cursor corruption
- `hive dashboard` starts the daemon in-process if no external daemon is running
