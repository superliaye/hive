import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import Database from 'better-sqlite3';
import type { Person } from '../types.js';
import type { HealthIssue } from './types.js';

const FOLDER_PATTERN = /^(\d+)-(.+)$/;
const REQUIRED_IDENTITY_FIELDS = ['id', 'alias', 'name', 'role'] as const;
const EXPECTED_AGENT_FILES = ['IDENTITY.md', 'SOUL.md', 'BUREAU.md', 'PRIORITIES.md', 'MEMORY.md'];
const KNOWN_MCP_SERVERS = ['playwright'];

// ── Identity checks ──

/**
 * Check that every DB person has a folder and every folder has a DB entry.
 */
export function checkFolderDbSync(orgDir: string, people: Person[]): HealthIssue[] {
  const issues: HealthIssue[] = [];

  for (const person of people) {
    if (!person.folder) continue;
    const agentDir = path.join(orgDir, person.folder);
    if (!fs.existsSync(agentDir)) {
      issues.push({
        severity: 'error',
        code: 'MISSING_FOLDER',
        agent: person.alias,
        message: `Agent @${person.alias} has DB entry but no folder at org/${person.folder}`,
        autoFixable: false,
      });
    }
  }

  const dbFolders = new Set(people.map(p => p.folder).filter(Boolean));
  const entries = fs.readdirSync(orgDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!FOLDER_PATTERN.test(entry.name)) continue;
    if (!dbFolders.has(entry.name)) {
      const match = entry.name.match(FOLDER_PATTERN);
      issues.push({
        severity: 'warning',
        code: 'ORPHANED_FOLDER',
        agent: match?.[2],
        message: `Folder org/${entry.name} exists but has no matching DB entry`,
        autoFixable: false,
      });
    }
  }

  return issues;
}

/**
 * Check that IDENTITY.md exists and has all required frontmatter fields.
 */
export function checkIdentityFields(agentDir: string, alias: string): HealthIssue[] {
  const issues: HealthIssue[] = [];
  const identityPath = path.join(agentDir, 'IDENTITY.md');

  if (!fs.existsSync(identityPath)) {
    issues.push({
      severity: 'error',
      code: 'MISSING_AGENT_FILE',
      agent: alias,
      message: `IDENTITY.md missing for @${alias}`,
      autoFixable: false,
    });
    return issues;
  }

  const content = fs.readFileSync(identityPath, 'utf-8');
  let data: Record<string, unknown>;
  try {
    const parsed = matter(content);
    data = parsed.data;
    if (!data || Object.keys(data).length === 0) {
      issues.push({
        severity: 'error',
        code: 'IDENTITY_PARSE_ERROR',
        agent: alias,
        message: `IDENTITY.md for @${alias} has no frontmatter`,
        autoFixable: false,
      });
      return issues;
    }
  } catch {
    issues.push({
      severity: 'error',
      code: 'IDENTITY_PARSE_ERROR',
      agent: alias,
      message: `IDENTITY.md for @${alias} has unparseable frontmatter`,
      autoFixable: false,
    });
    return issues;
  }

  for (const field of REQUIRED_IDENTITY_FIELDS) {
    if (data[field] === undefined || data[field] === null || data[field] === '') {
      issues.push({
        severity: 'error',
        code: 'IDENTITY_FIELD_MISSING',
        agent: alias,
        message: `IDENTITY.md for @${alias} missing required field: ${field}`,
        autoFixable: false,
      });
    }
  }

  return issues;
}

/**
 * Check that IDENTITY.md frontmatter matches the people DB record.
 */
export function checkIdentityDbMatch(agentDir: string, person: Person): HealthIssue[] {
  const issues: HealthIssue[] = [];
  const identityPath = path.join(agentDir, 'IDENTITY.md');

  if (!fs.existsSync(identityPath)) return issues;

  let data: Record<string, unknown>;
  try {
    const parsed = matter(fs.readFileSync(identityPath, 'utf-8'));
    data = parsed.data;
  } catch {
    return issues;
  }

  const checks: Array<{ field: string; file: unknown; db: unknown }> = [
    { field: 'id', file: data.id, db: person.id },
    { field: 'alias', file: data.alias, db: person.alias },
    { field: 'name', file: data.name, db: person.name },
  ];

  for (const check of checks) {
    if (check.file !== undefined && String(check.file) !== String(check.db)) {
      issues.push({
        severity: 'error',
        code: 'IDENTITY_DB_MISMATCH',
        agent: person.alias,
        message: `@${person.alias} frontmatter ${check.field}="${check.file}" doesn't match DB "${check.db}"`,
        autoFixable: true,
      });
    }
  }

  return issues;
}

// ── Structural checks ──

/**
 * Check that all expected agent files exist.
 */
