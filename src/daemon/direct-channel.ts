export interface DirectChannelDef {
  channel: string;
  label: string;
}

/**
 * Parse ## Direct Channels section from BUREAU.md content.
 * Format: `- #channel-name — description`
 */
export function parseBureauDirectChannels(bureau: string): DirectChannelDef[] {
  const sectionMatch = bureau.match(/## Direct Channels\n([\s\S]*?)(?=\n## |\n$|$)/);
  if (!sectionMatch) return [];

  const lines = sectionMatch[1].trim().split('\n');
  const results: DirectChannelDef[] = [];

  for (const line of lines) {
    const match = line.match(/^- #(\S+)\s*[—–-]\s*(.+)$/);
    if (match) {
      results.push({ channel: match[1], label: match[2].trim() });
    }
  }

  return results;
}

/**
 * Registry that maps channels → agents and coalesces rapid signals
 * within a debounce window before triggering CheckWork.
 *
 * When a message arrives on a direct channel, call signal(channelName).
 * After the coalesce window (default 100ms), onTrigger(agentId) is called
 * once per affected agent, regardless of how many signals arrived.
 */
export class DirectChannelRegistry {
  /** channel → set of agentIds that have this as a direct channel */
  private channelToAgents = new Map<string, Set<string>>();
  /** agentId → pending coalesce timer */
  private pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private onTrigger: (agentId: string) => void,
    private coalesceMs = 100,
  ) {}

  register(agentId: string, channels: string[]): void {
    for (const ch of channels) {
      let agents = this.channelToAgents.get(ch);
      if (!agents) {
        agents = new Set();
        this.channelToAgents.set(ch, agents);
      }
      agents.add(agentId);
    }
  }

  signal(channel: string): void {
    const agents = this.channelToAgents.get(channel);
    if (!agents) return;

    for (const agentId of agents) {
      // If there's already a pending timer for this agent, skip (coalescing)
      if (this.pendingTimers.has(agentId)) continue;

      const timer = setTimeout(() => {
        this.pendingTimers.delete(agentId);
        this.onTrigger(agentId);
      }, this.coalesceMs);

      this.pendingTimers.set(agentId, timer);
    }
  }

  clearAll(): void {
    for (const timer of this.pendingTimers.values()) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();
  }
}
