import { Command } from 'commander';
import type { ChatDb } from './db.js';
import type { ConversationStore } from './conversations.js';
import type { MessageStore } from './messages.js';
import type { CursorStore } from './cursors.js';
import type { SearchEngine } from './search.js';
import type { AccessControl } from './access.js';
import type { ChatMessage } from './types.js';

export interface ChatCliDeps {
  db: ChatDb;
  conversations: ConversationStore;
  messages: MessageStore;
  cursors: CursorStore;
  search: SearchEngine;
  access: AccessControl;
  /** Dashboard port for signaling daemon on new messages */
  dashboardPort?: number;
}

/**
 * Resolve HIVE_AGENT_ID env var to a person identity (id + alias).
 */
function getCallerIdentity(access: AccessControl): { id: number; alias: string } {
  const envId = process.env.HIVE_AGENT_ID;
  if (!envId) throw new Error('HIVE_AGENT_ID not set. Are you running inside a hive agent?');
  const person = access.resolvePerson(envId);
  return { id: person.id, alias: person.alias };
}

function formatMsg(msg: ChatMessage, displayName?: string): string {
  const ts = String(msg.timestamp).replace('T', ' ').slice(0, 19);
  const name = displayName ?? msg.conversationId;
  return `${ts} | ${msg.senderAlias} | ${name} | ${msg.content}`;
}

/**
 * Signal the daemon that a new message arrived on a conversation.
 * Best-effort: if dashboard isn't running, the daemon will pick it up on next tick.
 */
