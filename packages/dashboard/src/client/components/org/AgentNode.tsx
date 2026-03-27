import { StatusDot, timeAgo } from '../shared';
import type { OrgAgent, Agent } from '../../types';

interface AgentNodeProps {
  orgAgent: OrgAgent;
  state?: Agent;
  selected: boolean;
  onClick: () => void;
  compact?: boolean;
}

export function AgentNode({ orgAgent, state, selected, onClick, compact }: AgentNodeProps) {
  const status = state?.status ?? 'idle';
  const lastActive = state?.lastInvocation;

  if (compact) {
    return (
      <button
        onClick={onClick}
        className={`w-full px-3 py-2 rounded-lg border transition-all text-left cursor-pointer ${
          selected
            ? 'bg-amber-500/10 border-amber-500'
            : 'bg-slate-900 border-slate-800 hover:border-slate-700'
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="text-base shrink-0">{orgAgent.emoji ?? '\u25B9'}</span>
          <span className="text-sm font-medium text-slate-200 truncate">{orgAgent.name}</span>
          <StatusDot status={status} />
          <span className="text-xs text-slate-500">{status}</span>
          {orgAgent.role && (
            <span className="text-[11px] text-slate-500 truncate ml-auto hidden min-[420px]:inline">{orgAgent.role}</span>
          )}
        </div>
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      className={`px-4 py-3 rounded-lg border transition-all text-left min-w-[140px] cursor-pointer ${
        selected
          ? 'bg-amber-500/10 border-amber-500'
          : 'bg-slate-900 border-slate-800 hover:border-slate-700'
      }`}
    >
      <div className="flex items-center gap-2 mb-0.5">
        <span className="text-base">{orgAgent.emoji ?? '\u25B9'}</span>
        <span className="text-sm font-medium text-slate-200 truncate">{orgAgent.name}</span>
      </div>
      {orgAgent.role && (
        <p className="text-[11px] text-slate-500 ml-7 truncate">{orgAgent.role}</p>
      )}
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
