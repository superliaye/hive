import { useState } from 'react';
import { TokenSummary } from '../components/audit/TokenSummary';
import { AuditTable } from '../components/audit/AuditTable';
import { CostChart } from '../components/audit/CostChart';
import { useApi } from '../hooks/useApi';
import type { Invocation, Agent } from '../types';

export function AuditPage() {
  const [filters, setFilters] = useState({ agentId: '', type: '' });
  const queryParts: string[] = [];
  if (filters.agentId) queryParts.push(`agentId=${filters.agentId}`);
  if (filters.type) queryParts.push(`type=${filters.type}`);
  const queryString = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';

  const { data: invocations } = useApi<Invocation[]>(`/api/audit${queryString}&limit=100`, { refreshInterval: 5000 });
  const { data: totals } = useApi<{ totalIn: number; totalOut: number }>('/api/audit/totals', { refreshInterval: 5000 });
  const { data: agents } = useApi<Agent[]>('/api/agents');

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-medium text-slate-200">Audit & Cost</h2>

      <TokenSummary totals={totals} invocationCount={invocations?.length ?? 0} />

      <div className="flex gap-3">
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
        <select
          value={filters.type}
          onChange={e => setFilters(f => ({ ...f, type: e.target.value }))}
          className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-amber-500"
        >
          <option value="">All types</option>
          <option value="main">main</option>
          <option value="triage">triage</option>
          <option value="memory">memory</option>
          <option value="comms">comms</option>
        </select>
      </div>

      <AuditTable invocations={invocations ?? []} />

      {agents && agents.length > 0 && <CostChart agents={agents} />}
    </div>
  );
}
