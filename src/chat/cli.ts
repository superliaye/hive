import { Command } from 'commander';
import type { ChatDb } from './db.js';
import { ChannelStore } from './channels.js';
import { MessageStore } from './messages.js';
import { CursorStore } from './cursors.js';
import { SearchEngine } from './search.js';
import { AccessControl } from './access.js';
import type { ChatMessage } from './types.js';

function getCallerId(): number {
  return AccessControl.requireIdentity(process.env.HIVE_AGENT_ID);
}

function formatMessage(msg: ChatMessage): string {
  const ts = msg.timestamp?.replace('T', ' ').replace(/\.\d+Z?$/, '') ?? '';
  return `${msg.channelId} | ${msg.senderAlias} | seq:${msg.seq} | ${ts} | ${msg.content}`;
}

export function buildChatCommand(db: ChatDb): Command {
  const channelStore = new ChannelStore(db);
  const msgStore = new MessageStore(db);
  const cursorStore = new CursorStore(db);
  const searchEngine = new SearchEngine(db);
  const access = new AccessControl(db);

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

      const callerId = getCallerId();
      const channelId = channelStore.resolveTarget(target, callerId);

      if (target.startsWith('@')) {
        const alias = target.slice(1);
        const person = access.resolvePerson(alias);
        access.validateSend(callerId, person.id);
      } else {
        access.requireMembership(callerId, channelId);
      }

      const msg = msgStore.send(channelId, callerId, message);
      process.stdout.write(`Sent seq ${msg.seq} to ${channelId}\n`);
    });

  // --- inbox ---
  chat
    .command('inbox')
    .description('Show unread messages grouped by channel')
    .action(() => {
      const callerId = getCallerId();
      const groups = cursorStore.getUnread(callerId);

      if (groups.length === 0) {
        process.stdout.write('No unread messages\n');
        return;
      }

      for (const group of groups) {
        process.stdout.write(`\n--- ${group.channelId} (${group.messages.length} unread) ---\n`);
        for (const msg of group.messages) {
          process.stdout.write(formatMessage(msg) + '\n');
        }
      }
    });

  // --- ack ---
  chat
    .command('ack <target> <seq>')
    .description('Advance read cursor. @alias for DM, #group for group.')
    .action((target: string, seqStr: string) => {
      const callerId = getCallerId();
      const channelId = channelStore.resolveTarget(target, callerId);
      cursorStore.ack(callerId, channelId, Number(seqStr));
      process.stdout.write(`Cursor advanced to seq ${seqStr} on ${channelId}\n`);
    });

  // --- history ---
  chat
    .command('history <target>')
    .description('Show message history. @alias for DM, #group for group.')
    .option('--limit <n>', 'Max messages to return', '20')
    .option('--from <seq>', 'Start from this seq (inclusive)')
    .option('--to <seq>', 'End at this seq (inclusive)')
    .option('--all', 'Show all messages')
    .action((target: string, opts: any) => {
      const callerId = getCallerId();
      const channelId = channelStore.resolveTarget(target, callerId);
      access.requireMembership(callerId, channelId);

      const result = msgStore.history(channelId, {
        limit: opts.all ? undefined : Number(opts.limit),
        from: opts.from ? Number(opts.from) : undefined,
        to: opts.to ? Number(opts.to) : undefined,
        all: opts.all,
      });

      const count = result.messages.length;
      process.stdout.write(
        `Showing ${count} of ${result.total} messages in ${channelId} (seq ${result.showing.from}-${result.showing.to})\n\n`
      );

      for (const msg of result.messages) {
        process.stdout.write(formatMessage(msg) + '\n');
      }
    });

  // --- search ---
  chat
    .command('search [scope] [pattern]')
    .description('Search messages. Scope: @alias (DM), #group. Pattern: literal or regex.')
    .option('--from <alias>', 'Filter by sender alias')
    .option('--after <date>', 'After date (YYYY-MM-DD)')
    .option('--before <date>', 'Before date (YYYY-MM-DD)')
    .option('-i', 'Case insensitive')
    .option('-E', 'Extended regex mode')
    .option('--limit <n>', 'Max results', '20')
    .option('--offset <n>', 'Skip first N results', '0')
    .action((scope: string | undefined, pattern: string | undefined, opts: any) => {
      const callerId = getCallerId();

      let scopeChannelId: string | undefined;
      let actualPattern = pattern;

      if (scope && !scope.startsWith('@') && !scope.startsWith('#')) {
        actualPattern = scope;
        scopeChannelId = undefined;
      } else if (scope) {
        scopeChannelId = channelStore.resolveTarget(scope, callerId);
      }

      let fromPersonId: number | undefined;
      if (opts.from) {
        const fromAlias = opts.from.startsWith('@') ? opts.from.slice(1) : opts.from;
        fromPersonId = access.resolvePerson(fromAlias).id;
      }

      const result = searchEngine.search({
        pattern: actualPattern,
        callerId,
        scopeChannelId,
        fromPersonId,
        after: opts.after,
        before: opts.before,
        caseInsensitive: opts.i || false,
        regex: opts.E || false,
        limit: Number(opts.limit),
        offset: Number(opts.offset),
      });

      const start = Number(opts.offset) + 1;
      const end = start + result.messages.length - 1;
      process.stdout.write(`Found ${result.total} results (showing ${start}-${end})\n\n`);

      for (const msg of result.messages) {
        process.stdout.write(formatMessage(msg) + '\n');
      }
    });

  // --- group subcommand ---
  const group = chat
    .command('group')
    .description('Manage group channels');

  group
    .command('create <name> <members...>')
    .description('Create a group channel. Members: @alias @alias ...')
    .action((name: string, members: string[]) => {
      const callerId = getCallerId();
      const memberIds = members.map(m => {
        const alias = m.startsWith('@') ? m.slice(1) : m;
        return access.resolvePerson(alias).id;
      });
      channelStore.createGroup(name, callerId, memberIds);
      process.stdout.write(`Group #${name} created with ${new Set([...memberIds, callerId]).size} members\n`);
    });

  group
    .command('list')
    .description('List groups you belong to')
    .action(() => {
      const callerId = getCallerId();
      const groups = channelStore.listGroups(callerId);
      if (groups.length === 0) {
        process.stdout.write('No groups\n');
        return;
      }
      for (const g of groups) {
        process.stdout.write(`#${g.id}\n`);
      }
    });

  group
    .command('info <name>')
    .description('Show group details')
    .action((name: string) => {
      const callerId = getCallerId();
      const groupName = name.startsWith('#') ? name.slice(1) : name;
      access.requireMembership(callerId, groupName);
      const info = channelStore.getGroupInfo(groupName);
      process.stdout.write(`Group: #${info.id}\n`);
      process.stdout.write(`Created by: person ${info.createdBy}\n`);
      process.stdout.write(`Members (${info.memberCount}): ${info.members.map(m => '@' + m.alias).join(', ')}\n`);
      process.stdout.write(`Messages: ${info.messageCount}\n`);
    });

  group
    .command('add <name> <alias>')
    .description('Add member to group')
    .action((name: string, alias: string) => {
      const callerId = getCallerId();
      const groupName = name.startsWith('#') ? name.slice(1) : name;
      access.requireMembership(callerId, groupName);
      const cleanAlias = alias.startsWith('@') ? alias.slice(1) : alias;
      const person = access.resolvePerson(cleanAlias);
      channelStore.addMember(groupName, person.id);
      process.stdout.write(`Added @${person.alias} to #${groupName}\n`);
    });

  group
    .command('remove <name> <alias>')
    .description('Remove member from group (use your own alias to leave)')
    .action((name: string, alias: string) => {
      const callerId = getCallerId();
      const groupName = name.startsWith('#') ? name.slice(1) : name;
      access.requireMembership(callerId, groupName);
      const cleanAlias = alias.startsWith('@') ? alias.slice(1) : alias;
      const person = access.resolvePerson(cleanAlias);
      channelStore.removeMember(groupName, person.id);
      process.stdout.write(`Removed @${person.alias} from #${groupName}\n`);
    });

  group
    .command('delete <name>')
    .description('Delete group (messages preserved for audit)')
    .action((name: string) => {
      const callerId = getCallerId();
      const groupName = name.startsWith('#') ? name.slice(1) : name;
      access.requireMembership(callerId, groupName);
      channelStore.deleteGroup(groupName);
      process.stdout.write(`Group #${groupName} deleted\n`);
    });

  return chat;
}
