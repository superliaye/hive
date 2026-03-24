# Dashboard Plan B: Frontend Implementation

## Overview

Build the React frontend for the Hive Dashboard: shell layout, home page with summary cards, org chart, CEO chat, channel browser, and audit page. Depends on Plan A (backend) being complete.

**Spec**: `docs/superpowers/specs/2026-03-22-hive-dashboard-design.md`
**Backend Plan**: `docs/superpowers/plans/2026-03-22-dashboard-plan-a-backend.md`

---

## Task 5: Shell Layout + Tailwind + Router

### Goal
Build the app shell: dark-themed sidebar navigation, top status bar, and React Router setup.

### Files to Create
- `packages/dashboard/src/client/App.tsx` — overwrite placeholder with real router
- `packages/dashboard/src/client/main.tsx` — overwrite with Tailwind import
- `packages/dashboard/src/client/index.css` — Tailwind base styles + dark theme
- `packages/dashboard/src/client/components/layout/Shell.tsx`
- `packages/dashboard/src/client/components/layout/Sidebar.tsx`
- `packages/dashboard/src/client/components/layout/StatusBar.tsx`
- `packages/dashboard/src/client/hooks/useSSE.ts`
- `packages/dashboard/src/client/hooks/useApi.ts` — shared fetch helper

### Implementation

**Design system** (from spec):
- Dark gray background (`#1a1a2e` or Tailwind `slate-900`)
- Accent: amber/gold (`#F59E0B` / `amber-500`)
- Status colors: green-500 (working), gray-500 (idle), red-500 (errored), amber-500 (active)
- Monospace for IDs/channels, Inter/system sans-serif for UI text
- 8px spacing grid

**`packages/dashboard/src/client/index.css`**:
```css
@import "tailwindcss";

body {
  @apply bg-slate-950 text-slate-100 font-sans;
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
}

/* Monospace for code/IDs */
.font-mono {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}

/* Scrollbar styling for dark theme */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #475569; border-radius: 3px; }
```

**`packages/dashboard/src/client/components/layout/Shell.tsx`**:
```tsx
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';

export function Shell() {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0">
        <StatusBar />
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
```

