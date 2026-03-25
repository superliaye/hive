import type { ChatDb } from './db.js';
import type { UnreadGroup } from './types.js';

export class CursorStore {
  constructor(private db: ChatDb) {}

  /** Get all unread messages for a person, grouped by channel, chronological. Excludes own messages. */
  getUnread(personId: number): UnreadGroup[] {
    const raw = this.db.raw();

    const channels = raw.prepare(
      'SELECT channel_id FROM channel_members WHERE person_id = ?'
    ).all(personId) as { channel_id: string }[];

    const groups: UnreadGroup[] = [];

    for (const { channel_id } of channels) {
      const cursor = this.getCursor(personId, channel_id);

      const rows = raw.prepare(`
        SELECT m.*, p.alias as sender_alias, c.type as channel_type
        FROM messages m
        JOIN people p ON m.sender_id = p.id
        JOIN channels c ON m.channel_id = c.id
        WHERE m.channel_id = ? AND m.seq > ? AND m.sender_id != ?
        ORDER BY m.seq ASC
      `).all(channel_id, cursor, personId) as any[];

      if (rows.length > 0) {
        groups.push({
          channelId: channel_id,
          channelType: rows[0].channel_type,
          messages: rows.map(r => ({
            seq: r.seq,
            channelId: r.channel_id,
            senderId: r.sender_id,
            senderAlias: r.sender_alias,
            content: r.content,
            timestamp: r.timestamp,
          })),
        });
      }
    }

    groups.sort((a, b) => {
      const aTs = a.messages[0]?.timestamp ?? '';
      const bTs = b.messages[0]?.timestamp ?? '';
      return aTs.localeCompare(bTs);
    });

    return groups;
  }

  /** Advance read cursor for a person on a channel. Never goes backwards. */
  ack(personId: number, channelId: string, seq: number): void {
    this.db.raw().prepare(`
      INSERT INTO read_cursors (person_id, channel_id, last_seq, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT (person_id, channel_id) DO UPDATE SET
        last_seq = MAX(last_seq, excluded.last_seq),
        updated_at = CURRENT_TIMESTAMP
    `).run(personId, channelId, seq);
  }

  /** Get the current cursor position. Returns 0 if no cursor exists. */
  getCursor(personId: number, channelId: string): number {
    const row = this.db.raw().prepare(
      'SELECT last_seq FROM read_cursors WHERE person_id = ? AND channel_id = ?'
    ).get(personId, channelId) as any;
    return row?.last_seq ?? 0;
  }
}
