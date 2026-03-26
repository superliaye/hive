/**
 * Agent provisioning: programmatic creation of agents.
 *
 * Handles:
 * 1. Validate inputs (alias unique, manager exists, template exists)
 * 2. Insert into people table (source of truth)
 * 3. Create org/{id}-{alias}/ folder from role template
 * 4. Customize BUREAU.md with reporting relationships
 * 5. Generate IDENTITY.md frontmatter from config.json + provided data
 */
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import type { Person } from '../types.js';
import { resolveSkillsForAgent, copySkillsToAgent } from '../agents/skill-loader.js';
import { checkIdentityFields, checkAgentFiles, checkSkills, checkMcpSettings } from '../validation/org-health.js';

export interface ProvisionInput {
  alias: string;
  name: string;
  roleTemplate: string;
  reportsTo: string;        // alias of manager
  vibe?: string;
  skills?: string[];         // additional skills beyond template defaults
}

export interface ProvisionResult {
  person: Person;
  folder: string;            // e.g., "5-alice"
  dir: string;               // absolute path to agent folder
  warnings: string[];        // post-provisioning verification warnings
}

export interface ProvisionError {
  code: 'ALIAS_EXISTS' | 'MANAGER_NOT_FOUND' | 'TEMPLATE_NOT_FOUND' | 'ORG_DIR_MISSING';
  message: string;
}

/** Known MCP server configurations. */
const MCP_REGISTRY: Record<string, { command: string; args: string[] }> = {
  playwright: { command: 'npx', args: ['@anthropic/mcp-playwright'] },
};

/**
 * Write .claude/settings.json with MCP server config for the agent.
 */
function writeMcpSettings(agentDir: string, mcpNames: string[]): void {
  const mcpServers: Record<string, { command: string; args: string[] }> = {};
  for (const name of mcpNames) {
    const server = MCP_REGISTRY[name];
    if (server) mcpServers[name] = server;
  }
  if (Object.keys(mcpServers).length === 0) return;

  const claudeDir = path.join(agentDir, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });
  const settingsPath = path.join(claudeDir, 'settings.json');

  // Merge with existing settings if present
  let settings: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  }
  settings.mcpServers = { ...(settings.mcpServers as Record<string, unknown> ?? {}), ...mcpServers };
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
}

/**
 * Validate provisioning inputs without side effects.
 * Returns null if valid, or an error describing the problem.
 */
export function validateProvision(
  input: ProvisionInput,
  db: Database.Database,
  templateDir: string,
): ProvisionError | null {
  // Check alias doesn't already exist
  const existing = db.prepare('SELECT id FROM people WHERE alias = ?').get(input.alias);
  if (existing) {
    return { code: 'ALIAS_EXISTS', message: `Alias "${input.alias}" already exists in people table` };
  }

  // Check manager exists
  const manager = db.prepare('SELECT id FROM people WHERE alias = ?').get(input.reportsTo);
  if (!manager) {
    return { code: 'MANAGER_NOT_FOUND', message: `Manager "@${input.reportsTo}" not found in people table` };
  }

  // Check template exists
  const tmplPath = path.join(templateDir, input.roleTemplate);
  if (!fs.existsSync(tmplPath) || !fs.existsSync(path.join(tmplPath, 'IDENTITY.md'))) {
    return { code: 'TEMPLATE_NOT_FOUND', message: `Role template "${input.roleTemplate}" not found in ${templateDir}` };
  }

  return null;
}

/**
 * Provision a new agent:
 * 1. Insert into people table → get assigned ID
 * 2. Create org/{id}-{alias}/ from template
 * 3. Customize files with agent-specific data
 */