**`packages/dashboard/src/client/components/layout/Sidebar.tsx`**:
```tsx
import { NavLink } from 'react-router-dom';

const links = [
  { to: '/', label: 'Home', icon: '⌂' },
  { to: '/org', label: 'Organization', icon: '◈' },
  { to: '/chat', label: 'CEO Chat', icon: '◉' },
  { to: '/channels', label: 'Channels', icon: '▣' },
  { to: '/audit', label: 'Audit', icon: '◧' },
];

export function Sidebar() {
  return (
    <nav className="w-56 bg-slate-900 border-r border-slate-800 flex flex-col">
      <div className="p-4 border-b border-slate-800">
        <h1 className="text-lg font-bold text-amber-500">Hive</h1>
        <p className="text-xs text-slate-500">Dashboard</p>
      </div>
      <div className="flex-1 py-2">
        {links.map(link => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-2.5 text-sm transition-colors
               ${isActive
                 ? 'bg-slate-800 text-amber-500 border-r-2 border-amber-500'
                 : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'}`
            }
          >
            <span className="text-base">{link.icon}</span>
            {link.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
```

**`packages/dashboard/src/client/components/layout/StatusBar.tsx`**:
```tsx
import { useSSE } from '../../hooks/useSSE';

export function StatusBar() {
  const { connected } = useSSE();

  return (
    <header className="h-10 bg-slate-900 border-b border-slate-800 flex items-center px-4 justify-between">
      <span className="text-xs text-slate-500">Hive Dashboard</span>
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
        <span className="text-xs text-slate-500">
          {connected ? 'Connected' : 'Reconnecting...'}
        </span>
      </div>
    </header>
  );
}
```

**`packages/dashboard/src/client/hooks/useSSE.ts`**:
```tsx
import { useState, useEffect, useCallback, useRef, createContext, useContext } from 'react';

type SSEEvent = {
  type: string;
  data: any;
};

type SSEContextValue = {
  connected: boolean;
  subscribe: (event: string, handler: (data: any) => void) => () => void;
};

const SSEContext = createContext<SSEContextValue>({
  connected: false,
  subscribe: () => () => {},
});

export function SSEProvider({ children }: { children: React.ReactNode }) {
  const [connected, setConnected] = useState(false);
  const listenersRef = useRef<Map<string, Set<(data: any) => void>>>(new Map());

  useEffect(() => {
    const es = new EventSource('/api/events');

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    const eventTypes = ['agent-state', 'new-message', 'heartbeat', 'ceo-working', 'connected'];
    for (const type of eventTypes) {
      es.addEventListener(type, (e) => {
        const data = JSON.parse(e.data);
        const handlers = listenersRef.current.get(type);
        handlers?.forEach(h => h(data));
      });
    }

    return () => es.close();
  }, []);

  const subscribe = useCallback((event: string, handler: (data: any) => void) => {
    if (!listenersRef.current.has(event)) {
      listenersRef.current.set(event, new Set());
    }
    listenersRef.current.get(event)!.add(handler);
    return () => {
      listenersRef.current.get(event)?.delete(handler);
    };
  }, []);

  return (
    <SSEContext.Provider value={{ connected, subscribe }}>
      {children}
    </SSEContext.Provider>
  );
}

export function useSSE() {
  return useContext(SSEContext);
}

// Hook to subscribe to a specific SSE event
export function useSSEEvent(event: string, handler: (data: any) => void) {
  const { subscribe } = useSSE();
  useEffect(() => subscribe(event, handler), [event, handler, subscribe]);
}
```

**`packages/dashboard/src/client/hooks/useApi.ts`**:
```tsx
import { useState, useEffect, useCallback } from 'react';

export function useApi<T>(url: string, opts?: { refreshInterval?: number }) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      setData(await res.json());
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    refetch();
    if (opts?.refreshInterval) {
      const id = setInterval(refetch, opts.refreshInterval);
      return () => clearInterval(id);
    }
  }, [refetch, opts?.refreshInterval]);

  return { data, loading, error, refetch, setData };
}
```

**`packages/dashboard/src/client/App.tsx`**:
```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { SSEProvider } from './hooks/useSSE';
import { Shell } from './components/layout/Shell';
// Pages imported in subsequent tasks — use placeholders for now
function Placeholder({ name }: { name: string }) {
  return <div className="text-slate-400">{name} — coming soon</div>;
}

export function App() {
  return (
    <SSEProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<Placeholder name="Home" />} />
            <Route path="org" element={<Placeholder name="Organization" />} />
            <Route path="chat" element={<Placeholder name="CEO Chat" />} />
            <Route path="channels" element={<Placeholder name="Channels" />} />
            <Route path="audit" element={<Placeholder name="Audit" />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </SSEProvider>
  );
}
```

### Verification
```bash
npm run -w @hive/dashboard dev
# Open http://localhost:5173 — should see dark shell with sidebar nav
# Click nav links — routes change, placeholder text shows
# Status bar shows connection indicator
```

---

## Task 6: Home Page (Dashboard Cards)

### Goal
Build the home page with 5 summary cards: Org overview, CEO Chat preview, Channel Activity, Token Usage, and Recent Activity. Each card is clickable to navigate to its detail page.

### Files to Create
- `packages/dashboard/src/client/pages/HomePage.tsx`
- `packages/dashboard/src/client/components/home/OrgSummaryCard.tsx`
- `packages/dashboard/src/client/components/home/RecentChatCard.tsx`
- `packages/dashboard/src/client/components/home/ChannelActivityCard.tsx`
- `packages/dashboard/src/client/components/home/AuditSnapshotCard.tsx`
- `packages/dashboard/src/client/components/home/OrchestratorStatusCard.tsx`

### Files to Modify
- `packages/dashboard/src/client/App.tsx` — replace Home placeholder with `HomePage`

### Implementation

**`packages/dashboard/src/client/pages/HomePage.tsx`**:
```tsx
import { OrgSummaryCard } from '../components/home/OrgSummaryCard';
import { RecentChatCard } from '../components/home/RecentChatCard';
import { ChannelActivityCard } from '../components/home/ChannelActivityCard';
import { AuditSnapshotCard } from '../components/home/AuditSnapshotCard';
import { OrchestratorStatusCard } from '../components/home/OrchestratorStatusCard';

