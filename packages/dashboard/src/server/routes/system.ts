import { Router } from 'express';
import { spawn } from 'child_process';
import path from 'path';
import type { HiveContext } from '../../../../../src/context.js';
import { PidFile } from '../../../../../src/orchestrator/pid-file.js';

export function createSystemRoutes(ctx: HiveContext): Router {
  const router = Router();

  const getPidFile = () => new PidFile(path.join(ctx.dataDir, 'hive.pid'));

  // GET /api/status — orchestrator status
  router.get('/status', (_req, res) => {
    const pidFile = getPidFile();
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
  router.post('/orchestrator/start', (_req, res) => {
    const pidFile = getPidFile();
    if (pidFile.isRunning()) {
      res.status(409).json({ error: 'Orchestrator already running' });
      return;
    }

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
  router.post('/orchestrator/stop', (_req, res) => {
    const pidFile = getPidFile();
    const pid = pidFile.read();

    if (!pid || !pidFile.isRunning()) {
      res.status(404).json({ error: 'Orchestrator not running' });
      return;
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
