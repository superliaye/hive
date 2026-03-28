import { useApi } from '../../hooks/useApi';
import { formatConversationName } from '../shared';
import type { Conversation, Agent } from '../../types';

interface ConversationListProps {
  selectedConversation: string | null;
  onSelectConversation: (name: string) => void;
}

export function ConversationList({ selectedConversation, onSelectConversation }: ConversationListProps) {
  const { data: conversations } = useApi<Conversation[]>('/api/conversations');
  const { data: agents } = useApi<Agent[]>('/api/agents');

  const agentMap = new Map(agents?.map(a => [a.id, a]) ?? []);

  return (
    <div className="w-full md:w-56 border-r border-slate-800 flex flex-col shrink-0">
      <div className="p-4 border-b border-slate-800">
        <h3 className="text-sm font-medium text-slate-300">Conversations</h3>
      </div>
      <div className="flex-1 overflow-auto py-1">
        {conversations?.map(ch => (
          <button
            key={ch.name}
            onClick={() => onSelectConversation(ch.name)}
            className={`w-full text-left px-4 py-2 text-sm transition-colors cursor-pointer ${
              selectedConversation === ch.name
                ? 'bg-slate-800 text-amber-500'
                : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
            }`}
          >
            <span className="flex items-center min-w-0">
              <span className="truncate">{formatConversationName(ch.name, agentMap, ch.members, ch.displayName)}</span>
              <span className="text-xs text-slate-600 ml-2 shrink-0">{ch.messageCount} msgs</span>
            </span>
          </button>
        ))}
        {conversations?.length === 0 && (
          <p className="text-xs text-slate-500 px-4 py-2">No conversations</p>
        )}
      </div>
    </div>
  );
}
