# Hive Dashboard — Design Spec

## Overview

A web-based control panel for operating, monitoring, and debugging a Hive organization. Runs locally via `hive dashboard`, serves a React SPA backed by an Express API that reads from Hive's SQLite stores. Designed for the super user to observe agent activity, communicate with the CEO, browse channel conversations, inspect agent state, and audit token usage — all from one interface.

## Architecture

```
┌─────────────────────────────────────────────────┐
│                   Browser (React + Vite)          │
│  ┌────────┬──────────┬──────────┬───────┬──────┐ │
│  │  Home  │ Org Chart│ CEO Chat │Channels│Audit │ │
│  │(dashboard)│(tree)  │(#board)  │(browse)│(cost)│ │
│  └───┬────┴────┬─────┴────┬─────┴───┬───┴──┬───┘ │
│      └─────────┴──────────┴─────────┴──────┘      │
│                    REST + SSE                      │
└────────────────────┬──────────────────────────────┘
                     │ http://localhost:3000
┌────────────────────┴──────────────────────────────┐
│            Express Server (packages/dashboard)     │
│  /api/org  /api/agents  /api/channels  /api/chat  │
│  /api/audit            /api/events (SSE)           │
└────────────────────┬──────────────────────────────┘
                     │ imports
┌────────────────────┴──────────────────────────────┐
│              HiveContext (src/context.ts)           │
│  orgChart + comms + audit + state + config         │
└────────────────────┬──────────────────────────────┘
                     │ reads/writes
              data/*.db + org/**/*.md
```

### Key Decisions

- **Frontend**: React 18 + Vite + TypeScript + Tailwind CSS
- **Backend**: Express server in `packages/dashboard/`, imports `HiveContext` from core `src/`
- **Data**: Direct SQLite reads via shared stores. SSE polls DB changes every 2s and pushes diffs to browser
- **Real-time**: Server-Sent Events (SSE) for agent state changes and new messages. Chat input via REST POST
- **Deployment**: `hive dashboard` starts Express (serves API + static build). In dev, Vite proxy to Express
- **Decoupling**: Dashboard lives in `packages/dashboard/` with its own `package.json`. Imports only `HiveContext` from core — no direct store access

### HiveContext (New — Shared Data Layer)

A new `src/context.ts` that replaces the ad-hoc store initialization scattered across `cli.ts`:

```typescript
export class HiveContext {
  readonly orgChart: OrgChart;
  readonly comms: SqliteCommsProvider;
  readonly audit: AuditStore;
  readonly state: AgentStateStore;
  readonly channelManager: ChannelManager;
  readonly dataDir: string;
  readonly orgDir: string;

  static async create(cwd?: string): Promise<HiveContext>;
  close(): void;
}
```

Both the orchestrator and dashboard create a `HiveContext` pointing at the same `data/` directory. SQLite WAL mode handles concurrent reads (dashboard) + writes (orchestrator).

**DB paths:** `state` uses `data/orchestrator.db` (same file the orchestrator writes to), `audit` uses `data/audit.db`, `comms` uses `data/comms.db`. The `create()` factory resolves these paths from `dataDir`.

**Monorepo setup:** Root `package.json` needs `"workspaces": ["packages/*"]` added. The dashboard package imports from core via workspace reference or relative path (`../../src/context.js`).

**Serialization note:** `OrgChart.agents` is a `Map` — API routes must convert to a plain array/object before JSON serialization.

**Live file reads:** The `GET /api/agents/:id` endpoint re-reads agent md files from disk (not from cached `AgentConfig.files`) so it always shows the latest content, even if agents have self-modified their files.

---

## Package Structure