export function HomePage() {
  return (
    <div className="space-y-6">
      <OrchestratorStatusCard />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <OrgSummaryCard />
        <RecentChatCard />
        <ChannelActivityCard />
        <AuditSnapshotCard />
      </div>
    </div>
  );
}
```

**Card component pattern** — shared card wrapper:
```tsx
// Inline in each card or extract to a shared Card component:
function DashboardCard({ title, icon, linkTo, children }: {
  title: string; icon: string; linkTo: string; children: React.ReactNode;
}) {
  return (
    <Link to={linkTo} className="block bg-slate-900 border border-slate-800 rounded-lg p-4 hover:border-slate-700 transition-colors">
      <h3 className="text-sm font-medium text-slate-400 mb-3">
        <span className="mr-2">{icon}</span>{title}
      </h3>
      {children}
    </Link>
  );
}
```

**Key card implementations:**

**OrgSummaryCard**: Fetch `GET /api/agents`, show mini agent list with status dots. Subscribe to `agent-state` SSE events for live status updates.

**RecentChatCard**: Fetch `GET /api/channels/board/messages?limit=5`, show last 3-5 messages. Include an inline input that POSTs to `/api/chat`. Subscribe to `new-message` SSE events filtered to `#board`.

**ChannelActivityCard**: Fetch `GET /api/channels`, then for each channel fetch most recent message. Show channel name + last message timestamp + truncated content.

**AuditSnapshotCard**: Fetch `GET /api/audit/totals` and `GET /api/audit?limit=5`. Show total tokens in/out and per-agent breakdown bars.

**OrchestratorStatusCard**: Fetch `GET /api/status`. Show running/stopped, PID, uptime, agent count. Include Start/Stop button that POSTs to `/api/orchestrator/start` or `stop`.

### Data fetching pattern
Each card uses `useApi()` hook for initial data + `useSSEEvent()` for real-time updates:
```tsx
function OrgSummaryCard() {
  const { data: agents, setData } = useApi<Agent[]>('/api/agents');
  useSSEEvent('agent-state', (event) => {
    setData(prev => prev?.map(a =>
      a.id === event.agentId ? { ...a, status: event.status } : a
    ) ?? null);
  });
  // render...
}
```

### Verification
```bash
npm run -w @hive/dashboard dev
# Home page shows 5 cards with data (or empty state messages)
# Cards are clickable — navigate to detail pages
# SSE updates reflect in real-time (change agent state in DB, see card update)
```

---

## Task 7: Org Chart + Agent Detail Panel

### Goal
Build the org chart tree visualization and the slide-out agent detail panel with State/Files/Audit tabs.

### Files to Create
- `packages/dashboard/src/client/pages/OrgPage.tsx`
- `packages/dashboard/src/client/components/org/OrgTree.tsx`
- `packages/dashboard/src/client/components/org/AgentNode.tsx`
- `packages/dashboard/src/client/components/agents/AgentDetailPanel.tsx`
- `packages/dashboard/src/client/components/agents/AgentStateCard.tsx`
- `packages/dashboard/src/client/components/agents/AgentMdViewer.tsx`

### Files to Modify
- `packages/dashboard/src/client/App.tsx` — replace Org placeholder

### Implementation

