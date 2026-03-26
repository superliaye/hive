import { useApi } from '../../hooks/useApi';
import { useSSEEvent } from '../../hooks/useSSE';
import { DashboardCard, timeAgo } from '../shared';
import type { Channel, Message } from '../../types';
import { useEffect, useState, useCallback } from 'react';

interface ChannelPreview {
  name: string;
  recentMessages: Message[];
}

export function ChannelActivityCard() {
  const { data: channels } = useApi<Channel[]>('/api/channels');
  const [previews, setPreviews] = useState<ChannelPreview[]>([]);

  useEffect(() => {
    if (!channels) return;
    Promise.all(
      channels.map(async (ch) => {
        try {
          const res = await fetch(`/api/channels/${ch.name}/messages?limit=3`);
          const msgs: Message[] = await res.json();
          return { name: ch.name, recentMessages: msgs };
        } catch {
          return { name: ch.name, recentMessages: [] as Message[] };
        }
      })
    ).then(all => {
      // Sort by most recent message, channels with messages first
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
  }, [channels]);

  // Real-time: update channel previews when new messages arrive via SSE
  useSSEEvent('new-message', useCallback((event: any) => {
    const newMsg: Message = { id: event.id, sender: event.sender, content: event.content, timestamp: event.timestamp, channel: event.channel };
    setPreviews(prev => prev.map(p =>
      p.name === event.channel
        ? { ...p, recentMessages: [...p.recentMessages.slice(-2), newMsg] }
        : p
    ));
  }, []));

  return (
    <DashboardCard title="Channel Activity" icon={'\u25A3'} linkTo="/channels">
      {previews.length > 0 ? (
        <div className="space-y-3">
          {previews.map(p => {
            const lastMsg = p.recentMessages[p.recentMessages.length - 1];
            return (
              <div key={p.name} className="text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="text-amber-500 font-mono">#{p.name}</span>
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
        <p className="text-xs text-slate-500">No channels yet</p>
      )}
    </DashboardCard>
  );
}
