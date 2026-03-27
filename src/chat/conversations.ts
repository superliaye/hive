import type { ChatDb } from './db.js';
import type { Conversation, ConversationMember } from './types.js';
import { AccessControl } from './access.js';

const GROUP_NAME_REGEX = /^[a-z0-9-]+$/;
const GROUP_NAME_MAX_LEN = 50;

export interface GroupInfo {
  id: string;
  createdBy: number;
  createdAt: string;
  memberCount: number;
  messageCount: number;
  members: { personId: number; alias: string }[];
}

export class ConversationStore {
  private access: AccessControl;

  constructor(private db: ChatDb) {
    this.access = new AccessControl(db);
  }

  /** Ensure DM conversation exists between two people. Creates lazily. */
  ensureDm(personA: number, personB: number): Conversation {
    const raw = this.db.raw();
    const [lo, hi] = personA < personB ? [personA, personB] : [personB, personA];
    const id = `dm:${lo}:${hi}`;

    const existing = raw.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as any;
    if (existing) return this.toConversation(existing);

    const txn = raw.transaction(() => {
      raw.prepare('INSERT INTO conversations (id, type, created_by) VALUES (?, ?, ?)').run(id, 'dm', lo);
      raw.prepare('INSERT INTO conversation_members (conversation_id, person_id) VALUES (?, ?)').run(id, lo);
      raw.prepare('INSERT INTO conversation_members (conversation_id, person_id) VALUES (?, ?)').run(id, hi);
    });
    txn();

    return this.toConversation(raw.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as any);
  }

  /** Create a named group. */
  createGroup(name: string, creatorId: number, memberIds: number[]): Conversation {
    if (!GROUP_NAME_REGEX.test(name)) {
      throw new Error(`Group name must be kebab-case [a-z0-9-]. Got: "${name}"`);
    }
    if (name.length > GROUP_NAME_MAX_LEN) {
      throw new Error(`Group name must be ${GROUP_NAME_MAX_LEN} characters or less`);
    }

    const allMembers = new Set(memberIds);
    allMembers.add(creatorId);

    if (allMembers.size < 2) {
      throw new Error('Group must have at least 2 members');
    }

    for (const mid of allMembers) {
      this.access.validateGroupAdd(mid);
      this.access.resolvePerson(String(mid));
    }

    const raw = this.db.raw();

    const existing = raw.prepare('SELECT id FROM conversations WHERE id = ?').get(name);
    if (existing) {
      throw new Error(`Group "${name}" already exists`);
    }

    const txn = raw.transaction(() => {
      raw.prepare('INSERT INTO conversations (id, type, created_by) VALUES (?, ?, ?)').run(name, 'group', creatorId);
      const ins = raw.prepare('INSERT INTO conversation_members (conversation_id, person_id) VALUES (?, ?)');
      for (const mid of allMembers) {
        ins.run(name, mid);
      }
    });
    txn();

    return this.toConversation(raw.prepare('SELECT * FROM conversations WHERE id = ?').get(name) as any);
  }

  /** Get conversation by id. Returns null if not found. */
  getConversation(id: string): Conversation | null {
    const row = this.db.raw().prepare('SELECT * FROM conversations WHERE id = ?').get(id) as any;
    return row ? this.toConversation(row) : null;
  }

  /** Get members of a conversation. */
  getMembers(conversationId: string): ConversationMember[] {
    const rows = this.db.raw()
      .prepare('SELECT * FROM conversation_members WHERE conversation_id = ?')
      .all(conversationId) as any[];
    return rows.map(r => ({
      conversationId: r.conversation_id,
      personId: r.person_id,
      joinedAt: r.joined_at,
    }));
  }

  /** List non-deleted groups a person belongs to. */
  listGroups(personId: number): Conversation[] {
    const rows = this.db.raw().prepare(`
      SELECT c.* FROM conversations c
      JOIN conversation_members cm ON c.id = cm.conversation_id
      WHERE cm.person_id = ? AND c.type = 'group' AND c.deleted = 0
      ORDER BY c.created_at DESC
    `).all(personId) as any[];
    return rows.map(r => this.toConversation(r));
  }

