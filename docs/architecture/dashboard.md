# Dashboard & SSE

## Overview

Web UI for observing and interacting with the Hive org. React + Vite frontend, Express backend, real-time updates via Server-Sent Events.

## Architecture

```
packages/dashboard/
├── src/
│   ├── server/
│   │   ├── index.ts          # createServer(), daemon bootstrap
│   │   ├── router.ts         # Express API router
│   │   ├── sse.ts            # SSEManager
│   │   └── routes/
│   │       ├── org.ts        # /api/org, /api/agents
│   │       ├── chat.ts       # /api/chat (post to CEO DM)
│   │       ├── conversations.ts  # /api/conversations
│   │       ├── audit.ts      # /api/audit
│   │       └── system.ts     # /api/status
│   └── client/
│       ├── App.tsx           # Router: /, /org, /chat, /conversations, /audit
│       ├── hooks/
│       │   ├── useSSE.tsx    # SSE context provider + hooks
│       │   └── useApi.ts     # Fetch with optional polling
│       └── pages/
│           ├── HomePage.tsx
│           ├── OrgPage.tsx
│           ├── ChatPage.tsx
│           ├── ConversationsPage.tsx
│           └── AuditPage.tsx
```

## Server Startup

`createServer({ port: 3001 })`:

1. Create HiveContext (loads org chart, chat DB, all stores)
2. Initialize HiveEventBus
3. Start daemon **in-process** if no external daemon running (checks PID file)
4. Wire event bus to store mutations (see below)
5. Create Express app with API router + SSE endpoint
6. Serve static React build from `dist/client`
7. Hot-reload every 30s (detects new agents)

## Event Bus Wiring

The server wraps three store methods to emit events:

| Store method | Event emitted |
|-------------|---------------|
| `messages.send()` | `message:new` |
| `state.updateStatus()` | `agent:state` |
| `audit.logInvocation()` | `audit:invocation` |

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/org` | Full org tree (root, agents, conversations) |
| GET | `/api/org/meta` | Root agent metadata |
| GET | `/api/agents` | All agent states |
| GET | `/api/agents/:alias` | Single agent detail + files + recent invocations |
| POST | `/api/chat` | Post message to CEO's DM (super-user → root agent) |
| POST | `/api/chat/post` | Post to any conversation as any agent |
| GET | `/api/conversations` | List all conversations with metadata |
| GET | `/api/conversations/:name/messages` | Message history (limit param) |
| GET | `/api/audit` | Invocation log (filters: agentId, type, since, limit) |
| GET | `/api/audit/totals` | Token totals per agent |
| GET | `/api/audit/agent-totals` | All agents' token totals |
| GET | `/api/status` | Daemon status (running, pid, counts) |
| POST | `/api/signal` | Trigger daemon to check agent inbox |
| GET | `/api/events` | SSE stream |

## SSE (Server-Sent Events)

**Server** (`SSEManager`):
- `GET /api/events` → opens persistent connection
- Sends `connected` event with client ID
- Sends full agent state sync on connect
- Subscribes to EventBus for real-time push
- 30s heartbeat as fallback state sync (only sends on change)

**Events streamed**:
| SSE Event | Trigger | Payload |
|-----------|---------|---------|
| `connected` | Client connects | `{ clientId }` |
| `agent-state` | Agent status change | `{ agentId, status, currentTask }` |
| `new-message` | Message posted | `{ id, conversation, sender, content }` |
| `audit-invocation` | Agent invocation logged | `{ agentId, model, tokensIn, ... }` |
| `heartbeat` | 30s interval | Full agent state array (if changed) |

**Client** (`useSSE` hook):
- Creates `EventSource('/api/events')` on mount
- `useSSEEvent(event, handler)` — subscribe to specific event type, auto-cleanup on unmount
- Components use SSE to update state in real-time without polling

## Signal Path (Dashboard → Daemon)

```
User types message in ChatPage
  → POST /api/chat { content }
  → messages.send(superUser, ceoConversation, content)
  → EventBus emits message:new (SSE broadcast)
  → POST /api/signal { conversation }
  → daemon.signalConversation(id)
  → enqueueCheckWork for CEO (100ms debounce)
```
