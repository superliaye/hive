import { Router } from 'express';
import path from 'path';
import type { HiveContext } from '../../../../../src/context.js';
import { PidFile } from '../../../../../src/orchestrator/pid-file.js';

export function createSystemRoutes(ctx: HiveContext): Router {
  const router = Router();

  const getPidFile = () => new PidFile(path.join(ctx.dataDir, 'hive.pid'));

  // GET /api/status — daemon status
  router.get('/status', (_req, res) => {
    const pidFile = getPidFile();
    const pid = pidFile.read();
    const running = pidFile.isRunning();

    let channelCount = 0;
    try {
      const channelIds = ctx.access.getAccessibleChannels(0);
      channelCount = channelIds.length;
    } catch { /* chat not initialized yet */ }

    res.json({
      running,
      pid: running ? pid : null,
      agentCount: ctx.orgChart.agents.size,
      channelCount,
    });
  });

  return router;
}
