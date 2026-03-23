import { useState, useCallback } from 'react';
import { ChatFeed } from '../components/chat/ChatFeed';
import { ChatInput } from '../components/chat/ChatInput';
import { useApi } from '../hooks/useApi';
import { useSSEEvent } from '../hooks/useSSE';
import type { Message } from '../types';

export function ChatPage() {
  const { data: messages, setData } = useApi<Message[]>('/api/channels/board/messages?limit=100');
  const [ceoWorking, setCeoWorking] = useState(false);
  const [sending, setSending] = useState(false);

  useSSEEvent('new-message', useCallback((event: any) => {
    if (event.channel === 'board') {
      setData(prev => {
        const exists = prev?.some(m => m.id === event.id);
        if (exists) return prev;
        return [...(prev ?? []), {
          id: event.id,
          sender: event.sender,
          content: event.content,
          timestamp: event.timestamp,
          channel: 'board',
        }];
      });
    }
  }, [setData]));

  // Track CEO working status via agent-state SSE events (set by daemon)
  useSSEEvent('agent-state', useCallback((event: any) => {
    if (event.agentId === 'ceo') {
      setCeoWorking(event.status === 'working');
    }
  }, []));

  const sendMessage = async (text: string) => {
    setSending(true);
    try {
      await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-full -m-6">
      <div className="border-b border-slate-800 px-6 py-3 shrink-0">
        <h2 className="text-lg font-medium text-slate-200">CEO Chat</h2>
        <p className="text-xs text-slate-500 font-mono">#board</p>
      </div>
      <ChatFeed messages={messages ?? []} ceoWorking={ceoWorking} />
      <ChatInput onSend={sendMessage} disabled={sending} />
    </div>
  );
}
