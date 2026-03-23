import { Command } from 'commander';
import { parseOrgTree } from './org/parser.js';
import { SqliteCommsProvider } from './comms/sqlite-provider.js';
import { ChannelManager } from './comms/channel-manager.js';
import { MessageGateway } from './comms/message-gateway.js';
import { chatAction, observeAction, formatMessage, startFollowing } from './comms/cli-commands.js';
import { HiveContext } from './context.js';
import chalk from 'chalk';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Lightweight helpers for commands that don't need full HiveContext
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

const program = new Command();

program
  .name('hive')
  .description('Self-organizing company of AI agents')
  .version('0.1.0');

program
  .command('org')
  .description('Print org chart from folder tree')
  .action(async () => {
    const ctx = await HiveContext.create();
    try {
      const { orgChart } = ctx;
      function printAgent(id: string, indent: number): void {
        const agent = orgChart.agents.get(id);
        if (!agent) return;
        const prefix = '  '.repeat(indent);
        const emoji = agent.identity.emoji ?? '🔹';
        console.log(`${prefix}${emoji} ${chalk.bold(agent.identity.name)} (${agent.identity.role}) [${agent.id}]`);
        for (const childId of agent.childIds) {
          printAgent(childId, indent + 1);
        }
      }
      console.log(chalk.underline('\nOrg Chart:\n'));
      printAgent(orgChart.root.id, 0);
      console.log(`\n${chalk.dim(`${orgChart.agents.size} agents, ${orgChart.channels.length} channels`)}\n`);
    } finally {
      ctx.close();
    }
  });

