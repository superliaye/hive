/**
 * Parse FOLLOWUP tags from agent response text.
 *
 * Format:
 *   FOLLOWUP: <description>
 *   | check: <shell command>
 *   | backoff: 10m, 30m, 1h, 4h
 *
 * `check` is optional. `backoff` is required.
 * Multiple FOLLOWUP blocks can appear in a single response.
 */

export interface ParsedFollowUp {
  description: string;
  checkCommand?: string;
  backoff: string[];
}

/**
 * Parse all FOLLOWUP tags from response text.
 * Returns parsed follow-ups and the response text with FOLLOWUP blocks stripped.
 */
export function parseFollowUps(text: string): { followups: ParsedFollowUp[]; cleanedText: string } {
  const followups: ParsedFollowUp[] = [];

  // Match FOLLOWUP: line followed by optional | key: value continuation lines
  const pattern = /^FOLLOWUP:\s*(.+)(?:\n(?:\|\s*\w+:\s*.+))*$/gm;
  let cleanedText = text;

  const matches = text.matchAll(pattern);
  for (const match of matches) {
    const block = match[0];
    const parsed = parseFollowUpBlock(block);
    if (parsed) {
      followups.push(parsed);
      cleanedText = cleanedText.replace(block, '').trim();
    }
  }

  return { followups, cleanedText };
}

function parseFollowUpBlock(block: string): ParsedFollowUp | null {
  const lines = block.split('\n');
  const descLine = lines[0];
  const descMatch = descLine.match(/^FOLLOWUP:\s*(.+)$/);
  if (!descMatch) return null;

  const description = descMatch[1].trim();
  let checkCommand: string | undefined;
  let backoff: string[] | undefined;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    const kvMatch = line.match(/^\|\s*(\w+):\s*(.+)$/);
    if (!kvMatch) continue;

    const key = kvMatch[1].toLowerCase();
    const value = kvMatch[2].trim();

    switch (key) {
      case 'check':
        checkCommand = value;
        break;
      case 'backoff':
        backoff = value.split(',').map(s => s.trim()).filter(Boolean);
        break;
    }
  }

  if (!backoff || backoff.length === 0) return null;

  return { description, checkCommand, backoff };
}

/**
 * Strip FOLLOWUP blocks from response text (used when posting cleaned response).
 */
export function stripFollowUps(text: string): string {
  return parseFollowUps(text).cleanedText;
}
