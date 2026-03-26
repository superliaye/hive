import type { AgentConfig } from '../types.js';
import matter from 'gray-matter';

function stripFrontmatter(content: string): string {
  const { content: body } = matter(content);
  return body.trim();
}

const ACTION_TAG_INSTRUCTION = `## Response Footer
At the very end of your response, on its own line, include an action summary tag:
ACTION: <3-6 word summary of what you did>

Examples:
ACTION: Delegated task to platform-eng
ACTION: Posted status update to #board
ACTION: Updated sprint priorities
ACTION: Clarified routing confusion to AR`;

export function assemblePrompt(config: AgentConfig): string {
  const sections = [
    stripFrontmatter(config.files.identity),
    config.files.soul,
    config.files.bureau,
    config.files.protocols,
    config.files.skills,
    config.files.priorities,
    config.files.routine,
    config.files.memory,
    ACTION_TAG_INSTRUCTION,
  ].filter(s => s.trim().length > 0);

  return sections.join('\n\n---\n\n');
}
