import { StatusDot } from '../shared';
import type { OrgAgent, Agent } from '../../types';

interface AgentNodeProps {
  orgAgent: OrgAgent;
  state?: Agent;
  selected: boolean;
  onClick: () => void;
}

export function AgentNode({ orgAgent, state, selected, onClick }: AgentNodeProps) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-3 rounded-lg border transition-all text-left min-w-[140px] ${
        selected
          ? 'bg-amber-500/10 border-amber-500'
          : 'bg-slate-900 border-slate-800 hover:border-slate-700'
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-base">{orgAgent.emoji ?? '\u25B9'}</span>
        <span className="text-sm font-medium text-slate-200 truncate">{orgAgent.name}</span>
      </div>
      <div className="flex items-center gap-2">
        <StatusDot status={state?.status ?? 'idle'} />
        <span className="text-xs text-slate-500">{state?.status ?? 'idle'}</span>
        <span className="text-xs text-slate-600 ml-auto font-mono">{orgAgent.model}</span>
      </div>
    </button>
  );
}
