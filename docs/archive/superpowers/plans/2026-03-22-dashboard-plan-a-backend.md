# Dashboard Plan A: Backend Infrastructure

## Overview

Build the backend infrastructure for the Hive Dashboard: HiveContext shared data layer, monorepo scaffold, Express REST API routes, and SSE event stream. This plan covers Tasks 1-4 from the dashboard design spec.

**Spec**: `docs/superpowers/specs/2026-03-22-hive-dashboard-design.md`

---

## Task 1: HiveContext — Shared Data Layer

### Goal
Create `src/context.ts` — a single factory that wires up all stores (orgChart, comms, audit, state, channelManager) so both the CLI and dashboard can share it without duplicating initialization logic.

### Files to Create
- `src/context.ts`

### Files to Modify
- `src/cli.ts` — refactor to use HiveContext instead of ad-hoc `getCommsProvider()`, `getAuditStore()`, etc.

### Implementation

**`src/context.ts`**:
```typescript
import path from 'path';
import fs from 'fs';
import { parseOrgTree } from './org/parser.js';
import { SqliteCommsProvider } from './comms/sqlite-provider.js';
import { ChannelManager } from './comms/channel-manager.js';
import { AuditStore } from './audit/store.js';
import { AgentStateStore } from './state/agent-state.js';
import type { OrgChart } from './types.js';

export class HiveContext {
  readonly orgChart: OrgChart;
  readonly comms: SqliteCommsProvider;
  readonly audit: AuditStore;
  readonly state: AgentStateStore;
  readonly channelManager: ChannelManager;
  readonly dataDir: string;
  readonly orgDir: string;

  private constructor(opts: {
    orgChart: OrgChart;
    comms: SqliteCommsProvider;
    audit: AuditStore;
    state: AgentStateStore;
    channelManager: ChannelManager;
    dataDir: string;
    orgDir: string;
  }) {
    this.orgChart = opts.orgChart;
    this.comms = opts.comms;
    this.audit = opts.audit;
    this.state = opts.state;
    this.channelManager = opts.channelManager;
    this.dataDir = opts.dataDir;
    this.orgDir = opts.orgDir;
  }

  static async create(cwd?: string): Promise<HiveContext> {
    const root = cwd ?? process.cwd();
    const orgDir = path.resolve(root, 'org');
    if (!fs.existsSync(orgDir)) {
      throw new Error('No org/ directory found. Run `hive init` first.');
    }
    const dataDir = path.resolve(root, 'data');
    fs.mkdirSync(dataDir, { recursive: true });

    const orgChart = await parseOrgTree(orgDir);
    const comms = new SqliteCommsProvider(path.join(dataDir, 'comms.db'));
    const audit = new AuditStore(path.join(dataDir, 'audit.db'));
    const state = new AgentStateStore(path.join(dataDir, 'orchestrator.db'));
    const channelManager = new ChannelManager(comms);

    // Sync channels from org tree
    await channelManager.syncFromOrgTree(orgChart);

    return new HiveContext({
      orgChart, comms, audit, state, channelManager, dataDir, orgDir,
    });
  }

  close(): void {
    this.comms.close();
    this.audit.close();
    this.state.close();
  }
}
```

**Key points:**
- Private constructor — use `HiveContext.create()` factory
- All DB paths derived from `dataDir`: `comms.db`, `audit.db`, `orchestrator.db`
- `close()` closes all three DB connections
- Channel sync runs on creation so channels are always up to date

**Refactor `src/cli.ts`:**
- Remove `getOrgDir()`, `getDataDir()`, `getCommsProvider()`, `getAuditStore()` helper functions
- Replace with `const ctx = await HiveContext.create();`
- Update all commands (`org`, `status`, `chat`, `observe`) to use `ctx.orgChart`, `ctx.comms`, `ctx.audit`, `ctx.state`, `ctx.channelManager`
- The `start` command is special — it still needs to build `OrchestratorConfig` from `buildStartConfig()`. Use `ctx` for the comms/state/audit stores, but keep the orchestrator-specific wiring in place
- `stop` command doesn't need HiveContext (just reads PID file)
- Call `ctx.close()` in finally blocks

