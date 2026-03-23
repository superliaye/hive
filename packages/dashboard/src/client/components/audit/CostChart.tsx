import { useApi } from '../../hooks/useApi';
import type { Agent } from '../../types';

export function CostChart({ agents }: { agents: Agent[] }) {
  // Fetch per-agent totals
  const agentTotals = agents.map(a => {
    const { data } = useApi<{ totalIn: number; totalOut: number }>(`/api/audit/totals?agentId=${a.id}`);
    return { agent: a, totals: data };
  });

  const maxTotal = Math.max(
    ...agentTotals.map(at => (at.totals?.totalIn ?? 0) + (at.totals?.totalOut ?? 0)),
    1,
  );

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
      <h3 className="text-sm font-medium text-slate-400 mb-4">Per-Agent Breakdown</h3>
      <div className="space-y-3">
        {agentTotals.map(({ agent, totals }) => {
          const total = (totals?.totalIn ?? 0) + (totals?.totalOut ?? 0);
          const pct = total > 0 ? (total / maxTotal) * 100 : 0;
          return (
            <div key={agent.id} className="flex items-center gap-3">
              <span className="text-sm w-24 truncate text-slate-300">
                {agent.emoji ?? '\u25B9'} {agent.name}
              </span>
              <div className="flex-1 bg-slate-800 rounded-full h-2.5 overflow-hidden">
                <div
                  className="bg-amber-500 h-full rounded-full transition-all duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-xs text-slate-500 w-28 text-right font-mono">
                {(totals?.totalIn ?? 0).toLocaleString()} / {(totals?.totalOut ?? 0).toLocaleString()}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