export function checkAgentFiles(agentDir: string, alias: string): HealthIssue[] {
  const issues: HealthIssue[] = [];
  for (const file of EXPECTED_AGENT_FILES) {
    if (!fs.existsSync(path.join(agentDir, file))) {
      issues.push({
        severity: file === 'IDENTITY.md' ? 'error' : 'warning',
        code: 'MISSING_AGENT_FILE',
        agent: alias,
        message: `${file} missing for @${alias}`,
        autoFixable: false,
      });
    }
  }
  return issues;
}

/**
 * Check the reporting chain for dangling references and cycles.
 */
export function checkReportingChain(people: Person[]): HealthIssue[] {
  const issues: HealthIssue[] = [];
  const byId = new Map(people.map(p => [p.id, p]));

  for (const person of people) {
    if (person.reportsTo === undefined || person.reportsTo === null) continue;
    if (!byId.has(person.reportsTo)) {
      issues.push({
        severity: 'error',
        code: 'DANGLING_MANAGER',
        agent: person.alias,
        message: `@${person.alias} reports to person ID ${person.reportsTo} which doesn't exist`,
        autoFixable: false,
      });
    }
  }

  // Cycle detection
  const reported = new Set<string>();
  for (const person of people) {
    const visited = new Set<number>();
    let current: Person | undefined = person;
    while (current && current.reportsTo !== undefined && current.reportsTo !== null) {
      if (visited.has(current.id)) {
        const key = `cycle-${[...visited].sort().join(',')}`;
        if (!reported.has(key)) {
          reported.add(key);
          issues.push({
            severity: 'error',
            code: 'CIRCULAR_REPORTING',
            agent: person.alias,
            message: `Circular reporting chain detected involving @${person.alias}`,
            autoFixable: false,
          });
        }
        break;
      }
      visited.add(current.id);
      current = byId.get(current.reportsTo);
    }
  }

  return issues;
}

// ── Skill/MCP checks ──

/**
 * Check that declared skills exist in role-skills/ and are copied to agent.
 */
export function checkSkills(
  agentDir: string,
  alias: string,
  declaredSkills: string[],
  roleSkillsDir: string,
): HealthIssue[] {
  const issues: HealthIssue[] = [];

  for (const skill of declaredSkills) {
    const sourceDir = path.join(roleSkillsDir, skill);
    if (!fs.existsSync(sourceDir)) {
      issues.push({
        severity: 'warning',
        code: 'SKILL_NOT_FOUND',
        agent: alias,
        message: `Skill "${skill}" declared for @${alias} but not found in role-skills/`,
        autoFixable: false,
      });
      continue;
    }

    const agentSkillDir = path.join(agentDir, '.claude', 'skills', skill);
    if (!fs.existsSync(agentSkillDir)) {
      issues.push({
        severity: 'warning',
        code: 'SKILL_NOT_COPIED',
        agent: alias,
        message: `Skill "${skill}" exists in role-skills/ but not copied to @${alias}`,
        autoFixable: true,
      });
    }
  }

  return issues;
}

/**
 * Check that MCP settings are properly configured for the agent.
 */
export function checkMcpSettings(
  agentDir: string,
  alias: string,
  declaredMcp: string[],
): HealthIssue[] {
  const issues: HealthIssue[] = [];

  for (const mcp of declaredMcp) {
    if (!KNOWN_MCP_SERVERS.includes(mcp)) {
      issues.push({
        severity: 'warning',
        code: 'MCP_UNKNOWN',
        agent: alias,
        message: `MCP server "${mcp}" declared for @${alias} is not in the known registry`,
        autoFixable: false,
      });
    }
  }

  const knownDeclared = declaredMcp.filter(m => KNOWN_MCP_SERVERS.includes(m));
  if (knownDeclared.length > 0) {
    const settingsPath = path.join(agentDir, '.claude', 'settings.json');
    if (!fs.existsSync(settingsPath)) {
      issues.push({
        severity: 'warning',
        code: 'MCP_SETTINGS_MISSING',
        agent: alias,
        message: `@${alias} declares MCP servers [${knownDeclared.join(', ')}] but has no .claude/settings.json`,
        autoFixable: true,
      });
    }
  }

  return issues;
}

// ── Full scan ──

export interface ScanOptions {
  orgDir: string;
  db: Database.Database;
  roleSkillsDir: string;
}

/**
 * Run all validation checks across the entire org.
 */