**`packages/dashboard/src/client/pages/OrgPage.tsx`**:
```tsx
import { useState } from 'react';
import { OrgTree } from '../components/org/OrgTree';
import { AgentDetailPanel } from '../components/agents/AgentDetailPanel';
import { useApi } from '../../hooks/useApi';

export function OrgPage() {
  const { data: org } = useApi<OrgData>('/api/org');
  const { data: agents } = useApi<AgentWithState[]>('/api/agents');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  return (
    <div className="flex h-full">
      <div className="flex-1">
        {org && agents && (
          <OrgTree
            org={org}
            agents={agents}
            onSelectAgent={setSelectedAgentId}
            selectedAgentId={selectedAgentId}
          />
        )}
      </div>
      {selectedAgentId && (
        <AgentDetailPanel
          agentId={selectedAgentId}
          onClose={() => setSelectedAgentId(null)}
        />
      )}
    </div>
  );
}
```

**OrgTree**: Top-down tree using CSS flexbox. Each node is an `AgentNode` component showing emoji, name, status dot, model. Connected by CSS borders/lines. No heavy chart library needed for v1.

**AgentNode**: Clickable card with status colors:
- Green dot `bg-green-500` = working
- Gray dot `bg-gray-500` = idle
- Red dot `bg-red-500` = errored
- Dim `bg-gray-700 opacity-50` = disposed

Subscribe to `agent-state` SSE events for live status dot updates.

**AgentDetailPanel**: Slide-in panel from right (fixed width ~400px, `translate-x` animation). Three tabs:

1. **State tab**: Live status, last heartbeat (relative time), last invocation, current task, PID. Quick stats: invocations today, tokens in/out, avg duration. Recent invocations table (last 10).

2. **Files tab**: Render all 6 md files (IDENTITY, SOUL, BUREAU, PRIORITIES, ROUTINE, MEMORY) as markdown. Use `react-markdown` with dark theme code blocks. Read-only display.

3. **Audit tab**: Full invocation history for this agent. Filterable table. Click row to expand details (inputSummary, outputSummary).

Data: Fetch `GET /api/agents/:id` which returns state, files, recentInvocations, tokenTotals.

### Verification
```bash
npm run -w @hive/dashboard dev
# Org page shows tree with CEO at top, reports below
# Click agent → detail panel slides in from right
# Tabs switch between State, Files, Audit
# Status dots update in real-time via SSE
```

---

## Task 8: CEO Chat Page

### Goal
Full chat interface for #board communication with the CEO.

### Files to Create
- `packages/dashboard/src/client/pages/ChatPage.tsx`
- `packages/dashboard/src/client/components/chat/ChatFeed.tsx`
- `packages/dashboard/src/client/components/chat/ChatInput.tsx`
- `packages/dashboard/src/client/components/chat/MessageBubble.tsx`

### Files to Modify
- `packages/dashboard/src/client/App.tsx` — replace Chat placeholder

### Implementation

**`packages/dashboard/src/client/pages/ChatPage.tsx`**:
```tsx
import { useState, useEffect, useRef, useCallback } from 'react';
import { ChatFeed } from '../components/chat/ChatFeed';
import { ChatInput } from '../components/chat/ChatInput';
import { useApi } from '../../hooks/useApi';
import { useSSEEvent } from '../../hooks/useSSE';

export function ChatPage() {
  const { data: messages, setData } = useApi<Message[]>('/api/channels/board/messages?limit=100');
  const [ceoWorking, setCeoWorking] = useState(false);
  const [sending, setSending] = useState(false);

  // Listen for new messages
  useSSEEvent('new-message', useCallback((event: any) => {
    if (event.channel === 'board') {
      setData(prev => [...(prev ?? []), {
        id: event.id,
        sender: event.sender,
        content: event.content,
        timestamp: event.timestamp,
        channel: 'board',
      }]);
    }
  }, [setData]));

  // Listen for CEO working status
  useSSEEvent('ceo-working', useCallback((event: any) => {
    setCeoWorking(event.status === 'started');
  }, []));

  const sendMessage = async (text: string) => {
    setSending(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      if (data.queued) {
        // Message queued — it'll appear via SSE
      }
      // Response (if synchronous) will also appear via SSE
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-slate-800 px-4 py-3">
        <h2 className="text-lg font-medium">CEO Chat</h2>
        <p className="text-xs text-slate-500 font-mono">#board</p>
      </div>
      <ChatFeed messages={messages ?? []} ceoWorking={ceoWorking} />
      <ChatInput onSend={sendMessage} disabled={sending} />
    </div>
  );
}
```

