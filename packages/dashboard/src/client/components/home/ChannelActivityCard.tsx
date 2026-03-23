import { useApi } from '../../hooks/useApi';
import { DashboardCard, timeAgo } from '../shared';
import type { Channel, Message } from '../../types';
import { useEffect, useState } from 'react';

interface ChannelPreview {
  name: string;
  lastMessage?: Message;
}

export function ChannelActivityCard() {
  const { data: channels } = useApi<Channel[]>('/api/channels');
  const [previews, setPreviews] = useState<ChannelPreview[]>([]);

  useEffect(() => {
    if (!channels) return;
    Promise.all(
      channels.slice(0, 5).map(async (ch) => {
        try {
          const res = await fetch(`/api/channels/${ch.name}/messages?limit=1`);
          const msgs: Message[] = await res.json();
          return { name: ch.name, lastMessage: msgs[0] };
        } catch {
          return { name: ch.name };
        }
      })
    ).then(setPreviews);
  }, [channels]);

  return (
    <DashboardCard title="Channel Activity" icon={'\u25A3'} linkTo="/channels">
      {previews.length > 0 ? (
        <div className="space-y-2">
          {previews.map(p => (
            <div key={p.name} className="text-xs">
              <div className="flex items-center gap-1.5">
                <span className="text-amber-500 font-mono">#{p.name}</span>
                {p.lastMessage && (
                  <span className="text-slate-600 ml-auto">{timeAgo(p.lastMessage.timestamp)}</span>
                )}
              </div>
              {p.lastMessage && (
                <p className="text-slate-400 truncate mt-0.5">
                  {p.lastMessage.sender}: {p.lastMessage.content.slice(0, 60)}
                </p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-500">No channels yet</p>
      )}
    </DashboardCard>
  );
}
