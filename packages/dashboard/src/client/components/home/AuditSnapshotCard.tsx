import { useState, useCallback } from 'react';
import { useApi } from '../../hooks/useApi';
import { useSSEEvent } from '../../hooks/useSSE';
import { DashboardCard } from '../shared';
import type { Invocation } from '../../types';

export function AuditSnapshotCard() {
  const { data: totals, setData: setTotals } = useApi<{ totalIn: number; totalOut: number }>('/api/audit/totals');
  const { data: recent, setData: setRecent } = useApi<Invocation[]>('/api/audit?limit=5');

  // Real-time: accumulate token counts and prepend new invocations from SSE
  useSSEEvent('audit-invocation', useCallback((inv: any) => {
    setTotals(prev => prev ? {
      totalIn: prev.totalIn + (inv.tokensIn ?? 0),
      totalOut: prev.totalOut + (inv.tokensOut ?? 0),
    } : prev);
    setRecent(prev => {
      if (!prev) return prev;
      const entry: Invocation = {
        id: inv.id,
        agentId: inv.agentId,
        invocationType: inv.invocationType,
        model: inv.model,
        tokensIn: inv.tokensIn,
        tokensOut: inv.tokensOut,
        durationMs: inv.durationMs,
        timestamp: new Date().toISOString(),
      };
      return [entry, ...prev].slice(0, 5);
    });
  }, [setTotals, setRecent]));

  return (
    <DashboardCard title="Token Usage" icon={'\u25A7'} linkTo="/audit">
      {totals ? (
        <>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <p className="text-lg font-bold text-slate-200">{formatTokens(totals.totalIn)}</p>
              <p className="text-xs text-slate-500">tokens in</p>
            </div>
            <div>
              <p className="text-lg font-bold text-slate-200">{formatTokens(totals.totalOut)}</p>
              <p className="text-xs text-slate-500">tokens out</p>
            </div>
          </div>
          {recent && recent.length > 0 && (
            <div className="space-y-1">
              {recent.slice(0, 3).map(inv => (
                <div key={inv.id} className="flex items-center gap-2 text-xs text-slate-400">
                  <span className="font-mono">{inv.agentId}</span>
                  <span className="text-slate-600">{inv.invocationType}</span>
                  <span className="ml-auto text-slate-500">{inv.tokensIn ?? 0}+{inv.tokensOut ?? 0}</span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="text-xs text-slate-500">Loading...</p>
      )}
    </DashboardCard>
  );
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}
