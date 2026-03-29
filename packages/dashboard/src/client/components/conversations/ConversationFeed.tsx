import { useCallback, useEffect, useRef } from 'react';
import { useApi } from '../../hooks/useApi';
import { useSSEEvent } from '../../hooks/useSSE';
import { ConversationMessage } from './ConversationMessage';
import { EmptyState } from '../shared';
import type { MessagesResponse } from '../../types';

export interface ConversationFeedProps {
  conversation: string;
  focusedSender?: string;
}

export function ConversationFeed({ conversation, focusedSender }: ConversationFeedProps) {
  const { data: messagesData, setData } = useApi<MessagesResponse>(`/api/conversations/${conversation}/messages?limit=50`);
  const messages = messagesData?.messages;
  const bottomRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages?.length]);

  if (!messages) return <EmptyState message="Loading messages..." />;
  if (messages.length === 0) return <EmptyState message="No messages in this conversation" />;

  return (
    <div className="overflow-auto py-3">
      {messages.map(m => (
        <ConversationMessage
          key={m.id}
          message={m}
          isFocused={m.sender === focusedSender}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