### Tests
- `tests/context.test.ts` — unit test:
  - `HiveContext.create()` with valid org dir → returns context with all stores
  - `HiveContext.create()` with missing org dir → throws
  - `ctx.close()` doesn't throw
  - All store instances are accessible and functional (e.g., `ctx.state.listAll()` returns array)
- Use temp directory with fixture org/ copied in (same pattern as `tests/cli/commands.test.ts`)

### Verification
```bash
npx vitest run tests/context.test.ts
npx vitest run  # All existing tests still pass
```

---

## Task 2: Monorepo + Dashboard Scaffold

### Goal
Set up `packages/dashboard/` as a workspace package with Express server, Vite config, and `hive dashboard` CLI command.

### Files to Create
- `packages/dashboard/package.json`
- `packages/dashboard/tsconfig.json`
- `packages/dashboard/vite.config.ts`
- `packages/dashboard/index.html`
- `packages/dashboard/src/server/index.ts` — Express app with static serving + API mount
- `packages/dashboard/src/client/main.tsx` — React entry (placeholder)
- `packages/dashboard/src/client/App.tsx` — Router placeholder

### Files to Modify
- `package.json` (root) — add `"workspaces": ["packages/*"]`
- `src/cli.ts` — add `hive dashboard` command
- `tsconfig.json` (root) — add reference to `packages/dashboard/tsconfig.json` if using project references

### Implementation

**Root `package.json`** — add workspaces:
```json
{
  "workspaces": ["packages/*"]
}
```

**`packages/dashboard/package.json`**:
```json
{
  "name": "@hive/dashboard",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build && tsc -p tsconfig.server.json",
    "preview": "node dist/server/index.js"
  },
  "dependencies": {
    "express": "^5.1.0",
    "hive": "workspace:*"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-router-dom": "^7.0.0",
    "@vitejs/plugin-react": "^4.5.0",
    "vite": "^6.0.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.9.3"
  }
}
```

**Note**: The `hive` workspace reference gives the dashboard access to `HiveContext` via `import { HiveContext } from 'hive/context.js'`. This requires adding `"exports"` to the root `package.json`:
```json
{
  "exports": {
    "./context.js": "./dist/context.js",
    "./types.js": "./dist/types.js"
  }
}
```

**`packages/dashboard/vite.config.ts`**:
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: '.',
  build: {
    outDir: 'dist/client',
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
```

- Dev mode: Vite serves frontend on port 5173, proxies `/api` to Express on 3001
- Prod mode: Express serves built static files from `dist/client/`

**`packages/dashboard/src/server/index.ts`**:
```typescript
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { HiveContext } from 'hive/context.js';
// Routes imported in Task 3

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function createServer(opts: { port: number; cwd?: string }) {
  const ctx = await HiveContext.create(opts.cwd);
  const app = express();

  app.use(express.json());

  // API routes will be mounted here in Task 3:
  // app.use('/api', createApiRouter(ctx));

  // Serve static files in production
  const clientDir = path.resolve(__dirname, '../client');
  app.use(express.static(clientDir));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDir, 'index.html'));
  });

  const server = app.listen(opts.port, () => {
    console.log(`Hive Dashboard running at http://localhost:${opts.port}`);
  });

  // Cleanup on shutdown
  process.on('SIGTERM', () => {
    ctx.close();
    server.close();
  });

  return { app, server, ctx };
}

