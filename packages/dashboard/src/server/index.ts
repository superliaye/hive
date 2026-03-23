import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { HiveContext } from '../../../../src/context.js';
import { createApiRouter } from './router.js';
import { SSEManager } from './sse.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

  // Serve static files in production
  const clientDir = path.resolve(__dirname, '../client');
  app.use(express.static(clientDir));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDir, 'index.html'));
  });

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