export function runFullScan(opts: ScanOptions): HealthIssue[] {
  const { orgDir, db, roleSkillsDir } = opts;
  const issues: HealthIssue[] = [];

  const rows = db.prepare(
    'SELECT id, alias, name, role_template, status, folder, reports_to FROM people WHERE status = ?'
  ).all('active') as Array<{
    id: number; alias: string; name: string; role_template: string | null;
    status: string; folder: string | null; reports_to: number | null;
  }>;

  const personList: Person[] = rows.map(r => ({
    id: r.id,
    alias: r.alias,
    name: r.name,
    roleTemplate: r.role_template ?? undefined,
    status: r.status as 'active',
    folder: r.folder ?? undefined,
    reportsTo: r.reports_to ?? undefined,
  }));

  issues.push(...checkFolderDbSync(orgDir, personList));
  issues.push(...checkReportingChain(personList));

  for (const person of personList) {
    if (!person.folder) continue;
    const agentDir = path.join(orgDir, person.folder);
    if (!fs.existsSync(agentDir)) continue;

    issues.push(...checkAgentFiles(agentDir, person.alias));
    issues.push(...checkIdentityFields(agentDir, person.alias));
    issues.push(...checkIdentityDbMatch(agentDir, person));

    // Read skills from frontmatter
    const identityPath = path.join(agentDir, 'IDENTITY.md');
    if (fs.existsSync(identityPath)) {
      try {
        const { data } = matter(fs.readFileSync(identityPath, 'utf-8'));
        const skills: string[] = data.skills ?? [];
        issues.push(...checkSkills(agentDir, person.alias, skills, roleSkillsDir));

        // MCP from role template config
        if (person.roleTemplate) {
          const configPath = path.join(roleSkillsDir, '..', 'role-templates', person.roleTemplate, 'config.json');
          if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            if (config.mcp?.length > 0) {
              issues.push(...checkMcpSettings(agentDir, person.alias, config.mcp));
            }
          }
        }
      } catch { /* caught by earlier checks */ }
    }
  }

  const severityOrder: Record<string, number> = { error: 0, warning: 1, info: 2 };
  issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return issues;
}

// ── Auto-fix ──

const MCP_REGISTRY: Record<string, { command: string; args: string[] }> = {
  playwright: { command: 'npx', args: ['@anthropic/mcp-playwright'] },
};

export interface AutoFixOptions {
  orgDir: string;
  roleSkillsDir: string;
  mcpFromConfig?: Record<string, string[]>;
}

export interface AutoFixResult {
  fixed: number;
  skipped: number;
  details: string[];
}

/** Find agent directory by alias. */
function findAgentDir(orgDir: string, alias: string): string | null {
  const entries = fs.readdirSync(orgDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const match = entry.name.match(FOLDER_PATTERN);
    if (match && match[2] === alias) {
      return path.join(orgDir, entry.name);
    }
  }
  return null;
}

/**
 * Attempt to auto-fix all fixable issues.
 */
export function autoFix(issues: HealthIssue[], opts: AutoFixOptions): AutoFixResult {
  const result: AutoFixResult = { fixed: 0, skipped: 0, details: [] };

  for (const issue of issues) {
    if (!issue.autoFixable) {
      result.skipped++;
      continue;
    }

    try {
      switch (issue.code) {
        case 'SKILL_NOT_COPIED': {
          if (!issue.agent) break;
          const skillMatch = issue.message.match(/Skill "([^"]+)"/);
          if (!skillMatch) break;
          const skillName = skillMatch[1];
          const sourceDir = path.join(opts.roleSkillsDir, skillName);
          const agentDir = findAgentDir(opts.orgDir, issue.agent);
          if (!agentDir || !fs.existsSync(sourceDir)) break;

          const targetDir = path.join(agentDir, '.claude', 'skills', skillName);
          fs.mkdirSync(path.dirname(targetDir), { recursive: true });
          fs.cpSync(sourceDir, targetDir, { recursive: true });
          result.fixed++;
          result.details.push(`Copied skill "${skillName}" to @${issue.agent}`);
          break;
        }

        case 'MCP_SETTINGS_MISSING': {
          if (!issue.agent) break;
          const agentDir = findAgentDir(opts.orgDir, issue.agent);
          if (!agentDir) break;
          const mcpNames = opts.mcpFromConfig?.[issue.agent] ?? [];
          const mcpServers: Record<string, { command: string; args: string[] }> = {};
          for (const name of mcpNames) {
            if (MCP_REGISTRY[name]) mcpServers[name] = MCP_REGISTRY[name];
          }
          if (Object.keys(mcpServers).length === 0) break;

          const claudeDir = path.join(agentDir, '.claude');
          fs.mkdirSync(claudeDir, { recursive: true });
          fs.writeFileSync(
            path.join(claudeDir, 'settings.json'),
            JSON.stringify({ mcpServers }, null, 2) + '\n',
          );
          result.fixed++;
          result.details.push(`Wrote MCP settings for @${issue.agent}`);
          break;
        }

        default:
          result.skipped++;
      }
    } catch (err) {
      result.details.push(`Failed to fix ${issue.code} for @${issue.agent}: ${err instanceof Error ? err.message : String(err)}`);
      result.skipped++;
    }
  }

  return result;
}
