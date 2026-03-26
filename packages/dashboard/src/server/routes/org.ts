import { Router } from 'express';
import type { HiveContext } from '../../../../../src/context.js';
import { readAgentFiles } from '../../../../../src/org/parser.js';

export function createOrgRoutes(ctx: HiveContext): Router {
  const router = Router();

  // GET /api/org — full org chart
  router.get('/', (_req, res) => {
    const { orgChart } = ctx;
    const agents = Array.from(orgChart.agents.values()).map(a => ({
      alias: a.person.alias,
      id: a.person.id,
      name: a.person.name,
      role: a.identity.role,
      emoji: a.identity.emoji,
      model: a.identity.model,
      reportsTo: a.reportsTo?.alias ?? null,
      directReports: a.directReports.map(p => p.alias),
    }));
    res.json({
      agents,
      people: orgChart.people,
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
      const state = states.find(s => s.agentId === a.person.alias);
      return {
        alias: a.person.alias,
        id: a.person.id,
        name: a.person.name,
        role: a.identity.role,
        emoji: a.identity.emoji,
        model: a.identity.model,
        status: state?.status ?? 'idle',
        lastHeartbeat: state?.lastHeartbeat,
        lastInvocation: state?.lastInvocation,
        currentTask: state?.currentTask,
      };
    });
    res.json(agents);
  });

  // GET /api/agents/:alias — single agent detail with live files
  router.get('/:alias', async (req, res) => {
    const agent = ctx.orgChart.agents.get(req.params.alias);
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const state = ctx.state.get(req.params.alias);
    const freshFiles = await readAgentFiles(agent.dir);
    const recentInvocations = ctx.audit.getInvocations({
      agentId: req.params.alias,
      limit: 20,
    });
    const tokenTotals = ctx.audit.getTokenTotals(req.params.alias);

    res.json({
      alias: agent.person.alias,
      id: agent.person.id,
      identity: agent.identity,
      reportsTo: agent.reportsTo?.alias ?? null,
      directReports: agent.directReports.map(p => p.alias),
      dir: agent.dir,
      state: state ?? { agentId: agent.person.alias, status: 'idle' },
      files: freshFiles,
      recentInvocations,
      tokenTotals,
    });
  });

  return router;
}
