import { StatusDot, timeAgo } from '../shared';
import type { OrgAgent, Agent } from '../../types';

interface AgentNodeProps {
  orgAgent: OrgAgent;
  state?: Agent;
  selected: boolean;
  onClick: () => void;
}

export function AgentNode({ orgAgent, state, selected, onClick }: AgentNodeProps) {
  const status = state?.status ?? 'idle';
  const lastActive = state?.lastInvocation;

  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 md:px-4 md:py-3 rounded-lg border transition-all text-left min-w-[120px] md:min-w-[140px] ${
        selected
          ? 'bg-amber-500/10 border-amber-500'
          : 'bg-slate-900 border-slate-800 hover:border-slate-700'
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-base">{orgAgent.emoji ?? '\u25B9'}</span>
        <span className="text-sm font-medium text-slate-200 truncate">{orgAgent.name}</span>
      </div>
      <div className="flex items-center gap-1">
        <StatusDot status={status} />
        <span className="text-xs text-slate-500">{status}</span>
        {lastActive && status === 'idle' && (
          <span className="text-[10px] text-slate-600 ml-1">{timeAgo(lastActive)}</span>
        )}
        <span className="text-xs text-slate-600 ml-auto font-mono">{orgAgent.model}</span>
      </div>
    </button>
  );
}