program
  .command('status')
  .description('Show active agents and org status')
  .action(async () => {
    const ctx = await HiveContext.create();
    try {
      for (const [id] of ctx.orgChart.agents) {
        ctx.state.register(id);
      }
      const states = ctx.state.listAll();
      console.log(chalk.underline('\nAgent Status:\n'));
      for (const state of states) {
        const agent = ctx.orgChart.agents.get(state.agentId);
        const name = agent?.identity.name ?? state.agentId;
        const statusColor = state.status === 'working' ? chalk.green : state.status === 'errored' ? chalk.red : chalk.dim;
        console.log(`  ${statusColor(state.status.padEnd(8))} ${name}`);
      }
      console.log();
    } finally {
      ctx.close();
    }
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
  .option('--persistent-interval <ms>', 'Heartbeat interval for persistent agents (ms)', '600000')
  .option('--on-demand-interval <ms>', 'Heartbeat interval for on-demand agents (ms)', '7200000')
  .action(async (opts) => {
    const orgDir = getOrgDir();
    const dataDir = getDataDir();
    const { Orchestrator } = await import('./orchestrator/orchestrator.js');
    const { buildStartConfig } = await import('./orchestrator/cli-helpers.js');
    const { PidFile } = await import('./orchestrator/pid-file.js');

    // Check if already running
    const pidFile = new PidFile(path.join(dataDir, 'hive.pid'));
    if (pidFile.isRunning()) {
      console.error(chalk.red(`Hive is already running (PID: ${pidFile.read()}). Use \`hive stop\` first.`));
      process.exit(1);
    }

    console.log(chalk.blue('Parsing org tree...'));
    const orgChart = await parseOrgTree(orgDir);
    console.log(chalk.dim(`Found ${orgChart.agents.size} agents, ${orgChart.channels.length} channels`));

    // Auto-wire comms provider from SQLite
    const commsDb = path.join(dataDir, 'comms.db');
    const commsProvider = new SqliteCommsProvider(commsDb);
    const channelManager = new ChannelManager(commsProvider);

    // Sync channels from the org tree so all org-defined channels exist in the DB
    await channelManager.syncFromOrgTree(orgChart);

    const config = buildStartConfig({
      orgChart,
      dataDir,
      persistentIntervalMs: parseInt(opts.persistentInterval, 10),
      onDemandIntervalMs: parseInt(opts.onDemandInterval, 10),
      commsProvider: {
        getUnread: (agentId) => commsProvider.getUnread(agentId),
        markRead: (agentId, messageIds) => commsProvider.markRead(agentId, messageIds),
        postMessage: async (agentId, channel, content, opts) => {
          await commsProvider.postMessage(agentId, channel, content, opts);
        },
      },
    });

    const orchestrator = new Orchestrator(config);
    await orchestrator.start();

    console.log(chalk.green(`Hive started (PID: ${process.pid})`));
    console.log(chalk.dim(`Persistent agents: ${config.persistentAgentIds.join(', ') || 'none'}`));
    console.log(chalk.dim(`On-demand agents: ${Array.from(orgChart.agents.keys()).filter(id => !config.persistentAgentIds.includes(id)).join(', ') || 'none'}`));

    // Keep the process alive
    const shutdown = async (signal: string) => {
      console.log(chalk.yellow(`\nReceived ${signal}. Shutting down gracefully...`));
      await orchestrator.stop();
      console.log(chalk.green('Hive stopped.'));
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  });

program
  .command('stop')
  .description('Graceful shutdown')
  .action(async () => {
    const dataDir = getDataDir();
    const { PidFile } = await import('./orchestrator/pid-file.js');

    const pidFile = new PidFile(path.join(dataDir, 'hive.pid'));
    const pid = pidFile.read();

    if (!pid) {
      console.log(chalk.yellow('No hive.pid file found. Hive may not be running.'));
      process.exit(0);
    }

    if (!pidFile.isRunning()) {
      console.log(chalk.yellow(`Stale PID file found (PID: ${pid} is dead). Cleaning up.`));
      pidFile.remove();
      process.exit(0);
    }

    console.log(chalk.blue(`Sending SIGTERM to Hive process (PID: ${pid})...`));
    try {
      process.kill(pid, 'SIGTERM');
      console.log(chalk.green('Shutdown signal sent. Hive will stop after completing in-flight work.'));
    } catch (err) {
      console.error(chalk.red(`Failed to send signal: ${err instanceof Error ? err.message : err}`));
      process.exit(1);
    }
  });

program
  .command('chat')
  .description('Send a message to the CEO via #board')
  .argument('<message>', 'Message to send to the CEO')
  .action(async (message: string) => {
    const ctx = await HiveContext.create();
    const gateway = new MessageGateway(ctx.comms, ctx.audit);

    const ceoConfig = ctx.orgChart.root;
    if (!ceoConfig) {
      console.error(chalk.red('No CEO found in org tree.'));
      ctx.close();
      process.exit(1);
    }

    console.log(chalk.dim(`> super-user: ${message}`));
    console.log(chalk.dim('Waiting for CEO response...\n'));

    try {
      const result = await chatAction({
        message,
        gateway,
        provider: ctx.comms,
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
      ctx.close();
    }
  });

program
  .command('observe')
  .description('Watch a channel\'s messages (tail -f style)')
  .argument('<channel>', 'Channel name to observe (without #)')
  .option('-n, --limit <number>', 'Number of recent messages to show', '20')
  .option('-f, --follow', 'Follow new messages in real-time', false)
  .action(async (channel: string, opts: { limit: string; follow: boolean }) => {
    const ctx = await HiveContext.create();
    const gateway = new MessageGateway(ctx.comms, ctx.audit);
    const limit = parseInt(opts.limit, 10);

    console.log(chalk.underline(`\n#${channel}\n`));

    try {
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

      if (opts.follow) {
        console.log(chalk.dim('\n--- following (Ctrl+C to stop) ---\n'));

        const controller = startFollowing(
          channel,
          gateway,
          (formatted) => console.log(formatted),
          1000,
        );

        process.on('SIGINT', () => {
          controller.abort();
          console.log(chalk.dim('\nStopped observing.'));
          ctx.close();
          process.exit(0);
        });

        await new Promise(() => {});
      }
    } catch (err: any) {
      console.error(chalk.red(`Error: ${err.message}`));
    } finally {
      if (!opts.follow) {
        ctx.close();
      }
    }
  });

program
  .command('dashboard')
  .description('Open the Hive dashboard in your browser')
  .option('-p, --port <port>', 'Port number', '3001')
  .option('--no-open', 'Do not auto-open browser')
  .action(async (opts) => {
    const port = parseInt(opts.port, 10);
    const serverScript = path.resolve(
      fileURLToPath(import.meta.url),
      '../../packages/dashboard/src/server/index.ts',
    );

    // Use tsx to run the server TypeScript directly in dev
    const { fork } = await import('child_process');
    const child = fork(serverScript, [], {
      execArgv: ['--import', 'tsx'],
      env: { ...process.env, PORT: String(port) },
      stdio: 'inherit',
    });

    if (opts.open !== false) {
      // Wait briefly for server to start, then open browser
      setTimeout(async () => {
        const { exec } = await import('child_process');
        exec(`open http://localhost:${port}`);
      }, 1500);
    }

    process.on('SIGINT', () => {
      child.kill('SIGTERM');
      process.exit(0);
    });

    await new Promise(() => {}); // Keep alive
  });

program.parse();
