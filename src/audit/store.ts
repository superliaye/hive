import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

export interface LogInvocationOpts {
  agentId: string;
  invocationType: string;
  model: string;
  tokensIn?: number;
  tokensOut?: number;
  durationMs?: number;
  inputSummary?: string;
  outputSummary?: string;
  channel?: string;
}

export interface InvocationRow {
  id: string;
  agentId: string;
  invocationType: string;
  model: string;
  tokensIn: number | null;
  tokensOut: number | null;
  durationMs: number | null;
  inputSummary: string | null;
  outputSummary: string | null;
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
    durationMs: row.duration_ms ?? null,
    inputSummary: row.input_summary ?? null,
    outputSummary: row.output_summary ?? null,
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
        duration_ms INTEGER,
        input_summary TEXT,
        output_summary TEXT,
        channel TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_invocations_agent ON invocations(agent_id);
      CREATE INDEX IF NOT EXISTS idx_invocations_ts ON invocations(timestamp);
    `);
  }

  logInvocation(opts: LogInvocationOpts): string {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO invocations (id, agent_id, invocation_type, model, tokens_in, tokens_out, duration_ms, input_summary, output_summary, channel)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, opts.agentId, opts.invocationType, opts.model,
      opts.tokensIn ?? null, opts.tokensOut ?? null, opts.durationMs ?? null,
      opts.inputSummary ?? null, opts.outputSummary ?? null, opts.channel ?? null,
    );
    return id;
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

  close(): void {
    this.db.close();
  }
}
