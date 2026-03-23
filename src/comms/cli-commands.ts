import type { MessageGateway } from './message-gateway.js';
import type { Message } from './types.js';
import chalk from 'chalk';

export interface ChatActionOpts {
  message: string;
  gateway: MessageGateway;
}

export interface ChatActionResult {
  userMessage: Message;
}

/**
 * The `hive chat` action. Posts a message to #board as super-user.
 * The daemon detects #board as a direct channel for the CEO and
 * triggers CheckWork, which invokes the CEO to respond.
 */
export async function chatAction(opts: ChatActionOpts): Promise<ChatActionResult> {
  const { message, gateway } = opts;

  // Post the super user's message to #board
  const userMessage = await gateway.postMessage('board', 'super-user', message);

  return { userMessage };
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
