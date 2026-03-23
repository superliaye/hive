import { Router } from 'express';
import type { HiveContext } from '../../../../../src/context.js';
import type { SSEManager } from '../sse.js';

export function createChatRoutes(ctx: HiveContext, sse: SSEManager): Router {
  const router = Router();

  // POST /api/chat — post message to #board, daemon handles the rest
  router.post('/', async (req, res) => {
    const { message } = req.body;
    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    try {
      const userMessage = await ctx.comms.postMessage('board', 'super-user', message);

      // CEO status is tracked via agent-state SSE polling —
      // the daemon will set CEO to 'working' when it processes the message
      res.json({
        posted: true,
        messageId: userMessage.id,
        note: 'Message posted to #board. CEO will respond via daemon.',
      });
    } catch (err: any) {
      console.error('[chat] Error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
