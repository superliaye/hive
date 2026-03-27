import { Command } from 'commander';
import { parseOrgFlat } from './org/parser.js';
import { scaffold } from './org/scaffold.js';
import { provision, validateProvision } from './org/provision.js';
import { HiveContext } from './context.js';
import { ChatDb } from './chat/db.js';
import { ChannelStore } from './chat/channels.js';
import { MessageStore } from './chat/messages.js';
import { CursorStore } from './chat/cursors.js';
import { SearchEngine } from './chat/search.js';
import { AccessControl } from './chat/access.js';
import { ChatAdapter } from './chat/adapter.js';
import { buildChatCommand } from './chat/cli.js';
import { MemoryManager } from './memory/manager.js';
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
      // Build tree: find roots (people with no reportsTo or reportsTo not in agents)
      const agentList = Array.from(orgChart.agents.values());
      const roots = agentList.filter(a => !a.reportsTo);

      function printAgent(agent: typeof agentList[0], indent: number): void {
        const prefix = '  '.repeat(indent);
        const emoji = agent.identity.emoji ?? '🔹';
        console.log(`${prefix}${emoji} ${chalk.bold(agent.identity.name)} (${agent.identity.role}) [${agent.person.alias}]`);
        // Find direct reports
        const reports = agentList.filter(a => a.reportsTo?.id === agent.person.id);
        for (const report of reports) {
          printAgent(report, indent + 1);
        }
      }
      console.log(chalk.underline('\nOrg Chart:\n'));
      for (const root of roots) {
        printAgent(root, 0);
      }
      console.log(`\n${chalk.dim(`${orgChart.agents.size} agents`)}\n`);
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
      for (const [alias] of ctx.orgChart.agents) {
        ctx.state.register(alias);
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
  .option('--timezone <tz>', 'Organization timezone', 'America/Los_Angeles')
  .option('--template <name>', 'Org template to use (e.g., "software-startup")')
  .action(async (opts) => {
    const targetDir = process.cwd();
    const orgDir = path.join(targetDir, 'org');

    if (fs.existsSync(orgDir)) {
      console.error(chalk.red('org/ directory already exists. Cannot re-initialize.'));
      process.exit(1);
    }

    if (opts.template) {
      const { scaffoldFromManifest } = await import('./org/scaffold.js');

      try {
        const result = scaffoldFromManifest({
          targetDir,
          mission: opts.mission,
          timezone: opts.timezone,
          templateName: opts.template,
        });

        console.log(chalk.green(`✔ Organization bootstrapped from template "${opts.template}"!\n`));
        console.log(`  ${chalk.bold('Mission:')} ${opts.mission}`);
        console.log(`  ${chalk.bold('Agents:')} ${result.agentsCreated.length}`);
        for (const alias of result.agentsCreated) {
          console.log(`    - @${alias}`);
        }

        if (result.warnings.length > 0) {
          console.log('');
          for (const w of result.warnings) {
            console.log(chalk.yellow(`  ⚠ ${w}`));
          }
        }

        console.log(`\n  ${chalk.dim('Next: hive start')}`);
      } catch (err) {
        console.error(chalk.red(`Failed: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
    } else {
      const result = scaffold({
        targetDir,
        mission: opts.mission,
        timezone: opts.timezone,
      });

      console.log(chalk.green('✔ Organization bootstrapped!\n'));
      console.log(`  ${chalk.bold('Mission:')} ${opts.mission}`);
      console.log(`  ${chalk.bold('Agents:')} ${result.agentsCreated.join(', ')}`);
      console.log(`\n  ${chalk.dim('Next: hive start')}`);
    }
  });

// ── Agent management ──
const agent = program.command('agent').description('Manage agents');

agent
  .command('create')
  .description('Create a new agent from a role template')
  .requiredOption('--alias <alias>', 'Unique alias (e.g., "alice")')
  .requiredOption('--name <name>', 'Display name (e.g., "Alice Park")')
  .requiredOption('--template <template>', 'Role template (e.g., "software-engineer")')
  .requiredOption('--reports-to <alias>', 'Manager alias (e.g., "ceo")')
  .option('--vibe <vibe>', 'Personality vibe (1-2 sentences)')
  .option('--skills <skills>', 'Additional skills (comma-separated)')
  .action(async (opts) => {
    const orgDir = getOrgDir();
    const dataDir = getDataDir();
    const templateDir = path.resolve(process.cwd(), 'role-templates');

    if (!fs.existsSync(templateDir)) {
      console.error(chalk.red('No role-templates/ directory found.'));
      process.exit(1);
    }

    const chatDb = new ChatDb(path.join(dataDir, 'hive.db'));
    const db = chatDb.raw();

    try {
      // Validate
      const input = {
        alias: opts.alias,
        name: opts.name,
        roleTemplate: opts.template,
        reportsTo: opts.reportsTo,
        vibe: opts.vibe,
        skills: opts.skills ? opts.skills.split(',').map((s: string) => s.trim()) : undefined,
      };

      const error = validateProvision(input, db, templateDir);
      if (error) {
        console.error(chalk.red(`Validation failed: ${error.message}`));
        process.exit(1);
      }

      // Create
      const result = provision(input, db, orgDir, templateDir);

      console.log(chalk.green(`✔ Agent created!\n`));
      console.log(`  ${chalk.bold('Alias:')} @${result.person.alias}`);
      console.log(`  ${chalk.bold('ID:')} ${result.person.id}`);
      console.log(`  ${chalk.bold('Folder:')} org/${result.folder}/`);
      console.log(`  ${chalk.bold('Template:')} ${opts.template}`);
      console.log(`  ${chalk.bold('Reports to:')} @${opts.reportsTo}`);
      console.log(`  ${chalk.bold('Dir:')} ${result.dir}`);

      if (result.warnings.length > 0) {
        console.log('');
        for (const w of result.warnings) {
          console.log(chalk.yellow(`  ⚠ ${w}`));
        }
      }
    } finally {
      chatDb.close();
    }
  });

agent
  .command('list')
  .description('List all agents from the people table')
  .action(async () => {
    const dataDir = getDataDir();
    const chatDb = new ChatDb(path.join(dataDir, 'hive.db'));
    const db = chatDb.raw();

    try {
      const people = db.prepare(
        'SELECT id, alias, name, role_template, status, folder, reports_to FROM people WHERE id > 0 ORDER BY id'
      ).all() as { id: number; alias: string; name: string; role_template: string | null; status: string; folder: string | null; reports_to: number | null }[];

      if (people.length === 0) {
        console.log(chalk.dim('No agents found. Run `hive init` first.'));
        return;
      }

      console.log(chalk.underline('\nAgents:\n'));
      for (const p of people) {
        const statusColor = p.status === 'active' ? chalk.green : chalk.dim;
        const manager = p.reports_to
          ? (db.prepare('SELECT alias FROM people WHERE id = ?').get(p.reports_to) as { alias: string } | undefined)?.alias ?? '?'
          : '-';
        console.log(`  ${chalk.bold(`@${p.alias}`)} (${p.name}) ${statusColor(p.status)} → @${manager}  ${chalk.dim(p.folder ?? '')}`);
      }
      console.log();
    } finally {
      chatDb.close();
    }
  });

program
  .command('start')
  .description('Wake the organization')
  .option('--tick-interval <ms>', 'Tick interval for periodic agent checks (ms)', '600000')
  .action(async (opts) => {
    const orgDir = getOrgDir();
    const dataDir = getDataDir();
    const { Daemon } = await import('./daemon/daemon.js');
    const { AgentStateStore } = await import('./state/agent-state.js');
    const { AuditStore } = await import('./audit/store.js');
    const { PidFile } = await import('./orchestrator/pid-file.js');

    // Check if already running
    const pidFile = new PidFile(path.join(dataDir, 'hive.pid'));
    if (pidFile.isRunning()) {
      console.error(chalk.red(`Hive is already running (PID: ${pidFile.read()}). Use \`hive stop\` first.`));
      process.exit(1);
    }

    console.log(chalk.blue('Parsing org...'));
    const chatDb = new ChatDb(path.join(dataDir, 'hive.db'));
    const people = HiveContext.loadPeople(chatDb);
    const orgChart = await parseOrgFlat(orgDir, people);
    console.log(chalk.dim(`Found ${orgChart.agents.size} agents`));

    // Health check before starting
    const { runFullScan: healthScan } = await import('./validation/org-health.js');
    const roleSkillsDir = path.resolve(process.cwd(), 'role-skills');
    const healthIssues = healthScan({ orgDir, db: chatDb.raw(), roleSkillsDir });
    const healthErrors = healthIssues.filter(i => i.severity === 'error');
    if (healthErrors.length > 0) {
      console.error(chalk.red(`\n✖ ${healthErrors.length} health error(s) — refusing to start:\n`));
      for (const issue of healthErrors) {
        console.error(chalk.red(`  [${issue.code}] ${issue.message}`));
      }
      console.error(chalk.dim('\nRun `hive doctor --fix` to attempt auto-repair, or fix manually.'));
      chatDb.close();
      process.exit(1);
    }
    const healthWarnings = healthIssues.filter(i => i.severity === 'warning');
    if (healthWarnings.length > 0) {
      console.log(chalk.yellow(`⚠ ${healthWarnings.length} warning(s) — starting anyway:`));
      for (const w of healthWarnings) {
        console.log(chalk.yellow(`  [${w.code}] ${w.message}`));
      }
      console.log('');
    }

    // Wire chat stores and adapter
    const channelStore = new ChannelStore(chatDb);
    const messageStore = new MessageStore(chatDb);
    const cursorStore = new CursorStore(chatDb);
    const chatAdapter = new ChatAdapter(chatDb, channelStore, messageStore, cursorStore);
    const stateStore = new AgentStateStore(path.join(dataDir, 'orchestrator.db'));
    const auditStore = new AuditStore(path.join(dataDir, 'audit.db'));

    const memoryManager = new MemoryManager(dataDir);

    const daemon = new Daemon({
      orgChart,
      chatAdapter,
      audit: auditStore,
      state: stateStore,
      memory: memoryManager,
      dataDir,
      orgDir,
      pidFilePath: path.join(dataDir, 'hive.pid'),
      tickIntervalMs: parseInt(opts.tickInterval, 10),
    });

    await daemon.start();

    console.log(chalk.green(`Hive daemon started (PID: ${process.pid})`));
    console.log(chalk.dim(`Agents: ${Array.from(orgChart.agents.keys()).join(', ')}`));
    console.log(chalk.dim(`Tick interval: ${opts.tickInterval}ms`));

    // Keep the process alive
    const shutdown = async (signal: string) => {
      console.log(chalk.yellow(`\nReceived ${signal}. Shutting down gracefully...`));
      await daemon.stop();
      stateStore.close();
      auditStore.close();
      chatDb.close();
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

// Wire the new hive chat subcommand tree (send, inbox, ack, history, search, group)
{
  const dataDir = getDataDir();
  const chatDb = new ChatDb(path.join(dataDir, 'hive.db'));
  const channels = new ChannelStore(chatDb);
  const messages = new MessageStore(chatDb);
  const cursors = new CursorStore(chatDb);
  const search = new SearchEngine(chatDb);
  const access = new AccessControl(chatDb);
  program.addCommand(buildChatCommand({ db: chatDb, channels, messages, cursors, search, access }));
}

program
  .command('memory')
  .description('Search or index agent memory')
  .argument('<action>', 'Action: search, index, status')
  .argument('[agent-id]', 'Agent ID (required for search)')
  .argument('[query...]', 'Search query')
  .option('-n, --limit <number>', 'Max results', '5')
  .action(async (action: string, agentId: string | undefined, queryParts: string[], opts: { limit: string }) => {
    const ctx = await HiveContext.create();
    try {
      if (action === 'index') {
        console.log(chalk.blue('Indexing all agent memories...'));
        await ctx.memory.indexAll(ctx.orgChart.agents, msg => console.log(chalk.dim(msg)));
        console.log(chalk.green('Done.'));
      } else if (action === 'search') {
        if (!agentId) { console.error(chalk.red('Agent ID required')); process.exit(1); }
        const query = queryParts.join(' ');
        if (!query) { console.error(chalk.red('Query required')); process.exit(1); }
        const results = await ctx.memory.search(agentId, query, parseInt(opts.limit, 10));
        if (results.length === 0) {
          console.log(chalk.dim('No results. Run `hive memory index` first.'));
        }
        for (const r of results) {
          console.log(chalk.cyan(`[${r.score.toFixed(3)}] ${path.basename(r.path)}:${r.startLine}`));
          console.log(r.text.slice(0, 200));
          console.log();
        }
      } else if (action === 'status') {
        for (const [alias] of ctx.orgChart.agents) {
          const store = ctx.memory.getStore(alias);
          const count = store.chunkCount();
          const files = store.indexedFiles().length;
          console.log(`${chalk.bold(alias)}: ${count} chunks, ${files} files indexed`);
        }
      } else {
        console.error(chalk.red(`Unknown action: ${action}. Use: search, index, status`));
      }
    } finally {
      ctx.close();
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

// ── Doctor ──

program
  .command('doctor')
  .description('Run health checks on the organization')
  .option('--fix', 'Attempt to auto-fix fixable issues')
  .action(async (opts) => {
    const orgDir = getOrgDir();
    const dataDir = getDataDir();
    const roleSkillsDir = path.resolve(process.cwd(), 'role-skills');

    const chatDb = new ChatDb(path.join(dataDir, 'hive.db'));
    const { runFullScan, autoFix } = await import('./validation/org-health.js');

    console.log(chalk.blue('Running org health checks...\n'));
    const issues = runFullScan({ orgDir, db: chatDb.raw(), roleSkillsDir });

    if (issues.length === 0) {
      console.log(chalk.green('✔ Org is healthy — no issues found.'));
      chatDb.close();
      return;
    }

    const errors = issues.filter(i => i.severity === 'error');
    const warnings = issues.filter(i => i.severity === 'warning');

    if (errors.length > 0) {
      console.log(chalk.red(`✖ ${errors.length} error(s):`));
      for (const issue of errors) {
        console.log(chalk.red(`  [${issue.code}] ${issue.message}`));
      }
    }
    if (warnings.length > 0) {
      console.log(chalk.yellow(`⚠ ${warnings.length} warning(s):`));
      for (const issue of warnings) {
        console.log(chalk.yellow(`  [${issue.code}] ${issue.message}`));
      }
    }

    const fixable = issues.filter(i => i.autoFixable);
    if (fixable.length > 0 && !opts.fix) {
      console.log(chalk.dim(`\n${fixable.length} issue(s) can be auto-fixed. Run \`hive doctor --fix\` to apply.`));
    }

    if (opts.fix && fixable.length > 0) {
      console.log(chalk.blue('\nApplying auto-fixes...'));

      // Build MCP config lookup
      const mcpFromConfig: Record<string, string[]> = {};
      const people = chatDb.raw().prepare('SELECT alias, role_template FROM people WHERE status = ?').all('active') as { alias: string; role_template: string | null }[];
      for (const p of people) {
        if (!p.role_template) continue;
        const configPath = path.join(process.cwd(), 'role-templates', p.role_template, 'config.json');
        if (fs.existsSync(configPath)) {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          if (config.mcp) mcpFromConfig[p.alias] = config.mcp;
        }
      }

      const fixResult = autoFix(fixable, { orgDir, roleSkillsDir, mcpFromConfig });
      console.log(chalk.green(`  ✔ ${fixResult.fixed} fixed`));
      if (fixResult.skipped > 0) {
        console.log(chalk.yellow(`  ⚠ ${fixResult.skipped} skipped`));
      }
      for (const detail of fixResult.details) {
        console.log(chalk.dim(`  ${detail}`));
      }
    }

    chatDb.close();

    if (errors.length > 0) {
      process.exit(1);
    }
  });

program.parse();
