import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

export interface LogInvocationOpts {
  agentId: string;
  invocationType: string;
  model: string;
  tokensIn?: number;
  tokensOut?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  durationMs?: number;
  inputSummary?: string;
  outputSummary?: string;
  actionSummary?: string;
  channel?: string;
}

export interface InvocationRow {
  id: string;
  agentId: string;
  invocationType: string;
  model: string;
  tokensIn: number | null;
  tokensOut: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
  durationMs: number | null;
  inputSummary: string | null;
  outputSummary: string | null;
  actionSummary: string | null;
  channel: string | null;
  timestamp: string;
}

function mapInvocationRow(row: any): InvocationRow {
  return {
    id: row.id,
    agentId: row.agent_id,
    invocationType: row.invocation_type,
    model: row.model,
    tokensIn: row.tokens_in ?? null,
    tokensOut: row.tokens_out ?? null,
    cacheReadTokens: row.cache_read_tokens ?? null,
    cacheCreationTokens: row.cache_creation_tokens ?? null,
    durationMs: row.duration_ms ?? null,
    inputSummary: row.input_summary ?? null,
    outputSummary: row.output_summary ?? null,
    actionSummary: row.action_summary ?? null,
    channel: row.channel ?? null,
    timestamp: row.timestamp,
  };
}

export class AuditStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS invocations (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        invocation_type TEXT NOT NULL,
        model TEXT NOT NULL,
        tokens_in INTEGER,
        tokens_out INTEGER,
        cache_read_tokens INTEGER,
        cache_creation_tokens INTEGER,
        duration_ms INTEGER,
        input_summary TEXT,
        output_summary TEXT,
        action_summary TEXT,
        channel TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_invocations_agent ON invocations(agent_id);
      CREATE INDEX IF NOT EXISTS idx_invocations_ts ON invocations(timestamp);
    `);
    // Add columns if upgrading from older schema
    const alterColumns = [
      'ALTER TABLE invocations ADD COLUMN action_summary TEXT',
      'ALTER TABLE invocations ADD COLUMN cache_read_tokens INTEGER',
      'ALTER TABLE invocations ADD COLUMN cache_creation_tokens INTEGER',
    ];
    for (const sql of alterColumns) {
      try { this.db.exec(sql); } catch { /* Column already exists */ }
    }
  }

  logInvocation(opts: LogInvocationOpts): string {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO invocations (id, agent_id, invocation_type, model, tokens_in, tokens_out, cache_read_tokens, cache_creation_tokens, duration_ms, input_summary, output_summary, action_summary, channel)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, opts.agentId, opts.invocationType, opts.model,
      opts.tokensIn ?? null, opts.tokensOut ?? null,
      opts.cacheReadTokens ?? null, opts.cacheCreationTokens ?? null,
      opts.durationMs ?? null,
      opts.inputSummary ?? null, opts.outputSummary ?? null, opts.actionSummary ?? null, opts.channel ?? null,
    );
    return id;
  }

  updateActionSummary(invocationId: string, actionSummary: string): void {
    this.db.prepare('UPDATE invocations SET action_summary = ? WHERE id = ?').run(actionSummary, invocationId);
  }

  getInvocations(filter: { agentId?: string; invocationType?: string; since?: Date; limit?: number }): InvocationRow[] {
    let sql = 'SELECT * FROM invocations WHERE 1=1';
    const params: unknown[] = [];

    if (filter.agentId) {
      sql += ' AND agent_id = ?';
      params.push(filter.agentId);
    }
    if (filter.invocationType) {
      sql += ' AND invocation_type = ?';
      params.push(filter.invocationType);
    }
    if (filter.since) {
      sql += ' AND timestamp >= ?';
      params.push(filter.since.toISOString());
    }
    sql += ' ORDER BY timestamp DESC';
    if (filter.limit) {
      sql += ' LIMIT ?';
      params.push(filter.limit);
    }

    return (this.db.prepare(sql).all(...params) as any[]).map(mapInvocationRow);
  }

  getTokenTotals(agentId?: string): { totalIn: number; totalOut: number } {
    let sql = 'SELECT COALESCE(SUM(tokens_in), 0) as total_in, COALESCE(SUM(tokens_out), 0) as total_out FROM invocations';
    const params: unknown[] = [];
    if (agentId) {
      sql += ' WHERE agent_id = ?';
      params.push(agentId);
    }
    const row = this.db.prepare(sql).get(...params) as { total_in: number; total_out: number };
    return { totalIn: row.total_in, totalOut: row.total_out };
  }

  getTokenTotalsByAgent(): Record<string, { totalIn: number; totalOut: number }> {
    const rows = this.db.prepare(
      'SELECT agent_id, COALESCE(SUM(tokens_in), 0) as total_in, COALESCE(SUM(tokens_out), 0) as total_out FROM invocations GROUP BY agent_id'
    ).all() as Array<{ agent_id: string; total_in: number; total_out: number }>;
    const result: Record<string, { totalIn: number; totalOut: number }> = {};
    for (const row of rows) {
      result[row.agent_id] = { totalIn: row.total_in, totalOut: row.total_out };
    }
    return result;
  }

  close(): void {
    this.db.close();
  }
}
