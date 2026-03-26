import type { AgentConfig, AgentIdentity } from '../types.js';
import { readAgentFiles, parseIdentityFrontmatter } from '../org/parser.js';

export interface LoadedAgentFiles {
  files: AgentConfig['files'];
  identity: AgentIdentity;
}

export async function loadAgentFiles(dir: string, sharedProtocols?: string): Promise<LoadedAgentFiles> {
  const files = await readAgentFiles(dir, sharedProtocols);
  const identity = parseIdentityFrontmatter(files.identity);
  return { files, identity };
}
