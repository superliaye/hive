import type { AgentConfig } from '../types.js';
import { readAgentFiles, parseIdentityFrontmatter } from '../org/parser.js';

export async function loadAgentConfig(
  dir: string,
  id: string,
  depth: number,
  parentId: string | null,
): Promise<AgentConfig> {
  const files = await readAgentFiles(dir);
  const identity = parseIdentityFrontmatter(files.identity);

  return {
    id,
    identity,
    dir,
    depth,
    parentId,
    childIds: [],
    files,
  };
}