  /** Get group info including member count and message count. */
  getGroupInfo(groupId: string): GroupInfo {
    const raw = this.db.raw();
    const ch = raw.prepare('SELECT * FROM conversations WHERE id = ? AND type = ?').get(groupId, 'group') as any;
    if (!ch) throw new Error(`Group "${groupId}" not found. Run: hive chat group list`);

    const members = raw.prepare(`
      SELECT cm.person_id, p.alias FROM conversation_members cm
      JOIN people p ON cm.person_id = p.id
      WHERE cm.conversation_id = ?
    `).all(groupId) as any[];

    const msgCount = raw.prepare('SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = ?').get(groupId) as any;

    return {
      id: groupId,
      createdBy: ch.created_by,
      createdAt: ch.created_at,
      memberCount: members.length,
      messageCount: msgCount.cnt,
      members: members.map((m: any) => ({ personId: m.person_id, alias: m.alias })),
    };
  }

  /** Add a member to a group. */
  addMember(groupId: string, personId: number): void {
    this.access.validateGroupAdd(personId);
    this.db.raw()
      .prepare('INSERT OR IGNORE INTO conversation_members (conversation_id, person_id) VALUES (?, ?)')
      .run(groupId, personId);
  }

  /** Remove a member from a group. */
  removeMember(groupId: string, personId: number): void {
    this.db.raw()
      .prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND person_id = ?')
      .run(groupId, personId);
  }

  /** Soft-delete a group. Messages are preserved for audit. */
  deleteGroup(groupId: string): void {
    this.db.raw()
      .prepare('UPDATE conversations SET deleted = 1 WHERE id = ? AND type = ?')
      .run(groupId, 'group');
  }

  /** Resolve @alias or #group target string to conversation id. Creates DM lazily if needed (use for send). */
  resolveTarget(target: string, callerId: number): string {
    if (target.startsWith('@')) {
      const alias = target.slice(1);
      const person = this.access.resolvePerson(alias);
      const dm = this.ensureDm(callerId, person.id);
      return dm.id;
    }
    if (target.startsWith('#')) {
      const groupName = target.slice(1);
      const conv = this.getConversation(groupName);
      if (!conv || conv.type !== 'group' || conv.deleted) {
        throw new Error(`Group "${groupName}" not found. Run: hive chat group list`);
      }
      return conv.id;
    }
    throw new Error(`Target must start with @ (DM) or # (group). Got: "${target}"`);
  }

  /** Resolve target without creating DM (use for history, search, ack). Throws if DM doesn't exist. */
  resolveExistingTarget(target: string, callerId: number): string {
    if (target.startsWith('@')) {
      const alias = target.slice(1);
      const person = this.access.resolvePerson(alias);
      const [lo, hi] = callerId < person.id ? [callerId, person.id] : [person.id, callerId];
      const id = `dm:${lo}:${hi}`;
      const existing = this.db.raw().prepare('SELECT id FROM conversations WHERE id = ?').get(id);
      if (!existing) {
        throw new Error(`No DM history with @${alias}`);
      }
      return id;
    }
    if (target.startsWith('#')) {
      const groupName = target.slice(1);
      const conv = this.getConversation(groupName);
      if (!conv || conv.type !== 'group' || conv.deleted) {
        throw new Error(`Group "${groupName}" not found. Run: hive chat group list`);
      }
      return conv.id;
    }
    throw new Error(`Target must start with @ (DM) or # (group). Got: "${target}"`);
  }

  /** Format a conversation ID for display. DMs show as @otherPerson, groups as #name. */
  formatForDisplay(conversationId: string, viewerId: number): string {
    const dmMatch = conversationId.match(/^dm:(\d+):(\d+)$/);
    if (dmMatch) {
      const a = parseInt(dmMatch[1], 10);
      const b = parseInt(dmMatch[2], 10);
      const otherId = a === viewerId ? b : b === viewerId ? a : b;
      const row = this.db.raw().prepare('SELECT alias FROM people WHERE id = ?').get(otherId) as { alias: string } | undefined;
      return row ? `@${row.alias}` : conversationId;
    }
    if (!conversationId.startsWith('dm:')) {
      return `#${conversationId}`;
    }
    return conversationId;
  }

  private toConversation(row: any): Conversation {
    return {
      id: row.id,
      type: row.type,
      createdBy: row.created_by,
      createdAt: row.created_at,
      deleted: row.deleted === 1,
    };
  }
}
