import { useApi } from '../../hooks/useApi';
import { useSSEEvent } from '../../hooks/useSSE';
import { DashboardCard, timeAgo, formatConversationName } from '../shared';
import type { Conversation, Message, Agent } from '../../types';
import { useEffect, useState, useCallback } from 'react';

interface ConversationPreview {
  name: string;
  displayName?: string;
  members: string[];
  recentMessages: Message[];
}

export function ConversationActivityCard() {
  const { data: conversations } = useApi<Conversation[]>('/api/conversations');
  const { data: agents } = useApi<Agent[]>('/api/agents');
  const [previews, setPreviews] = useState<ConversationPreview[]>([]);
  const agentMap = new Map(agents?.map(a => [a.id, a]) ?? []);

  useEffect(() => {
    if (!conversations) return;
    Promise.all(
      conversations.map(async (ch) => {
        try {
          const res = await fetch(`/api/conversations/${ch.name}/messages?limit=3`);
          const msgs: Message[] = await res.json();
          return { name: ch.name, displayName: ch.displayName, members: ch.members, recentMessages: msgs };
        } catch {
          return { name: ch.name, displayName: ch.displayName, members: ch.members, recentMessages: [] as Message[] };
        }
      })
    ).then(all => {
      // Sort by most recent message, conversations with messages first
      const sorted = all.sort((a, b) => {
        const aLast = a.recentMessages[a.recentMessages.length - 1];
        const bLast = b.recentMessages[b.recentMessages.length - 1];
        if (!aLast && !bLast) return 0;
        if (!aLast) return 1;
        if (!bLast) return -1;
        return new Date(bLast.timestamp).getTime() - new Date(aLast.timestamp).getTime();
      });
      setPreviews(sorted.slice(0, 5));
    });
  }, [conversations]);

  // Real-time: update conversation previews when new messages arrive via SSE
  useSSEEvent('new-message', useCallback((event: any) => {
    const newMsg: Message = { id: event.id, sender: event.sender, content: event.content, timestamp: event.timestamp, conversation: event.conversation };
    setPreviews(prev => prev.map(p =>
      p.name === event.conversation
        ? { ...p, recentMessages: [...p.recentMessages.slice(-2), newMsg] }
        : p
    ));
  }, []));

  return (
    <DashboardCard title="Conversation Activity" icon={'\u25A3'} linkTo="/conversations">
      {previews.length > 0 ? (
        <div className="space-y-3">
          {previews.map(p => {
            const lastMsg = p.recentMessages[p.recentMessages.length - 1];
            return (
              <div key={p.name} className="text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="text-amber-500">{formatConversationName(p.name, agentMap, p.members, p.displayName)}</span>
                  {lastMsg && (
                    <span className="text-slate-600 ml-auto">{timeAgo(lastMsg.timestamp)}</span>
                  )}
                </div>
                {p.recentMessages.length > 0 ? (
                  <div className="mt-1 space-y-0.5">
                    {p.recentMessages.map(m => (
                      <p key={m.id} className="text-slate-400 truncate">
                        <span className="text-slate-500">{m.sender}:</span> {m.content.slice(0, 60)}
                      </p>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-slate-500">No conversations yet</p>
      )}
    </DashboardCard>
  );
}
