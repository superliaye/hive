import Database from 'better-sqlite3';

export type FollowUpStatus = 'open' | 'done' | 'expired' | 'cancelled';

export interface FollowUp {
  id: number;
  agentId: string;
  description: string;
  checkCommand: string | null;
  backoffSchedule: string[];  // e.g. ["10m", "30m", "1h"]
  attempt: number;
  nextCheckAt: Date;
  lastCheckExit: number | null;
  lastCheckOutput: string | null;
  status: FollowUpStatus;
  createdAt: Date;
  closedAt: Date | null;
}

function parseUtcDatetime(value: string): Date {
  // Handle both SQLite CURRENT_TIMESTAMP ("YYYY-MM-DD HH:MM:SS") and ISO strings
  if (value.includes('T')) return new Date(value);
  return new Date(value.replace(' ', 'T') + 'Z');
}

export class FollowUpStore {
  private db: Database.Database;

  constructor(dbOrPath: Database.Database | string) {
    if (typeof dbOrPath === 'string') {
      this.db = new Database(dbOrPath);
      this.db.pragma('journal_mode = WAL');
    } else {
      this.db = dbOrPath;
    }
    this.migrate();
  }

  dispose(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS followups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        description TEXT NOT NULL,
        check_command TEXT,
        backoff_schedule TEXT NOT NULL,
        attempt INTEGER DEFAULT 0,
        next_check_at DATETIME NOT NULL,
        last_check_exit INTEGER,
        last_check_output TEXT,
        status TEXT DEFAULT 'open',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        closed_at DATETIME
      );
      CREATE INDEX IF NOT EXISTS idx_followups_agent_status ON followups(agent_id, status);
      CREATE INDEX IF NOT EXISTS idx_followups_next_check ON followups(status, next_check_at);
    `);
  }

  create(opts: {
    agentId: string;
    description: string;
    checkCommand?: string;
    backoffSchedule: string[];
  }): FollowUp {
    const nextCheckAt = this.computeNextCheck(opts.backoffSchedule[0]);
    const result = this.db.prepare(`
      INSERT INTO followups (agent_id, description, check_command, backoff_schedule, next_check_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      opts.agentId,
      opts.description,
      opts.checkCommand ?? null,
      JSON.stringify(opts.backoffSchedule),
      nextCheckAt.toISOString(),
    );
    return this.get(result.lastInsertRowid as number)!;
  }

  get(id: number): FollowUp | undefined {
    const row = this.db.prepare('SELECT * FROM followups WHERE id = ?').get(id) as any;
    return row ? this.toFollowUp(row) : undefined;
  }

  getOpenByAgent(agentId: string): FollowUp[] {
    const rows = this.db.prepare(
      "SELECT * FROM followups WHERE agent_id = ? AND status = 'open' ORDER BY next_check_at"
    ).all(agentId) as any[];
    return rows.map(r => this.toFollowUp(r));
  }

  getAllOpen(): FollowUp[] {
    const rows = this.db.prepare(
      "SELECT * FROM followups WHERE status = 'open' ORDER BY next_check_at"
    ).all() as any[];
    return rows.map(r => this.toFollowUp(r));
  }

  recordCheckResult(id: number, exitCode: number, output: string | null): void {
    this.db.prepare(`
      UPDATE followups SET last_check_exit = ?, last_check_output = ? WHERE id = ?
    `).run(exitCode, output, id);
  }

  advanceAttempt(id: number): FollowUp | undefined {
    const followup = this.get(id);
    if (!followup) return undefined;

    const nextAttempt = followup.attempt + 1;
    const schedule = followup.backoffSchedule;

    if (nextAttempt >= schedule.length) {
      // No more attempts — mark expired
      this.db.prepare(`
        UPDATE followups SET attempt = ?, status = 'expired', closed_at = CURRENT_TIMESTAMP WHERE id = ?
      `).run(nextAttempt, id);
    } else {
      const nextCheckAt = this.computeNextCheck(schedule[nextAttempt]);
      this.db.prepare(`
        UPDATE followups SET attempt = ?, next_check_at = ? WHERE id = ?
      `).run(nextAttempt, nextCheckAt.toISOString(), id);
    }
    return this.get(id);
  }

  close(id: number, status: 'done' | 'expired' | 'cancelled' = 'done'): void {
    this.db.prepare(`
      UPDATE followups SET status = ?, closed_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(status, id);
  }

  private computeNextCheck(interval: string): Date {
    const ms = parseInterval(interval);
    return new Date(Date.now() + ms);
  }

  private toFollowUp(row: any): FollowUp {
    return {
      id: row.id,
      agentId: row.agent_id,
      description: row.description,
      checkCommand: row.check_command,
      backoffSchedule: JSON.parse(row.backoff_schedule),
      attempt: row.attempt,
      nextCheckAt: parseUtcDatetime(row.next_check_at),
      lastCheckExit: row.last_check_exit,
      lastCheckOutput: row.last_check_output,
      status: row.status,
      createdAt: parseUtcDatetime(row.created_at),
      closedAt: row.closed_at ? parseUtcDatetime(row.closed_at) : null,
    };
  }
}

/** Parse a human-friendly interval like "10m", "2h", "1d" to milliseconds. */
export function parseInterval(interval: string): number {
  const match = interval.trim().match(/^(\d+(?:\.\d+)?)\s*(m|min|h|hr|d|day|s|sec)s?$/i);
  if (!match) throw new Error(`Invalid interval: ${interval}`);
  const value = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  switch (unit) {
    case 's': case 'sec': return value * 1000;
    case 'm': case 'min': return value * 60 * 1000;
    case 'h': case 'hr': return value * 60 * 60 * 1000;
    case 'd': case 'day': return value * 24 * 60 * 60 * 1000;
    default: throw new Error(`Unknown time unit: ${unit}`);
  }
}
