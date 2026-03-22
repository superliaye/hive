import { Command } from 'commander';
import { parseOrgTree } from './org/parser.js';
import { AgentStateStore } from './state/agent-state.js';
import { SqliteCommsProvider } from './comms/sqlite-provider.js';
import { ChannelManager } from './comms/channel-manager.js';
import { MessageGateway } from './comms/message-gateway.js';
import { AuditStore } from './audit/store.js';
import { chatAction, observeAction, formatMessage, startFollowing } from './comms/cli-commands.js';
import chalk from 'chalk';
import path from 'path';
import fs from 'fs';

function getOrgDir(): string {
  const orgDir = path.resolve(process.cwd(), 'org');
  if (!fs.existsSync(orgDir)) {
    console.error(chalk.red('No org/ directory found. Run `hive init` first.'));
    process.exit(1);
  }
  return orgDir;
}

function getDataDir(): string {
  const dataDir = path.resolve(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return dataDir;
}

function getCommsProvider(): SqliteCommsProvider {
  return new SqliteCommsProvider(path.join(getDataDir(), 'comms.db'));
}

function getAuditStore(): AuditStore {
  return new AuditStore(path.join(getDataDir(), 'audit.db'));
}

const program = new Command();

program
  .name('hive')
  .description('Self-organizing company of AI agents')
  .version('0.1.0');

program
  .command('org')
  .description('Print org chart from folder tree')
  .action(async () => {
    const org = await parseOrgTree(getOrgDir());
    function printAgent(id: string, indent: number): void {
      const agent = org.agents.get(id);
      if (!agent) return;
      const prefix = '  '.repeat(indent);
      const emoji = agent.identity.emoji ?? '🔹';
      console.log(`${prefix}${emoji} ${chalk.bold(agent.identity.name)} (${agent.identity.role}) [${agent.id}]`);
      for (const childId of agent.childIds) {
        printAgent(childId, indent + 1);
      }
    }
    console.log(chalk.underline('\nOrg Chart:\n'));
    printAgent(org.root.id, 0);
    console.log(`\n${chalk.dim(`${org.agents.size} agents, ${org.channels.length} channels`)}\n`);
  });

program
  .command('status')
  .description('Show active agents and org status')
  .action(async () => {
    const org = await parseOrgTree(getOrgDir());
    const stateStore = new AgentStateStore(path.join(getDataDir(), 'orchestrator.db'));

    for (const [id, agent] of org.agents) {
      stateStore.register(id);
    }

    const states = stateStore.listAll();
    console.log(chalk.underline('\nAgent Status:\n'));
    for (const state of states) {
      const agent = org.agents.get(state.agentId);
      const name = agent?.identity.name ?? state.agentId;
      const statusColor = state.status === 'working' ? chalk.green : state.status === 'errored' ? chalk.red : chalk.dim;
      console.log(`  ${statusColor(state.status.padEnd(8))} ${name}`);
    }
    console.log();
    stateStore.close();
  });

program
  .command('init')
  .description('Bootstrap a new organization')
  .requiredOption('--mission <mission>', 'Organization mission statement')
  .option('--template <template>', 'Org template to use', 'startup')
  .action(async (opts) => {
    console.log(`hive init — mission: "${opts.mission}", template: ${opts.template}`);
    console.log(chalk.dim('(Not yet implemented — see Plan 4)'));
  });

program
  .command('start')
  .description('Wake the organization')
  .action(async () => {
    console.log('hive start — not yet implemented (see Plan 3)');
  });

program
  .command('stop')
  .description('Graceful shutdown')
  .action(async () => {
    console.log('hive stop — not yet implemented (see Plan 3)');
  });

program
  .command('chat')
  .description('Send a message to the CEO via #board')
  .argument('<message>', 'Message to send to the CEO')
  .action(async (message: string) => {
    const provider = getCommsProvider();
    const auditStore = getAuditStore();
    const gateway = new MessageGateway(provider, auditStore);
    const orgDir = getOrgDir();

    // Ensure #board channel exists
    const channelManager = new ChannelManager(provider);
    const org = await parseOrgTree(orgDir);
    await channelManager.syncFromOrgTree(org);

    // Find CEO directory
    const ceoConfig = org.root;
    if (!ceoConfig) {
      console.error(chalk.red('No CEO found in org tree.'));
      provider.close();
      auditStore.close();
      process.exit(1);
    }

    console.log(chalk.dim(`> super-user: ${message}`));
    console.log(chalk.dim('Waiting for CEO response...\n'));

    try {
      const result = await chatAction({
        message,
        gateway,
        provider,
        ceoDir: ceoConfig.dir,
      });

      if (result.ceoResponse) {
        console.log(chalk.bold.cyan('CEO: ') + result.ceoResponse.content);
      } else {
        console.log(chalk.yellow('CEO did not respond.'));
      }
    } catch (err: any) {
      console.error(chalk.red(`Error: ${err.message}`));
    } finally {
      provider.close();
      auditStore.close();
    }
  });

program
  .command('observe')
  .description('Watch a channel\'s messages (tail -f style)')
  .argument('<channel>', 'Channel name to observe (without #)')
  .option('-n, --limit <number>', 'Number of recent messages to show', '20')
  .option('-f, --follow', 'Follow new messages in real-time', false)
  .action(async (channel: string, opts: { limit: string; follow: boolean }) => {
    const provider = getCommsProvider();
    const auditStore = getAuditStore();
    const gateway = new MessageGateway(provider, auditStore);
    const limit = parseInt(opts.limit, 10);

    console.log(chalk.underline(`\n#${channel}\n`));

    try {
      // Show existing messages
      const result = await observeAction({
        channel,
        gateway,
        follow: opts.follow,
        limit,
      });

      if (result.formatted) {
        console.log(result.formatted);
      } else {
        console.log(chalk.dim('(no messages)'));
      }

      // Follow mode: poll for new messages
      if (opts.follow) {
        console.log(chalk.dim('\n--- following (Ctrl+C to stop) ---\n'));

        const controller = startFollowing(
          channel,
          gateway,
          (formatted) => console.log(formatted),
          1000,
        );

        // Handle Ctrl+C gracefully
        process.on('SIGINT', () => {
          controller.abort();
          console.log(chalk.dim('\nStopped observing.'));
          provider.close();
          auditStore.close();
          process.exit(0);
        });

        // Keep the process alive
        await new Promise(() => {});
      }
    } catch (err: any) {
      console.error(chalk.red(`Error: ${err.message}`));
    } finally {
      if (!opts.follow) {
        provider.close();
        auditStore.close();
      }
    }
  });

program.parse();
