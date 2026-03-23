import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { HiveContext } from '../../../../src/context.js';
import { createApiRouter } from './router.js';
import { SSEManager } from './sse.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Allow the dashboard to spawn claude CLI even when launched from within Claude Code
delete process.env.CLAUDECODE;

export async function createServer(opts: { port: number; cwd?: string }) {
  const ctx = await HiveContext.create(opts.cwd);
  const app = express();
  const sse = new SSEManager(ctx);

  app.use(express.json());

  // SSE endpoint (before router to avoid wildcard catch)
  app.get('/api/events', (req, res) => sse.addClient(req, res));

  // API routes
  app.use('/api', createApiRouter(ctx, sse));

  // Start SSE polling
  sse.startPolling();

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

  const server = app.listen(opts.port, () => {
    console.log(`Hive Dashboard running at http://localhost:${opts.port}`);
  });

  process.on('SIGTERM', () => {
    sse.stopPolling();
    ctx.close();
    server.close();
  });

  return { app, server, ctx, sse };
}

// Direct invocation (when run as standalone script)
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = parseInt(process.env.PORT ?? '3001', 10);
  createServer({ port });
}
