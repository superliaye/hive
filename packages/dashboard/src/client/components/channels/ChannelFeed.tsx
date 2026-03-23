import { useCallback } from 'react';
import { useApi } from '../../hooks/useApi';
import { useSSEEvent } from '../../hooks/useSSE';
import { ChannelMessage } from './ChannelMessage';
import { EmptyState } from '../shared';
import type { Message } from '../../types';

export function ChannelFeed({ channel }: { channel: string }) {
  const { data: messages, setData } = useApi<Message[]>(`/api/channels/${channel}/messages?limit=50`);

  useSSEEvent('new-message', useCallback((event: any) => {
    if (event.channel === channel) {
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

  if (!messages) return <EmptyState message="Loading messages..." />;
  if (messages.length === 0) return <EmptyState message="No messages in this channel" />;

  return (
    <div className="overflow-auto">
      {messages.map(m => (
        <ChannelMessage key={m.id} message={m} />
      ))}
    </div>
  );
}
