import { Router } from 'express';
import type { HiveContext } from '../../../../../src/context.js';

export function createAuditRoutes(ctx: HiveContext): Router {
  const router = Router();

  // GET /api/audit — invocation log with filters
  router.get('/', (req, res) => {
    const agentId = req.query.agentId as string | undefined;
    const invocationType = req.query.type as string | undefined;
    const since = req.query.since ? new Date(req.query.since as string) : undefined;
    const limit = parseInt(req.query.limit as string) || 50;

    const invocations = ctx.audit.getInvocations({
      agentId,
      invocationType,
      since,
      limit,
    });
    res.json(invocations);
  });

  // GET /api/audit/totals — token totals
  router.get('/totals', (req, res) => {
    const agentId = req.query.agentId as string | undefined;
    const totals = ctx.audit.getTokenTotals(agentId);
    res.json(totals);
  });

  // GET /api/audit/agent-totals — token totals grouped by agent (single query)
  router.get('/agent-totals', (_req, res) => {
    const totals = ctx.audit.getTokenTotalsByAgent();
    res.json(totals);
  });

  return router;
}
