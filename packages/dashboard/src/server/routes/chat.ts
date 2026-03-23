import { Router } from 'express';
import type { HiveContext } from '../../../../../src/context.js';
import { chatAction } from '../../../../../src/comms/cli-commands.js';
import { MessageGateway } from '../../../../../src/comms/message-gateway.js';
import type { SSEManager } from '../sse.js';

export function createChatRoutes(ctx: HiveContext, sse: SSEManager): Router {
  const router = Router();

  let ceoWorking = false;

  // POST /api/chat — send message to CEO
  router.post('/', async (req, res) => {
    const { message } = req.body;
    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    // If CEO is already working, queue the message
    const ceoState = ctx.state.get(ctx.orgChart.root.id);
    if (ceoState?.status === 'working' || ceoWorking) {
      await ctx.comms.postMessage('board', 'super-user', message);
      res.status(202).json({ queued: true, message: 'CEO is busy. Message queued.' });
      return;
    }

    ceoWorking = true;
    sse.emitCeoWorking('started');

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
      sse.emitCeoWorking('completed');
    }
  });

  return router;
}
