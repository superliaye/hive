import type { AgentConfig } from '../types.js';
import matter from 'gray-matter';

function stripFrontmatter(content: string): string {
  const { content: body } = matter(content);
  return body.trim();
}

const ACTION_TAG_INSTRUCTION = `## Response Footer

### ACTION Tag (required)
At the very end of your response, on its own line, include an action summary tag:
ACTION: <3-6 word summary of what you did>

Examples:
ACTION: Delegated task to platform-eng
ACTION: Posted status update to dm:ceo
ACTION: Updated sprint priorities
ACTION: Clarified routing confusion to AR

### FOLLOWUP Tag (when you have open commitments)
When you delegate work, create a PR, or make any commitment that needs tracking, declare a FOLLOWUP tag before your ACTION tag. The system will automatically check on it and re-invoke you if needed.

Format:
FOLLOWUP: <description>
| check: <shell command — exit 0 = done, 1 = not done, 2 = skip this check>
| backoff: <comma-separated intervals, e.g. 10m, 30m, 1h>

Always provide a \`check\` command when possible — it resolves automatically with zero token cost. Only omit for subjective evaluations.

Examples:
FOLLOWUP: Bug #47 — verify rio submitted PR
| check: gh pr list --search "47" --json number --jq 'if length > 0 then empty else error("none") end'
| backoff: 30m, 1h, 2h

FOLLOWUP: PR #46 — drive to merge
| check: gh pr view 46 --json state -q 'if .state == "MERGED" then empty else error("open") end'
| backoff: 10m, 30m, 1h, 4h

FOLLOWUP: QA verification from @tess
| backoff: 1h, 4h, 1d

On your **final attempt**, you must make a terminal decision: complete, escalate, or cancel. Do not leave things unresolved.`;

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
    config.files.inboxLog,
    ACTION_TAG_INSTRUCTION,
  ].filter(s => s.trim().length > 0);

  return sections.join('\n\n---\n\n');
}
