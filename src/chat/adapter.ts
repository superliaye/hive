import type { ChatDb } from './db.js';
import type { ChannelStore } from './channels.js';
import type { MessageStore } from './messages.js';
import type { CursorStore } from './cursors.js';
import type { UnreadMessage } from '../daemon/types.js';

/**
 * Bridges the daemon's string-alias interface to the chat module's numeric-ID stores.
 *
 * The daemon speaks aliases ("ceo", "cto"). The chat module speaks person IDs (1, 2).
 * This adapter converts between the two and provides the daemon-facing API surface.
 */
export class ChatAdapter {
  private aliasToId = new Map<string, number>();
  private idToAlias = new Map<number, string>();

  constructor(
    private db: ChatDb,
    private channels: ChannelStore,
    private messages: MessageStore,
    private cursors: CursorStore,
  ) {
    this.loadPeopleCache();
  }

  /** Maps alias to person ID from people table. */
  resolveAlias(alias: string): number {
    const id = this.aliasToId.get(alias);
    if (id === undefined) {
      throw new Error(`Unknown alias: "${alias}"`);
    }
    return id;
  }

  /** Maps person ID to alias. */
  resolveId(id: number): string {
    const alias = this.idToAlias.get(id);
    if (alias === undefined) {
      throw new Error(`Unknown person ID: ${id}`);
    }
    return alias;
  }

  /** Reloads alias<->ID mappings. Call after hot-reload. */
  refreshPeopleCache(): void {
    this.loadPeopleCache();
  }

  /** Ensures DM channel exists between two aliases. Returns channel ID. */
  ensureDm(aliasA: string, aliasB: string): string {
    const idA = this.resolveAlias(aliasA);
    const idB = this.resolveAlias(aliasB);
    const channel = this.channels.ensureDm(idA, idB);
    return channel.id;
  }

  /**
   * Posts a message to a channel.
   * Returns synthetic message ID in format `{channelId}:{seq}`.
   */
  postMessage(senderAlias: string, channelId: string, content: string): string {
    const senderId = this.resolveAlias(senderAlias);
    const msg = this.messages.send(channelId, senderId, content);
    return `${msg.channelId}:${msg.seq}`;
  }

  /**
   * Gets unread messages for an alias, mapped to daemon's UnreadMessage format.
   * Converts UnreadGroup[] -> UnreadMessage[] using synthetic ID format.
   */
  getUnread(alias: string): UnreadMessage[] {
    const personId = this.resolveAlias(alias);
    const groups = this.cursors.getUnread(personId);
    const result: UnreadMessage[] = [];

    for (const group of groups) {
      for (const msg of group.messages) {
        result.push({
          id: `${msg.channelId}:${msg.seq}`,
          channel: msg.channelId,
          sender: msg.senderAlias,
          content: msg.content,
          timestamp: new Date(msg.timestamp),
        });
      }
    }

    return result;
  }

  /**
   * Parses synthetic IDs back to channelId+seq, groups by channel,
   * and advances cursors to the max seq per channel.
   */
  markRead(alias: string, messageIds: string[]): void {
    const personId = this.resolveAlias(alias);

    // Group by channel, track max seq per channel
    const maxSeqByChannel = new Map<string, number>();

    for (const syntheticId of messageIds) {
      const lastColon = syntheticId.lastIndexOf(':');
      if (lastColon === -1) {
        throw new Error(`Invalid synthetic message ID: "${syntheticId}"`);
      }
      const channelId = syntheticId.slice(0, lastColon);
      const seq = Number(syntheticId.slice(lastColon + 1));
      if (Number.isNaN(seq)) {
        throw new Error(`Invalid seq in message ID: "${syntheticId}"`);
      }

      const current = maxSeqByChannel.get(channelId) ?? 0;
      if (seq > current) {
        maxSeqByChannel.set(channelId, seq);
      }
    }

    for (const [channelId, maxSeq] of maxSeqByChannel) {
      this.cursors.ack(personId, channelId, maxSeq);
    }
  }

  /** Returns member aliases for a channel (used by signal handler). */
  getChannelMembers(channelId: string): string[] {
    const members = this.channels.getMembers(channelId);
    return members.map(m => this.resolveId(m.personId));
  }

  private loadPeopleCache(): void {
    this.aliasToId.clear();
    this.idToAlias.clear();
    const rows = this.db.raw()
      .prepare('SELECT id, alias FROM people')
      .all() as { id: number; alias: string }[];
    for (const row of rows) {
      this.aliasToId.set(row.alias, row.id);
      this.idToAlias.set(row.id, row.alias);
    }
  }
}
