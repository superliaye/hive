import { useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { useSSEEvent } from '../hooks/useSSE';
import { StatusDot, timeAgo, EmptyState } from '../components/shared';
import type { Agent, Conversation } from '../types';

/**
 * Layer 1 — Directory (top level).
 * URL: /conversations
 *
 * Two sections: Agent cards (click -> Layer 2) and Group chat cards (click -> Layer 3 with no focal agent).
 * Both sorted by most-recently-active first.
 */
export function ConversationsDirectoryPage() {
  const { data: agents, setData: setAgents } = useApi<Agent[]>('/api/agents');
  const { data: conversations } = useApi<Conversation[]>('/api/conversations');

  // Live-update agent status badges via SSE
  useSSEEvent('agent-state', useCallback((event: any) => {
    setAgents(prev =>
      prev?.map(a =>
        a.id === event.agentId
          ? { ...a, status: event.status, currentTask: event.currentTask, lastHeartbeat: event.lastHeartbeat }
          : a
      ) ?? null
    );
  }, [setAgents]));

  const agentMap = useMemo(
    () => new Map(agents?.map(a => [a.id, a]) ?? []),
    [agents]
  );

  // Build per-agent stats: both conversationCount and lastActive come from server (agent-scoped)
  const agentStats = useMemo(() => {
    const stats = new Map<string, { conversationCount: number; lastActive: string | null }>();
    if (!agents) return stats;
    for (const agent of agents) {
      stats.set(agent.id, {
        conversationCount: agent.conversationCount ?? 0,
        lastActive: agent.lastActive ?? null,
      });
    }
    return stats;
  }, [agents]);

  // Sort agents by most recently active
  const sortedAgents = useMemo(() => {
    if (!agents) return [];
    return [...agents].sort((a, b) => {
      const tsA = agentStats.get(a.id)?.lastActive ?? '';
      const tsB = agentStats.get(b.id)?.lastActive ?? '';
      return tsB.localeCompare(tsA);
    });
  }, [agents, agentStats]);

  // Group conversations sorted by most recently active
  const groups = useMemo(() => {
    if (!conversations) return [];
    return conversations
      .filter(c => c.type === 'group')
      .sort((a, b) => {
        const tsA = a.lastMessage?.timestamp ?? '';
        const tsB = b.lastMessage?.timestamp ?? '';
        return tsB.localeCompare(tsA);
      });
  }, [conversations]);

  if (!agents || !conversations) {
    return <EmptyState message="Loading..." />;
  }

  return (
    <div className="h-full -m-3 md:-m-6 flex flex-col">
      <div className="p-4 md:p-6 border-b border-slate-800 shrink-0">
        <h2 className="text-lg font-medium text-slate-200">Conversations</h2>
        <p className="text-xs text-slate-500 mt-1">Select an agent to view their conversations, or open a group chat directly.</p>
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="flex flex-col md:flex-row gap-6 md:gap-8">
          {/* Agents section — 60% on desktop */}
          <div className="md:w-[60%]">
            <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">Agents</h3>
            {sortedAgents.length === 0 ? (
              <p className="text-sm text-slate-500 py-8 text-center">No agents in this organization</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {sortedAgents.map(agent => {
                  const stats = agentStats.get(agent.id);
                  return (
                    <AgentCard
                      key={agent.id}
                      agent={agent}
                      conversationCount={stats?.conversationCount ?? 0}
                      lastActive={stats?.lastActive ?? null}
                    />
                  );
                })}
              </div>
            )}
          </div>

          {/* Groups section — 40% on desktop */}
          <div className="md:w-[40%]">
            <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">Group Chats</h3>
            {groups.length === 0 ? (
              <p className="text-sm text-slate-500 py-8 text-center">No group chats yet</p>
            ) : (
              <div className="space-y-3">
                {groups.map(group => (
                  <GroupCard key={group.name} group={group} agentMap={agentMap} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Agent Card ──────────────────────────────────────────────────────────────

function AgentCard({
  agent,
  conversationCount,
  lastActive,
}: {
  agent: Agent;
  conversationCount: number;
  lastActive: string | null;
}) {
  return (
    <Link
      to={`/conversations/${encodeURIComponent(agent.id)}`}
      className="block p-3 rounded-lg border border-slate-800 hover:border-slate-700 bg-slate-900/50 hover:bg-slate-800/50 transition-colors cursor-pointer group"
    >
      <div className="flex items-start gap-2.5">
        <span className="text-xl shrink-0 mt-0.5">{agent.emoji ?? '\u25B9'}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm text-slate-200 font-medium truncate">{agent.name}</span>
            <StatusDot status={agent.status} />
          </div>
          <p className="text-xs text-slate-500 truncate">{agent.role}</p>
        </div>
        <span className="text-slate-600 text-sm opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          &rsaquo;
        </span>
      </div>

      <div className="mt-2.5 flex items-center justify-between text-xs text-slate-500">
        <span>{conversationCount} {conversationCount === 1 ? 'conversation' : 'conversations'}</span>
        <span>{lastActive ? timeAgo(lastActive) : 'no activity'}</span>
      </div>
    </Link>
  );
}

// ─── Group Card ──────────────────────────────────────────────────────────────

function GroupCard({
  group,
  agentMap,
}: {
  group: Conversation;
  agentMap: Map<string, Agent>;
}) {
  const memberCount = group.members.filter(m => m !== 'super-user').length;
  const lastMsg = group.lastMessage;
  const senderDisplay = lastMsg
    ? (agentMap.get(lastMsg.sender)?.name ?? lastMsg.sender)
    : null;

  return (
    <Link
      to={`/conversations/_/${group.name}`}
      className="block p-3 rounded-lg border border-slate-800 hover:border-slate-700 bg-slate-900/50 hover:bg-slate-800/50 transition-colors cursor-pointer"
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-slate-200 font-medium truncate">
          <span className="text-slate-500">#</span>{group.name}
        </span>
        <span className="text-xs text-slate-600 shrink-0 ml-2">
          {memberCount} {memberCount === 1 ? 'member' : 'members'}
        </span>
      </div>

      <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
        <span>{group.messageCount} messages</span>
        {lastMsg && <span>{timeAgo(lastMsg.timestamp)}</span>}
      </div>

      {lastMsg && (
        <p className="text-xs text-slate-400 truncate">
          <span className="text-slate-500">{senderDisplay}:</span>{' '}
          {lastMsg.content}
        </p>
      )}
    </Link>
  );
}
