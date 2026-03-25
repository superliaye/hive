import fs from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';
import type { AgentConfig, AgentIdentity, OrgChart, ChannelDef } from '../types.js';

const AGENT_FILES = ['IDENTITY.md', 'SOUL.md', 'BUREAU.md', 'PRIORITIES.md', 'ROUTINE.md', 'MEMORY.md'];
const SKIP_DIRS = ['.claude', '.workspace', '.archive', '.proposals', 'memory', 'node_modules', '.git'];

async function isAgentDir(dir: string): Promise<boolean> {
  try {
    await fs.access(path.join(dir, 'IDENTITY.md'));
    return true;
  } catch {
    return false;
  }
}

function deriveAgentId(agentPath: string, orgRoot: string): string {
  const relative = path.relative(orgRoot, agentPath);
  if (relative === '' || relative === '.') return 'root';
  // org/ceo/engineering/eng-1 → ceo-engineering-eng-1
  // But the first agent folder is typically just "ceo"
  return relative.split(path.sep).filter(s => s !== '').join('-');
}

function deriveChannelName(agentPath: string, orgRoot: string): string | null {
  const relative = path.relative(orgRoot, agentPath);
  const parts = relative.split(path.sep).filter(s => s !== '');
  if (parts.length < 2) return null;
  // Use last two significant segments: "engineering/backend" → "eng-backend"
  const parent = parts[parts.length - 2];
  const team = parts[parts.length - 1];
  return `${parent}-${team}`;
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
  };
}

export function parseIdentityFrontmatter(content: string): AgentIdentity {
  const { data } = matter(content);
  return {
    name: data.name ?? 'Unknown',
    role: data.role ?? 'Unknown',
    model: data.model ?? 'claude-opus-4-6',
    emoji: data.emoji,
    vibe: data.vibe,
    tools: data.tools ?? ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'],
    skills: data.skills,
  };
}

async function walkIntermediate(
  dir: string,
  orgRoot: string,
  parentDepth: number,
  parentId: string,
  parentConfig: AgentConfig,
  agents: Map<string, AgentConfig>,
  sharedProtocols?: string,
): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIRS.includes(entry.name)) continue;
    const childDir = path.join(dir, entry.name);
    if (await isAgentDir(childDir)) {
      const child = await walkAgents(childDir, orgRoot, parentDepth + 1, parentId, agents, sharedProtocols);
      if (child) parentConfig.childIds.push(child.id);
    } else {
      await walkIntermediate(childDir, orgRoot, parentDepth, parentId, parentConfig, agents, sharedProtocols);
    }
  }
}

async function walkAgents(
  dir: string,
  orgRoot: string,
  depth: number,
  parentId: string | null,
  agents: Map<string, AgentConfig>,
  sharedProtocols?: string,
): Promise<AgentConfig | null> {
  if (!(await isAgentDir(dir))) return null;

  const id = deriveAgentId(dir, orgRoot);
  const files = await readAgentFiles(dir, sharedProtocols);
  const identity = parseIdentityFrontmatter(files.identity);

  const config: AgentConfig = {
    id,
    identity,
    dir,
    depth,
    parentId,
    childIds: [],
    files,
  };

  agents.set(id, config);

  // Scan subdirectories for child agents
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIRS.includes(entry.name)) continue;
    const childDir = path.join(dir, entry.name);

    // Check if this dir itself is an agent, or contains agents
    if (await isAgentDir(childDir)) {
      const child = await walkAgents(childDir, orgRoot, depth + 1, id, agents, sharedProtocols);
      if (child) config.childIds.push(child.id);
    } else {
      // Intermediate directory (e.g., "engineering/") — recurse fully
      await walkIntermediate(childDir, orgRoot, depth, id, config, agents, sharedProtocols);
    }
  }

  return config;
}

