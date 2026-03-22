import { Command } from 'commander';
import { parseOrgTree } from './org/parser.js';
import { AgentStateStore } from './state/agent-state.js';
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

program.parse();