**ChatFeed**: Scrollable message list. Auto-scrolls to bottom on new messages. Shows "typing..." indicator when `ceoWorking` is true.

**MessageBubble**: Renders sender name + emoji, timestamp (relative), and markdown content. Align super-user messages right, CEO messages left. Use `react-markdown` for content rendering (CEO often uses structured formats).

**ChatInput**: Text input + Send button. Disabled while sending. Enter to send, Shift+Enter for newline.

### Verification
```bash
# With orchestrator running:
npm run -w @hive/dashboard dev
# Type message → appears in feed → CEO responds → response appears via SSE
# "Typing..." shows while CEO is processing
# Full #board history loads on page open
```

---

## Task 9: Channels Page

### Goal
Two-panel channel browser: channel list on left, message feed on right.

### Files to Create
- `packages/dashboard/src/client/pages/ChannelsPage.tsx`
- `packages/dashboard/src/client/components/channels/ChannelList.tsx`
- `packages/dashboard/src/client/components/channels/ChannelFeed.tsx`
- `packages/dashboard/src/client/components/channels/ChannelMessage.tsx`

### Files to Modify
- `packages/dashboard/src/client/App.tsx` — replace Channels placeholder

### Implementation

**`packages/dashboard/src/client/pages/ChannelsPage.tsx`**:
```tsx
import { useState } from 'react';
import { ChannelList } from '../components/channels/ChannelList';
import { ChannelFeed } from '../components/channels/ChannelFeed';

export function ChannelsPage() {
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);

  return (
    <div className="flex h-full">
      <ChannelList
        selectedChannel={selectedChannel}
        onSelectChannel={setSelectedChannel}
      />
      <div className="flex-1 border-l border-slate-800">
        {selectedChannel ? (
          <ChannelFeed channel={selectedChannel} />
        ) : (
          <div className="flex items-center justify-center h-full text-slate-500">
            Select a channel
          </div>
        )}
      </div>
    </div>
  );
}
```

**ChannelList**: Fetch `GET /api/channels`. Show list with channel names. Bold + unread count badge for channels with unread messages (P2 — skip badge for v1, just list channels). Search/filter input at bottom.

**ChannelFeed**: Fetch `GET /api/channels/:name/messages?limit=50`. Render messages chronologically. Subscribe to `new-message` SSE events filtered by selected channel. Support FTS search via query parameter.

**ChannelMessage**: Sender emoji + name, timestamp, markdown content. Similar to MessageBubble but without alignment (all messages left-aligned in channels).

**Read-only**: Super user is read-only on all channels except #board. No input field on channel view.

### Verification
```bash
npm run -w @hive/dashboard dev
# Channel list shows all org channels
# Click channel → messages load in right panel
# New messages appear in real-time via SSE
```

---

## Task 10: Audit Page

### Goal
Full audit view with summary cards, filterable invocation table, and per-agent token breakdown.

### Files to Create
- `packages/dashboard/src/client/pages/AuditPage.tsx`
- `packages/dashboard/src/client/components/audit/AuditTable.tsx`
- `packages/dashboard/src/client/components/audit/TokenSummary.tsx`
- `packages/dashboard/src/client/components/audit/CostChart.tsx`

### Files to Modify
- `packages/dashboard/src/client/App.tsx` — replace Audit placeholder

### Implementation

