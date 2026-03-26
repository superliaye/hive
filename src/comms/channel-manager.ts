import type { Channel, ICommsProvider } from './types.js';

export class ChannelManager {
  constructor(private provider: ICommsProvider) {}

  /**
   * Ensure a channel exists with the given members. If it already exists,
   * members are added (not removed).
   */
  async ensureChannel(name: string, members?: string[]): Promise<Channel> {
    return this.provider.createAutoChannel(name, members ?? []);
  }

  /**
   * Get all channels that an agent is a member of.
   */
  async getChannelsForAgent(agentId: string): Promise<Channel[]> {
    const allChannels = await this.provider.listChannels();
    return allChannels.filter(c => c.members.includes(agentId));
  }
}
