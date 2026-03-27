import type { ChatDb } from './db.js';
import type { ConversationStore } from './conversations.js';
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
    private conversations: ConversationStore,
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

  /** Ensures DM conversation exists between two aliases. Returns conversation ID. */
  ensureDm(aliasA: string, aliasB: string): string {
    const idA = this.resolveAlias(aliasA);
    const idB = this.resolveAlias(aliasB);
    const conv = this.conversations.ensureDm(idA, idB);
    return conv.id;
  }

  /**
   * Posts a message to a conversation.
   * Returns synthetic message ID in format `{conversationId}:{seq}`.
   */
  postMessage(senderAlias: string, conversationId: string, content: string): string {
    const senderId = this.resolveAlias(senderAlias);
    const msg = this.messages.send(conversationId, senderId, content);
    return `${msg.conversationId}:${msg.seq}`;
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
          id: `${msg.conversationId}:${msg.seq}`,
          conversation: msg.conversationId,
          sender: msg.senderAlias,
          content: msg.content,
          timestamp: new Date(msg.timestamp),
        });
      }
    }

    return result;
  }

  /**
   * Parses synthetic IDs back to conversationId+seq, groups by conversation,
   * and advances cursors to the max seq per conversation.
   */
  markRead(alias: string, messageIds: string[]): void {
    const personId = this.resolveAlias(alias);

    const maxSeqByConversation = new Map<string, number>();

    for (const syntheticId of messageIds) {
      const lastColon = syntheticId.lastIndexOf(':');
      if (lastColon === -1) {
        throw new Error(`Invalid synthetic message ID: "${syntheticId}"`);
      }
      const conversationId = syntheticId.slice(0, lastColon);
      const seqStr = syntheticId.slice(lastColon + 1);
      if (seqStr === '') {
        throw new Error(`Invalid synthetic message ID: "${syntheticId}"`);
      }
      const seq = parseInt(seqStr, 10);
      if (Number.isNaN(seq) || seq <= 0) {
        throw new Error(`Invalid seq in message ID: "${syntheticId}"`);
      }

      const current = maxSeqByConversation.get(conversationId) ?? 0;
      if (seq > current) {
        maxSeqByConversation.set(conversationId, seq);
      }
    }

    for (const [conversationId, maxSeq] of maxSeqByConversation) {
      this.cursors.ack(personId, conversationId, maxSeq);
    }
  }

  /** Returns member aliases for a conversation (used by signal handler). */
  getConversationMembers(conversationId: string): string[] {
    const members = this.conversations.getMembers(conversationId);
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
