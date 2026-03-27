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

    let conversationCount = 0;
    try {
      const conversationIds = ctx.access.getAccessibleConversations(0);
      conversationCount = conversationIds.length;
    } catch { /* chat not initialized yet */ }

    res.json({
      running,
      pid: running ? pid : null,
      agentCount: ctx.orgChart.agents.size,
      conversationCount,
    });
  });

  return router;
}
