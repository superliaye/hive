import { useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useApi } from '../hooks/useApi';
import { useSSEEvent } from '../hooks/useSSE';
import { StatusDot, EmptyState, timeAgo } from '../components/shared';
import type { AgentConversationsResponse, AgentDmConversation, AgentGroupConversation } from '../types';

/**
 * Layer 2 — Agent Conversations (drill-in).
 * URL: /conversations/:alias
 *
 * Uses dedicated /api/agents/:alias/conversations endpoint for enriched data.
 * Shows all conversations (DMs + groups) for a specific agent with last message previews.
 * Clicking a conversation navigates to Layer 3 with this agent as the focal agent.
 */
export function AgentConversationsPage() {
  const { alias } = useParams<{ alias: string }>();
  const { data, error, setData } = useApi<AgentConversationsResponse>(
    alias ? `/api/agents/${encodeURIComponent(alias)}/conversations` : null
  );

  // Live-update agent status badge via SSE
  useSSEEvent('agent-state', useCallback((event: any) => {
    if (event.agentId === alias) {
      setData(prev => prev ? {
        ...prev,
        agent: { ...prev.agent, status: event.status },
      } : null);
    }
  }, [alias, setData]));

  // Loading
  if (!data && !error) {
    return <EmptyState message="Loading..." />;
  }

  // 404 — agent not found
  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-slate-400 text-sm">
          Agent not found: <span className="text-slate-200 font-medium">{alias}</span>
        </p>
        <Link to="/conversations" className="text-xs text-amber-500 hover:text-amber-400">
          &larr; Back to Conversations
        </Link>
      </div>
    );
  }

  const { agent, dms, groups } = data;
  const hasNoConversations = dms.length === 0 && groups.length === 0;

  return (
    <div className="h-full -m-3 md:-m-6 flex flex-col">
      {/* Header */}
      <div className="p-4 md:p-6 border-b border-slate-800 shrink-0">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-xs mb-2">
          <Link to="/conversations" className="text-slate-500 hover:text-slate-300 transition-colors">
            Conversations
          </Link>
          <span className="text-slate-600">/</span>
          <span className="text-slate-400">{agent.name}</span>
        </nav>

        {/* Agent identity */}
        <div className="flex items-center gap-3">
          <Link to="/conversations" className="md:hidden text-slate-500 hover:text-slate-300 shrink-0">
            &larr;
          </Link>
          <span className="text-2xl shrink-0">{agent.emoji ?? '\u25B9'}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-medium text-slate-200 truncate">{agent.name}</h2>
              <StatusDot status={agent.status} />
              <span className="text-xs text-slate-500 capitalize">{agent.status}</span>
            </div>
            <p className="text-sm text-slate-500">{agent.role}</p>
          </div>
        </div>
      </div>

      {/* Conversation lists */}
      <div className="flex-1 overflow-auto p-4 md:p-6">
        {hasNoConversations ? (
          <div className="text-center py-12 text-sm text-slate-500">
            No conversations yet
          </div>
        ) : (
          <div className="space-y-6">
            {/* DMs section */}
            {dms.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">
                  Direct Messages
                </h3>
                <div className="space-y-1">
                  {dms.map(dm => (
                    <DmRow key={dm.id} dm={dm} agentAlias={alias!} />
                  ))}
                </div>
              </div>
            )}

            {/* Groups section */}
            {groups.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">
                  Group Chats
                </h3>
                <div className="space-y-1">
                  {groups.map(group => (
                    <GroupRow key={group.id} group={group} agentAlias={alias!} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── DM Row ──────────────────────────────────────────────────────────────────

function DmRow({ dm, agentAlias }: { dm: AgentDmConversation; agentAlias: string }) {
  const isSuper = dm.otherParty.alias === 'super-user';
  const lastMsg = dm.lastMessage;

  return (
    <Link
      to={`/conversations/${encodeURIComponent(agentAlias)}/${dm.id}`}
      className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-slate-800/50 transition-colors cursor-pointer group"
    >
      {/* Avatar / emoji */}
      <span className="text-lg shrink-0">
        {isSuper ? (
          <span className="text-amber-500/80 text-sm font-medium">You</span>
        ) : (
          dm.otherParty.emoji ?? '\u25B9'
        )}
      </span>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-sm text-slate-200 font-medium truncate">
            @{dm.otherParty.alias}
            {!isSuper && (
              <span className="text-slate-500 font-normal ml-1.5">{dm.otherParty.name}</span>
            )}
          </span>
          <span className="text-xs text-slate-600 shrink-0 ml-2">{dm.messageCount}</span>
        </div>
        {lastMsg && (
          <p className="text-xs text-slate-500 truncate">
            <span className="text-slate-400">{lastMsg.sender}:</span>{' '}
            {lastMsg.content}
            <span className="text-slate-600 ml-1.5">&middot; {timeAgo(lastMsg.timestamp)}</span>
          </p>
        )}
      </div>

      {/* Chevron */}
      <span className="text-slate-600 text-sm opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        &rsaquo;
      </span>
    </Link>
  );
}

// ─── Group Row ───────────────────────────────────────────────────────────────

function GroupRow({ group, agentAlias }: { group: AgentGroupConversation; agentAlias: string }) {
  const lastMsg = group.lastMessage;

  return (
    <Link
      to={`/conversations/${encodeURIComponent(agentAlias)}/${group.id}`}
      className="flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-slate-800/50 transition-colors cursor-pointer group"
    >
      {/* Icon */}
      <span className="text-sm text-slate-500 shrink-0 w-7 text-center">#</span>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-sm text-slate-200 font-medium truncate">{group.name}</span>
          <div className="flex items-center gap-3 text-xs text-slate-600 shrink-0 ml-2">
            <span>{group.memberCount} members</span>
            <span>{group.messageCount}</span>
          </div>
        </div>
        {lastMsg && (
          <p className="text-xs text-slate-500 truncate">
            <span className="text-slate-400">{lastMsg.sender}:</span>{' '}
            {lastMsg.content}
            <span className="text-slate-600 ml-1.5">&middot; {timeAgo(lastMsg.timestamp)}</span>
          </p>
        )}
      </div>

      {/* Chevron */}
      <span className="text-slate-600 text-sm opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        &rsaquo;
      </span>
    </Link>
  );
}
