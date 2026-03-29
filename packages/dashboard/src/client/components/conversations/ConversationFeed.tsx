import { useCallback, useEffect, useRef } from 'react';
import { useApi } from '../../hooks/useApi';
import { useSSEEvent } from '../../hooks/useSSE';
import { ConversationMessage } from './ConversationMessage';
import { EmptyState } from '../shared';
import type { Agent, MessagesResponse } from '../../types';

export interface ConversationFeedProps {
  conversation: string;
  focusedSender?: string;
  /** Optional agent map for resolving emoji/names in message bubbles */
  agentMap?: Map<string, Agent>;
}

export function ConversationFeed({ conversation, focusedSender, agentMap }: ConversationFeedProps) {
  const { data: messagesData, setData } = useApi<MessagesResponse>(`/api/conversations/${conversation}/messages?limit=50`);
  const messages = messagesData?.messages;
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Track whether user is near the bottom (within 150px) for smart auto-scroll
  const isNearBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 150;
  }, []);

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

  // Smart auto-scroll: only scroll to bottom if user was already near the bottom
  const prevLengthRef = useRef(0);
  useEffect(() => {
    const len = messages?.length ?? 0;
    if (len > prevLengthRef.current) {
      // Initial load — always scroll to bottom
      if (prevLengthRef.current === 0) {
        bottomRef.current?.scrollIntoView({ behavior: 'instant' });
      } else if (isNearBottom()) {
        // New message arrived and user was near bottom — scroll smoothly
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
    }
    prevLengthRef.current = len;
  }, [messages?.length, isNearBottom]);

  if (!messages) return <EmptyState message="Loading messages..." />;
  if (messages.length === 0) return <EmptyState message="No messages in this conversation" />;

  return (
    <div ref={containerRef} className="overflow-auto h-full py-3">
      {messages.map(m => (
        <ConversationMessage
          key={m.id}
          message={m}
          isFocused={m.sender === focusedSender}
          agent={agentMap?.get(m.sender)}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