async function signalDaemon(conversationId: string, port: number): Promise<void> {
  try {
    await fetch(`http://localhost:${port}/api/signal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation: conversationId }),
    });
  } catch {
    // Dashboard not running — daemon will pick up on next tick
  }
}

export function buildChatCommand(deps: ChatCliDeps): Command {
  const { conversations, messages, cursors, search, access } = deps;
  const port = deps.dashboardPort ?? 3001;

  const chat = new Command('chat')
    .description('Messaging system for agent communication');

  // --- send ---
  chat
    .command('send <target> [message]')
    .description('Send a message. @alias for DM, #group for group. Pipe via stdin if no message arg.')
    .option('--stdin', 'Read message from stdin')
    .action(async (target: string, message: string | undefined, cmdOpts: any) => {
      if (!message || cmdOpts.stdin) {
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) {
          chunks.push(chunk);
        }
        message = Buffer.concat(chunks).toString('utf-8').trimEnd();
      }
      if (!message) {
        throw new Error('Message is required. Provide as argument or pipe via stdin.');
      }

      const caller = getCallerIdentity(access);
      const conversationId = conversations.resolveTarget(target, caller.id);

      const msg = messages.send(conversationId, caller.id, message);

      // Signal daemon for immediate pickup
      await signalDaemon(conversationId, port);

      const displayName = conversations.formatForDisplay(conversationId, caller.id);
      process.stdout.write(`Sent to ${displayName} (seq: ${msg.seq})\n`);
    });

  // --- inbox ---
  chat
    .command('inbox')
    .description('Show unread messages grouped by conversation')
    .action(async () => {
      const caller = getCallerIdentity(access);
      const unreadGroups = cursors.getUnread(caller.id);

      if (unreadGroups.length === 0) {
        process.stdout.write('No unread messages\n');
        return;
      }

      for (const group of unreadGroups) {
        const displayName = conversations.formatForDisplay(group.conversationId, caller.id);
        process.stdout.write(`\n--- ${displayName} (${group.messages.length} unread) ---\n`);
        for (const msg of group.messages) {
          process.stdout.write(formatMsg(msg, displayName) + '\n');
        }
      }
    });

  // --- ack ---
  chat
    .command('ack <target> [seq]')
    .description('Mark messages as read. If no seq, marks all in that conversation.')
    .action(async (target: string, seqStr?: string) => {
      const caller = getCallerIdentity(access);
      const conversationId = conversations.resolveExistingTarget(target, caller.id);

      const displayName = conversations.formatForDisplay(conversationId, caller.id);
      if (seqStr) {
        const seq = parseInt(seqStr, 10);
        cursors.ack(caller.id, conversationId, seq);
        process.stdout.write(`Marked up to seq ${seq} as read in ${displayName}\n`);
      } else {
        const unreadGroups = cursors.getUnread(caller.id);
        const group = unreadGroups.find(g => g.conversationId === conversationId);
        if (!group || group.messages.length === 0) {
          process.stdout.write(`No unread messages in ${displayName}\n`);
          return;
        }
        const maxSeq = group.messages[group.messages.length - 1].seq;
        cursors.ack(caller.id, conversationId, maxSeq);
        process.stdout.write(`Marked ${group.messages.length} messages as read in ${displayName}\n`);
      }
    });

  // --- history ---
  chat
    .command('history <target>')
    .description('Show message history. @alias for DM, #group for group.')
    .option('--limit <n>', 'Max messages to return', '20')
    .action(async (target: string, opts: any) => {
      const caller = getCallerIdentity(access);
      const conversationId = conversations.resolveExistingTarget(target, caller.id);
      const limit = Number(opts.limit);
      const result = messages.history(conversationId, { limit });

      const displayName = conversations.formatForDisplay(conversationId, caller.id);
      if (result.messages.length === 0) {
        process.stdout.write(`No messages in ${displayName}\n`);
        return;
      }

      process.stdout.write(`Showing ${result.messages.length} of ${result.total} messages in ${displayName}\n\n`);
      for (const msg of result.messages) {
        process.stdout.write(formatMsg(msg, displayName) + '\n');
      }
    });

  // --- search ---
  chat
    .command('search [pattern]')
    .description('Search messages')
    .option('--in <target>', 'Scope to a conversation (@alias or #group)')
    .option('--from <alias>', 'Filter by sender')
    .option('--limit <n>', 'Max results', '20')
    .action(async (pattern: string | undefined, opts: any) => {
      const caller = getCallerIdentity(access);

      let scopeConversationId: string | undefined;
      if (opts.in) {
        scopeConversationId = conversations.resolveExistingTarget(opts.in, caller.id);
      }

      let fromPersonId: number | undefined;
      if (opts.from) {
        const fromAlias = opts.from.startsWith('@') ? opts.from.slice(1) : opts.from;
        const person = access.resolvePerson(fromAlias);
        fromPersonId = person.id;
      }

      if (!pattern && !scopeConversationId && fromPersonId === undefined) {
        process.stderr.write('Pattern is required (or use --in / --from to scope)\n');
        process.exit(1);
      }

      const result = search.search({
        callerId: caller.id,
        pattern,
        scopeConversationId,
        fromPersonId,
        limit: Number(opts.limit),
      });

      process.stdout.write(`Found ${result.total} results (showing ${result.messages.length})\n\n`);
      for (const msg of result.messages) {
        const display = conversations.formatForDisplay(msg.conversationId, caller.id);
        process.stdout.write(formatMsg(msg, display) + '\n');
      }
    });

  // --- group subcommand ---
  const group = chat
    .command('group')
    .description('Manage groups');

  group
    .command('create <name> <members...>')
    .description('Create a group. Members: @alias @alias ...')
    .action(async (name: string, members: string[]) => {
      const caller = getCallerIdentity(access);
      const memberIds = members.map(m => {
        const alias = m.startsWith('@') ? m.slice(1) : m;
        return access.resolvePerson(alias).id;
      });
      conversations.createGroup(name, caller.id, memberIds);
      const totalMembers = new Set([caller.id, ...memberIds]).size;
      process.stdout.write(`Group #${name} created with ${totalMembers} members\n`);
    });

  group
    .command('list')
    .description('List groups you belong to')
    .action(async () => {
      const caller = getCallerIdentity(access);
      const groups = conversations.listGroups(caller.id);
      if (groups.length === 0) {
        process.stdout.write('No groups\n');
        return;
      }
      for (const conv of groups) {
        const members = conversations.getMembers(conv.id);
        process.stdout.write(`${conv.id} (${members.length} members)\n`);
      }
    });

  return chat;
}
