import { Router } from 'express';
import type { HiveContext } from '../../../../../src/context.js';
import { readAgentFiles } from '../../../../../src/org/parser.js';

export function createOrgRoutes(ctx: HiveContext): Router {
  const router = Router();

  // GET /api/org — full org chart tree
  router.get('/', (_req, res) => {
    const { orgChart } = ctx;
    const agents = Array.from(orgChart.agents.values()).map(a => ({
      id: a.id,
      name: a.identity.name,
      role: a.identity.role,
      emoji: a.identity.emoji,
      model: a.identity.model,
      depth: a.depth,
      parentId: a.parentId,
      childIds: a.childIds,
    }));
    res.json({
      root: orgChart.root.id,
      agents,
      channels: orgChart.channels,
    });
  });

  return router;
}

export function createAgentRoutes(ctx: HiveContext): Router {
  const router = Router();

  // GET /api/agents — all agent states
  router.get('/', (_req, res) => {
    const states = ctx.state.listAll();
    const agents = Array.from(ctx.orgChart.agents.values()).map(a => {
      const state = states.find(s => s.agentId === a.id);
      return {
        id: a.id,
        name: a.identity.name,
        role: a.identity.role,
        emoji: a.identity.emoji,
        model: a.identity.model,
        status: state?.status ?? 'idle',
        lastHeartbeat: state?.lastHeartbeat,
        currentTask: state?.currentTask,
      };
    });
    res.json(agents);
  });

  // GET /api/agents/:id — single agent detail with live files
  router.get('/:id', async (req, res) => {
    const agent = ctx.orgChart.agents.get(req.params.id);
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const state = ctx.state.get(req.params.id);
    const freshFiles = await readAgentFiles(agent.dir);
    const recentInvocations = ctx.audit.getInvocations({
      agentId: req.params.id,
      limit: 20,
    });
    const tokenTotals = ctx.audit.getTokenTotals(req.params.id);

    res.json({
      id: agent.id,
      identity: agent.identity,
      depth: agent.depth,
      parentId: agent.parentId,
      childIds: agent.childIds,
      dir: agent.dir,
      state: state ?? { agentId: agent.id, status: 'idle' },
      files: freshFiles,
      recentInvocations,
      tokenTotals,
    });
  });

  return router;
}
