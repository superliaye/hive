import { Router } from 'express';
import type { HiveContext } from '../../../../../src/context.js';
import type { SSEManager } from '../sse.js';

export function createChatRoutes(ctx: HiveContext, sse: SSEManager): Router {
  const router = Router();

  // Resolve root agent (CEO)
  function getRootAgent() {
    const agents = Array.from(ctx.orgChart.agents.values());
    return agents.find(a => !a.reportsTo) ?? null;
  }

  // POST /api/chat/post — post to any channel as any agent (used by `hive post`)
  router.post('/post', (req, res) => {
    const { channel, sender, message } = req.body;
    if (!channel || !sender || !message) {
      res.status(400).json({ error: 'channel, sender, and message are required' });
      return;
    }
    try {
      const senderId = ctx.chatAdapter.resolveAlias(sender);
      const msg = ctx.messages.send(channel, senderId, message);
      res.json({ posted: true, messageId: `${channel}:${msg.seq}` });
    } catch (err: any) {
      console.error('[chat/post] Error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/chat — post message to CEO's DM as super-user, daemon handles the rest
  router.post('/', (req, res) => {
    const { message } = req.body;
    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    try {
      const root = getRootAgent();
      const rootAlias = root?.person.alias ?? 'ceo';
      const rootId = ctx.chatAdapter.resolveAlias(rootAlias);
      const channel = ctx.channels.ensureDm(0, rootId); // 0 = super-user
      const msg = ctx.messages.send(channel.id, 0, message);

      res.json({
        posted: true,
        messageId: `${channel.id}:${msg.seq}`,
      });
    } catch (err: any) {
      console.error('[chat] Error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
