import path from 'path';
import fs from 'fs';
import { parseOrgFlat } from './org/parser.js';
import { ChatDb } from './chat/db.js';
import { SqliteCommsProvider } from './comms/sqlite-provider.js';
import { ChannelManager } from './comms/channel-manager.js';
import { AuditStore } from './audit/store.js';
import { AgentStateStore } from './state/agent-state.js';
import { MemoryManager } from './memory/manager.js';
import type { OrgChart, Person } from './types.js';

export class HiveContext {
  readonly orgChart: OrgChart;
  readonly comms: SqliteCommsProvider;
  readonly audit: AuditStore;
  readonly state: AgentStateStore;
  readonly channelManager: ChannelManager;
  readonly memory: MemoryManager;
  readonly chatDb: ChatDb;
  readonly dataDir: string;
  readonly orgDir: string;

  private constructor(opts: {
    orgChart: OrgChart;
    comms: SqliteCommsProvider;
    audit: AuditStore;
    state: AgentStateStore;
    channelManager: ChannelManager;
    memory: MemoryManager;
    chatDb: ChatDb;
    dataDir: string;
    orgDir: string;
  }) {
    this.orgChart = opts.orgChart;
    this.comms = opts.comms;
    this.audit = opts.audit;
    this.state = opts.state;
    this.channelManager = opts.channelManager;
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
    const comms = new SqliteCommsProvider(path.join(dataDir, 'comms.db'));
    const audit = new AuditStore(path.join(dataDir, 'audit.db'));
    const state = new AgentStateStore(path.join(dataDir, 'orchestrator.db'));
    const channelManager = new ChannelManager(comms);
    const memory = new MemoryManager(dataDir);

    return new HiveContext({
      orgChart, comms, audit, state, channelManager, memory, chatDb, dataDir, orgDir,
    });
  }

  close(): void {
    this.comms.close();
    this.audit.close();
    this.state.close();
    this.memory.close();
    this.chatDb.close();
  }
}