// Direct invocation
const port = parseInt(process.env.PORT ?? '3001', 10);
createServer({ port });
```

**`hive dashboard` CLI command** — add to `src/cli.ts`:
```typescript
program
  .command('dashboard')
  .description('Open the Hive dashboard in your browser')
  .option('-p, --port <port>', 'Port number', '3001')
  .option('--no-open', 'Do not auto-open browser')
  .action(async (opts) => {
    const { createServer } = await import('@hive/dashboard/server');
    await createServer({ port: parseInt(opts.port, 10), cwd: process.cwd() });
    if (opts.open !== false) {
      const { exec } = await import('child_process');
      exec(`open http://localhost:${opts.port}`);
    }
  });
```

**Alternative approach** (simpler, avoids cross-package import complexities): Instead of importing from `@hive/dashboard`, the CLI can spawn the dashboard server as a subprocess:
```typescript
.action(async (opts) => {
  const serverPath = path.resolve(import.meta.dirname, '../../packages/dashboard/dist/server/index.js');
  // Or use: npx -w @hive/dashboard node dist/server/index.js
});
```

Pick the approach that works with the workspace resolution. The import approach is cleaner if exports are configured correctly.

**`packages/dashboard/index.html`**:
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Hive Dashboard</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/client/main.tsx"></script>
</body>
</html>
```

**`packages/dashboard/src/client/main.tsx`** (placeholder):
```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<App />);
```

**`packages/dashboard/src/client/App.tsx`** (placeholder):
```tsx
import React from 'react';

export function App() {
  return <div>Hive Dashboard — scaffold ready</div>;
}
```

### Tests
- `packages/dashboard/src/server/__tests__/server.test.ts`:
  - `createServer()` starts Express and returns `{ app, server, ctx }`
  - `GET /` returns 200 with HTML
  - Server cleanup: `server.close()` + `ctx.close()` doesn't throw

### Verification
```bash
# Install workspace deps
npm install
# Build core first
npm run build
# Build dashboard
npm run -w @hive/dashboard build
# Run dashboard tests
npx vitest run packages/dashboard/
```

---

## Task 3: REST API Routes

### Goal
Implement all `/api/*` endpoints that the frontend will consume.

### Files to Create
- `packages/dashboard/src/server/routes/org.ts`
- `packages/dashboard/src/server/routes/channels.ts`
- `packages/dashboard/src/server/routes/chat.ts`
- `packages/dashboard/src/server/routes/audit.ts`
- `packages/dashboard/src/server/routes/system.ts`
- `packages/dashboard/src/server/router.ts` — mounts all route modules

### Files to Modify
- `packages/dashboard/src/server/index.ts` — mount API router
- `src/audit/store.ts` — add `invocationType` filter to `getInvocations()`
- `src/org/parser.ts` — may need `readAgentFiles()` export for live file reads

### Implementation

**`packages/dashboard/src/server/router.ts`**:
```typescript
import { Router } from 'express';
import type { HiveContext } from 'hive/context.js';
import { createOrgRoutes } from './routes/org.js';
import { createChannelRoutes } from './routes/channels.js';
import { createChatRoutes } from './routes/chat.js';
import { createAuditRoutes } from './routes/audit.js';
import { createSystemRoutes } from './routes/system.js';

export function createApiRouter(ctx: HiveContext): Router {
  const router = Router();
  router.use('/org', createOrgRoutes(ctx));
  router.use('/agents', createOrgRoutes(ctx));  // shared — org.ts handles both
  router.use('/channels', createChannelRoutes(ctx));
  router.use('/chat', createChatRoutes(ctx));
  router.use('/audit', createAuditRoutes(ctx));
  router.use('/', createSystemRoutes(ctx));
  return router;
}
```

