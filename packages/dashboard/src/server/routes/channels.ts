import { Router } from 'express';
import type { HiveContext } from '../../../../../src/context.js';

export function createChannelRoutes(ctx: HiveContext): Router {
  const router = Router();

  // GET /api/channels — list all channels
  router.get('/', async (_req, res) => {
    const channels = await ctx.comms.listChannels();
    res.json(channels.map(ch => ({
      ...ch,
      createdAt: ch.createdAt.toISOString(),
    })));
  });

  // GET /api/channels/:name/messages
  router.get('/:name/messages', async (req, res) => {
    const limit = parseInt(req.query.limit as string) || 50;
    const since = req.query.since ? new Date(req.query.since as string) : undefined;
    const messages = await ctx.comms.readChannel(req.params.name, { limit, since });
    res.json(messages.map(m => ({
      ...m,
      timestamp: m.timestamp.toISOString(),
    })));
  });

  return router;
}
