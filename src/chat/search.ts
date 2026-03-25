import type { ChatDb } from './db.js';
import type { SearchResult } from './types.js';
import { AccessControl } from './access.js';

export interface SearchOpts {
  pattern?: string;
  callerId: number;
  scopeChannelId?: string;
  fromPersonId?: number;
  after?: string;
  before?: string;
  caseInsensitive?: boolean;
  regex?: boolean;
  limit?: number;
  offset?: number;
}

const DEFAULT_LIMIT = 20;

export class SearchEngine {
  private access: AccessControl;

  constructor(private db: ChatDb) {
    this.access = new AccessControl(db);
  }

  search(opts: SearchOpts): SearchResult {
    const {
      pattern,
      callerId,
      scopeChannelId,
      fromPersonId,
      after,
      before,
      caseInsensitive = false,
      regex = false,
      limit = DEFAULT_LIMIT,
      offset = 0,
    } = opts;

    if (!pattern && !scopeChannelId && fromPersonId === undefined) {
      throw new Error('At least one of: pattern, scope (@alias/#group), or --from required');
    }

    const raw = this.db.raw();

    const accessibleChannels = scopeChannelId
      ? [scopeChannelId]
      : this.access.getAccessibleChannels(callerId);

    if (accessibleChannels.length === 0) {
      return { messages: [], total: 0, showing: { offset, limit } };
    }

    if (scopeChannelId) {
      this.access.requireMembership(callerId, scopeChannelId);
    }

    const placeholders = accessibleChannels.map(() => '?').join(',');
    const conditions: string[] = [`m.channel_id IN (${placeholders})`];
    const params: any[] = [...accessibleChannels];

    if (fromPersonId !== undefined) {
      conditions.push('m.sender_id = ?');
      params.push(fromPersonId);
    }

    if (after) {
      conditions.push('m.timestamp >= ?');
      params.push(after + ' 00:00:00');
    }

    if (before) {
      conditions.push('m.timestamp < ?');
      params.push(before + ' 00:00:00');
    }

    const where = conditions.join(' AND ');
    const query = `
      SELECT m.*, p.alias as sender_alias
      FROM messages m
      JOIN people p ON m.sender_id = p.id
      WHERE ${where}
      ORDER BY m.timestamp DESC, m.channel_id, m.seq DESC
    `;

    let rows = raw.prepare(query).all(...params) as any[];

    if (pattern) {
      if (regex) {
        const flags = caseInsensitive ? 'i' : '';
        const re = new RegExp(pattern, flags);
        rows = rows.filter((r: any) => re.test(r.content));
      } else {
        if (caseInsensitive) {
          const lowerPattern = pattern.toLowerCase();
          rows = rows.filter((r: any) => r.content.toLowerCase().includes(lowerPattern));
        } else {
          rows = rows.filter((r: any) => r.content.includes(pattern));
        }
      }
    }

    const total = rows.length;
    const sliced = rows.slice(offset, offset + limit);

    return {
      messages: sliced.map((r: any) => ({
        seq: r.seq,
        channelId: r.channel_id,
        senderId: r.sender_id,
        senderAlias: r.sender_alias,
        content: r.content,
        timestamp: r.timestamp,
      })),
      total,
      showing: { offset, limit },
    };
  }
}
