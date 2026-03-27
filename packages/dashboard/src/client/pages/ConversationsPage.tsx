import { useState } from 'react';
import { ConversationList } from '../components/conversations/ConversationList';
import { ConversationFeed } from '../components/conversations/ConversationFeed';
import { useApi } from '../hooks/useApi';
import { formatConversationName } from '../components/shared';
import type { Agent, Conversation } from '../types';

export function ConversationsPage() {
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null);
  const { data: agents } = useApi<Agent[]>('/api/agents');
  const { data: conversations } = useApi<Conversation[]>('/api/conversations');
  const agentMap = new Map(agents?.map(a => [a.id, a]) ?? []);
  const selectedCh = conversations?.find(ch => ch.name === selectedConversation);

  return (
    <div className="flex flex-col md:flex-row h-full -m-3 md:-m-6">
      {/* Conversation list: full width on mobile when no conversation selected */}
      <div className={`md:block ${selectedConversation ? 'hidden' : 'block'}`}>
        <ConversationList
          selectedConversation={selectedConversation}
          onSelectConversation={setSelectedConversation}
        />
      </div>
      <div className="flex-1 min-w-0">
        {selectedConversation ? (
          <div className="flex flex-col h-full">
            <div className="px-4 md:px-6 py-3 border-b border-slate-800 shrink-0 flex items-center gap-3">
              <button
                onClick={() => setSelectedConversation(null)}
                className="md:hidden text-xs text-slate-500 hover:text-slate-300"
              >
                &larr; Back
              </button>
              <h2 className="text-lg font-medium text-slate-200">{formatConversationName(selectedConversation, agentMap, selectedCh?.members, selectedCh?.displayName)}</h2>
            </div>
            <div className="flex-1 overflow-auto">
              <ConversationFeed conversation={selectedConversation} />
            </div>
          </div>
        ) : (
          <div className="hidden md:flex items-center justify-center h-full text-slate-500 text-sm">
            Select a conversation to view messages
          </div>
        )}
      </div>
    </div>
  );
}
