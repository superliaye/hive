#!/usr/bin/env npx tsx
/**
 * One-time migration: comms.db → hive.db
 *
 * Reads all messages from comms.db and inserts them into hive.db
 * using the chat module's stores. Handles mixed channel formats
 * (dm:alias and dm:N:M) and mixed sender formats (alias and numeric ID).
 */
import Database from 'better-sqlite3';
import path from 'path';
import { ChatDb } from '../src/chat/db.js';
import { ChannelStore } from '../src/chat/channels.js';
import { MessageStore } from '../src/chat/messages.js';

const dataDir = process.argv[2] || 'data';
const commsPath = path.join(dataDir, 'comms.db');
const hivePath = path.join(dataDir, 'hive.db');

console.log(`Migrating ${commsPath} → ${hivePath}`);

const commsDb = new Database(commsPath, { readonly: true });
const chatDb = new ChatDb(hivePath);
const channels = new ChannelStore(chatDb);
const messages = new MessageStore(chatDb);

// Build alias→ID and ID→alias maps from people table
const people = chatDb.raw().prepare('SELECT id, alias FROM people').all() as { id: number; alias: string }[];
const aliasToId = new Map(people.map(p => [p.alias, p.id]));
const idToAlias = new Map(people.map(p => [p.id, p.alias]));

function resolveSender(sender: string): number | null {
  // Try as alias first
  const byAlias = aliasToId.get(sender);
  if (byAlias !== undefined) return byAlias;
  // Try as numeric ID
  const num = parseInt(sender, 10);
  if (!Number.isNaN(num) && idToAlias.has(num)) return num;
  return null;
}

function resolveChannel(channelName: string, senderId: number): string | null {
  // Already in new format: dm:N:M
  if (/^dm:\d+:\d+$/.test(channelName)) {
    // Ensure channel exists in hive.db
    const parts = channelName.split(':');
    const a = parseInt(parts[1], 10);
    const b = parseInt(parts[2], 10);
    if (idToAlias.has(a) && idToAlias.has(b)) {
      return channels.ensureDm(a, b).id;
    }
    return null;
  }

  // Old format: dm:alias
  if (channelName.startsWith('dm:')) {
    const alias = channelName.slice(3);
    const targetId = aliasToId.get(alias);
    if (targetId === undefined) return null;
    return channels.ensureDm(senderId, targetId).id;
  }

  // Special channels like 'board' → skip (deprecated)
  if (channelName === 'board') return null;

  // Group channel — create if needed
  try {
    const existing = channels.getChannel(channelName);
    if (existing) return channelName;
  } catch { /* not found */ }

  // Create as group
  try {
    return channels.createGroup(channelName, senderId, [senderId]).id;
  } catch {
    return null;
  }
}

// Check for existing messages in hive.db
const existingCount = (chatDb.raw().prepare('SELECT COUNT(*) as c FROM messages').get() as any).c;
const forceFlag = process.argv.includes('--force');
if (existingCount > 0 && !forceFlag) {
  console.log(`WARNING: hive.db already has ${existingCount} messages. Use --force to clear and re-migrate.`);
  commsDb.close();
  chatDb.close();
  process.exit(0);
}
if (existingCount > 0 && forceFlag) {
  console.log(`Clearing ${existingCount} existing messages in hive.db...`);
  chatDb.raw().exec('DELETE FROM messages');
  chatDb.raw().exec('DELETE FROM read_cursors');
}

// Read all messages from comms.db ordered by seq (insertion order)
const commsMessages = commsDb.prepare(
  'SELECT id, channel, sender, content, timestamp FROM messages ORDER BY seq ASC'
).all() as { id: string; channel: string; sender: string; content: string; timestamp: string }[];

console.log(`Found ${commsMessages.length} messages in comms.db`);

let migrated = 0;
let skipped = 0;
const skippedReasons = new Map<string, number>();

for (const msg of commsMessages) {
  const senderId = resolveSender(msg.sender);
  if (senderId === null) {
    const reason = `unknown sender: ${msg.sender}`;
    skippedReasons.set(reason, (skippedReasons.get(reason) ?? 0) + 1);
    skipped++;
    continue;
  }

  try {
    const channelId = resolveChannel(msg.channel, senderId);
    if (channelId === null) {
      const reason = `unresolvable channel: ${msg.channel}`;
      skippedReasons.set(reason, (skippedReasons.get(reason) ?? 0) + 1);
      skipped++;
      continue;
    }

    messages.send(channelId, senderId, msg.content);
    migrated++;
  } catch (err) {
    const reason = `error: ${msg.channel} - ${err instanceof Error ? err.message : String(err)}`;
    skippedReasons.set(reason, (skippedReasons.get(reason) ?? 0) + 1);
    skipped++;
  }
}

console.log(`\nMigration complete:`);
console.log(`  Migrated: ${migrated}`);
console.log(`  Skipped:  ${skipped}`);
if (skippedReasons.size > 0) {
  console.log(`  Reasons:`);
  for (const [reason, count] of skippedReasons) {
    console.log(`    ${reason}: ${count}`);
  }
}

commsDb.close();
chatDb.close();