/**
 * Generate the channel topology for an org.
 *
 * Design principles for scale (100s of agents, 1000s of messages/hr):
 *
 * 1. **Hierarchy-scoped channels** — each manager + direct reports get a team channel.
 *    Messages flow up/down the tree, not sideways. A leaf agent only sees messages
 *    from its immediate team, not from every agent in the org.
 *
 * 2. **1:1 DM channels** — every parent-child pair gets a private channel.
 *    This is the primary communication path. Agents talk to their manager privately.
 *    `hive chat send --channel dm:platform-eng --as ceo "do X"` sends directly.
 *
 * 3. **Broadcast channels are read-only sinks** — #all-hands exists but only the
 *    CEO (root) is a member for posting. Other agents can read via search/memory
 *    but are NOT members, so they don't get triggered on every broadcast.
 *
 * 4. **No sideways channels by default** — platform-eng and qa-eng don't share a
 *    channel unless they have a common manager channel (team channel).
 *    Cross-team comms go through the hierarchy: eng→manager→other-manager→target.
 */
function generateChannels(agents: Map<string, AgentConfig>, orgRoot: string): ChannelDef[] {
  const channels: ChannelDef[] = [];
  const root = Array.from(agents.values()).find(a => a.depth === 0);

  // Board: super-user ↔ CEO (external interface)
  if (root) {
    channels.push({ name: 'board', autoGenerated: true, memberIds: [root.id] });
    channels.push({ name: 'approvals', autoGenerated: true, memberIds: [root.id] });
  }

  // Team channels: each manager + their direct reports
  // This replaces the old "leadership" + folder-derived channels with a uniform pattern.
  for (const agent of agents.values()) {
    if (agent.childIds.length > 0) {
      // Use a meaningful name derived from the folder structure
      const channelName = deriveChannelName(agent.dir, orgRoot) ?? `team-${agent.id}`;
      if (!channels.find(c => c.name === channelName)) {
        channels.push({
          name: channelName,
          autoGenerated: true,
          memberIds: [agent.id, ...agent.childIds],
        });
      }
    }
  }

  // 1:1 DM channels: every parent ↔ child pair
  // Named dm:<child-id> for easy addressing (child ID is unique in the org)
  for (const agent of agents.values()) {
    if (agent.parentId) {
      const dmName = `dm:${agent.id}`;
      channels.push({
        name: dmName,
        autoGenerated: true,
        memberIds: [agent.parentId, agent.id],
      });
    }
  }

  // AR-requests: CEO ↔ AR (if AR exists) — specialized channel for provisioning
  const arAgent = Array.from(agents.values()).find(
    a => a.dir.endsWith('/ar') || a.dir.endsWith('\\ar'),
  );
  if (arAgent) {
    const arMembers = [arAgent.parentId, arAgent.id].filter(Boolean) as string[];
    channels.push({
      name: 'ar-requests',
      autoGenerated: true,
      memberIds: arMembers,
    });
  }

  return channels;
}

export async function parseOrgTree(orgRoot: string): Promise<OrgChart> {
  const agents = new Map<string, AgentConfig>();

  // Load shared protocols (org-wide rules all agents must follow)
  let sharedProtocols = '';
  try {
    sharedProtocols = await fs.readFile(path.join(orgRoot, 'PROTOCOLS.md'), 'utf-8');
  } catch { /* no PROTOCOLS.md — optional */ }

  // Find the root agent directory (first dir with IDENTITY.md)
  const entries = await fs.readdir(orgRoot, { withFileTypes: true });
  let root: AgentConfig | null = null;

  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIRS.includes(entry.name)) continue;
    const candidateDir = path.join(orgRoot, entry.name);
    root = await walkAgents(candidateDir, orgRoot, 0, null, agents, sharedProtocols);
    if (root) break;
  }

  if (!root) {
    throw new Error(`No agent found in org root: ${orgRoot}. Expected a directory with IDENTITY.md.`);
  }

  const channels = generateChannels(agents, orgRoot);

  return { root, agents, channels };
}
