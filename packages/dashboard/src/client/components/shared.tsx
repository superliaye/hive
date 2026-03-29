import { Link } from 'react-router-dom';
import type { Agent } from '../types';

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-12 text-slate-500 text-sm">
      {message}
    </div>
  );
}

export function DashboardCard({ title, icon, linkTo, children }: {
  title: string;
  icon: string;
  linkTo: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={linkTo}
      className="block bg-slate-900 border border-slate-800 rounded-lg p-4 hover:border-slate-700 transition-colors"
    >
      <h3 className="text-sm font-medium text-slate-400 mb-3 flex items-center min-w-0">
        <span className="mr-2 shrink-0">{icon}</span><span className="truncate">{title}</span>
      </h3>
      {children}
    </Link>
  );
}

export function StatusDot({ status }: { status: string }) {
  const color =
    status === 'working' ? 'bg-green-500' :
    status === 'errored' ? 'bg-red-500' :
    status === 'disposed' ? 'bg-gray-700 opacity-50' :
    'bg-gray-500';
  return <span className={`inline-block w-2 h-2 rounded-full ${color}`} />;
}

/**
 * Convert a UTC timestamp string to a human-readable relative time.
 * Handles multiple formats from our backends:
 *  - SQLite CURRENT_TIMESTAMP: "YYYY-MM-DD HH:MM:SS" (no T, no Z)
 *  - SQLite strftime:          "YYYY-MM-DDTHH:MM:SS.fff" (T but no Z)
 *  - Full ISO 8601:            "YYYY-MM-DDTHH:MM:SS.fffZ"
 * All timestamps without a timezone indicator are treated as UTC (per CLAUDE.md convention).
 */
export function timeAgo(dateStr: string | undefined): string {
  if (!dateStr) return 'never';
  let normalized = dateStr;
  // If no timezone indicator (Z or +/-offset), treat as UTC by appending Z
  if (/^\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}/.test(normalized) && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(normalized)) {
    normalized = normalized.replace(' ', 'T') + 'Z';
  }
  const ts = new Date(normalized).getTime();
  if (isNaN(ts)) return 'unknown';
  const ms = Math.max(0, Date.now() - ts);
  const s = Math.floor(ms / 1000);
  if (s < 60) return s === 0 ? 'just now' : `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Parse a UTC timestamp that may lack Z suffix, for comparison/sorting. */
export function parseUtcTimestamp(dateStr: string): number {
  let normalized = dateStr;
  if (/^\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}/.test(normalized) && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(normalized)) {
    normalized = normalized.replace(' ', 'T') + 'Z';
  }
  return new Date(normalized).getTime();
}

/** Resolve a sender alias (e.g. "hiro", "super-user") to a display name using the agent map. */
export function senderName(alias: string, agentMap: Map<string, Agent>): string {
  if (alias === 'super-user') return 'You';
  const agent = agentMap.get(alias);
  return agent?.name ?? alias;
}

/** Strip markdown syntax for a plain-text preview */
export function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s+/g, '')           // headings
    .replace(/\*\*(.+?)\*\*/g, '$1')     // bold
    .replace(/\*(.+?)\*/g, '$1')         // italic
    .replace(/__(.+?)__/g, '$1')         // bold alt
    .replace(/_(.+?)_/g, '$1')           // italic alt
    .replace(/~~(.+?)~~/g, '$1')         // strikethrough
    .replace(/`(.+?)`/g, '$1')           // inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
    .replace(/^[-*+]\s+/gm, '')          // unordered list markers
    .replace(/^\d+\.\s+/gm, '')          // ordered list markers
    .replace(/^>\s+/gm, '')              // blockquotes
    .replace(/\n{2,}/g, ' ')             // collapse multiple newlines
    .replace(/\n/g, ' ')                 // single newlines to space
    .trim();
}

/** Convert a conversation name to a human-readable display name using the agent map.
 *  Handles both old format "dm:alias" and new format "dm:0:1".
 *  When displayName is provided (from server), uses it directly.
 *  When members array is provided (from /api/conversations), uses member aliases for display. */
export function formatConversationName(conversationName: string, agentMap?: Map<string, Agent>, members?: string[], displayName?: string): string {
  // Prefer server-provided display name
  if (displayName) {
    if (displayName.startsWith('@') && agentMap) {
      const alias = displayName.slice(1);
      const agent = agentMap.get(alias);
      if (agent) return `${agent.emoji ?? '\u25B9'} ${agent.name}`;
    }
    return displayName;
  }
  if (conversationName.startsWith('dm:')) {
    // New format: dm:N:M — use members array to find agent names
    if (members && agentMap) {
      const names = members
        .filter(alias => alias !== 'super-user')
        .map(alias => {
          const agent = agentMap.get(alias);
          return agent ? `${agent.emoji ?? '\u25B9'} ${agent.name}` : alias;
        });
      if (names.length > 0) return names.join(' \u2194 ');
    }
    // Fallback: try old format dm:alias
    const rest = conversationName.slice(3);
    if (agentMap && !rest.includes(':')) {
      const agent = agentMap.get(rest);
      if (agent) return `${agent.emoji ?? '\u25B9'} ${agent.name}`;
    }
    // Fallback: show members if available
    if (members) {
      return members.filter(a => a !== 'super-user').join(' \u2194 ') || conversationName;
    }
    return rest;
  }
  return `# ${conversationName}`;
}
