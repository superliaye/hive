import { useState } from 'react';
import { ChannelList } from '../components/channels/ChannelList';
import { ChannelFeed } from '../components/channels/ChannelFeed';

export function ChannelsPage() {
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);

  return (
    <div className="flex flex-col md:flex-row h-full -m-3 md:-m-6">
      {/* Channel list: full width on mobile when no channel selected */}
      <div className={`md:block ${selectedChannel ? 'hidden' : 'block'}`}>
        <ChannelList
          selectedChannel={selectedChannel}
          onSelectChannel={setSelectedChannel}
        />
      </div>
      <div className="flex-1 min-w-0">
        {selectedChannel ? (
          <div className="flex flex-col h-full">
            <div className="px-4 md:px-6 py-3 border-b border-slate-800 shrink-0 flex items-center gap-3">
              <button
                onClick={() => setSelectedChannel(null)}
                className="md:hidden text-xs text-slate-500 hover:text-slate-300"
              >
                &larr; Back
              </button>
              <h2 className="text-lg font-medium text-slate-200 font-mono">#{selectedChannel}</h2>
            </div>
            <div className="flex-1 overflow-auto">
              <ChannelFeed channel={selectedChannel} />
            </div>
          </div>
        ) : (
          <div className="hidden md:flex items-center justify-center h-full text-slate-500 text-sm">
            Select a channel to view messages
          </div>
        )}
      </div>
    </div>
  );
}
