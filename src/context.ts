import path from 'path';
import fs from 'fs';
import { parseOrgFlat } from './org/parser.js';
import { ChatDb } from './chat/db.js';
import { ChannelStore } from './chat/channels.js';
import { MessageStore } from './chat/messages.js';
import { CursorStore } from './chat/cursors.js';
import { SearchEngine } from './chat/search.js';
import { AccessControl } from './chat/access.js';
import { ChatAdapter } from './chat/adapter.js';
import { AuditStore } from './audit/store.js';
import { AgentStateStore } from './state/agent-state.js';
import { MemoryManager } from './memory/manager.js';
import type { OrgChart, Person } from './types.js';

export class HiveContext {
  readonly orgChart: OrgChart;
  readonly channels: ChannelStore;
  readonly messages: MessageStore;
  readonly cursors: CursorStore;
  readonly search: SearchEngine;
  readonly access: AccessControl;
  readonly chatAdapter: ChatAdapter;
  readonly audit: AuditStore;
  readonly state: AgentStateStore;
  readonly memory: MemoryManager;
  readonly chatDb: ChatDb;
  readonly dataDir: string;
  readonly orgDir: string;

  private constructor(opts: {
    orgChart: OrgChart;
    channels: ChannelStore;
    messages: MessageStore;
    cursors: CursorStore;
    search: SearchEngine;
    access: AccessControl;
    chatAdapter: ChatAdapter;
    audit: AuditStore;
    state: AgentStateStore;
    memory: MemoryManager;
    chatDb: ChatDb;
    dataDir: string;
    orgDir: string;
  }) {
    this.orgChart = opts.orgChart;
    this.channels = opts.channels;
    this.messages = opts.messages;
    this.cursors = opts.cursors;
    this.search = opts.search;
    this.access = opts.access;
    this.chatAdapter = opts.chatAdapter;
    this.audit = opts.audit;
    this.state = opts.state;
    this.memory = opts.memory;
    this.chatDb = opts.chatDb;
    this.dataDir = opts.dataDir;
    this.orgDir = opts.orgDir;
  }

  /** Load all active people from the database. */
  static loadPeople(chatDb: ChatDb): Person[] {
    const rows = chatDb.raw().prepare(
      'SELECT id, alias, name, role_template, status, folder, reports_to, created_at FROM people WHERE status = ?'
    ).all('active') as any[];
    return rows.map(r => ({
      id: r.id,
      alias: r.alias,
      name: r.name,
      roleTemplate: r.role_template ?? undefined,
      status: r.status,
      folder: r.folder ?? undefined,
      reportsTo: r.reports_to ?? undefined,
      createdAt: r.created_at ? new Date(r.created_at) : undefined,
    }));
  }

  static async create(cwd?: string): Promise<HiveContext> {
    const root = cwd ?? process.cwd();
    const orgDir = path.resolve(root, 'org');
    if (!fs.existsSync(orgDir)) {
      throw new Error('No org/ directory found. Run `hive init` first.');
    }
    const dataDir = path.resolve(root, 'data');
    fs.mkdirSync(dataDir, { recursive: true });

    const chatDb = new ChatDb(path.join(dataDir, 'hive.db'));
    const people = HiveContext.loadPeople(chatDb);
    const orgChart = await parseOrgFlat(orgDir, people);

    const channelStore = new ChannelStore(chatDb);
    const messageStore = new MessageStore(chatDb);
    const cursorStore = new CursorStore(chatDb);
    const searchEngine = new SearchEngine(chatDb);
    const accessControl = new AccessControl(chatDb);
    const chatAdapter = new ChatAdapter(chatDb, channelStore, messageStore, cursorStore);

    const audit = new AuditStore(path.join(dataDir, 'audit.db'));
    const state = new AgentStateStore(path.join(dataDir, 'orchestrator.db'));
    const memory = new MemoryManager(dataDir);

    return new HiveContext({
      orgChart,
      channels: channelStore,
      messages: messageStore,
      cursors: cursorStore,
      search: searchEngine,
      access: accessControl,
      chatAdapter,
      audit,
      state,
      memory,
      chatDb,
      dataDir,
      orgDir,
    });
  }

  close(): void {
    this.audit.close();
    this.state.close();
    this.memory.close();
    this.chatDb.close();
  }
}
