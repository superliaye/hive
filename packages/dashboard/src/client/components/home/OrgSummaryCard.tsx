import { useApi } from '../../hooks/useApi';
import { useSSEEvent } from '../../hooks/useSSE';
import { DashboardCard, StatusDot, timeAgo } from '../shared';
import type { Agent } from '../../types';

export function OrgSummaryCard() {
  const { data: agents, setData } = useApi<Agent[]>('/api/agents');

  useSSEEvent('agent-state', (event) => {
    setData(prev => prev?.map(a =>
      a.id === event.agentId
        ? { ...a, status: event.status, currentTask: event.currentTask, lastInvocation: event.lastInvocation ?? a.lastInvocation }
        : a
    ) ?? null);
  });

  return (
    <DashboardCard title="Organization" icon={'\u25C8'} linkTo="/org">
      {agents ? (
        <div className="space-y-2">
          {agents.map(a => (
            <div key={a.id} className="flex items-center gap-2 text-sm min-w-0">
              <StatusDot status={a.status} />
              <span className="shrink-0">{a.emoji ?? '\u25B9'}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-300 truncate">{a.name}</span>
                  {a.role && (
                    <span className="text-[11px] text-slate-500 truncate hidden sm:inline">&middot; {a.role}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-auto">
                {a.lastInvocation && (
                  <span className="text-[11px] text-slate-600 hidden md:inline">{timeAgo(a.lastInvocation)}</span>
                )}
                <span className="text-xs text-slate-500 font-mono">{a.status}</span>
              </div>
            </div>
          ))}
          <p className="text-xs text-slate-500 mt-2">{agents.length} agents</p>
        </div>
      ) : (
        <p className="text-xs text-slate-500">Loading...</p>
      )}
    </DashboardCard>
  );
}
