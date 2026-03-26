import Database from 'better-sqlite3';
import type { AgentState } from '../types.js';

/** SQLite CURRENT_TIMESTAMP stores UTC but without a Z suffix.
 *  `new Date("YYYY-MM-DD HH:MM:SS")` treats it as local time.
 *  Append Z to force UTC interpretation. */
function parseUtcDatetime(value: string): Date {
  return new Date(value.replace(' ', 'T') + 'Z');
}

export class AgentStateStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_state (
        agent_id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'idle',
        last_invocation DATETIME,
        last_heartbeat DATETIME,
        current_task TEXT,
        pid INTEGER
      );
    `);
  }

  register(agentId: string): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO agent_state (agent_id, status) VALUES (?, 'idle')
    `).run(agentId);
  }

  get(agentId: string): AgentState | undefined {
    const row = this.db.prepare('SELECT * FROM agent_state WHERE agent_id = ?').get(agentId) as any;
    if (!row) return undefined;
    return {
      agentId: row.agent_id,
      status: row.status,
      lastInvocation: row.last_invocation ? parseUtcDatetime(row.last_invocation) : undefined,
      lastHeartbeat: row.last_heartbeat ? parseUtcDatetime(row.last_heartbeat) : undefined,
      currentTask: row.current_task ?? undefined,
      pid: row.pid ?? undefined,
    };
  }

  updateStatus(
    agentId: string,
    status: AgentState['status'],
    opts?: { pid?: number; currentTask?: string },
  ): void {
    if (status === 'working') {
      // Only update last_invocation when agent starts working
      this.db.prepare(`
        UPDATE agent_state
        SET status = ?, pid = ?, current_task = ?, last_invocation = CURRENT_TIMESTAMP
        WHERE agent_id = ?
      `).run(status, opts?.pid ?? null, opts?.currentTask ?? null, agentId);
    } else {
      this.db.prepare(`
        UPDATE agent_state
        SET status = ?, pid = ?, current_task = ?
        WHERE agent_id = ?
      `).run(status, opts?.pid ?? null, opts?.currentTask ?? null, agentId);
    }
  }

  markHeartbeat(agentId: string): void {
    this.db.prepare(`
      UPDATE agent_state SET last_heartbeat = CURRENT_TIMESTAMP WHERE agent_id = ?
    `).run(agentId);
  }

  findStale(): AgentState[] {
    const rows = this.db.prepare(
      "SELECT * FROM agent_state WHERE status = 'working'"
    ).all() as any[];

    return rows
      .filter((row) => {
        if (!row.pid) return true;
        try {
          process.kill(row.pid, 0);
          return false; // Process alive → not stale
        } catch {
          return true; // Process dead → stale
        }
      })
      .map((row) => ({
        agentId: row.agent_id,
        status: row.status,
        pid: row.pid,
        currentTask: row.current_task,
      }));
  }

  listAll(): AgentState[] {
    return (this.db.prepare('SELECT * FROM agent_state').all() as any[]).map((row) => ({
      agentId: row.agent_id,
      status: row.status,
      lastInvocation: row.last_invocation ? parseUtcDatetime(row.last_invocation) : undefined,
      lastHeartbeat: row.last_heartbeat ? parseUtcDatetime(row.last_heartbeat) : undefined,
      currentTask: row.current_task ?? undefined,
      pid: row.pid ?? undefined,
    }));
  }

  close(): void {
    this.db.close();
  }
}