export function provision(
  input: ProvisionInput,
  db: Database.Database,
  orgDir: string,
  templateDir: string,
): ProvisionResult {
  // Validate first
  const error = validateProvision(input, db, templateDir);
  if (error) {
    throw new Error(`${error.code}: ${error.message}`);
  }

  // 1. Insert into people table
  const manager = db.prepare('SELECT id, alias, name FROM people WHERE alias = ?').get(input.reportsTo) as { id: number; alias: string; name: string };

  const result = db.prepare(`
    INSERT INTO people (alias, name, role_template, status, folder, reports_to)
    VALUES (?, ?, ?, 'active', NULL, ?)
  `).run(input.alias, input.name, input.roleTemplate, manager.id);

  const personId = result.lastInsertRowid as number;
  const folder = `${personId}-${input.alias}`;

  // Update folder field now that we have the ID
  db.prepare('UPDATE people SET folder = ? WHERE id = ?').run(folder, personId);

  // 2. Create directory from template
  const agentDir = path.join(orgDir, folder);
  const tmplDir = path.join(templateDir, input.roleTemplate);

  if (fs.existsSync(agentDir)) {
    throw new Error(`Directory already exists: ${agentDir}`);
  }

  fs.mkdirSync(agentDir, { recursive: true });

  // Copy template files (skip config.json — that's gateway-only)
  const templateFiles = ['IDENTITY.md', 'SOUL.md', 'BUREAU.md', 'PRIORITIES.md', 'MEMORY.md'];
  for (const file of templateFiles) {
    const src = path.join(tmplDir, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(agentDir, file));
    }
  }

  // 3. Generate IDENTITY.md frontmatter
  // Read config.json for model/emoji/skills defaults
  let config: { name?: string; model?: string; emoji?: string; skills?: string[]; mcp?: string[] } = {};
  const configPath = path.join(tmplDir, 'config.json');
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  }

  const skills = input.skills ?? config.skills ?? ['hive-comms'];
  if (!skills.includes('hive-comms')) skills.unshift('hive-comms');

  const templateBody = fs.existsSync(path.join(agentDir, 'IDENTITY.md'))
    ? fs.readFileSync(path.join(agentDir, 'IDENTITY.md'), 'utf-8')
    : '';

  const frontmatter = [
    '---',
    `id: ${personId}`,
    `alias: ${input.alias}`,
    `name: ${input.name}`,
    `role: ${config.name ?? input.roleTemplate}`,
    `title:`,
    `model: ${config.model ?? 'claude-opus-4-6'}`,
    config.emoji ? `emoji: "${config.emoji}"` : null,
    input.vibe ? `vibe: "${input.vibe}"` : null,
    `skills: [${skills.join(', ')}]`,
    '---',
    '',
  ].filter(Boolean).join('\n');

  fs.writeFileSync(path.join(agentDir, 'IDENTITY.md'), frontmatter + templateBody);

  // 4. Customize BUREAU.md with reporting
  const directReports = db.prepare(
    'SELECT alias FROM people WHERE reports_to = ? AND status = ?'
  ).all(personId, 'active') as { alias: string }[];

  const managerReports = db.prepare(
    'SELECT alias FROM people WHERE reports_to = ? AND status = ? AND id != ?'
  ).all(manager.id, 'active', personId) as { alias: string }[];

  const bureauPath = path.join(agentDir, 'BUREAU.md');
  let bureau = fs.existsSync(bureauPath)
    ? fs.readFileSync(bureauPath, 'utf-8')
    : '## Reporting\n\nReports to: \nDirect reports: none\n';

  // Replace reporting placeholders
  bureau = bureau.replace(
    /Reports to:.*$/m,
    `Reports to: @${manager.alias} (${manager.name})`
  );
  bureau = bureau.replace(
    /Direct reports:.*$/m,
    directReports.length > 0
      ? `Direct reports: ${directReports.map(r => `@${r.alias}`).join(', ')}`
      : 'Direct reports: none'
  );

  fs.writeFileSync(bureauPath, bureau);

  // 5. Update manager's BUREAU.md to include new direct report
  const managerFolder = db.prepare('SELECT folder FROM people WHERE id = ?').get(manager.id) as { folder: string } | undefined;
  if (managerFolder?.folder) {
    const managerBureauPath = path.join(orgDir, managerFolder.folder, 'BUREAU.md');
    if (fs.existsSync(managerBureauPath)) {
      let managerBureau = fs.readFileSync(managerBureauPath, 'utf-8');
      const allManagerReports = db.prepare(
        'SELECT alias FROM people WHERE reports_to = ? AND status = ?'
      ).all(manager.id, 'active') as { alias: string }[];

      const reportsLine = allManagerReports.length > 0
        ? `Direct reports: ${allManagerReports.map(r => `@${r.alias}`).join(', ')}`
        : 'Direct reports: none';

      managerBureau = managerBureau.replace(/Direct reports:.*$/m, reportsLine);
      fs.writeFileSync(managerBureauPath, managerBureau);
    }
  }

  // 6. Copy skills from role-skills/ to agent's .claude/skills/
  const roleSkillsDir = path.resolve(orgDir, '..', 'role-skills');
  if (fs.existsSync(roleSkillsDir)) {
    const resolved = resolveSkillsForAgent(roleSkillsDir, skills);
    if (resolved.skills.length > 0) {
      const agentClaudeDir = path.join(agentDir, '.claude');
      copySkillsToAgent(resolved, agentClaudeDir);
    }
  }

  // 7. Write MCP settings if config declares MCP servers
  if (config.mcp && config.mcp.length > 0) {
    writeMcpSettings(agentDir, config.mcp);
  }

  const person: Person = {
    id: personId,
    alias: input.alias,
    name: input.name,
    roleTemplate: input.roleTemplate,
    status: 'active',
    folder,
    reportsTo: manager.id,
  };

  // 8. Post-provisioning verification
  const warnings: string[] = [];
  const identityIssues = checkIdentityFields(agentDir, input.alias);
  const fileIssues = checkAgentFiles(agentDir, input.alias);
  const roleSkillsDirResolved = path.resolve(orgDir, '..', 'role-skills');
  const skillIssues = fs.existsSync(roleSkillsDirResolved)
    ? checkSkills(agentDir, input.alias, skills, roleSkillsDirResolved)
    : [];
  const mcpIssues = config.mcp?.length
    ? checkMcpSettings(agentDir, input.alias, config.mcp)
    : [];

  for (const issue of [...identityIssues, ...fileIssues, ...skillIssues, ...mcpIssues]) {
    warnings.push(`[${issue.code}] ${issue.message}`);
  }

  return { person, folder, dir: agentDir, warnings };
}
