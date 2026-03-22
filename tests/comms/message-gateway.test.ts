import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MessageGateway } from '../../src/comms/message-gateway.js';
import { SqliteCommsProvider } from '../../src/comms/sqlite-provider.js';
import { AuditStore } from '../../src/audit/store.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('MessageGateway', () => {
  let provider: SqliteCommsProvider;
  let auditStore: AuditStore;
  let gateway: MessageGateway;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-gateway-'));
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

  describe('postMessage', () => {
    it('posts a message and returns it', async () => {
      await provider.createChannel('board', ['ceo']);
      const msg = await gateway.postMessage('board', 'super-user', 'Hello CEO');
      expect(msg.content).toBe('Hello CEO');
      expect(msg.channel).toBe('board');
    });

    it('creates an audit log entry for each message', async () => {
      await provider.createChannel('board', ['ceo']);
      await gateway.postMessage('board', 'super-user', 'Audit me');
      const entries = auditStore.getInvocations({ limit: 10 });
      expect(entries.length).toBeGreaterThanOrEqual(1);
      const commsEntry = entries.find(e => e.invocationType === 'comms');
      expect(commsEntry).toBeDefined();
      expect(commsEntry!.channel).toBe('board');
      expect(commsEntry!.agentId).toBe('super-user');
    });
  });

  describe('readChannel', () => {
    it('reads messages through the gateway', async () => {
      await provider.createChannel('board', ['ceo']);
      await gateway.postMessage('board', 'super-user', 'Message 1');
      await gateway.postMessage('board', 'ceo', 'Message 2');
      const messages = await gateway.readChannel('board');
      expect(messages).toHaveLength(2);
    });
  });

  describe('getUnreadForAgent', () => {
    it('returns unread messages for an agent', async () => {
      await provider.createChannel('board', ['ceo']);
      await gateway.postMessage('board', 'super-user', 'Unread msg');
      const unread = await gateway.getUnreadForAgent('ceo');
      expect(unread).toHaveLength(1);
      expect(unread[0].content).toBe('Unread msg');
    });

    it('supports markRead through the gateway', async () => {
      await provider.createChannel('board', ['ceo']);
      const msg = await gateway.postMessage('board', 'super-user', 'Read me');
      await gateway.markRead('ceo', [msg.id]);
      const unread = await gateway.getUnreadForAgent('ceo');
      expect(unread).toHaveLength(0);
    });
  });

  describe('searchHistory', () => {
    it('searches through the gateway', async () => {
      await provider.createChannel('board', ['ceo']);
      await gateway.postMessage('board', 'super-user', 'Deploy the service');
      await gateway.postMessage('board', 'ceo', 'OK will deploy');
      const results = await gateway.searchHistory('deploy');
      expect(results).toHaveLength(2);
    });
  });
});
