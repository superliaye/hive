import path from 'path';
import fs from 'fs';
import { parseOrgTree } from './org/parser.js';
import { SqliteCommsProvider } from './comms/sqlite-provider.js';
import { ChannelManager } from './comms/channel-manager.js';
import { AuditStore } from './audit/store.js';
import { AgentStateStore } from './state/agent-state.js';
import type { OrgChart } from './types.js';

export class HiveContext {
  readonly orgChart: OrgChart;
  readonly comms: SqliteCommsProvider;
  readonly audit: AuditStore;
  readonly state: AgentStateStore;
  readonly channelManager: ChannelManager;
  readonly dataDir: string;
  readonly orgDir: string;

  private constructor(opts: {
    orgChart: OrgChart;
    comms: SqliteCommsProvider;
    audit: AuditStore;
    state: AgentStateStore;
    channelManager: ChannelManager;
    dataDir: string;
    orgDir: string;
  }) {
    this.orgChart = opts.orgChart;
    this.comms = opts.comms;
    this.audit = opts.audit;
    this.state = opts.state;
    this.channelManager = opts.channelManager;
    this.dataDir = opts.dataDir;
    this.orgDir = opts.orgDir;
  }

  static async create(cwd?: string): Promise<HiveContext> {
    const root = cwd ?? process.cwd();
    const orgDir = path.resolve(root, 'org');
    if (!fs.existsSync(orgDir)) {
      throw new Error('No org/ directory found. Run `hive init` first.');
    }
    const dataDir = path.resolve(root, 'data');
    fs.mkdirSync(dataDir, { recursive: true });

    const orgChart = await parseOrgTree(orgDir);
    const comms = new SqliteCommsProvider(path.join(dataDir, 'comms.db'));
    const audit = new AuditStore(path.join(dataDir, 'audit.db'));
    const state = new AgentStateStore(path.join(dataDir, 'orchestrator.db'));
    const channelManager = new ChannelManager(comms);

    await channelManager.syncFromOrgTree(orgChart);

    return new HiveContext({
      orgChart, comms, audit, state, channelManager, dataDir, orgDir,
    });
  }

  close(): void {
    this.comms.close();
    this.audit.close();
    this.state.close();
  }
}
