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

export function timeAgo(dateStr: string | undefined): string {
  if (!dateStr) return 'never';
  // Handle SQLite datetime format "YYYY-MM-DD HH:MM:SS" (no T, no Z — treat as UTC)
  let normalized = dateStr;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(normalized)) {
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