**`packages/dashboard/src/client/pages/AuditPage.tsx`**:
```tsx
import { useState } from 'react';
import { TokenSummary } from '../components/audit/TokenSummary';
import { AuditTable } from '../components/audit/AuditTable';
import { CostChart } from '../components/audit/CostChart';
import { useApi } from '../../hooks/useApi';

export function AuditPage() {
  const [filters, setFilters] = useState({ agentId: '', type: '', since: '' });
  const queryParams = new URLSearchParams(
    Object.entries(filters).filter(([_, v]) => v)
  ).toString();

  const { data: invocations } = useApi<Invocation[]>(`/api/audit?${queryParams}`, { refreshInterval: 5000 });
  const { data: totals } = useApi<{ totalIn: number; totalOut: number }>('/api/audit/totals', { refreshInterval: 5000 });
  const { data: agents } = useApi<Agent[]>('/api/agents');

  return (
    <div className="space-y-6">
      <TokenSummary totals={totals} invocationCount={invocations?.length ?? 0} />
      <div className="flex gap-4">
        {/* Filters */}
        <select value={filters.agentId} onChange={e => setFilters(f => ({ ...f, agentId: e.target.value }))}
          className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm">
          <option value="">All agents</option>
          {agents?.map(a => <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>)}
        </select>
        <select value={filters.type} onChange={e => setFilters(f => ({ ...f, type: e.target.value }))}
          className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm">
          <option value="">All types</option>
          <option value="main">main</option>
          <option value="triage">triage</option>
          <option value="memory">memory</option>
          <option value="comms">comms</option>
        </select>
      </div>
      <AuditTable invocations={invocations ?? []} />
      <CostChart agents={agents ?? []} />
    </div>
  );
}
```

**TokenSummary**: 4 stat cards at top — total tokens in, total tokens out, total invocations, estimated cost. Use simple math for cost: `(tokensIn * 0.003 + tokensOut * 0.015) / 1000` (sonnet pricing, approximate).

**AuditTable**: Sortable table with columns: #, Agent (emoji + name), Type, Model, Tokens (in/out), Duration, Timestamp. Click row to expand: shows inputSummary and outputSummary.

**CostChart**: Per-agent horizontal bar chart using CSS (no chart library). Each bar shows relative token consumption with `bg-amber-500` fill. Label shows exact token counts.

### Verification
```bash
npm run -w @hive/dashboard dev
# Audit page shows summary cards with totals
# Table shows invocations, filterable by agent and type
# Per-agent bars show relative usage
# Data refreshes every 5s
```

---

## Execution Order

5. Shell layout first — everything mounts inside it
6. Home page — the default landing page, tests all API integrations
7. Org chart — core visualization
8. CEO chat — core interaction
9. Channels — completes communication view
10. Audit — completes monitoring view

Tasks 7-10 are independent of each other and could be parallelized if desired.

---

## Dependencies (Dashboard Package)

Already declared in Task 2's `package.json`. Additional runtime deps needed:
- `react-markdown` — markdown rendering in chat/channels/agent detail
- `react-router-dom` — client-side routing

Add to `packages/dashboard/package.json` dependencies:
```json
{
  "react-markdown": "^9.0.0"
}
```

## Shared Types (Frontend)

Create `packages/dashboard/src/client/types.ts` for API response shapes:
```typescript
export interface Agent {
  id: string;
  name: string;
  role: string;
  emoji?: string;
  model: string;
  status: string;
  lastHeartbeat?: string;
  currentTask?: string;
}

export interface OrgData {
  root: string;
  agents: Array<{
    id: string; name: string; role: string; emoji?: string;
    model: string; depth: number; parentId: string | null; childIds: string[];
  }>;
  channels: Array<{ name: string; memberIds: string[] }>;
}

export interface Message {
  id: string;
  channel: string;
  sender: string;
  content: string;
  timestamp: string;
  mentions?: string[];
}

export interface Invocation {
  id: string;
  agentId: string;
  invocationType: string;
  model: string;
  tokensIn: number | null;
  tokensOut: number | null;
  durationMs: number | null;
  inputSummary: string | null;
  outputSummary: string | null;
  channel: string | null;
  timestamp: string;
}

export interface Channel {
  id: string;
  name: string;
  members: string[];
  createdAt: string;
  autoGenerated: boolean;
}
```

## Empty State Handling

Every page and card must handle zero-data gracefully:
- "No agents registered" for empty org
- "No messages yet" for empty channels/chat
- "No invocations recorded" for empty audit
- "Orchestrator is not running" with start button for system status

Use a consistent `EmptyState` component:
```tsx
function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-12 text-slate-500 text-sm">
      {message}
    </div>
  );
}
```
