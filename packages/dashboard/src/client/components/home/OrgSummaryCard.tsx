import { useApi } from '../../hooks/useApi';
import { useSSEEvent } from '../../hooks/useSSE';
import { DashboardCard, StatusDot } from '../shared';
import type { Agent } from '../../types';

export function OrgSummaryCard() {
  const { data: agents, setData } = useApi<Agent[]>('/api/agents');

  useSSEEvent('agent-state', (event) => {
    setData(prev => prev?.map(a =>
      a.id === event.agentId ? { ...a, status: event.status, currentTask: event.currentTask } : a
    ) ?? null);
  });

  return (
    <DashboardCard title="Organization" icon={'\u25C8'} linkTo="/org">
      {agents ? (
        <div className="space-y-1.5">
          {agents.map(a => (
            <div key={a.id} className="flex items-center gap-2 text-sm">
              <StatusDot status={a.status} />
              <span>{a.emoji ?? '\u25B9'}</span>
              <span className="text-slate-300 truncate">{a.name}</span>
              <span className="ml-auto text-xs text-slate-500 font-mono">{a.status}</span>
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
