import type { ChatDb } from './db.js';
import type { ChatMessage, HistoryResult } from './types.js';

export interface HistoryOpts {
  limit?: number;
  from?: number;
  to?: number;
  all?: boolean;
}

const DEFAULT_LIMIT = 20;

export class MessageStore {
  constructor(private db: ChatDb) {}

  /** Send a message to a channel. Returns the message with per-channel seq. Atomic. */
  send(channelId: string, senderId: number, content: string): ChatMessage {
    const raw = this.db.raw();

    const txn = raw.transaction(() => {
      const last = raw.prepare(
        'SELECT MAX(seq) as maxSeq FROM messages WHERE channel_id = ?'
      ).get(channelId) as any;
      const seq = (last?.maxSeq ?? 0) + 1;

      raw.prepare(
        'INSERT INTO messages (seq, channel_id, sender_id, content) VALUES (?, ?, ?, ?)'
      ).run(seq, channelId, senderId, content);

      const sender = raw.prepare('SELECT alias FROM people WHERE id = ?').get(senderId) as any;
      const row = raw.prepare(
        'SELECT * FROM messages WHERE channel_id = ? AND seq = ?'
      ).get(channelId, seq) as any;

      return this.toMessage(row, sender?.alias ?? 'unknown');
    });

    return txn();
  }

  /** Get message history for a channel with flexible range/limit options. */
  history(channelId: string, opts: HistoryOpts = {}): HistoryResult {
    const { from, to, all } = opts;
    const limit = opts.limit ?? DEFAULT_LIMIT;
    const raw = this.db.raw();

    if (from !== undefined && to !== undefined && from > to) {
      throw new Error('--from must be <= --to');
    }

    const totalRow = raw.prepare(
      'SELECT COUNT(*) as cnt FROM messages WHERE channel_id = ?'
    ).get(channelId) as any;
    const total = totalRow.cnt;

    const conditions: string[] = ['m.channel_id = ?'];
    const params: any[] = [channelId];

    if (from !== undefined) {
      conditions.push('m.seq >= ?');
      params.push(from);
    }
    if (to !== undefined) {
      conditions.push('m.seq <= ?');
      params.push(to);
    }

    const where = conditions.join(' AND ');
    let query: string;

    if (all) {
      query = `SELECT m.*, p.alias as sender_alias FROM messages m JOIN people p ON m.sender_id = p.id WHERE ${where} ORDER BY m.seq ASC`;
    } else if (from !== undefined) {
      query = `SELECT m.*, p.alias as sender_alias FROM messages m JOIN people p ON m.sender_id = p.id WHERE ${where} ORDER BY m.seq ASC LIMIT ?`;
      params.push(to !== undefined ? (to - from + 1) : limit);
    } else {
      query = `SELECT * FROM (SELECT m.*, p.alias as sender_alias FROM messages m JOIN people p ON m.sender_id = p.id WHERE ${where} ORDER BY m.seq DESC LIMIT ?) ORDER BY seq ASC`;
      params.push(limit);
    }

    const rows = raw.prepare(query).all(...params) as any[];
    const messages = rows.map((r: any) => this.toMessage(r, r.sender_alias));

    const showingFrom = messages.length > 0 ? messages[0].seq : 0;
    const showingTo = messages.length > 0 ? messages[messages.length - 1].seq : 0;

    return {
      messages,
      total,
      channelId,
      showing: { from: showingFrom, to: showingTo },
    };
  }

  private toMessage(row: any, senderAlias: string): ChatMessage {
    return {
      seq: row.seq,
      channelId: row.channel_id,
      senderId: row.sender_id,
      senderAlias,
      content: row.content,
      timestamp: row.timestamp,
    };
  }
}
