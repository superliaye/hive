import { useApi } from '../../hooks/useApi';
import { formatChannelName } from '../shared';
import type { Channel, Agent } from '../../types';

interface ChannelListProps {
  selectedChannel: string | null;
  onSelectChannel: (name: string) => void;
}

export function ChannelList({ selectedChannel, onSelectChannel }: ChannelListProps) {
  const { data: channels } = useApi<Channel[]>('/api/channels');
  const { data: agents } = useApi<Agent[]>('/api/agents');

  const agentMap = new Map(agents?.map(a => [a.id, a]) ?? []);

  return (
    <div className="w-full md:w-56 border-r border-slate-800 flex flex-col shrink-0">
      <div className="p-4 border-b border-slate-800">
        <h3 className="text-sm font-medium text-slate-300">Channels</h3>
      </div>
      <div className="flex-1 overflow-auto py-1">
        {channels?.map(ch => (
          <button
            key={ch.name}
            onClick={() => onSelectChannel(ch.name)}
            className={`w-full text-left px-4 py-2 text-sm transition-colors cursor-pointer ${
              selectedChannel === ch.name
                ? 'bg-slate-800 text-amber-500'
                : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
            }`}
          >
            <span>{formatChannelName(ch.name, agentMap, ch.members, ch.displayName)}</span>
            <span className="text-xs text-slate-600 ml-2">{ch.messageCount} msgs</span>
          </button>
        ))}
        {channels?.length === 0 && (
          <p className="text-xs text-slate-500 px-4 py-2">No channels</p>
        )}
      </div>
    </div>
  );
}