**`packages/dashboard/src/server/routes/org.ts`**:
```typescript
import { Router } from 'express';
import type { HiveContext } from 'hive/context.js';
import { readAgentFiles } from 'hive/org/parser.js';

export function createOrgRoutes(ctx: HiveContext): Router {
  const router = Router();

  // GET /api/org — full org chart tree
  router.get('/', (_req, res) => {
    const { orgChart } = ctx;
    const agents = Array.from(orgChart.agents.values()).map(a => ({
      id: a.id,
      name: a.identity.name,
      role: a.identity.role,
      emoji: a.identity.emoji,
      model: a.identity.model,
      depth: a.depth,
      parentId: a.parentId,
      childIds: a.childIds,
    }));
    res.json({
      root: orgChart.root.id,
      agents,
      channels: orgChart.channels,
    });
  });

  // GET /api/agents — all agent states
  router.get('/agents', (_req, res) => {
    const states = ctx.state.listAll();
    const agents = Array.from(ctx.orgChart.agents.values()).map(a => {
      const state = states.find(s => s.agentId === a.id);
      return {
        id: a.id,
        name: a.identity.name,
        role: a.identity.role,
        emoji: a.identity.emoji,
        model: a.identity.model,
        status: state?.status ?? 'idle',
        lastHeartbeat: state?.lastHeartbeat,
        currentTask: state?.currentTask,
      };
    });
    res.json(agents);
  });

  // GET /api/agents/:id — single agent detail with live files
  router.get('/agents/:id', async (req, res) => {
    const agent = ctx.orgChart.agents.get(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });

    const state = ctx.state.get(req.params.id);
    // Re-read files from disk (agent may have self-modified)
    const freshFiles = readAgentFiles(agent.dir);
    const recentInvocations = ctx.audit.getInvocations({
      agentId: req.params.id,
      limit: 20,
    });
    const tokenTotals = ctx.audit.getTokenTotals(req.params.id);

    res.json({
      id: agent.id,
      identity: agent.identity,
      depth: agent.depth,
      parentId: agent.parentId,
      childIds: agent.childIds,
      dir: agent.dir,
      state: state ?? { agentId: agent.id, status: 'idle' },
      files: freshFiles,
      recentInvocations,
      tokenTotals,
    });
  });

  return router;
}
```

**Important**: `readAgentFiles()` is already defined in `src/org/parser.ts` but may not be exported. If not exported, add `export` to it. It reads the 6 md files from an agent's directory. Calling it fresh on each request ensures we see the latest files even if agents have self-modified them.

**`packages/dashboard/src/server/routes/channels.ts`**:
```typescript
import { Router } from 'express';
import type { HiveContext } from 'hive/context.js';

export function createChannelRoutes(ctx: HiveContext): Router {
  const router = Router();

  // GET /api/channels — list all channels
  router.get('/', async (_req, res) => {
    const channels = await ctx.comms.listChannels();
    res.json(channels.map(ch => ({
      ...ch,
      createdAt: ch.createdAt.toISOString(),
    })));
  });

  // GET /api/channels/:name/messages
  router.get('/:name/messages', async (req, res) => {
    const limit = parseInt(req.query.limit as string) || 50;
    const since = req.query.since ? new Date(req.query.since as string) : undefined;
    const messages = await ctx.comms.readChannel(req.params.name, { limit, since });
    res.json(messages.map(m => ({
      ...m,
      timestamp: m.timestamp.toISOString(),
    })));
  });

  return router;
}
```

**`packages/dashboard/src/server/routes/chat.ts`**:
```typescript
import { Router } from 'express';
import type { HiveContext } from 'hive/context.js';
import { chatAction } from 'hive/comms/cli-commands.js';
import { MessageGateway } from 'hive/comms/message-gateway.js';

export function createChatRoutes(ctx: HiveContext): Router {
  const router = Router();

  let ceoWorking = false;

  // POST /api/chat — send message to CEO
  router.post('/', async (req, res) => {
    const { message } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message is required' });
    }

    // If CEO is already working, return 202
    const ceoState = ctx.state.get(ctx.orgChart.root.id);
    if (ceoState?.status === 'working' || ceoWorking) {
      // Post message to #board anyway — CEO will pick it up on next heartbeat
      await ctx.comms.postMessage('board', 'super-user', message);
      return res.status(202).json({ queued: true, message: 'CEO is busy. Message queued.' });
    }

    ceoWorking = true;
    // Emit SSE event: ceo-working started (handled in Task 4)

    try {
      const gateway = new MessageGateway(ctx.comms, ctx.audit);
      const result = await chatAction({
        message,
        gateway,
        provider: ctx.comms,
        ceoDir: ctx.orgChart.root.dir,
      });

      res.json({
        queued: false,
        response: result.ceoResponse ? {
          content: result.ceoResponse.content,
          timestamp: result.ceoResponse.timestamp.toISOString(),
        } : null,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    } finally {
      ceoWorking = false;
      // Emit SSE event: ceo-working completed
    }
  });

  return router;
}
```

