import { useState } from 'react';
import { TokenSummary } from '../components/audit/TokenSummary';
import { AuditTable } from '../components/audit/AuditTable';
import { CostChart } from '../components/audit/CostChart';
import { useApi } from '../hooks/useApi';
import type { Invocation, Agent } from '../types';

export function AuditPage() {
  const [filters, setFilters] = useState({ agentId: '' });
  const queryParts: string[] = [];
  if (filters.agentId) queryParts.push(`agentId=${filters.agentId}`);
  const queryString = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';

  const separator = queryString ? '&' : '?';
  const { data: invocations } = useApi<Invocation[]>(`/api/audit${queryString}${separator}limit=100`, { refreshInterval: 5000 });
  const { data: totals } = useApi<{ totalIn: number; totalOut: number }>('/api/audit/totals', { refreshInterval: 5000 });
  const { data: agents } = useApi<Agent[]>('/api/agents');

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-medium text-slate-200">Agent Activity</h2>

      <TokenSummary totals={totals} invocationCount={invocations?.filter(i => i.invocationType === 'checkWork').length ?? 0} />

      <div className="flex flex-wrap gap-3">
        <select
          value={filters.agentId}
          onChange={e => setFilters(f => ({ ...f, agentId: e.target.value }))}
          className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-amber-500"
        >
          <option value="">All agents</option>
          {agents?.map(a => (
            <option key={a.id} value={a.id}>{a.emoji ?? '\u25B9'} {a.name}</option>
          ))}
        </select>
      </div>

      <AuditTable invocations={invocations ?? []} />

      {agents && agents.length > 0 && <CostChart agents={agents} />}
    </div>
  );
}
