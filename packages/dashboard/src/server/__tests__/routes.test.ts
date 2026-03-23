import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { HiveContext } from '../../../../../src/context.js';
import { createApiRouter } from '../router.js';
import { SSEManager } from '../sse.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ORG = path.resolve(__dirname, '../../../../../tests/fixtures/sample-org');

let tempDir: string;
let ctx: HiveContext;
let app: express.Express;

async function request(path: string, opts?: RequestInit) {
  const server = app.listen(0);
  const addr = server.address() as { port: number };
  try {
    const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, opts);
    const body = await res.json();
    return { status: res.status, body };
  } finally {
    server.close();
  }
}

describe('Dashboard API routes', () => {
  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-routes-'));
    fs.cpSync(FIXTURE_ORG, path.join(tempDir, 'org'), { recursive: true });
    ctx = await HiveContext.create(tempDir);

    // Register agents in state store
    for (const [id] of ctx.orgChart.agents) {
      ctx.state.register(id);
    }

    const sse = new SSEManager(ctx);
    app = express();
    app.use(express.json());
    app.use('/api', createApiRouter(ctx, sse));
  });

  afterEach(() => {
    ctx.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('GET /api/org returns org chart', async () => {
    const { status, body } = await request('/api/org');
    expect(status).toBe(200);
    expect(body).toHaveProperty('root');
    expect(body).toHaveProperty('agents');
    expect(body).toHaveProperty('channels');
    expect(Array.isArray(body.agents)).toBe(true);
    expect(body.agents.length).toBeGreaterThan(0);
  });

  it('GET /api/agents returns all agents with status', async () => {
    const { status, body } = await request('/api/agents');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    expect(body[0]).toHaveProperty('id');
    expect(body[0]).toHaveProperty('status');
  });

  it('GET /api/agents/:id returns agent detail', async () => {
    const agentId = ctx.orgChart.root.id;
    const { status, body } = await request(`/api/agents/${agentId}`);
    expect(status).toBe(200);
    expect(body.id).toBe(agentId);
    expect(body).toHaveProperty('identity');
    expect(body).toHaveProperty('files');
    expect(body).toHaveProperty('state');
    expect(body).toHaveProperty('recentInvocations');
    expect(body).toHaveProperty('tokenTotals');
  });

  it('GET /api/agents/:id returns 404 for unknown', async () => {
    const { status, body } = await request('/api/agents/nonexistent');
    expect(status).toBe(404);
    expect(body.error).toBe('Agent not found');
  });

  it('GET /api/channels returns channel list', async () => {
    const { status, body } = await request('/api/channels');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  it('GET /api/channels/:name/messages returns messages array', async () => {
    const channels = await ctx.comms.listChannels();
    const channelName = channels[0]?.name ?? 'board';
    const { status, body } = await request(`/api/channels/${channelName}/messages`);
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/audit returns invocations array', async () => {
    const { status, body } = await request('/api/audit');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/audit/totals returns token totals', async () => {
    const { status, body } = await request('/api/audit/totals');
    expect(status).toBe(200);
    expect(body).toHaveProperty('totalIn');
    expect(body).toHaveProperty('totalOut');
  });

  it('GET /api/status returns orchestrator status', async () => {
    const { status, body } = await request('/api/status');
    expect(status).toBe(200);
    expect(body).toHaveProperty('running');
    expect(body).toHaveProperty('agentCount');
    expect(body.agentCount).toBeGreaterThan(0);
  });

  it('POST /api/chat requires message body', async () => {
    const { status, body } = await request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(status).toBe(400);
    expect(body.error).toBe('message is required');
  });
});
