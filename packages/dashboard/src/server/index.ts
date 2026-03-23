import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { HiveContext } from '../../../../src/context.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function createServer(opts: { port: number; cwd?: string }) {
  const ctx = await HiveContext.create(opts.cwd);
  const app = express();

  app.use(express.json());

  // API routes will be mounted in Task 3:
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

  process.on('SIGTERM', () => {
    ctx.close();
    server.close();
  });

  return { app, server, ctx };
}

// Direct invocation (when run as standalone script)
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = parseInt(process.env.PORT ?? '3001', 10);
  createServer({ port });
}