```
packages/dashboard/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
├── src/
│   ├── server/
│   │   ├── index.ts          # Express app setup
│   │   ├── sse.ts            # SSE event stream manager
│   │   └── routes/
│   │       ├── org.ts        # GET /api/org, GET /api/agents, GET /api/agents/:id
│   │       ├── channels.ts   # GET /api/channels, GET /api/channels/:name/messages
│   │       ├── chat.ts       # POST /api/chat
│   │       ├── audit.ts      # GET /api/audit, GET /api/audit/totals
│   │       └── system.ts     # GET /api/status, POST /api/orchestrator/start|stop
│   └── client/
│       ├── main.tsx          # React entry
│       ├── App.tsx           # Router + layout shell
│       ├── hooks/
│       │   ├── useSSE.ts     # SSE connection + event dispatch
│       │   ├── useOrg.ts     # Org chart data
│       │   ├── useAgents.ts  # Agent states
│       │   ├── useChannels.ts# Channel list + messages
│       │   └── useAudit.ts   # Audit data
│       ├── pages/
│       │   ├── HomePage.tsx
│       │   ├── OrgPage.tsx
│       │   ├── ChatPage.tsx
│       │   ├── ChannelsPage.tsx
│       │   └── AuditPage.tsx
│       └── components/
│           ├── layout/
│           │   ├── Sidebar.tsx
│           │   ├── StatusBar.tsx
│           │   └── Shell.tsx
│           ├── org/
│           │   ├── OrgTree.tsx
│           │   └── AgentNode.tsx
│           ├── chat/
│           │   ├── ChatFeed.tsx
│           │   ├── ChatInput.tsx
│           │   └── MessageBubble.tsx
│           ├── channels/
│           │   ├── ChannelList.tsx
│           │   ├── ChannelFeed.tsx
│           │   └── ChannelMessage.tsx
│           ├── agents/
│           │   ├── AgentDetailPanel.tsx
│           │   ├── AgentMdViewer.tsx
│           │   └── AgentStateCard.tsx
│           ├── audit/
│           │   ├── AuditTable.tsx
│           │   ├── TokenSummary.tsx
│           │   └── CostChart.tsx
│           └── home/
│               ├── OrgSummaryCard.tsx
│               ├── RecentChatCard.tsx
│               ├── ChannelActivityCard.tsx
│               ├── AuditSnapshotCard.tsx
│               └── OrchestratorStatusCard.tsx
```

---

## Pages

### 1. Home (Dashboard Overview)

The default landing page. A grid of summary cards — each shows a condensed view and links to its full page on click.

```
┌─────────────────────────────────────────────────────┐
│  🏠 Hive Dashboard                    ⚡ Running 3m │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌─────────────────────┐  ┌───────────────────────┐ │
│  │ 🏢 Organization      │  │ 💬 CEO Chat (#board)  │ │
│  │                      │  │                       │ │
│  │  👔 CEO    [working] │  │ You: How's progress?  │ │
│  │   🔧 Eng  [idle]    │  │ CEO: Plan 4 is 60%... │ │
│  │   🔍 QA   [idle]    │  │ You: Focus on tests   │ │
│  │                      │  │                       │ │
│  │  3 agents · 4 ch     │  │ [Type a message...]   │ │
│  └──────────────────────┘  └───────────────────────┘ │
│                                                     │
│  ┌─────────────────────┐  ┌───────────────────────┐ │
│  │ 📡 Channel Activity  │  │ 📊 Token Usage        │ │
│  │                      │  │                       │ │
│  │ #engineering  2m ago │  │ Today: 12.4K in       │ │
│  │  🔧: Task done...   │  │        5.8K out       │ │
│  │ #board        5m ago │  │                       │ │
│  │  👔: Delegated to... │  │ CEO     8.2K / 3.1K   │ │
│  │ #all-hands   12m ago │  │ Eng     3.0K / 2.1K   │ │
│  │  👔: Status update   │  │ QA      1.2K / 0.6K   │ │
│  └──────────────────────┘  └───────────────────────┘ │
│                                                     │
│  ┌──────────────────────────────────────────────────┐│
│  │ 🕐 Recent Activity                               ││
│  │ 16:30 🔧 Eng heartbeat — worked on API endpoint  ││
│  │ 16:28 👔 CEO triage — 3 messages, 1 ACT_NOW      ││
│  │ 16:20 🔍 QA review — NEEDS_WORK on parser.ts     ││
│  │ 16:15 👔 CEO delegated task to @platform-eng      ││
│  └──────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────┘
```

**Cards:**

| Card | Shows | Click → |
|------|-------|---------|
| Organization | Mini org tree with status colors | OrgPage |
| CEO Chat | Last 3-5 #board messages + inline input | ChatPage |
| Channel Activity | Latest message per active channel | ChannelsPage |
| Token Usage | Today's totals per agent | AuditPage |
| Recent Activity | Timeline of last 5-10 invocations across all agents | AuditPage (filtered) |
| Orchestrator Status | Running/stopped, uptime, agent count (in header bar) | — |

**CEO Chat card is interactive** — you can type and send messages directly from the home page without navigating to the full chat view.

**SSE updates**: All cards auto-refresh when new data arrives. No manual polling needed.

---

### 2. Org Chart

Interactive tree visualization of the organization hierarchy.

