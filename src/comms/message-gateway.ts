import type { Message, Channel, ICommsProvider } from './types.js';
import type { AuditStore } from '../audit/store.js';

/**
 * MessageGateway wraps an ICommsProvider with audit logging.
 * This is the primary entry point for agents to send and receive messages.
 * Every postMessage call is logged to the audit store for traceability.
 */
export class MessageGateway {
  constructor(
    private provider: ICommsProvider,
    private auditStore: AuditStore,
  ) {}

  async postMessage(
    channel: string,
    sender: string,
    content: string,
    opts?: { thread?: string },
  ): Promise<Message> {
    const msg = await this.provider.postMessage(channel, sender, content, opts);

    // Log to audit trail
    this.auditStore.logInvocation({
      agentId: sender,
      invocationType: 'comms',
      model: 'n/a',
      inputSummary: `Posted to #${channel}: ${content.slice(0, 100)}`,
      outputSummary: `Message ${msg.id}`,
      channel,
    });

    return msg;
  }

  async readChannel(
    channel: string,
    opts?: { limit?: number; since?: Date },
  ): Promise<Message[]> {
    return this.provider.readChannel(channel, opts);
  }

  async searchHistory(
    query: string,
    opts?: { channel?: string; sender?: string },
  ): Promise<Message[]> {
    return this.provider.searchHistory(query, opts);
  }

  async listChannels(): Promise<Channel[]> {
    return this.provider.listChannels();
  }

  async getUnreadForAgent(agentId: string): Promise<Message[]> {
    return this.provider.getUnread(agentId);
  }

  async markRead(agentId: string, messageIds: string[]): Promise<void> {
    return this.provider.markRead(agentId, messageIds);
  }
}
