import type { ChatDb } from './db.js';
import type { Person } from './types.js';

export class AccessControl {
  constructor(private db: ChatDb) {}

  /** Resolve alias or numeric id string to Person. Throws if not found. */
  resolvePerson(aliasOrId: string): Person {
    const raw = this.db.raw();
    if (/^\d+$/.test(aliasOrId)) {
      const row = raw.prepare('SELECT * FROM people WHERE id = ?').get(Number(aliasOrId)) as any;
      if (row) return this.toPerson(row);
    }
    const row = raw.prepare('SELECT * FROM people WHERE alias = ?').get(aliasOrId) as any;
    if (!row) throw new Error(`Person "${aliasOrId}" not found. Run: hive chat group list`);
    return this.toPerson(row);
  }

  /** Validate that senderId can message targetId. Throws on violation. */
  validateSend(senderId: number, targetId: number): void {
    if (senderId === targetId) {
      throw new Error('Cannot send message to yourself');
    }
    if (targetId === 0) {
      const sender = this.db.raw().prepare('SELECT role_template FROM people WHERE id = ?').get(senderId) as any;
      if (!sender || sender.role_template !== 'chief-executive') {
        throw new Error('Only CEO can message super-user');
      }
    }
  }

  /** Validate that personId can be added to a group. */
  validateGroupAdd(personId: number): void {
    if (personId === 0) {
      throw new Error('Super-user cannot be added to groups');
    }
  }

  /** Throws if personId is not a member of conversationId. */
  requireMembership(personId: number, conversationId: string): void {
    const row = this.db.raw()
      .prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND person_id = ?')
      .get(conversationId, personId);
    if (!row) {
      throw new Error('You are not a member of this conversation');
    }
  }

  /** Get all conversation IDs this person is a member of. Super-user (id 0) sees all. */
  getAccessibleConversations(personId: number): string[] {
    if (personId === 0) {
      const rows = this.db.raw()
        .prepare('SELECT id AS conversation_id FROM conversations WHERE deleted = 0')
        .all() as { conversation_id: string }[];
      return rows.map(r => r.conversation_id);
    }
    const rows = this.db.raw()
      .prepare('SELECT conversation_id FROM conversation_members WHERE person_id = ?')
      .all(personId) as { conversation_id: string }[];
    return rows.map(r => r.conversation_id);
  }

  /** Parse HIVE_AGENT_ID env var. Throws if missing. */
  static requireIdentity(envValue: string | undefined): number {
    if (envValue === undefined || envValue === '') {
      throw new Error('HIVE_AGENT_ID not set. Are you running inside a hive agent?');
    }
    return Number(envValue);
  }

  private toPerson(row: any): Person {
    return {
      id: row.id,
      alias: row.alias,
      name: row.name,
      roleTemplate: row.role_template,
      status: row.status,
      folder: row.folder,
    };
  }
}
