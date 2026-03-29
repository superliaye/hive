import Database from 'better-sqlite3';

export interface TriageLogEntry {
  id: number;
  classification: string;  // ACT_NOW, NOTE, QUEUE, IGNORE
  sender: string;
  conversation: string;
  content_snippet: string;  // first 200 chars
  created_at: string;
}

export class TriageLogStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS triage_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        classification TEXT NOT NULL,
        sender TEXT NOT NULL,
        conversation TEXT NOT NULL,
        content_snippet TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  append(entry: { classification: string; sender: string; conversation: string; contentSnippet: string }): void {
    this.db.prepare(
      'INSERT INTO triage_log (classification, sender, conversation, content_snippet) VALUES (?, ?, ?, ?)'
    ).run(entry.classification, entry.sender, entry.conversation, entry.contentSnippet);
  }

  getRecent(limit: number): TriageLogEntry[] {
    return this.db.prepare(
      'SELECT * FROM triage_log ORDER BY created_at DESC LIMIT ?'
    ).all(limit) as TriageLogEntry[];
  }

  close(): void {
    this.db.close();
  }
}