**`packages/dashboard/src/server/routes/audit.ts`**:
```typescript
import { Router } from 'express';
import type { HiveContext } from 'hive/context.js';

export function createAuditRoutes(ctx: HiveContext): Router {
  const router = Router();

  // GET /api/audit — invocation log with filters
  router.get('/', (req, res) => {
    const agentId = req.query.agentId as string | undefined;
    const invocationType = req.query.type as string | undefined;
    const since = req.query.since ? new Date(req.query.since as string) : undefined;
    const limit = parseInt(req.query.limit as string) || 50;

    const invocations = ctx.audit.getInvocations({
      agentId,
      invocationType,  // Requires AuditStore extension — see below
      since,
      limit,
    });
    res.json(invocations);
  });

  // GET /api/audit/totals — token totals
  router.get('/totals', (req, res) => {
    const agentId = req.query.agentId as string | undefined;
    const totals = ctx.audit.getTokenTotals(agentId);
    res.json(totals);
  });

  return router;
}
```

**Extend `src/audit/store.ts`** — add `invocationType` to `getInvocations()` filter:
```typescript
// Change the filter type:
getInvocations(filter: { agentId?: string; invocationType?: string; since?: Date; limit?: number }): InvocationRow[] {
  // ... existing code ...
  if (filter.invocationType) {
    sql += ' AND invocation_type = ?';
    params.push(filter.invocationType);
  }
  // ... rest unchanged ...
}
```

**`packages/dashboard/src/server/routes/system.ts`**:
```typescript
import { Router } from 'express';
import type { HiveContext } from 'hive/context.js';
import path from 'path';

export function createSystemRoutes(ctx: HiveContext): Router {
  const router = Router();

  // GET /api/status — orchestrator status
  router.get('/status', async (_req, res) => {
    const { PidFile } = await import('hive/orchestrator/pid-file.js');
    const pidFile = new PidFile(path.join(ctx.dataDir, 'hive.pid'));
    const pid = pidFile.read();
    const running = pidFile.isRunning();

    res.json({
      running,
      pid: running ? pid : null,
      agentCount: ctx.orgChart.agents.size,
      channelCount: ctx.orgChart.channels.length,
    });
  });

  // POST /api/orchestrator/start
  router.post('/orchestrator/start', async (_req, res) => {
    const { PidFile } = await import('hive/orchestrator/pid-file.js');
    const pidFile = new PidFile(path.join(ctx.dataDir, 'hive.pid'));
    if (pidFile.isRunning()) {
      return res.status(409).json({ error: 'Orchestrator already running' });
    }

    // Start orchestrator as detached subprocess
    const { spawn } = await import('child_process');
    const child = spawn('node', [
      path.resolve(ctx.dataDir, '../bin/hive'),
      'start',
    ], {
      detached: true,
      stdio: 'ignore',
      cwd: path.resolve(ctx.dataDir, '..'),
    });
    child.unref();

    res.json({ started: true, pid: child.pid });
  });

  // POST /api/orchestrator/stop
  router.post('/orchestrator/stop', async (_req, res) => {
    const { PidFile } = await import('hive/orchestrator/pid-file.js');
    const pidFile = new PidFile(path.join(ctx.dataDir, 'hive.pid'));
    const pid = pidFile.read();

    if (!pid || !pidFile.isRunning()) {
      return res.status(404).json({ error: 'Orchestrator not running' });
    }

    try {
      process.kill(pid, 'SIGTERM');
      res.json({ stopped: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
```

