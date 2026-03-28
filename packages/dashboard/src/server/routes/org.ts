import { Router } from 'express';
import type { HiveContext } from '../../../../../src/context.js';
import { readAgentFiles } from '../../../../../src/org/parser.js';

export function createOrgRoutes(ctx: HiveContext): Router {
  const router = Router();

  // GET /api/org — full org chart with tree structure for OrgTree component
  router.get('/', (_req, res) => {
    const { orgChart } = ctx;
    const agentList = Array.from(orgChart.agents.values());

    // Build depth map via BFS from roots
    const depthMap = new Map<string, number>();
    const roots = agentList.filter(a => !a.reportsTo);
    const queue = roots.map(a => ({ alias: a.person.alias, depth: 0 }));
    while (queue.length > 0) {
      const { alias, depth } = queue.shift()!;
      depthMap.set(alias, depth);
      const agent = orgChart.agents.get(alias);
      if (agent) {
        for (const report of agent.directReports) {
          queue.push({ alias: report.alias, depth: depth + 1 });
        }
      }
    }

    const agents = agentList.map(a => ({
      id: a.person.alias,
      name: a.identity.name,
      role: a.identity.role,
      emoji: a.identity.emoji,
      model: a.identity.model,
      depth: depthMap.get(a.person.alias) ?? 0,
      parentId: a.reportsTo?.alias ?? null,
      childIds: a.directReports.map(p => p.alias),
    }));

    const root = roots[0]?.person.alias ?? null;

    res.json({
      root,
      agents,
      conversations: [],
    });
  });

  // GET /api/org/meta — org metadata (root agent alias and name)
  router.get('/meta', (_req, res) => {
    const agentList = Array.from(ctx.orgChart.agents.values());
    const root = agentList.find(a => !a.reportsTo);
    const rootAlias = root?.person.alias ?? 'ceo';
    const rootName = root?.identity.name ?? 'CEO';

    const rootId = ctx.chatAdapter.resolveAlias(rootAlias);
    const dm = ctx.conversations.ensureDm(0, rootId);

    res.json({
      rootAlias,
      rootName,
      rootConversation: dm.id,
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
        id: a.person.alias,
        name: a.identity.name,
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
