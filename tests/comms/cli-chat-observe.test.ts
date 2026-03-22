import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteCommsProvider } from '../../src/comms/sqlite-provider.js';
import { ChannelManager } from '../../src/comms/channel-manager.js';
import { MessageGateway } from '../../src/comms/message-gateway.js';
import { AuditStore } from '../../src/audit/store.js';
import { chatAction, observeAction } from '../../src/comms/cli-commands.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('CLI Commands', () => {
  let provider: SqliteCommsProvider;
  let auditStore: AuditStore;
  let gateway: MessageGateway;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-cli-'));
    const commsDbPath = path.join(tmpDir, 'comms.db');
    const auditDbPath = path.join(tmpDir, 'audit.db');
    provider = new SqliteCommsProvider(commsDbPath);
    auditStore = new AuditStore(auditDbPath);
    gateway = new MessageGateway(provider, auditStore);
  });

  afterEach(() => {
    provider.close();
    auditStore.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('chatAction', () => {
    it('posts the user message to #board', async () => {
      await provider.createChannel('board', ['ceo']);

      // chatAction returns the posted message (before CEO response)
      const result = await chatAction({
        message: 'What is our status?',
        gateway,
        provider,
        // Skip spawning Claude for tests
        skipCeoResponse: true,
      });

      expect(result.userMessage.content).toBe('What is our status?');
      expect(result.userMessage.channel).toBe('board');
      expect(result.userMessage.sender).toBe('super-user');
    });

    it('records the message in the channel history', async () => {
      await provider.createChannel('board', ['ceo']);

      await chatAction({
        message: 'Hello',
        gateway,
        provider,
        skipCeoResponse: true,
      });

      const messages = await provider.readChannel('board');
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Hello');
    });
  });

  describe('observeAction', () => {
    it('returns formatted messages for a channel', async () => {
      await provider.createChannel('board', ['ceo']);
      await gateway.postMessage('board', 'super-user', 'Hello CEO');
      await gateway.postMessage('board', 'ceo', 'Hello boss');

      const output = await observeAction({
        channel: 'board',
        gateway,
        follow: false,   // Don't tail — just dump current messages
        limit: 50,
      });

      expect(output.messages).toHaveLength(2);
      expect(output.formatted).toContain('super-user');
      expect(output.formatted).toContain('Hello CEO');
      expect(output.formatted).toContain('ceo');
      expect(output.formatted).toContain('Hello boss');
    });

    it('respects limit option', async () => {
      await provider.createChannel('board', ['ceo']);
      await gateway.postMessage('board', 'user', 'One');
      await gateway.postMessage('board', 'user', 'Two');
      await gateway.postMessage('board', 'user', 'Three');

      const output = await observeAction({
        channel: 'board',
        gateway,
        follow: false,
        limit: 2,
      });

      expect(output.messages).toHaveLength(2);
    });

    it('shows timestamps in output', async () => {
      await provider.createChannel('board', ['ceo']);
      await gateway.postMessage('board', 'ceo', 'Timestamped message');

      const output = await observeAction({
        channel: 'board',
        gateway,
        follow: false,
        limit: 50,
      });

      // Should contain a date-like pattern (YYYY-MM-DD or HH:MM)
      expect(output.formatted).toMatch(/\d{2}:\d{2}/);
    });
  });
});