**Update `packages/dashboard/src/server/index.ts`** to mount router:
```typescript
import { createApiRouter } from './router.js';
// ...
app.use('/api', createApiRouter(ctx));
```

### Tests
- `packages/dashboard/src/server/__tests__/routes.test.ts`:
  - Use a temp org dir + fixture data
  - Create `HiveContext`, then `createApiRouter(ctx)` mounted on a test Express app
  - Test each endpoint:
    - `GET /api/org` → 200, has `root`, `agents` array, `channels`
    - `GET /api/agents` → 200, array of agents with status
    - `GET /api/agents/:id` → 200 with files, 404 for unknown
    - `GET /api/channels` → 200, array
    - `GET /api/channels/:name/messages` → 200, array (may be empty)
    - `GET /api/audit` → 200, array
    - `GET /api/audit/totals` → 200, `{ totalIn, totalOut }`
    - `GET /api/status` → 200, `{ running, pid, agentCount }`
  - Use `supertest` for HTTP assertions (add to devDeps)

### Verification
```bash
npx vitest run packages/dashboard/
npx vitest run  # All core tests still pass (audit store filter change is additive)
```

---

## Task 4: SSE Event Stream

### Goal
Implement `/api/events` — a Server-Sent Events endpoint that pushes real-time updates to the browser.

### Files to Create
- `packages/dashboard/src/server/sse.ts`

### Files to Modify
- `packages/dashboard/src/server/index.ts` — mount SSE endpoint
- `packages/dashboard/src/server/routes/chat.ts` — emit `ceo-working` events

### Implementation

**`packages/dashboard/src/server/sse.ts`**:
```typescript
import type { Request, Response } from 'express';
import type { HiveContext } from 'hive/context.js';
import type { AgentState } from 'hive/types.js';

interface SSEClient {
  id: string;
  res: Response;
}

export class SSEManager {
  private clients: SSEClient[] = [];
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private lastStates: Map<string, AgentState> = new Map();
  private lastMessageTimestamp: string | null = null;

  constructor(private ctx: HiveContext) {}

  addClient(req: Request, res: Response): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const client: SSEClient = {
      id: crypto.randomUUID(),
      res,
    };
    this.clients.push(client);

    // Send initial state
    this.sendEvent(res, 'connected', { clientId: client.id });

    req.on('close', () => {
      this.clients = this.clients.filter(c => c.id !== client.id);
    });
  }

  startPolling(intervalMs = 2000): void {
    if (this.pollInterval) return;

    this.pollInterval = setInterval(() => {
      if (this.clients.length === 0) return;
      this.pollAgentStates();
      this.pollNewMessages();
    }, intervalMs);
  }

  stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  // Called by chat route when CEO starts/stops working
  emitCeoWorking(status: 'started' | 'completed'): void {
    this.broadcast('ceo-working', { status });
  }

  private pollAgentStates(): void {
    const states = this.ctx.state.listAll();
    for (const state of states) {
      const prev = this.lastStates.get(state.agentId);
      if (!prev || prev.status !== state.status || prev.currentTask !== state.currentTask) {
        this.broadcast('agent-state', {
          agentId: state.agentId,
          status: state.status,
          currentTask: state.currentTask,
          lastHeartbeat: state.lastHeartbeat?.toISOString(),
        });
        this.lastStates.set(state.agentId, state);
      }
    }
  }

  private async pollNewMessages(): Promise<void> {
    // Get messages since last poll across all channels
    const channels = await this.ctx.comms.listChannels();
    for (const ch of channels) {
      const since = this.lastMessageTimestamp
        ? new Date(this.lastMessageTimestamp)
        : new Date(Date.now() - 2000);  // First poll: last 2 seconds
      const messages = await this.ctx.comms.readChannel(ch.name, { since });
      for (const msg of messages) {
        const ts = msg.timestamp.toISOString();
        if (!this.lastMessageTimestamp || ts > this.lastMessageTimestamp) {
          this.lastMessageTimestamp = ts;
        }
        this.broadcast('new-message', {
          channel: msg.channel,
          sender: msg.sender,
          content: msg.content,
          timestamp: ts,
          id: msg.id,
        });
      }
    }
  }

  private broadcast(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    this.clients.forEach(client => {
      try {
        client.res.write(payload);
      } catch {
        // Client disconnected
      }
    });
  }

  private sendEvent(res: Response, event: string, data: unknown): void {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}
```

