import type { MessageGateway } from './message-gateway.js';
import type { SqliteCommsProvider } from './sqlite-provider.js';
import type { Message } from './types.js';
import { spawnClaude, buildClaudeArgs } from '../agents/spawner.js';
import { assemblePrompt } from '../agents/prompt-assembler.js';
import { loadAgentConfig } from '../agents/config-loader.js';
import chalk from 'chalk';

export interface ChatActionOpts {
  message: string;
  gateway: MessageGateway;
  provider: SqliteCommsProvider;
  /** Path to the CEO agent directory. Required for CEO response. */
  ceoDir?: string;
  /** Skip spawning Claude CLI for CEO response (for testing). */
  skipCeoResponse?: boolean;
}

export interface ChatActionResult {
  userMessage: Message;
  ceoResponse?: Message;
}

/**
 * The `hive chat` action. Posts a message to #board as super-user,
 * then spawns the CEO agent via Claude CLI to get a response.
 */
export async function chatAction(opts: ChatActionOpts): Promise<ChatActionResult> {
  const { message, gateway, provider, ceoDir, skipCeoResponse } = opts;

  // Post the super user's message to #board
  const userMessage = await gateway.postMessage('board', 'super-user', message);

  if (skipCeoResponse || !ceoDir) {
    return { userMessage };
  }

  // Load CEO config and assemble prompt
  const ceoConfig = await loadAgentConfig(ceoDir, 'ceo', 0, null);
  const systemPrompt = assemblePrompt(ceoConfig);

  // Build context: recent #board history for the CEO
  const recentMessages = await provider.readChannel('board', { limit: 20 });
  const conversationContext = recentMessages
    .map(m => `[${m.timestamp.toISOString()}] ${m.sender}: ${m.content}`)
    .join('\n');

  const input = [
    'You have a new message from the super user on #board.',
    'Here is the recent conversation history:',
    '',
    conversationContext,
    '',
    'Respond to the super user\'s latest message. Be concise and direct.',
  ].join('\n');

  // Spawn Claude CLI as the CEO
  const args = buildClaudeArgs({
    model: ceoConfig.identity.model,
    systemPrompt,
    tools: ceoConfig.identity.tools,
  });

  const result = await spawnClaude(args, {
    cwd: ceoDir,
    input,
    timeoutMs: 120_000,
  });

  let ceoResponse: Message | undefined;
  if (result.exitCode === 0 && result.stdout.trim()) {
    ceoResponse = await gateway.postMessage('board', 'ceo', result.stdout.trim());
  } else if (result.exitCode !== 0) {
    console.error(`[chatAction] claude exited ${result.exitCode}: ${result.stderr.slice(0, 500)}`);
  }

  return { userMessage, ceoResponse };
}

export interface ObserveActionOpts {
  channel: string;
  gateway: MessageGateway;
  follow: boolean;
  limit: number;
  /** Callback for each new message in follow mode. */
  onMessage?: (formatted: string) => void;
}

export interface ObserveActionResult {
  messages: Message[];
  formatted: string;
}

/**
 * Format a single message for terminal display.
 */
export function formatMessage(msg: Message): string {
  const ts = msg.timestamp.toISOString().replace('T', ' ').slice(0, 19);
  const sender = chalk.bold.cyan(msg.sender);
  const thread = msg.thread ? chalk.dim(` (thread: ${msg.thread.slice(0, 8)}...)`) : '';
  return `${chalk.dim(ts)} ${sender}${thread}: ${msg.content}`;
}

/**
 * The `hive observe` action. Reads a channel's messages and optionally
 * tails new messages in real-time (poll-based).
 */
export async function observeAction(opts: ObserveActionOpts): Promise<ObserveActionResult> {
  const { channel, gateway, follow, limit } = opts;

  const messages = await gateway.readChannel(channel, { limit });
  const formatted = messages.map(formatMessage).join('\n');

  return { messages, formatted };
}

/**
 * Follow mode: polls for new messages and calls onMessage for each.
 * Returns an AbortController to stop polling.
 */
export function startFollowing(
  channel: string,
  gateway: MessageGateway,
  onMessage: (formatted: string) => void,
  pollIntervalMs: number = 1000,
): AbortController {
  const controller = new AbortController();
  let lastTimestamp = new Date();

  const poll = async () => {
    if (controller.signal.aborted) return;

    try {
      const newMessages = await gateway.readChannel(channel, { since: lastTimestamp });
      for (const msg of newMessages) {
        onMessage(formatMessage(msg));
        if (msg.timestamp > lastTimestamp) {
          lastTimestamp = msg.timestamp;
        }
      }
    } catch {
      // Channel may not exist yet — ignore errors in follow mode
    }

    if (!controller.signal.aborted) {
      setTimeout(poll, pollIntervalMs);
    }
  };

  // Start first poll
  setTimeout(poll, pollIntervalMs);

  return controller;
}
