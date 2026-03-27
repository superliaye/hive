import { Router } from 'express';
import type { HiveContext } from '../../../../src/context.js';
import type { Daemon } from '../../../../src/daemon/daemon.js';
import type { SSEManager } from './sse.js';
import { createOrgRoutes, createAgentRoutes } from './routes/org.js';
import { createConversationRoutes } from './routes/conversations.js';
import { createChatRoutes } from './routes/chat.js';
import { createAuditRoutes } from './routes/audit.js';
import { createSystemRoutes } from './routes/system.js';

export function createApiRouter(ctx: HiveContext, sse: SSEManager, daemon?: Daemon | null): Router {
  const router = Router();
  router.use('/org', createOrgRoutes(ctx));
  router.use('/agents', createAgentRoutes(ctx));
  router.use('/conversations', createConversationRoutes(ctx));
  router.use('/chat', createChatRoutes(ctx, sse));
  router.use('/audit', createAuditRoutes(ctx));
  router.use('/', createSystemRoutes(ctx));

  // POST /api/signal — notify daemon that a message arrived on a conversation
  router.post('/signal', (req, res) => {
    const { conversation } = req.body;
    if (!conversation) {
      res.status(400).json({ error: 'conversation is required' });
      return;
    }
    if (daemon) {
      daemon.signalConversation(conversation);
    }
    res.json({ signaled: true });
  });

  return router;
}
