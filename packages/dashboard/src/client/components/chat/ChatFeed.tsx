import { useEffect, useRef } from 'react';
import { MessageBubble } from './MessageBubble';
import type { Message } from '../../types';

interface ChatFeedProps {
  messages: Message[];
  rootWorking: boolean;
  rootName: string;
}

export function ChatFeed({ messages, rootWorking, rootName }: ChatFeedProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, rootWorking]);

  return (
    <div className="flex-1 overflow-auto px-4 py-4">
      {messages.length === 0 ? (
        <div className="flex items-center justify-center h-full text-slate-500 text-sm">
          No messages yet. Send a message to start a conversation with {rootName}.
        </div>
      ) : (
        messages.map(m => (
          <MessageBubble
            key={m.id}
            sender={m.sender}
            content={m.content}
            timestamp={m.timestamp}
            isUser={m.sender === 'super-user'}
          />
        ))
      )}
      {rootWorking && (
        <div className="flex items-center gap-2 text-sm text-slate-500 mb-4">
          <span className="animate-pulse">{rootName} is typing...</span>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
