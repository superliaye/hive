import { useState, useCallback } from 'react';
import { useApi } from '../../hooks/useApi';
import { useSSEEvent } from '../../hooks/useSSE';
import { DashboardCard, timeAgo } from '../shared';
import type { Message, OrgMeta } from '../../types';

export function RecentChatCard() {
  const { data: meta } = useApi<OrgMeta>('/api/org/meta');
  const { data: messages, setData } = useApi<Message[]>('/api/channels/board/messages?limit=5');
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  useSSEEvent('new-message', useCallback((event: any) => {
    if (event.channel === 'board') {
      setData(prev => [...(prev ?? []).slice(-4), {
        id: event.id,
        sender: event.sender,
        content: event.content,
        timestamp: event.timestamp,
        channel: 'board',
      }]);
    }
  }, [setData]));

  const send = async () => {
    if (!input.trim() || sending) return;
    setSending(true);
    try {
      await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: input.trim() }),
      });
      setInput('');
    } finally {
      setSending(false);
    }
  };

  const rootName = meta?.rootName ?? 'CEO';

  return (
    <DashboardCard title={`${rootName} Chat (#board)`} icon={'\u25C9'} linkTo="/chat">
      <div className="space-y-2 mb-3">
        {messages && messages.length > 0 ? (
          messages.slice(-3).map(m => (
            <div key={m.id} className="text-xs">
              <span className="text-slate-400 font-medium">{m.sender}: </span>
              <span className="text-slate-300 truncate">{m.content.slice(0, 80)}{m.content.length > 80 ? '...' : ''}</span>
              <span className="text-slate-600 ml-1">{timeAgo(m.timestamp)}</span>
            </div>
          ))
        ) : (
          <p className="text-xs text-slate-500">No messages yet</p>
        )}
      </div>
      <div className="flex gap-2" onClick={(e) => e.preventDefault()}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
          placeholder={`Message ${rootName}...`}
          className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500"
        />
        <button
          onClick={send}
          disabled={sending || !input.trim()}
          className="px-2 py-1 bg-amber-500 text-slate-950 text-xs rounded font-medium disabled:opacity-50 hover:bg-amber-400 transition-colors"
        >
          Send
        </button>
      </div>
    </DashboardCard>
  );
}
