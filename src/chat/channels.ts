import type { ChatDb } from './db.js';
import type { ChatChannel, ChannelMember } from './types.js';
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

export class ChannelStore {
  private access: AccessControl;

  constructor(private db: ChatDb) {
    this.access = new AccessControl(db);
  }

  /** Ensure DM channel exists between two people. Creates lazily. */
  ensureDm(personA: number, personB: number): ChatChannel {
    const raw = this.db.raw();
    const [lo, hi] = personA < personB ? [personA, personB] : [personB, personA];
    const id = `dm:${lo}:${hi}`;

    const existing = raw.prepare('SELECT * FROM channels WHERE id = ?').get(id) as any;
    if (existing) return this.toChannel(existing);

    const txn = raw.transaction(() => {
      raw.prepare('INSERT INTO channels (id, type, created_by) VALUES (?, ?, ?)').run(id, 'dm', lo);
      raw.prepare('INSERT INTO channel_members (channel_id, person_id) VALUES (?, ?)').run(id, lo);
      raw.prepare('INSERT INTO channel_members (channel_id, person_id) VALUES (?, ?)').run(id, hi);
    });
    txn();

    return this.toChannel(raw.prepare('SELECT * FROM channels WHERE id = ?').get(id) as any);
  }

  /** Create a named group channel. */
  createGroup(name: string, creatorId: number, memberIds: number[]): ChatChannel {
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

    const existing = raw.prepare('SELECT id FROM channels WHERE id = ?').get(name);
    if (existing) {
      throw new Error(`Group "${name}" already exists`);
    }

    const txn = raw.transaction(() => {
      raw.prepare('INSERT INTO channels (id, type, created_by) VALUES (?, ?, ?)').run(name, 'group', creatorId);
      const ins = raw.prepare('INSERT INTO channel_members (channel_id, person_id) VALUES (?, ?)');
      for (const mid of allMembers) {
        ins.run(name, mid);
      }
    });
    txn();

    return this.toChannel(raw.prepare('SELECT * FROM channels WHERE id = ?').get(name) as any);
  }

  /** Get channel by id. Returns null if not found. */
  getChannel(id: string): ChatChannel | null {
    const row = this.db.raw().prepare('SELECT * FROM channels WHERE id = ?').get(id) as any;
    return row ? this.toChannel(row) : null;
  }

  /** Get members of a channel. */
  getMembers(channelId: string): ChannelMember[] {
    const rows = this.db.raw()
      .prepare('SELECT * FROM channel_members WHERE channel_id = ?')
      .all(channelId) as any[];
    return rows.map(r => ({
      channelId: r.channel_id,
      personId: r.person_id,
      joinedAt: r.joined_at,
    }));
  }

  /** List non-deleted groups a person belongs to. */
  listGroups(personId: number): ChatChannel[] {
    const rows = this.db.raw().prepare(`
      SELECT c.* FROM channels c
      JOIN channel_members cm ON c.id = cm.channel_id
      WHERE cm.person_id = ? AND c.type = 'group' AND c.deleted = 0
      ORDER BY c.created_at DESC
    `).all(personId) as any[];
    return rows.map(r => this.toChannel(r));
  }

  /** Get group info including member count and message count. */
  getGroupInfo(groupId: string): GroupInfo {
    const raw = this.db.raw();
    const ch = raw.prepare('SELECT * FROM channels WHERE id = ? AND type = ?').get(groupId, 'group') as any;
    if (!ch) throw new Error(`Group "${groupId}" not found. Run: hive chat group list`);

    const members = raw.prepare(`
      SELECT cm.person_id, p.alias FROM channel_members cm
      JOIN people p ON cm.person_id = p.id
      WHERE cm.channel_id = ?
    `).all(groupId) as any[];

    const msgCount = raw.prepare('SELECT COUNT(*) as cnt FROM messages WHERE channel_id = ?').get(groupId) as any;

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
      .prepare('INSERT OR IGNORE INTO channel_members (channel_id, person_id) VALUES (?, ?)')
      .run(groupId, personId);
  }

  /** Remove a member from a group. */
  removeMember(groupId: string, personId: number): void {
    this.db.raw()
      .prepare('DELETE FROM channel_members WHERE channel_id = ? AND person_id = ?')
      .run(groupId, personId);
  }

  /** Soft-delete a group. Messages are preserved for audit. */
  deleteGroup(groupId: string): void {
    this.db.raw()
      .prepare('UPDATE channels SET deleted = 1 WHERE id = ? AND type = ?')
      .run(groupId, 'group');
  }

  /** Resolve @alias or #group target string to channel id. Creates DM lazily if needed. */
  resolveTarget(target: string, callerId: number): string {
    if (target.startsWith('@')) {
      const alias = target.slice(1);
      const person = this.access.resolvePerson(alias);
      const dm = this.ensureDm(callerId, person.id);
      return dm.id;
    }
    if (target.startsWith('#')) {
      const groupName = target.slice(1);
      const ch = this.getChannel(groupName);
      if (!ch || ch.type !== 'group' || ch.deleted) {
        throw new Error(`Group "${groupName}" not found. Run: hive chat group list`);
      }
      return ch.id;
    }
    throw new Error(`Target must start with @ (DM) or # (group). Got: "${target}"`);
  }

  private toChannel(row: any): ChatChannel {
    return {
      id: row.id,
      type: row.type,
      createdBy: row.created_by,
      createdAt: row.created_at,
      deleted: row.deleted === 1,
    };
  }
}
