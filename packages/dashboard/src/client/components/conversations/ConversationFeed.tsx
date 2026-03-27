import { useCallback } from 'react';
import { useApi } from '../../hooks/useApi';
import { useSSEEvent } from '../../hooks/useSSE';
import { ConversationMessage } from './ConversationMessage';
import { EmptyState } from '../shared';
import type { Message } from '../../types';

export function ConversationFeed({ conversation }: { conversation: string }) {
  const { data: messages, setData } = useApi<Message[]>(`/api/conversations/${conversation}/messages?limit=50`);

  useSSEEvent('new-message', useCallback((event: any) => {
    if (event.conversation === conversation) {
      setData(prev => {
        const exists = prev?.some(m => m.id === event.id);
        if (exists) return prev;
        return [...(prev ?? []), {
          id: event.id,
          sender: event.sender,
          content: event.content,
          timestamp: event.timestamp,
          conversation: event.conversation,
        }];
      });
    }
  }, [conversation, setData]));

  if (!messages) return <EmptyState message="Loading messages..." />;
  if (messages.length === 0) return <EmptyState message="No messages in this conversation" />;

  return (
    <div className="overflow-auto">
      {messages.map(m => (
        <ConversationMessage key={m.id} message={m} />
      ))}
    </div>
  );
}
