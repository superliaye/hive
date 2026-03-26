import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { HiveContext } from '../../../../src/context.js';
import { Daemon } from '../../../../src/daemon/daemon.js';
import { HiveEventBus } from '../../../../src/events/event-bus.js';
import { PidFile } from '../../../../src/orchestrator/pid-file.js';
import { createApiRouter } from './router.js';
import { SSEManager } from './sse.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Allow the dashboard to spawn claude CLI even when launched from within Claude Code
delete process.env.CLAUDECODE;

export async function createServer(opts: { port: number; host?: string; cwd?: string }) {
  const ctx = await HiveContext.create(opts.cwd);
  const eventBus = new HiveEventBus();

  // Start daemon in-process if not already running externally
  let daemon: Daemon | null = null;
  const pidFile = new PidFile(path.join(ctx.dataDir, 'hive.pid'));

  if (!pidFile.isRunning()) {
    daemon = new Daemon({
      orgChart: ctx.orgChart,
      comms: ctx.comms,
      audit: ctx.audit,
      state: ctx.state,
      channelManager: ctx.channelManager,
      dataDir: ctx.dataDir,
      orgDir: ctx.orgDir,
      pidFilePath: path.join(ctx.dataDir, 'hive.pid'),
      tickIntervalMs: 600_000,
    });

    try {
      await daemon.start();
      console.log('[dashboard] Daemon started in-process');
    } catch (err) {
      console.warn('[dashboard] Could not start daemon:', err instanceof Error ? err.message : err);
      daemon = null;
    }
  } else {
    console.log('[dashboard] External daemon detected, skipping in-process daemon');
  }

  // Wire event bus: wrap stores to emit events on mutations
  wireEventBus(ctx, eventBus, daemon);

  const app = express();
  const sse = new SSEManager(ctx, eventBus);

  app.use(express.json());

  // SSE endpoint (before router to avoid wildcard catch)
  app.get('/api/events', (req, res) => sse.addClient(req, res));

  // API routes
  app.use('/api', createApiRouter(ctx, sse));

  // Start SSE event-driven mode (with slow fallback heartbeat)
  sse.start();

  // Serve static files from Vite build output
  const dashboardRoot = path.resolve(__dirname, '../..');
  const clientDir = path.join(dashboardRoot, 'dist', 'client');
  if (fs.existsSync(clientDir)) {
    app.use(express.static(clientDir));
    app.get('/{*path}', (_req, res) => {
      res.sendFile(path.join(clientDir, 'index.html'));
    });
  } else {
    app.get('/{*path}', (_req, res) => {
      res.status(503).send('Dashboard not built. Run: npm run -w @hive/dashboard dev (for dev) or npm run -w @hive/dashboard build (for prod)');
    });
  }

  const host = opts.host ?? '0.0.0.0';
  const server = app.listen(opts.port, host, () => {
    console.log(`Hive Dashboard running at http://${host}:${opts.port}`);
    if (host === '0.0.0.0') {
      console.log(`  LAN: http://<your-ip>:${opts.port}`);
    }
  });

  // Periodic hot-reload: detect new agents every 30 seconds
  let hotReloadTimer: ReturnType<typeof setInterval> | null = null;
  if (daemon) {
    hotReloadTimer = setInterval(async () => {
      try {
        const { added, removed } = await daemon!.hotReload();
        if (added.length > 0 || removed.length > 0) {
          console.log(`[dashboard] hot-reload: +${added.length} -${removed.length} agents`);
        }
      } catch (err) {
        console.error('[dashboard] hot-reload error:', err);
      }
    }, 30_000);
  }

  const shutdown = async () => {
    if (hotReloadTimer) clearInterval(hotReloadTimer);
    sse.stop();
    if (daemon) {
      await daemon.stop();
      console.log('[dashboard] Daemon stopped');
    }
    ctx.close();
    server.close();
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return { app, server, ctx, sse, daemon };
}

/**
 * Wire the event bus to stores using the wrapper pattern.
 * After each mutation, emit the corresponding event for real-time SSE push.
 */
function wireEventBus(ctx: HiveContext, bus: HiveEventBus, daemon: Daemon | null): void {
  // Wrap comms.postMessage → emit message:new + signal daemon
  const originalPostMessage = ctx.comms.postMessage.bind(ctx.comms);
  ctx.comms.postMessage = async (channel: string, sender: string, content: string, opts?: { thread?: string }) => {
    const msg = await originalPostMessage(channel, sender, content, opts);
    bus.emit('message:new', {
      id: msg.id,
      channel: msg.channel,
      sender: msg.sender,
      content: msg.content,
      timestamp: msg.timestamp.toISOString(),
      thread: msg.thread,
    });
    if (daemon) {
      daemon.signalChannel(channel);
    }
    return msg;
  };

  // Wrap state.updateStatus → emit agent:state
  const originalUpdateStatus = ctx.state.updateStatus.bind(ctx.state);
  ctx.state.updateStatus = (agentId: string, status: Parameters<typeof originalUpdateStatus>[1], opts?: { pid?: number; currentTask?: string }) => {
    const result = originalUpdateStatus(agentId, status, opts);
    bus.emit('agent:state', {
      agentId,
      status,
      currentTask: opts?.currentTask,
      pid: opts?.pid,
    });
    return result;
  };

  // Wrap audit.logInvocation → emit audit:invocation
  const originalLogInvocation = ctx.audit.logInvocation.bind(ctx.audit);
  ctx.audit.logInvocation = (opts: any) => {
    const id = originalLogInvocation(opts);
    bus.emit('audit:invocation', {
      id,
      agentId: opts.agentId,
      invocationType: opts.invocationType,
      model: opts.model,
      tokensIn: opts.tokensIn,
      tokensOut: opts.tokensOut,
      durationMs: opts.durationMs,
      channel: opts.channel,
    });
    return id;
  };
}

// Direct invocation (when run as standalone script)
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = parseInt(process.env.PORT ?? '3001', 10);
  createServer({ port });
}
