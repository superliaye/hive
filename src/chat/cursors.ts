import type { ChatDb } from './db.js';
import type { UnreadGroup } from './types.js';

export class CursorStore {
  constructor(private db: ChatDb) {}

  /** Get all unread messages for a person, grouped by conversation, chronological. Excludes own messages. */
  getUnread(personId: number): UnreadGroup[] {
    const raw = this.db.raw();

    const conversations = raw.prepare(
      'SELECT conversation_id FROM conversation_members WHERE person_id = ?'
    ).all(personId) as { conversation_id: string }[];

    const groups: UnreadGroup[] = [];

    for (const { conversation_id } of conversations) {
      const cursor = this.getCursor(personId, conversation_id);

      const rows = raw.prepare(`
        SELECT m.*, p.alias as sender_alias, c.type as conversation_type
        FROM messages m
        JOIN people p ON m.sender_id = p.id
        JOIN conversations c ON m.conversation_id = c.id
        WHERE m.conversation_id = ? AND m.seq > ? AND m.sender_id != ?
        ORDER BY m.seq ASC
      `).all(conversation_id, cursor, personId) as any[];

      if (rows.length > 0) {
        groups.push({
          conversationId: conversation_id,
          conversationType: rows[0].conversation_type,
          messages: rows.map(r => ({
            seq: r.seq,
            conversationId: r.conversation_id,
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

  /** Advance read cursor for a person on a conversation. Never goes backwards. */
  ack(personId: number, conversationId: string, seq: number): void {
    const prev = this.getCursor(personId, conversationId);
    this.db.raw().prepare(`
      INSERT INTO read_cursors (person_id, conversation_id, last_seq, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT (person_id, conversation_id) DO UPDATE SET
        last_seq = MAX(last_seq, excluded.last_seq),
        updated_at = CURRENT_TIMESTAMP
    `).run(personId, conversationId, seq);
    if (seq > prev) {
      const maxSeq = this.db.raw().prepare(
        'SELECT MAX(seq) as m FROM messages WHERE conversation_id = ?'
      ).get(conversationId) as any;
      const warn = seq > (maxSeq?.m ?? 0) ? ' ⚠ CURSOR AHEAD OF MAX SEQ' : '';
      console.log(`[cursor] person=${personId} ${conversationId}: ${prev} → ${seq}${warn}`);
    }
  }

  /** Get the current cursor position. Returns 0 if no cursor exists. */
  getCursor(personId: number, conversationId: string): number {
    const row = this.db.raw().prepare(
      'SELECT last_seq FROM read_cursors WHERE person_id = ? AND conversation_id = ?'
    ).get(personId, conversationId) as any;
    return row?.last_seq ?? 0;
  }
}
