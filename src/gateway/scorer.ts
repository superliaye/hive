import type { AgentConfig } from '../types.js';
import type { ScoredMessage, ScoringWeights } from './types.js';

/**
 * Compute hierarchy-based authority score for a message sender.
 * manager=10, super-user=10, peer=5, report=3, unknown=1
 */
export function getHierarchyScore(
  senderId: string,
  agent: AgentConfig,
  orgAgents?: Map<string, AgentConfig>,
): number {
  // Super user always gets max authority
  if (senderId === 'super-user') return 10;

  // Manager (reportsTo) → highest authority
  if (agent.reportsTo && senderId === agent.reportsTo.alias) return 10;

  // Direct report → moderate authority
  if (agent.directReports.some(p => p.alias === senderId)) return 3;

  // Peer detection: same reportsTo
  if (orgAgents && agent.reportsTo) {
    const sender = orgAgents.get(senderId);
    if (sender && sender.reportsTo?.alias === agent.reportsTo.alias) return 5;
  }

  return 1;
}

/**
 * Compute channel priority weight.
 * DMs get 8, groups get 5, unknown gets 2.
 */
export function getChannelWeight(
  channel: string,
  _agent?: AgentConfig,
): number {
  if (channel.startsWith('dm:')) return 8;
  return 5;
}

/**
 * Compute recency decay: 10 = just now, linear decay to 0 over 24 hours.
 */
export function computeRecencyDecay(timestamp: Date): number {
  const ageMs = Date.now() - timestamp.getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  const DECAY_WINDOW_HOURS = 24;

  if (ageHours <= 0) return 10;
  if (ageHours >= DECAY_WINDOW_HOURS) return 0;

  return Math.round((1 - ageHours / DECAY_WINDOW_HOURS) * 10 * 10) / 10;
}

/**
 * Score a single message using the deterministic formula.
 * All components are normalized 0-10; weights sum to 1.0.
 * Final score is 0-10.
 */
export function scoreMessage(
  msg: Omit<ScoredMessage, 'score'>,
  agent: AgentConfig,
  weights: ScoringWeights,
  orgAgents?: Map<string, AgentConfig>,
): number {
  const authority = getHierarchyScore(msg.sender, agent, orgAgents);
  const urgency = msg.metadata?.urgent ? 10 : 0;
  const channel = getChannelWeight(msg.channel, agent);
  const recency = computeRecencyDecay(msg.timestamp);
  const mention = msg.mentions?.includes(agent.person.alias) ? 10 : 0;

  const raw = (authority * weights.authority)
    + (urgency * weights.urgency)
    + (channel * weights.channel)
    + (recency * weights.recency)
    + (mention * weights.mention);

  // Clamp to 0-10 range
  return Math.round(Math.max(0, Math.min(10, raw)) * 100) / 100;
}

/**
 * Rank a batch of messages by score (highest first).
 * Returns ScoredMessage[] with score attached.
 */
export function rankMessages(
  messages: Omit<ScoredMessage, 'score'>[],
  agent: AgentConfig,
  weights: ScoringWeights,
  orgAgents?: Map<string, AgentConfig>,
): ScoredMessage[] {
  return messages
    .map((msg) => ({
      ...msg,
      score: scoreMessage(msg, agent, weights, orgAgents),
    }))
    .sort((a, b) => b.score - a.score);
}
