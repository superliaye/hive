import { Command } from 'commander';
import type { ChatDb } from './db.js';
import type { ChannelStore } from './channels.js';
import type { MessageStore } from './messages.js';
import type { CursorStore } from './cursors.js';
import type { SearchEngine } from './search.js';
import type { AccessControl } from './access.js';
import type { ChatMessage } from './types.js';

export interface ChatCliDeps {
  db: ChatDb;
  channels: ChannelStore;
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

function formatMsg(msg: ChatMessage, displayChannel?: string): string {
  const ts = String(msg.timestamp).replace('T', ' ').slice(0, 19);
  const ch = displayChannel ?? msg.channelId;
  return `${ts} | ${msg.senderAlias} | ${ch} | ${msg.content}`;
}

/**
 * Signal the daemon that a new message arrived on a channel.
 * Best-effort: if dashboard isn't running, the daemon will pick it up on next tick.
 */
async function signalDaemon(channel: string, port: number): Promise<void> {
  try {
    await fetch(`http://localhost:${port}/api/signal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel }),
    });
  } catch {
    // Dashboard not running — daemon will pick up on next tick
  }
}

export function buildChatCommand(deps: ChatCliDeps): Command {
  const { channels, messages, cursors, search, access } = deps;
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
      const channelId = channels.resolveTarget(target, caller.id);

      const msg = messages.send(channelId, caller.id, message);

      // Signal daemon for immediate pickup
      await signalDaemon(channelId, port);

      const displayName = channels.formatForDisplay(channelId, caller.id);
      process.stdout.write(`Sent to ${displayName} (seq: ${msg.seq})\n`);
    });

  // --- inbox ---
  chat
    .command('inbox')
    .description('Show unread messages grouped by channel')
    .action(async () => {
      const caller = getCallerIdentity(access);
      const unreadGroups = cursors.getUnread(caller.id);

      if (unreadGroups.length === 0) {
        process.stdout.write('No unread messages\n');
        return;
      }

      for (const group of unreadGroups) {
        const displayName = channels.formatForDisplay(group.channelId, caller.id);
        process.stdout.write(`\n--- ${displayName} (${group.messages.length} unread) ---\n`);
        for (const msg of group.messages) {
          process.stdout.write(formatMsg(msg, displayName) + '\n');
        }
      }
    });

  // --- ack ---
  chat
    .command('ack <target> [seq]')
    .description('Mark messages as read. If no seq, marks all unread in that channel.')
    .action(async (target: string, seqStr?: string) => {
      const caller = getCallerIdentity(access);
      const channelId = channels.resolveExistingTarget(target, caller.id);

      const displayName = channels.formatForDisplay(channelId, caller.id);
      if (seqStr) {
        const seq = parseInt(seqStr, 10);
        cursors.ack(caller.id, channelId, seq);
        process.stdout.write(`Marked up to seq ${seq} as read in ${displayName}\n`);
      } else {
        // Find max seq from unread in this channel
        const unreadGroups = cursors.getUnread(caller.id);
        const group = unreadGroups.find(g => g.channelId === channelId);
        if (!group || group.messages.length === 0) {
          process.stdout.write(`No unread messages in ${displayName}\n`);
          return;
        }
        const maxSeq = group.messages[group.messages.length - 1].seq;
        cursors.ack(caller.id, channelId, maxSeq);
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
      const channelId = channels.resolveExistingTarget(target, caller.id);
      const limit = Number(opts.limit);
      const result = messages.history(channelId, { limit });

      const displayName = channels.formatForDisplay(channelId, caller.id);
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
    .description('Search messages across channels')
    .option('--channel <target>', 'Scope to a channel (@alias or #group)')
    .option('--from <alias>', 'Filter by sender')
    .option('--limit <n>', 'Max results', '20')
    .action(async (pattern: string | undefined, opts: any) => {
      const caller = getCallerIdentity(access);

      let scopeChannelId: string | undefined;
      if (opts.channel) {
        scopeChannelId = channels.resolveExistingTarget(opts.channel, caller.id);
      }

      let fromPersonId: number | undefined;
      if (opts.from) {
        const fromAlias = opts.from.startsWith('@') ? opts.from.slice(1) : opts.from;
        const person = access.resolvePerson(fromAlias);
        fromPersonId = person.id;
      }

      if (!pattern && !scopeChannelId && fromPersonId === undefined) {
        process.stderr.write('Pattern is required (or use --channel / --from to scope)\n');
        process.exit(1);
      }

      const result = search.search({
        callerId: caller.id,
        pattern,
        scopeChannelId,
        fromPersonId,
        limit: Number(opts.limit),
      });

      process.stdout.write(`Found ${result.total} results (showing ${result.messages.length})\n\n`);
      for (const msg of result.messages) {
        const displayCh = channels.formatForDisplay(msg.channelId, caller.id);
        process.stdout.write(formatMsg(msg, displayCh) + '\n');
      }
    });

  // --- group subcommand ---
  const group = chat
    .command('group')
    .description('Manage group channels');

  group
    .command('create <name> <members...>')
    .description('Create a group channel. Members: @alias @alias ...')
    .action(async (name: string, members: string[]) => {
      const caller = getCallerIdentity(access);
      const memberIds = members.map(m => {
        const alias = m.startsWith('@') ? m.slice(1) : m;
        return access.resolvePerson(alias).id;
      });
      const ch = channels.createGroup(name, caller.id, memberIds);
      const totalMembers = new Set([caller.id, ...memberIds]).size;
      process.stdout.write(`Group #${name} created with ${totalMembers} members\n`);
    });

  group
    .command('list')
    .description('List channels you belong to')
    .action(async () => {
      const caller = getCallerIdentity(access);
      const groups = channels.listGroups(caller.id);
      if (groups.length === 0) {
        process.stdout.write('No channels\n');
        return;
      }
      for (const ch of groups) {
        const members = channels.getMembers(ch.id);
        process.stdout.write(`${ch.id} (${members.length} members)\n`);
      }
    });

  return chat;
}
