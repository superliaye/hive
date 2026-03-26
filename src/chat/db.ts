import Database from 'better-sqlite3';

export class ChatDb {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.init();
  }

  private init(): void {
    this.db.exec(`
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

      CREATE TABLE IF NOT EXISTS channels (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('dm', 'group')),
        created_by INTEGER NOT NULL REFERENCES people(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        deleted INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS channel_members (
        channel_id TEXT NOT NULL REFERENCES channels(id),
        person_id INTEGER NOT NULL REFERENCES people(id),
        joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (channel_id, person_id)
      );

      CREATE TABLE IF NOT EXISTS messages (
        seq INTEGER NOT NULL,
        channel_id TEXT NOT NULL REFERENCES channels(id),
        sender_id INTEGER NOT NULL REFERENCES people(id),
        content TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (channel_id, seq)
      );

      CREATE TABLE IF NOT EXISTS read_cursors (
        person_id INTEGER NOT NULL REFERENCES people(id),
        channel_id TEXT NOT NULL REFERENCES channels(id),
        last_seq INTEGER NOT NULL DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (person_id, channel_id)
      );

      CREATE INDEX IF NOT EXISTS idx_messages_channel_ts ON messages(channel_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
      CREATE INDEX IF NOT EXISTS idx_channel_members_person ON channel_members(person_id);
    `);

    // Seed super-user if not exists
    this.db.prepare(`
      INSERT OR IGNORE INTO people (id, alias, name, role_template, status, folder)
      VALUES (0, 'super-user', 'Super User', NULL, 'active', NULL)
    `).run();
  }

  raw(): Database.Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }
}
