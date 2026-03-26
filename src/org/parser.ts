import fs from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';
import type { AgentConfig, AgentIdentity, OrgChart, Person } from '../types.js';

const SKIP_DIRS = ['.claude', '.workspace', '.archive', '.proposals', 'memory', 'node_modules', '.git'];

// Pattern: {id}-{alias} folder name
const FOLDER_PATTERN = /^(\d+)-(.+)$/;

async function isAgentDir(dir: string): Promise<boolean> {
  try {
    await fs.access(path.join(dir, 'IDENTITY.md'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Load the most recent daily memory logs (up to 3 days) and combine
 * with the curated MEMORY.md for the agent's memory context.
 */
async function loadMemory(dir: string): Promise<string> {
  const parts: string[] = [];

  // 1. Curated long-term memory
  try {
    const curated = await fs.readFile(path.join(dir, 'MEMORY.md'), 'utf-8');
    if (curated.trim()) parts.push(curated.trim());
  } catch { /* no MEMORY.md */ }

  // 2. Recent daily logs (last 3 days, most recent first)
  const memoryDir = path.join(dir, 'memory');
  try {
    const files = await fs.readdir(memoryDir);
    const dated = files
      .filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort()
      .reverse()
      .slice(0, 3);

    for (const file of dated) {
      const content = await fs.readFile(path.join(memoryDir, file), 'utf-8');
      if (content.trim()) {
        parts.push(`## Log: ${file.replace('.md', '')}\n${content.trim()}`);
      }
    }
  } catch { /* no memory/ directory */ }

  return parts.join('\n\n');
}

/**
 * Load all SKILL.md files from the agent's .claude/skills/ directory.
 */
async function loadSkills(dir: string): Promise<string> {
  const skillsDir = path.join(dir, '.claude', 'skills');
  try {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true });
    const parts: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const content = await fs.readFile(path.join(skillsDir, entry.name, 'SKILL.md'), 'utf-8');
        if (content.trim()) parts.push(content.trim());
      } catch { /* no SKILL.md in this dir */ }
    }
    return parts.join('\n\n---\n\n');
  } catch {
    return '';
  }
}

export async function readAgentFiles(dir: string, sharedProtocols?: string): Promise<AgentConfig['files']> {
  const read = async (name: string): Promise<string> => {
    try {
      return await fs.readFile(path.join(dir, name), 'utf-8');
    } catch {
      return '';
    }
  };
  return {
    identity: await read('IDENTITY.md'),
    soul: await read('SOUL.md'),
    bureau: await read('BUREAU.md'),
    priorities: await read('PRIORITIES.md'),
    routine: await read('ROUTINE.md'),
    memory: await loadMemory(dir),
    protocols: sharedProtocols ?? '',
    skills: await loadSkills(dir),
  };
}

export function parseIdentityFrontmatter(content: string): AgentIdentity {
  const { data } = matter(content);
  return {
    id: data.id ?? 0,
    alias: data.alias ?? 'unknown',
    name: data.name ?? 'Unknown',
    role: data.role ?? 'Unknown',
    title: data.title || undefined,
    model: data.model ?? 'claude-opus-4-6',
    emoji: data.emoji,
    vibe: data.vibe,
    skills: data.skills,
  };
}

/**
 * Parse folder name into id + alias.
 * Format: {id}-{alias} (e.g., "1-ceo", "2-ar", "10-platform-eng")
 */
export function parseFolderName(name: string): { id: number; alias: string } | null {
  const match = name.match(FOLDER_PATTERN);
  if (!match) return null;
  return { id: parseInt(match[1], 10), alias: match[2] };
}

/**
 * Scan org/ directory for flat agent folders.
 * Each folder is named {id}-{alias}/ and contains IDENTITY.md + other agent files.
 * Hierarchy comes from the people table (reports_to), not directory nesting.
 */
export async function parseOrgFlat(
  orgRoot: string,
  people: Person[],
): Promise<OrgChart> {
  const agents = new Map<string, AgentConfig>();
  const peopleByAlias = new Map(people.map(p => [p.alias, p]));
  const peopleById = new Map(people.map(p => [p.id, p]));

  // Load shared protocols
  let sharedProtocols = '';
  try {
    sharedProtocols = await fs.readFile(path.join(orgRoot, 'PROTOCOLS.md'), 'utf-8');
  } catch { /* optional */ }

  // Scan flat directories
  const entries = await fs.readdir(orgRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIRS.includes(entry.name)) continue;

    const parsed = parseFolderName(entry.name);
    if (!parsed) continue;

    const dir = path.join(orgRoot, entry.name);
    if (!(await isAgentDir(dir))) continue;

    const person = peopleByAlias.get(parsed.alias) ?? peopleById.get(parsed.id);
    if (!person) continue; // No matching person in DB

    const files = await readAgentFiles(dir, sharedProtocols);
    const identity = parseIdentityFrontmatter(files.identity);

    const reportsTo = person.reportsTo ? (peopleById.get(person.reportsTo) ?? null) : null;
    const directReports = people.filter(p => p.reportsTo === person.id);

    const config: AgentConfig = {
      person,
      dir,
      reportsTo,
      directReports,
      files,
      identity,
    };

    agents.set(person.alias, config);
  }

  return { agents, people };
}
