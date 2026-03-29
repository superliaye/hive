import { useState, useMemo } from 'react';
import { ConversationFeed } from '../components/conversations/ConversationFeed';
import { useApi } from '../hooks/useApi';
import { formatConversationName, StatusDot } from '../components/shared';
import type { Agent, Conversation } from '../types';

type View =
  | { layer: 'overview' }
  | { layer: 'agent'; agentId: string }
  | { layer: 'conversation'; conversationId: string; backTo: 'overview' | { agentId: string } };

export function ConversationsPage() {
  const [view, setView] = useState<View>({ layer: 'overview' });
  const { data: agents } = useApi<Agent[]>('/api/agents');
  const { data: conversations } = useApi<Conversation[]>('/api/conversations');
  const agentMap = useMemo(() => new Map(agents?.map(a => [a.id, a]) ?? []), [agents]);

  // Group conversations by type
  const groups = useMemo(
    () => conversations?.filter(c => c.type === 'group') ?? [],
    [conversations]
  );

  // Get conversations for a specific agent (DMs they're in + groups they're in)
  const getAgentConversations = (agentId: string) => {
    if (!conversations) return { dms: [], groups: [] };
    const agentConvs = conversations.filter(c => c.members.includes(agentId));
    return {
      dms: agentConvs.filter(c => c.type === 'dm'),
      groups: agentConvs.filter(c => c.type === 'group'),
    };
  };

  const handleBack = () => {
    if (view.layer === 'conversation' && view.backTo !== 'overview') {
      setView({ layer: 'agent', agentId: view.backTo.agentId });
    } else {
      setView({ layer: 'overview' });
    }
  };

  const openConversation = (conversationId: string, backTo: View['layer'] extends 'conversation' ? never : 'overview' | { agentId: string }) => {
    setView({ layer: 'conversation', conversationId, backTo });
  };

  const selectedConv = view.layer === 'conversation'
    ? conversations?.find(c => c.name === view.conversationId)
    : null;

  return (
    <div className="flex flex-col md:flex-row h-full -m-3 md:-m-6">
      {/* Left panel */}
      <div className={`md:block ${view.layer === 'conversation' ? 'hidden' : 'block'}`}>
        <div className="w-full md:w-72 border-r border-slate-800 flex flex-col shrink-0 h-full">
          {view.layer === 'overview' && (
            <OverviewPanel
              agents={agents ?? []}
              groups={groups}
              agentMap={agentMap}
              onSelectAgent={(id) => setView({ layer: 'agent', agentId: id })}
              onSelectGroup={(id) => openConversation(id, 'overview')}
            />
          )}
          {view.layer === 'agent' && (
            <AgentDetailPanel
              agentId={view.agentId}
              agent={agentMap.get(view.agentId)}
              conversations={getAgentConversations(view.agentId)}
              agentMap={agentMap}
              onBack={() => setView({ layer: 'overview' })}
              onSelectConversation={(id) => openConversation(id, { agentId: view.agentId })}
            />
          )}
          {view.layer === 'conversation' && (
            <div className="p-4 border-b border-slate-800">
              <button
                onClick={handleBack}
                className="text-xs text-slate-500 hover:text-slate-300 mb-2"
              >
                &larr; Back
              </button>
              <h3 className="text-sm font-medium text-slate-300">
                {formatConversationName(view.conversationId, agentMap, selectedConv?.members, selectedConv?.displayName)}
              </h3>
            </div>
          )}
        </div>
      </div>

      {/* Right panel — conversation feed */}
      <div className="flex-1 min-w-0">
        {view.layer === 'conversation' ? (
          <div className="flex flex-col h-full">
            <div className="px-4 md:px-6 py-3 border-b border-slate-800 shrink-0 flex items-center gap-3">
              <button
                onClick={handleBack}
                className="md:hidden text-xs text-slate-500 hover:text-slate-300"
              >
                &larr; Back
              </button>
              <h2 className="text-lg font-medium text-slate-200">
                {formatConversationName(view.conversationId, agentMap, selectedConv?.members, selectedConv?.displayName)}
              </h2>
            </div>
            <div className="flex-1 overflow-auto">
              <ConversationFeed
                conversation={view.conversationId}
                focusedSender={view.backTo !== 'overview' ? view.backTo.agentId : undefined}
              />
            </div>
          </div>
        ) : (
          <div className="hidden md:flex items-center justify-center h-full text-slate-500 text-sm">
            {view.layer === 'overview'
              ? 'Select an agent to view their conversations, or click a group chat'
              : 'Select a conversation to view messages'}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Layer 1: Overview Panel ──────────────────────────────────────────────

function OverviewPanel({
  agents,
  groups,
  agentMap,
  onSelectAgent,
  onSelectGroup,
}: {
  agents: Agent[];
  groups: Conversation[];
  agentMap: Map<string, Agent>;
  onSelectAgent: (id: string) => void;
  onSelectGroup: (id: string) => void;
}) {
  return (
    <>
      <div className="p-4 border-b border-slate-800">
        <h3 className="text-sm font-medium text-slate-300">Conversations</h3>
      </div>
      <div className="flex-1 overflow-auto">
        {/* Agents section */}
        <div className="px-3 pt-3 pb-1">
          <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wider px-1 mb-2">Agents</h4>
        </div>
        <div className="px-2 space-y-0.5">
          {agents.map(agent => (
            <button
              key={agent.id}
              onClick={() => onSelectAgent(agent.id)}
              className="w-full text-left px-3 py-2.5 rounded-md text-sm transition-colors cursor-pointer hover:bg-slate-800/50 group"
            >
              <div className="flex items-center gap-2.5">
                <span className="text-base shrink-0">{agent.emoji ?? '\u25B9'}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-200 truncate font-medium">{agent.name}</span>
                    <StatusDot status={agent.status} />
                  </div>
                  <span className="text-xs text-slate-500 truncate block">{agent.role}</span>
                </div>
                <span className="text-slate-600 text-xs opacity-0 group-hover:opacity-100 transition-opacity">&rsaquo;</span>
              </div>
            </button>
          ))}
          {agents.length === 0 && (
            <p className="text-xs text-slate-500 px-3 py-2">No agents</p>
          )}
        </div>

        {/* Divider */}
        <div className="mx-3 my-3 border-t border-slate-800/60" />

        {/* Groups section */}
        <div className="px-3 pb-1">
          <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wider px-1 mb-2">Group Chats</h4>
        </div>
        <div className="px-2 pb-3 space-y-0.5">
          {groups.map(group => (
            <button
              key={group.name}
              onClick={() => onSelectGroup(group.name)}
              className="w-full text-left px-3 py-2 rounded-md text-sm transition-colors cursor-pointer hover:bg-slate-800/50"
            >
              <div className="flex items-center justify-between">
                <span className="text-slate-300 truncate">
                  <span className="text-slate-500 mr-1">#</span>
                  {group.name}
                </span>
                <span className="text-xs text-slate-600 shrink-0 ml-2">{group.messageCount}</span>
              </div>
              <div className="text-xs text-slate-500 mt-0.5 truncate">
                {group.members.filter(m => m !== 'super-user').join(', ')}
              </div>
            </button>
          ))}
          {groups.length === 0 && (
            <p className="text-xs text-slate-500 px-3 py-2">No group chats</p>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Layer 2: Agent Detail Panel ──────────────────────────────────────────

function AgentDetailPanel({
  agentId,
  agent,
  conversations,
  agentMap,
  onBack,
  onSelectConversation,
}: {
  agentId: string;
  agent: Agent | undefined;
  conversations: { dms: Conversation[]; groups: Conversation[] };
  agentMap: Map<string, Agent>;
  onBack: () => void;
  onSelectConversation: (id: string) => void;
}) {
  const { dms, groups } = conversations;

  return (
    <>
      <div className="p-4 border-b border-slate-800">
        <button
          onClick={onBack}
          className="text-xs text-slate-500 hover:text-slate-300 mb-2 flex items-center gap-1 cursor-pointer"
        >
          &larr; All conversations
        </button>
        <div className="flex items-center gap-2.5">
          <span className="text-xl">{agent?.emoji ?? '\u25B9'}</span>
          <div>
            <h3 className="text-sm font-medium text-slate-200">{agent?.name ?? agentId}</h3>
            <p className="text-xs text-slate-500">{agent?.role}</p>
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {/* DMs section */}
        {dms.length > 0 && (
          <>
            <div className="px-3 pt-3 pb-1">
              <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wider px-1 mb-2">Direct Messages</h4>
            </div>
            <div className="px-2 space-y-0.5">
              {dms.map(dm => {
                // Show the other person in the DM (not the selected agent)
                const otherMember = dm.members.find(m => m !== agentId && m !== 'super-user') ?? dm.members.find(m => m !== agentId);
                const otherAgent = otherMember ? agentMap.get(otherMember) : undefined;
                const isSuper = otherMember === 'super-user';
                return (
                  <button
                    key={dm.name}
                    onClick={() => onSelectConversation(dm.name)}
                    className="w-full text-left px-3 py-2 rounded-md text-sm transition-colors cursor-pointer hover:bg-slate-800/50"
                  >
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 truncate text-slate-300">
                        {isSuper ? (
                          <span className="text-amber-500/80">You</span>
                        ) : (
                          <>
                            <span className="shrink-0">{otherAgent?.emoji ?? '\u25B9'}</span>
                            <span className="truncate">{otherAgent?.name ?? otherMember}</span>
                          </>
                        )}
                      </span>
                      <span className="text-xs text-slate-600 shrink-0 ml-2">{dm.messageCount} msgs</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* Groups section */}
        {groups.length > 0 && (
          <>
            <div className="mx-3 my-3 border-t border-slate-800/60" />
            <div className="px-3 pb-1">
              <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wider px-1 mb-2">Group Chats</h4>
            </div>
            <div className="px-2 pb-3 space-y-0.5">
              {groups.map(group => (
                <button
                  key={group.name}
                  onClick={() => onSelectConversation(group.name)}
                  className="w-full text-left px-3 py-2 rounded-md text-sm transition-colors cursor-pointer hover:bg-slate-800/50"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-slate-300 truncate">
                      <span className="text-slate-500 mr-1">#</span>
                      {group.name}
                    </span>
                    <span className="text-xs text-slate-600 shrink-0 ml-2">{group.messageCount}</span>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {dms.length === 0 && groups.length === 0 && (
          <div className="px-4 py-8 text-center text-xs text-slate-500">
            No conversations for this agent
          </div>
        )}
      </div>
    </>
  );
}
