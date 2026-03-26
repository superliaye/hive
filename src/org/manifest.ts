/**
 * Org template manifest: parse, validate, sort, and instantiate.
 */
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { provision } from './provision.js';

// ── Types ──

export interface ManifestAgent {
  alias: string;
  name: string;
  role: string;           // role-template name (e.g. "software-engineer")
  reports_to: string;     // alias of manager, or "super-user"
  title?: string;
  vibe?: string;
}

export interface OrgManifest {
  name: string;
  description?: string;
  agents: ManifestAgent[];
}

// ── Parsing ──

/**
 * Parse and validate a raw manifest object.
 */
export function parseManifest(raw: {
  name: string;
  description?: string;
  agents: Array<{ alias: string; name: string; role: string; reports_to: string; title?: string; vibe?: string }>;
}): OrgManifest {
  const agents = raw.agents;

  // Check for duplicate aliases
  const aliases = new Set<string>();
  for (const agent of agents) {
    if (aliases.has(agent.alias)) {
      throw new Error(`Duplicate alias "${agent.alias}" in manifest`);
    }
    aliases.add(agent.alias);
  }

  // Check all reports_to references are valid
  for (const agent of agents) {
    if (agent.reports_to !== 'super-user' && !aliases.has(agent.reports_to)) {
      throw new Error(`Agent "${agent.alias}" reports_to "${agent.reports_to}" which is not in the manifest`);
    }
  }

  // Check at least one agent reports to super-user (the root)
  const roots = agents.filter(a => a.reports_to === 'super-user');
  if (roots.length === 0) {
    throw new Error('Manifest must have at least one root agent (reports_to: "super-user")');
  }

  return {
    name: raw.name,
    description: raw.description,
    agents,
  };
}

/**
 * Topological sort: managers come before their reports.
 * Agents reporting to "super-user" come first.
 */
export function topologicalSort(agents: ManifestAgent[]): ManifestAgent[] {
  const byAlias = new Map(agents.map(a => [a.alias, a]));
  const sorted: ManifestAgent[] = [];
  const visited = new Set<string>();

  function visit(alias: string): void {
    if (visited.has(alias)) return;
    const agent = byAlias.get(alias);
    if (!agent) return;

    // Visit manager first (unless it's super-user)
    if (agent.reports_to !== 'super-user') {
      visit(agent.reports_to);
    }

    visited.add(alias);
    sorted.push(agent);
  }

  for (const agent of agents) {
    visit(agent.alias);
  }

  return sorted;
}

/**
 * Load a manifest from an org-templates directory.
 */
export function loadManifest(templateName: string, orgTemplatesDir: string): OrgManifest {
  const manifestPath = path.join(orgTemplatesDir, templateName, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Org template "${templateName}" not found at ${manifestPath}`);
  }
  const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  return parseManifest(raw);
}

// ── Instantiation ──

export interface InstantiateOptions {
  db: Database.Database;
  orgDir: string;
  templateDir: string;
}

export interface InstantiateResult {
  agentsCreated: Array<{ alias: string; name: string; folder: string }>;
  warnings: string[];
}

/**
 * Create a full org from a manifest.
 * Agents are provisioned in topological order (managers before reports).
 */
export function instantiateFromManifest(
  rawManifest: Parameters<typeof parseManifest>[0],
  opts: InstantiateOptions,
): InstantiateResult {
  const manifest = parseManifest(rawManifest);
  const sorted = topologicalSort(manifest.agents);

  const agentsCreated: InstantiateResult['agentsCreated'] = [];
  const allWarnings: string[] = [];

  for (const agent of sorted) {
    const result = provision(
      {
        alias: agent.alias,
        name: agent.name,
        roleTemplate: agent.role,
        reportsTo: agent.reports_to === 'super-user' ? 'super-user' : agent.reports_to,
        vibe: agent.vibe,
      },
      opts.db,
      opts.orgDir,
      opts.templateDir,
    );

    // Write title to frontmatter if provided
    if (agent.title) {
      const identityPath = path.join(result.dir, 'IDENTITY.md');
      let content = fs.readFileSync(identityPath, 'utf-8');
      content = content.replace(/^title:.*$/m, `title: ${agent.title}`);
      fs.writeFileSync(identityPath, content);
    }

    agentsCreated.push({ alias: agent.alias, name: agent.name, folder: result.folder });
    allWarnings.push(...result.warnings);
  }

  return { agentsCreated, warnings: allWarnings };
}
