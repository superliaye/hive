import { useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ConversationFeed } from '../components/conversations/ConversationFeed';
import { useApi } from '../hooks/useApi';
import { formatConversationName, StatusDot, EmptyState } from '../components/shared';
import type { Agent, Conversation } from '../types';

/**
 * Layer 3 — Conversation View (message feed with focal-agent chat bubbles).
 *
 * Routes:
 *   /conversations/:agentAlias/:conversationId  — focal agent highlighted on right
 *   /conversations/_/:conversationId             — no focal agent (group from Layer 1)
 *
 * Conversation IDs can contain colons (e.g. "dm:0:1"), so we use a React Router
 * splat param (*) to capture the full remaining path segment.
 */
export function ConversationViewPage() {
  const { agentAlias, '*': conversationIdRaw } = useParams();
  const conversationId = conversationIdRaw ?? '';
  const hasFocalAgent = agentAlias !== '_';

  const { data: agents } = useApi<Agent[]>('/api/agents');
  const { data: conversations } = useApi<Conversation[]>('/api/conversations');

  const agentMap = useMemo(
    () => new Map(agents?.map(a => [a.id, a]) ?? []),
    [agents]
  );

  const focalAgent = hasFocalAgent ? agentMap.get(agentAlias!) : undefined;
  const conversation = conversations?.find(c => c.name === conversationId);

  // Determine the focused sender alias for right-aligning their messages
  const focusedSender = hasFocalAgent ? agentAlias : undefined;

  // Build breadcrumb pieces
  const conversationDisplayName = conversation
    ? formatConversationName(conversation.name, agentMap, conversation.members, conversation.displayName)
    : conversationId;

  // Loading state — wait for agents and conversations to resolve
  if (!agents || !conversations) {
    return <EmptyState message="Loading..." />;
  }

  // 404: focal agent alias doesn't match any known agent
  if (hasFocalAgent && !focalAgent) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-slate-400 text-sm">Agent not found: <span className="text-slate-200 font-medium">{agentAlias}</span></p>
        <Link to="/conversations" className="text-xs text-amber-500 hover:text-amber-400">
          &larr; Back to Conversations
        </Link>
      </div>
    );
  }

  // 404: conversation doesn't exist
  if (!conversation) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-slate-400 text-sm">Conversation not found: <span className="text-slate-200 font-medium">{conversationId}</span></p>
        <Link
          to={hasFocalAgent ? `/conversations` : '/conversations'}
          className="text-xs text-amber-500 hover:text-amber-400"
        >
          &larr; Back to Conversations
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full -m-3 md:-m-6">
      {/* Header with breadcrumb */}
      <div className="px-4 md:px-6 py-3 border-b border-slate-800 shrink-0">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-xs mb-1.5">
          <Link to="/conversations" className="text-slate-500 hover:text-slate-300 transition-colors">
            Conversations
          </Link>
          {hasFocalAgent && focalAgent && (
            <>
              <span className="text-slate-600">/</span>
              <Link
                to={`/conversations/${encodeURIComponent(agentAlias!)}`}
                className="text-slate-500 hover:text-slate-300 transition-colors"
              >
                {focalAgent.name}
              </Link>
            </>
          )}
          <span className="text-slate-600">/</span>
          <span className="text-slate-400">{conversationDisplayName}</span>
        </nav>

        {/* Title row */}
        <div className="flex items-center gap-3">
          <Link
            to={hasFocalAgent ? `/conversations/${encodeURIComponent(agentAlias!)}` : '/conversations'}
            className="md:hidden text-slate-500 hover:text-slate-300 shrink-0"
          >
            &larr;
          </Link>
          <div className="flex items-center gap-2.5 min-w-0">
            {hasFocalAgent && focalAgent && (
              <>
                <span className="text-lg shrink-0">{focalAgent.emoji ?? '\u25B9'}</span>
                <StatusDot status={focalAgent.status} />
              </>
            )}
            <h2 className="text-lg font-medium text-slate-200 truncate">
              {conversationDisplayName}
            </h2>
          </div>
          {/* Member badges */}
          <div className="hidden md:flex items-center gap-1 ml-auto shrink-0">
            {conversation.members
              .filter(m => m !== 'super-user')
              .slice(0, 6)
              .map(alias => {
                const a = agentMap.get(alias);
                return (
                  <span
                    key={alias}
                    title={a?.name ?? alias}
                    className={`text-xs px-1.5 py-0.5 rounded-full border ${
                      alias === focusedSender
                        ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                        : 'border-slate-700 bg-slate-800 text-slate-400'
                    }`}
                  >
                    {a?.emoji ?? ''} {a?.name ?? alias}
                  </span>
                );
              })}
            {conversation.members.filter(m => m !== 'super-user').length > 6 && (
              <span className="text-xs text-slate-500">
                +{conversation.members.filter(m => m !== 'super-user').length - 6}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Message feed */}
      <div className="flex-1 overflow-auto">
        <ConversationFeed
          conversation={conversationId}
          focusedSender={focusedSender}
          agentMap={agentMap}
        />
      </div>
    </div>
  );
}
