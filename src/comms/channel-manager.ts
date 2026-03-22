import type { OrgChart } from '../types.js';
import type { Channel, ICommsProvider } from './types.js';

export class ChannelManager {
  constructor(private provider: ICommsProvider) {}

  /**
   * Sync channels from an OrgChart. Creates auto-generated channels
   * (all-hands, board, leadership, approvals, team channels) and adds
   * the correct members. Idempotent — safe to call repeatedly.
   */
  async syncFromOrgTree(org: OrgChart): Promise<Channel[]> {
    const created: Channel[] = [];

    for (const channelDef of org.channels) {
      const channel = await this.provider.createAutoChannel(
        channelDef.name,
        channelDef.memberIds,
      );
      created.push(channel);
    }

    return created;
  }

  /**
   * Ensure a channel exists with the given members. If it already exists,
   * members are added (not removed). Used for agent-created organic channels.
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
