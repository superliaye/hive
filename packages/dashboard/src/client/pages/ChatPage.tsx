import { useState, useCallback } from 'react';
import { ChatFeed } from '../components/chat/ChatFeed';
import { ChatInput } from '../components/chat/ChatInput';
import { useApi } from '../hooks/useApi';
import { useSSEEvent } from '../hooks/useSSE';
import type { Message, OrgMeta } from '../types';

export function ChatPage() {
  const { data: meta } = useApi<OrgMeta>('/api/org/meta');
  const conversation = meta?.rootConversation;
  const { data: messages, setData } = useApi<Message[]>(
    conversation ? `/api/conversations/${conversation}/messages?limit=100` : null,
  );
  const [rootWorking, setRootWorking] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  useSSEEvent('new-message', useCallback((event: any) => {
    if (conversation && event.conversation === conversation) {
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

  // Track root agent (CEO) working status via agent-state SSE events
  useSSEEvent('agent-state', useCallback((event: any) => {
    if (meta?.rootAlias && event.agentId === meta.rootAlias) {
      setRootWorking(event.status === 'working');
    }
  }, [meta?.rootAlias]));

  const rootName = meta?.rootName ?? 'CEO';

  const sendMessage = async (text: string): Promise<boolean> => {
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        setSendError(body || `Send failed (HTTP ${res.status})`);
        return false;
      }
      return true;
    } catch {
      setSendError('Network error — message not sent. Please try again.');
      return false;
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
      {sendError && (
        <div className="mx-4 mb-2 px-4 py-2.5 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center justify-between gap-3">
          <p className="text-sm text-red-400">{sendError}</p>
          <button
            onClick={() => setSendError(null)}
            className="text-red-400 hover:text-red-300 text-xs shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}
      <ChatInput onSend={sendMessage} disabled={sending} rootName={rootName} />
    </div>
  );
}
