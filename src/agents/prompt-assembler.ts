import type { AgentConfig } from '../types.js';
import matter from 'gray-matter';

function stripFrontmatter(content: string): string {
  const { content: body } = matter(content);
  return body.trim();
}

export function assemblePrompt(config: AgentConfig): string {
  const sections = [
    stripFrontmatter(config.files.identity),
    config.files.soul,
    config.files.bureau,
    config.files.priorities,
    config.files.routine,
    config.files.memory,
  ].filter(s => s.trim().length > 0);

  return sections.join('\n\n---\n\n');
}
