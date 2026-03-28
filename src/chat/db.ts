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
    // Clean up old table names from pre-conversation-rename schema.
    // Each step is guarded independently so partial migrations don't block restart.
    const hasOldChannels = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='channels'"
    ).get();
    const hasNewConversations = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='conversations'"
    ).get();

    if (hasOldChannels && !hasNewConversations) {
      // Fresh migration — rename tables
      this.db.exec(`ALTER TABLE channels RENAME TO conversations`);
    } else if (hasOldChannels && hasNewConversations) {
      // Partial migration — old table is a leftover, drop it
      this.db.exec(`DROP TABLE channels`);
    }

    const hasOldMembers = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='channel_members'"
    ).get();
    const hasNewMembers = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_members'"
    ).get();

    if (hasOldMembers && !hasNewMembers) {
      this.db.exec(`ALTER TABLE channel_members RENAME TO conversation_members`);
    } else if (hasOldMembers && hasNewMembers) {
      this.db.exec(`DROP TABLE channel_members`);
    }

    // Rename columns if they still use old names
    const msgCols = this.db.pragma('table_info(messages)') as Array<{ name: string }>;
    if (msgCols.some(c => c.name === 'channel_id')) {
      this.db.exec(`ALTER TABLE messages RENAME COLUMN channel_id TO conversation_id`);
    }
    const cursorCols = this.db.pragma('table_info(read_cursors)') as Array<{ name: string }>;
    if (cursorCols.some(c => c.name === 'channel_id')) {
      this.db.exec(`ALTER TABLE read_cursors RENAME COLUMN channel_id TO conversation_id`);
    }
    const memberCols = this.db.pragma('table_info(conversation_members)') as Array<{ name: string }>;
    if (memberCols.some(c => c.name === 'channel_id')) {
      this.db.exec(`ALTER TABLE conversation_members RENAME COLUMN channel_id TO conversation_id`);
    }

    this.db.exec(`
      DROP INDEX IF EXISTS idx_messages_channel_ts;
      DROP INDEX IF EXISTS idx_channel_members_person;
    `);

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

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('dm', 'group')),
        created_by INTEGER NOT NULL REFERENCES people(id),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        deleted INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS conversation_members (
        conversation_id TEXT NOT NULL REFERENCES conversations(id),
        person_id INTEGER NOT NULL REFERENCES people(id),
        joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (conversation_id, person_id)
      );

      CREATE TABLE IF NOT EXISTS messages (
        seq INTEGER NOT NULL,
        conversation_id TEXT NOT NULL REFERENCES conversations(id),
        sender_id INTEGER NOT NULL REFERENCES people(id),
        content TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (conversation_id, seq)
      );

      CREATE TABLE IF NOT EXISTS read_cursors (
        person_id INTEGER NOT NULL REFERENCES people(id),
        conversation_id TEXT NOT NULL REFERENCES conversations(id),
        last_seq INTEGER NOT NULL DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (person_id, conversation_id)
      );

      CREATE INDEX IF NOT EXISTS idx_messages_conversation_ts ON messages(conversation_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
      CREATE INDEX IF NOT EXISTS idx_conversation_members_person ON conversation_members(person_id);
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
