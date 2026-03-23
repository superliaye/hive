import { Router } from 'express';
import type { HiveContext } from '../../../../src/context.js';
import type { SSEManager } from './sse.js';
import { createOrgRoutes, createAgentRoutes } from './routes/org.js';
import { createChannelRoutes } from './routes/channels.js';
import { createChatRoutes } from './routes/chat.js';
import { createAuditRoutes } from './routes/audit.js';
import { createSystemRoutes } from './routes/system.js';

export function createApiRouter(ctx: HiveContext, sse: SSEManager): Router {
  const router = Router();
  router.use('/org', createOrgRoutes(ctx));
  router.use('/agents', createAgentRoutes(ctx));
  router.use('/channels', createChannelRoutes(ctx));
  router.use('/chat', createChatRoutes(ctx, sse));
  router.use('/audit', createAuditRoutes(ctx));
  router.use('/', createSystemRoutes(ctx));
  return router;
}
