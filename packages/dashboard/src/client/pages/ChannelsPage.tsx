import { useState } from 'react';
import { ChannelList } from '../components/channels/ChannelList';
import { ChannelFeed } from '../components/channels/ChannelFeed';

export function ChannelsPage() {
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);

  return (
    <div className="flex h-full -m-6">
      <ChannelList
        selectedChannel={selectedChannel}
        onSelectChannel={setSelectedChannel}
      />
      <div className="flex-1">
        {selectedChannel ? (
          <div className="flex flex-col h-full">
            <div className="px-6 py-3 border-b border-slate-800 shrink-0">
              <h2 className="text-lg font-medium text-slate-200 font-mono">#{selectedChannel}</h2>
            </div>
            <div className="flex-1 overflow-auto">
              <ChannelFeed channel={selectedChannel} />
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-slate-500 text-sm">
            Select a channel to view messages
          </div>
        )}
      </div>
    </div>
  );
}