**Mount SSE in `packages/dashboard/src/server/index.ts`**:
```typescript
import { SSEManager } from './sse.js';

// After creating ctx:
const sse = new SSEManager(ctx);
sse.startPolling();

app.get('/api/events', (req, res) => sse.addClient(req, res));

// Pass sse to chat routes so they can emit ceo-working
// Option A: attach to app.locals
app.locals.sse = sse;
// Option B: pass directly to route factory (cleaner)
```

**Update chat routes** to emit SSE:
```typescript
// In chat.ts, accept SSEManager as param:
export function createChatRoutes(ctx: HiveContext, sse: SSEManager): Router {
  // ...
  // Before chatAction:
  sse.emitCeoWorking('started');
  // After chatAction completes:
  sse.emitCeoWorking('completed');
}
```

### Optimization Notes
- The `pollNewMessages()` iterates all channels, which is fine for <20 channels. For larger orgs, could track per-channel last-seen timestamps
- `better-sqlite3` is synchronous — polling queries block the event loop briefly. For expected volumes (<10K rows) this is negligible
- SSE heartbeat: optionally send a comment line every 30s to keep connections alive through proxies: `res.write(': heartbeat\n\n')`

### Tests
- `packages/dashboard/src/server/__tests__/sse.test.ts`:
  - SSEManager broadcasts events to connected clients
  - `emitCeoWorking()` sends correct event format
  - Disconnected clients are cleaned up
  - Polling detects agent state changes and emits events
  - Use mock Response objects or lightweight HTTP test

### Verification
```bash
npx vitest run packages/dashboard/
# Manual: curl http://localhost:3001/api/events and verify SSE stream
```

---

## Execution Order

1. **Task 1** first — HiveContext is the foundation everything depends on
2. **Task 2** next — scaffold must exist before routes can be added
3. **Task 3** then — routes depend on scaffold + HiveContext
4. **Task 4** last — SSE depends on routes being mountable

Each task should be committed separately. Run full test suite after each task.

---

## Dependencies to Install

Root level:
- No new deps (HiveContext uses existing packages)

Dashboard package:
- `express` (runtime)
- `react`, `react-dom`, `react-router-dom` (runtime, but Vite bundles them)
- `@vitejs/plugin-react`, `vite`, `tailwindcss` (dev)
- `@types/express`, `@types/react`, `@types/react-dom` (dev)
- `supertest`, `@types/supertest` (dev, for route tests)

## Risk Notes

- **Workspace resolution**: The `hive` workspace reference in dashboard `package.json` requires the root package to have proper `exports` field. If resolution fails, fall back to relative imports (`../../src/context.js`)
- **Circular dependency**: Dashboard imports from core but core should NEVER import from dashboard. This is one-way only.
- **SQLite concurrent access**: Dashboard reads while orchestrator writes. WAL mode handles this — already enabled on all stores. No action needed.
- **`readAgentFiles` export**: Check if it's currently exported from `src/org/parser.ts`. If not, add `export` keyword.
