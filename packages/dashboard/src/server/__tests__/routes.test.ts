import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { HiveContext } from '../../../../../src/context.js';
import { createApiRouter } from '../router.js';
import { SSEManager } from '../sse.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ORG = path.resolve(__dirname, '../../../../../tests/fixtures/sample-org');

let tempDir: string;
let ctx: HiveContext;
let app: express.Express;

function seedPeople(dataDir: string): void {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'hive.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // Create only the people table — ChatDb.init() will create the rest
  db.exec(`
    CREATE TABLE IF NOT EXISTS people (
      id INTEGER PRIMARY KEY,
      alias TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      role_template TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      folder TEXT,
      reports_to INTEGER REFERENCES people(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO people (id, alias, name, status, folder) VALUES (0, 'super-user', 'Super User', 'active', NULL);
    INSERT INTO people (id, alias, name, role_template, status, folder) VALUES (1, 'ceo', 'Test CEO', 'Chief Executive Officer', 'active', '1-ceo');
    INSERT INTO people (id, alias, name, role_template, status, folder, reports_to) VALUES (2, 'ar', 'AR', 'Agent Resources Manager', 'active', '2-ar', 1);
    INSERT INTO people (id, alias, name, role_template, status, folder, reports_to) VALUES (3, 'eng-1', 'Engineer 1', 'Backend Software Engineer', 'active', '3-eng-1', 1);
  `);
  db.close();
}

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
    seedPeople(path.join(tempDir, 'data'));
    ctx = await HiveContext.create(tempDir);

    // Register agents in state store
    for (const [alias] of ctx.orgChart.agents) {
      ctx.state.register(alias);
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

  it('GET /api/org returns org chart with tree structure', async () => {
    const { status, body } = await request('/api/org');
    expect(status).toBe(200);
    expect(body).toHaveProperty('agents');
    expect(body).toHaveProperty('root');
    expect(body).toHaveProperty('conversations');
    expect(Array.isArray(body.agents)).toBe(true);
    expect(body.agents.length).toBeGreaterThan(0);
    // Tree model: agents have id (alias), depth, parentId, childIds
    expect(body.agents[0]).toHaveProperty('id');
    expect(body.agents[0]).toHaveProperty('depth');
    expect(body.agents[0]).toHaveProperty('parentId');
    expect(body.agents[0]).toHaveProperty('childIds');
  });

  it('GET /api/agents returns all agents with status', async () => {
    const { status, body } = await request('/api/agents');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    expect(body[0]).toHaveProperty('id');
    expect(body[0]).toHaveProperty('status');
  });

  it('GET /api/agents/:alias returns agent detail', async () => {
    const alias = 'ceo';
    const { status, body } = await request(`/api/agents/${alias}`);
    expect(status).toBe(200);
    expect(body.alias).toBe(alias);
    expect(body).toHaveProperty('identity');
    expect(body).toHaveProperty('files');
    expect(body).toHaveProperty('state');
    expect(body).toHaveProperty('recentInvocations');
    expect(body).toHaveProperty('tokenTotals');
    expect(body).toHaveProperty('reportsTo');
    expect(body).toHaveProperty('directReports');
  });

  it('GET /api/agents/:alias returns 404 for unknown', async () => {
    const { status, body } = await request('/api/agents/nonexistent');
    expect(status).toBe(404);
    expect(body.error).toBe('Agent not found');
  });

  it('GET /api/conversations returns conversation list', async () => {
    const { status, body } = await request('/api/conversations');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/conversations/:id/messages returns messages object with total', async () => {
    const conversationIds = ctx.access.getAccessibleConversations(0);
    const conversationId = conversationIds[0] ?? 'dm:0:1';
    const { status, body } = await request(`/api/conversations/${conversationId}/messages`);
    expect(status).toBe(200);
    expect(body).toHaveProperty('messages');
    expect(body).toHaveProperty('total');
    expect(Array.isArray(body.messages)).toBe(true);
    expect(typeof body.total).toBe('number');
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
