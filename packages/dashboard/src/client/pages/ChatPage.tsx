import { useState, useCallback } from 'react';
import { ChatFeed } from '../components/chat/ChatFeed';
import { ChatInput } from '../components/chat/ChatInput';
import { useApi } from '../hooks/useApi';
import { useSSEEvent } from '../hooks/useSSE';
import type { Message, OrgMeta } from '../types';

export function ChatPage() {
  const { data: meta } = useApi<OrgMeta>('/api/org/meta');
  const channel = meta?.boardChannel;
  const { data: messages, setData } = useApi<Message[]>(
    channel ? `/api/channels/${channel}/messages?limit=100` : null,
  );
  const [rootWorking, setRootWorking] = useState(false);
  const [sending, setSending] = useState(false);

  useSSEEvent('new-message', useCallback((event: any) => {
    if (channel && event.channel === channel) {
      setData(prev => {
        const exists = prev?.some(m => m.id === event.id);
        if (exists) return prev;
        return [...(prev ?? []), {
          id: event.id,
          sender: event.sender,
          content: event.content,
          timestamp: event.timestamp,
          channel: event.channel,
        }];
      });
    }
  }, [channel, setData]));

  // Track root agent (CEO) working status via agent-state SSE events
  useSSEEvent('agent-state', useCallback((event: any) => {
    if (meta?.rootAlias && event.agentId === meta.rootAlias) {
      setRootWorking(event.status === 'working');
    }
  }, [meta?.rootAlias]));

  const rootName = meta?.rootName ?? 'CEO';

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
    <div className="flex flex-col h-full -m-3 md:-m-6">
      <div className="border-b border-slate-800 px-4 md:px-6 py-3 shrink-0">
        <h2 className="text-lg font-medium text-slate-200">{rootName} Chat</h2>
        <p className="text-xs text-slate-500 font-mono">Direct message</p>
      </div>
      <ChatFeed messages={messages ?? []} rootWorking={rootWorking} rootName={rootName} />
      <ChatInput onSend={sendMessage} disabled={sending} rootName={rootName} />
    </div>
  );
}
