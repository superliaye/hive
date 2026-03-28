import { useCallback } from 'react';
import { useApi } from '../../hooks/useApi';
import { useSSEEvent } from '../../hooks/useSSE';
import { ConversationMessage } from './ConversationMessage';
import { EmptyState } from '../shared';
import type { Message, MessagesResponse } from '../../types';

export function ConversationFeed({ conversation }: { conversation: string }) {
  const { data: messagesData, setData } = useApi<MessagesResponse>(`/api/conversations/${conversation}/messages?limit=50`);
  const messages = messagesData?.messages;

  useSSEEvent('new-message', useCallback((event: any) => {
    if (event.conversation === conversation) {
      setData(prev => {
        const msgs = prev?.messages ?? [];
        const exists = msgs.some(m => m.id === event.id);
        if (exists) return prev;
        return {
          messages: [...msgs, {
            id: event.id,
            sender: event.sender,
            content: event.content,
            timestamp: event.timestamp,
            conversation: event.conversation,
          }],
          total: (prev?.total ?? 0) + 1,
        };
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