```
┌─────────────────────────────────────────────────────┐
│  🏢 Organization                                    │
├─────────────────────────────────────────────────────┤
│                                                     │
│              ┌──────────────┐                       │
│              │ 👔 Hive CEO  │                       │
│              │   ● working  │  ← green dot          │
│              │   sonnet     │                       │
│              └──────┬───────┘                       │
│           ┌─────────┴─────────┐                     │
│    ┌──────┴──────┐    ┌──────┴──────┐               │
│    │ 🔧 Platform │    │ 🔍 QA Eng  │               │
│    │   ○ idle    │    │   ○ idle    │               │
│    │   sonnet    │    │   sonnet    │               │
│    └─────────────┘    └─────────────┘               │
│                                                     │
│  Click any agent to view details →                  │
│                                                     │
│  ┌─ Agent Detail Panel ─────────────────────────┐   │
│  │  (slides in from right when agent is clicked) │   │
│  │  See Agent Detail Panel section below         │   │
│  └───────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

**Agent node colors:**
- Green dot (●) = working
- Gray dot (○) = idle
- Red dot (●) = errored
- Dim (◌) = disposed

**Node info:** emoji, name, status dot, model name. Compact enough that 10+ agents fit on screen.

**Layout:** Top-down tree using CSS flexbox (no heavy charting library needed for v1). If the org grows large, can swap to a canvas-based renderer later.

---

### 3. CEO Chat

Full chat interface for #board communication. Looks like a messaging app.

```
┌─────────────────────────────────────────────────────┐
│  💬 CEO Chat  (#board)                              │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │                                             │    │
│  │  You                          16:20         │    │
│  │  ┌─────────────────────────────────┐        │    │
│  │  │ How is Plan 4 progressing?      │        │    │
│  │  └─────────────────────────────────┘        │    │
│  │                                             │    │
│  │           Hive CEO 👔              16:21    │    │
│  │  ┌─────────────────────────────────┐        │    │
│  │  │ **Status Update**               │        │    │
│  │  │ Situation: Plan 4 in progress   │        │    │
│  │  │ Progress: Template system done  │        │    │
│  │  │ Next: hive init command         │        │    │
│  │  └─────────────────────────────────┘        │    │
│  │                                             │    │
│  │           Hive CEO 👔     ● typing...       │    │
│  │                                             │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  ┌─────────────────────────────────┐  ┌──────┐     │
│  │ Type a message to CEO...        │  │ Send │     │
│  └─────────────────────────────────┘  └──────┘     │
└─────────────────────────────────────────────────────┘
```

**Behavior:**
- Messages render markdown (CEO responses often use structured formats)
- "Typing..." indicator while Claude CLI is running (SSE event: `ceo-working`)
- Auto-scroll to bottom on new messages
- POST `/api/chat` sends message, SSE pushes response when ready
- Full #board history loaded on page open

---

### 4. Channels

Two-panel layout: channel list on left, message feed on right.

```
┌────────────────┬────────────────────────────────────┐
│ 📡 Channels    │  #engineering                      │
├────────────────┤────────────────────────────────────┤
│                │                                    │
│ #board      (2)│  🔧 Platform Eng          16:30   │
│ #all-hands     │  Task complete: API endpoints      │
│ #engineering   │  implemented. 5 new tests added.   │
│ #leadership    │  **Status: DONE**                  │
│ #approvals     │                                    │
│                │  🔍 QA Eng               16:32    │
│                │  Reviewing. Running test suite...   │
│                │                                    │
│                │  🔍 QA Eng               16:35    │
│                │  **Review: NEEDS_WORK**            │
│                │  - Missing null check in scorer.ts │
│                │  - Test coverage gap in triage.ts  │
│                │                                    │
│                │  🔧 Platform Eng          16:40   │
│                │  Fixing. Added null guard and 2    │
│                │  new test cases.                   │
│                │  **Status: DONE**                  │
│                │                                    │
├────────────────┤                                    │
│ 🔍 Search...   │                                    │
└────────────────┴────────────────────────────────────┘
```

**Features:**
- Channel list with unread badges (count in parentheses)
- Bold channel name when unread
- Click channel → loads messages on the right
- Messages show sender emoji + name, timestamp, markdown-rendered content
- Search bar filters channel history (uses FTS5 via `searchHistory()`)
- SSE pushes new messages into the active channel feed in real-time
- Super user is read-only on all channels except #board

---

### 5. Agent Detail Panel

Slide-out panel from the right side when an agent is clicked in the org chart. Also accessible by clicking agent names in channel messages.

```
┌─────────────────────────────────────────┐
│  ← Back    🔧 Platform Engineer         │
│            Senior Platform Engineer      │
│            sonnet · ○ idle               │
├─────────────────────────────────────────┤
│                                         │
│  [State] [Files] [Audit]    ← tabs      │
│                                         │
│  ── State ──────────────────────────    │
│  Status:        idle                    │
│  Last heartbeat: 2m ago                 │
│  Last invocation: 5m ago                │
│  Current task:  —                       │
│  PID:           —                       │
│                                         │
│  ── Quick Stats ────────────────────    │
│  Invocations today:  12                 │
│  Tokens in:          3,041              │
│  Tokens out:         2,108              │
│  Avg duration:       4.2s               │
│                                         │
│  ── Recent Invocations ─────────────    │
│  16:30 main    sonnet  4.1s  ✓         │
│  16:28 triage  haiku   0.8s  ✓         │
│  16:20 main    sonnet  5.2s  ✓         │
│  16:18 triage  haiku   0.6s  ✓         │
│                                         │
└─────────────────────────────────────────┘
```

**Tabs:**
- **State** — live status, heartbeat timing, recent invocations, quick stats
- **Files** — all 6 md files rendered as markdown with syntax highlighting. Read-only. Shows the agent's full identity, soul, bureau, priorities, routine, and memory
- **Audit** — full invocation history table for this agent with filters

---

### 6. Audit Page

Full audit view with filtering and cost breakdown.

```
┌─────────────────────────────────────────────────────┐
│  📊 Audit & Cost                                    │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────────┐ │
│  │ 16.4K   │ │  7.8K   │ │  45     │ │  $0.12   │ │
│  │ tokens↓ │ │ tokens↑ │ │ calls   │ │ est cost │ │
│  └─────────┘ └─────────┘ └─────────┘ └──────────┘ │
│                                                     │
│  Filter: [All agents ▾] [All types ▾] [Today ▾]    │
│                                                     │
│  ┌───┬──────────┬────────┬───────┬──────┬────────┐ │
│  │ # │ Agent    │ Type   │ Model │ Tok  │ Time   │ │
│  ├───┼──────────┼────────┼───────┼──────┼────────┤ │
│  │ 1 │ 👔 CEO  │ triage │ haiku │  200 │ 0.8s   │ │
│  │ 2 │ 👔 CEO  │ main   │sonnet │ 3.2K │ 4.1s   │ │
│  │ 3 │ 🔧 Eng  │ triage │ haiku │  180 │ 0.6s   │ │
│  │ 4 │ 🔧 Eng  │ main   │sonnet │ 2.8K │ 5.2s   │ │
│  │ 5 │ 🔍 QA   │ main   │sonnet │ 1.2K │ 3.0s   │ │
│  └───┴──────────┴────────┴───────┴──────┴────────┘ │
│                                                     │
│  Per-Agent Breakdown:                               │
│  👔 CEO      ████████████░░  8.2K in / 3.1K out   │
│  🔧 Eng      ██████░░░░░░░  3.0K in / 2.1K out   │
│  🔍 QA       ███░░░░░░░░░░  1.2K in / 0.6K out   │
└─────────────────────────────────────────────────────┘
```

**Features:**
- Summary cards at top: total tokens in/out, total invocations, estimated cost
- Filterable table: by agent, invocation type, time range
- Per-agent bar chart showing relative token consumption
- Click a row to expand: shows inputSummary, outputSummary, full details

---

## REST API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/org` | Org chart tree (agents with identity, depth, parent/child IDs) |
| GET | `/api/agents` | All agent states (status, lastHeartbeat, currentTask) |
| GET | `/api/agents/:id` | Single agent: state + all md files + recent invocations + token totals |
| GET | `/api/channels` | List all channels with member counts |
| GET | `/api/channels/:name/messages` | Messages in channel. Query: `?limit=50&since=ISO` |
| GET | `/api/audit` | Invocation log. Query: `?agentId=&type=&since=&limit=`. Note: `AuditStore.getInvocations()` needs extending to support `invocationType` filter |
| GET | `/api/audit/totals` | Token totals. Query: `?agentId=` |
| POST | `/api/chat` | Body: `{ message: string }`. Posts to #board, spawns CEO, returns response. If CEO is currently working (status=working), queues the message and returns 202 — the CEO will pick it up on next heartbeat. Emits `ceo-working` SSE events for typing indicator |
| GET | `/api/events` | SSE stream. Events: `agent-state`, `new-message`, `heartbeat`, `ceo-working` |
| GET | `/api/status` | Orchestrator status (running, PID, uptime, agent count) |
| POST | `/api/orchestrator/start` | Start the orchestrator as a detached child process (`hive start`). Checks `data/hive.pid` first — returns 409 if already running |
| POST | `/api/orchestrator/stop` | Stop the orchestrator by sending SIGTERM to the PID in `data/hive.pid`. Returns 404 if not running |

---

## SSE Events

The `/api/events` endpoint pushes these event types:

```
event: agent-state
data: {"agentId":"ceo","status":"working","currentTask":"triage"}

event: new-message
data: {"channel":"#engineering","sender":"platform-eng","content":"...","timestamp":"..."}

event: heartbeat
data: {"agentId":"ceo","timestamp":"..."}

event: ceo-working
data: {"status":"started"|"completed"}
```

**Implementation:** Server polls SQLite every 2 seconds, diffs against last known state, emits events for changes. Lightweight — each poll is a few simple queries.

---

## CLI Integration

Add to `src/cli.ts`:

```typescript
program
  .command('dashboard')
  .description('Open the Hive dashboard in your browser')
  .option('-p, --port <port>', 'Port number', '3000')
  .option('--no-open', 'Do not auto-open browser')
  .action(async (opts) => {
    // Start Express server from packages/dashboard
    // In dev: proxy Vite dev server
    // In prod: serve built static files
  });
```

`hive dashboard` starts the Express server, opens `localhost:3000` in the default browser.

---

## Design System

**Visual language:**
- Dark theme (dark gray background, not pure black) — easier on eyes during long monitoring sessions
- Accent color: amber/gold (#F59E0B) for active states, status indicators
- Monospace font for agent IDs, channel names, code content
- Sans-serif (Inter or system font) for UI text
- Status colors: green (#22C55E) working, gray (#6B7280) idle, red (#EF4444) errored, amber (#F59E0B) active
- Cards with subtle borders, slight elevation on hover
- Consistent 8px spacing grid

**Responsive:** Desktop-first (1280px+). Single-column collapse for narrower screens but not a priority for v1.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend framework | React 18 |
| Build tool | Vite |
| Styling | Tailwind CSS |
| Markdown rendering | react-markdown + rehype-raw |
| HTTP client | fetch (native) |
| SSE client | EventSource (native) |
| Backend | Express |
| Data access | HiveContext (imports from core src/) |
| Process management | child_process (for orchestrator start/stop) |

---

## Implementation Order

1. **HiveContext** (src/context.ts) — shared data layer, refactor CLI to use it
2. **Dashboard scaffold** — packages/dashboard, Express + Vite setup, `hive dashboard` command
3. **REST API routes** — all `/api/*` endpoints
4. **SSE event stream** — `/api/events` with DB polling
5. **Shell layout** — sidebar, router, status bar
6. **Home page** — dashboard cards with summary data
7. **Org chart** — tree visualization + agent detail panel
8. **CEO chat** — #board messaging with real-time response
9. **Channels** — channel browser with message feed
10. **Audit** — table, filters, token breakdown

---

## GitHub Issues

Tracked at: https://github.com/superliaye/hive/issues

| # | Title | Priority |
|---|-------|----------|
| 9 | HiveContext shared data layer | Infra |
| 10 | Dashboard package scaffold | Infra |
| 11 | REST API endpoints | Infra |
| 1 | Org chart with live agent states | P0 |
| 2 | Interactive chat with CEO | P0 |
| 3 | Channel browser with message history | P0 |
| 4 | Agent detail panel | P0 |
| 5 | Audit & cost view | P1 |
| 6 | Orchestrator controls | P1 |
| 7 | Live heartbeat indicators | P1 |
| 8 | Channel unread badges | P2 |

---

## Error Handling

- **API errors**: All endpoints return structured `{ error: string }` responses with appropriate HTTP codes. React UI shows toast notifications for transient errors.
- **SSE disconnection**: `EventSource` auto-reconnects. UI shows a "Reconnecting..." banner when the connection drops, clears when it resumes.
- **Orchestrator not running**: Dashboard works in read-only mode. Chat shows "Orchestrator is not running — CEO cannot respond" with a start button. Org chart and channel history still work (reads from DB).
- **Empty state**: Each page handles zero-data gracefully. "No messages yet" for channels, "No invocations recorded" for audit, etc.

---

## Unread Badges

Channel unread badges (P2) require tracking the super user's read position. Implementation: register a synthetic `super-user` agent ID in the `read_receipts` table. When the dashboard opens a channel, call `markRead('super-user', messageIds)`. Use `getUnread('super-user')` grouped by channel for badge counts.

---

## SSE Polling Notes

- `better-sqlite3` queries are synchronous and block the Express event loop briefly. For expected data volumes (<10K rows), this is negligible.
- SSE diff queries should include `LIMIT` and time-window filters to stay fast as tables grow.
- The `ceo-working` SSE event is emitted by the `POST /api/chat` handler (started/completed), not by DB polling.
