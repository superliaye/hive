import { Fragment, useState } from 'react';
import { timeAgo } from '../shared';
import type { Invocation } from '../../types';

function formatTokenTooltip(inv: Invocation): string {
  const parts = [`In: ${(inv.tokensIn ?? 0).toLocaleString()}`, `Out: ${(inv.tokensOut ?? 0).toLocaleString()}`];
  if (inv.cacheReadTokens) parts.push(`Cache read: ${inv.cacheReadTokens.toLocaleString()}`);
  if (inv.cacheCreationTokens) parts.push(`Cache creation: ${inv.cacheCreationTokens.toLocaleString()}`);
  return parts.join(' | ');
}

function FullDetailPanel({ invocationId }: { invocationId: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [detail, setDetail] = useState<{ fullInput: string | null; fullOutput: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showInput, setShowInput] = useState(true);
  const [showOutput, setShowOutput] = useState(true);

  const fetchDetail = async () => {
    if (state === 'loaded') {
      // Toggle visibility — already fetched
      setState('idle');
      return;
    }
    setState('loading');
    try {
      const res = await fetch(`/api/audit/${invocationId}/detail`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Unknown error' }));
        setError(body.error ?? `HTTP ${res.status}`);
        setState('error');
        return;
      }
      const data = await res.json();
      setDetail(data);
      setState('loaded');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
      setState('error');
    }
  };

  return (
    <div className="mt-2 pt-2 border-t border-slate-700/50">
      <button
        onClick={fetchDetail}
        className="text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
      >
        {state === 'loading' ? 'Loading...' : state === 'loaded' ? 'Hide full detail' : 'View full input/output'}
      </button>

      {state === 'error' && (
        <p className="text-xs text-red-400 mt-1">{error}</p>
      )}

      {state === 'loaded' && detail && (
        <div className="mt-2 space-y-2">
          {detail.fullInput && (
            <div>
              <button
                onClick={() => setShowInput(!showInput)}
                className="text-xs text-amber-500 hover:text-amber-400 font-medium"
              >
                {showInput ? '▼' : '▶'} Full Input
              </button>
              {showInput && (
                <pre className="mt-1 p-3 bg-slate-950 border border-slate-700 rounded text-xs text-slate-300 overflow-auto max-h-96 whitespace-pre-wrap font-mono">
                  {detail.fullInput}
                </pre>
              )}
            </div>
          )}
          {detail.fullOutput && (
            <div>
              <button
                onClick={() => setShowOutput(!showOutput)}
                className="text-xs text-amber-500 hover:text-amber-400 font-medium"
              >
                {showOutput ? '▼' : '▶'} Full Output
              </button>
              {showOutput && (
                <pre className="mt-1 p-3 bg-slate-950 border border-slate-700 rounded text-xs text-slate-300 overflow-auto max-h-96 whitespace-pre-wrap font-mono">
                  {detail.fullOutput}
                </pre>
              )}
            </div>
          )}
          {!detail.fullInput && !detail.fullOutput && (
            <p className="text-xs text-slate-500 mt-1">No full detail available (pruned or not recorded).</p>
          )}
        </div>
      )}
    </div>
  );
}

export function AuditTable({ invocations }: { invocations: Invocation[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Only show checkWork invocations (excludes triage-only or internal logging)
  const actionable = invocations.filter(inv => inv.invocationType === 'checkWork');

  if (actionable.length === 0) {
    return <p className="text-sm text-slate-500 py-8 text-center">No agent activity recorded</p>;
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-x-auto">
      <table className="w-full text-sm min-w-[480px]">
        <thead>
          <tr className="text-left text-xs text-slate-500 border-b border-slate-800 bg-slate-900/50">
            <th className="px-4 py-2">Agent</th>
            <th className="px-4 py-2">What it did</th>
            <th className="px-4 py-2 hidden sm:table-cell">Channel</th>
            <th className="px-4 py-2">Tokens</th>
            <th className="px-4 py-2 hidden md:table-cell">Duration</th>
            <th className="px-4 py-2">When</th>
          </tr>
        </thead>
        <tbody>
          {actionable.map((inv) => (
            <Fragment key={inv.id}>
              <tr
                onClick={() => setExpandedId(expandedId === inv.id ? null : inv.id)}
                className="border-b border-slate-800/50 text-slate-400 hover:bg-slate-800/30 cursor-pointer transition-colors"
              >
                <td className="px-4 py-2 font-mono text-xs">{inv.agentId}</td>
                <td className="px-4 py-2 text-xs max-w-xs truncate">
                  {inv.actionSummary
                    ? <span className="text-slate-200">{inv.actionSummary}</span>
                    : inv.outputSummary ? inv.outputSummary.slice(0, 80) : inv.inputSummary ?? '-'}
                </td>
                <td className="px-4 py-2 text-xs hidden sm:table-cell">
                  {inv.channel ? <span className="text-amber-500 font-mono">#{inv.channel}</span> : '-'}
                </td>
                <td className="px-4 py-2 text-xs">
                  <span title={formatTokenTooltip(inv)}>
                    {(inv.tokensIn ?? 0).toLocaleString()} / {(inv.tokensOut ?? 0).toLocaleString()}
                    {(inv.cacheReadTokens || inv.cacheCreationTokens) ? (
                      <span className="text-slate-600 ml-1 hidden lg:inline">
                        ({[
                          inv.cacheReadTokens ? `${inv.cacheReadTokens.toLocaleString()} cached` : '',
                          inv.cacheCreationTokens ? `${inv.cacheCreationTokens.toLocaleString()} new cache` : '',
                        ].filter(Boolean).join(', ')})
                      </span>
                    ) : null}
                  </span>
                </td>
                <td className="px-4 py-2 text-xs hidden md:table-cell">
                  {inv.durationMs ? `${(inv.durationMs / 1000).toFixed(1)}s` : '-'}
                </td>
                <td className="px-4 py-2 text-xs text-slate-500">{timeAgo(inv.timestamp)}</td>
              </tr>
              {expandedId === inv.id && (
                <tr className="border-b border-slate-800/50">
                  <td colSpan={6} className="px-4 py-3 bg-slate-800/20">
                    <div className="space-y-2 text-xs">
                      {inv.inputSummary && (
                        <div>
                          <span className="text-slate-500">Triggered by: </span>
                          <span className="text-slate-300">{inv.inputSummary}</span>
                        </div>
                      )}
                      {inv.outputSummary && (
                        <div>
                          <span className="text-slate-500">Response: </span>
                          <span className="text-slate-300">{inv.outputSummary}</span>
                        </div>
                      )}
                      {(inv.cacheReadTokens != null || inv.cacheCreationTokens != null) && (
                        <div>
                          <span className="text-slate-500">Cache tokens: </span>
                          <span className="text-slate-300">
                            {inv.cacheReadTokens != null ? `${inv.cacheReadTokens.toLocaleString()} read` : ''}
                            {inv.cacheReadTokens != null && inv.cacheCreationTokens != null ? ' + ' : ''}
                            {inv.cacheCreationTokens != null ? `${inv.cacheCreationTokens.toLocaleString()} created` : ''}
                          </span>
                        </div>
                      )}
                      <div>
                        <span className="text-slate-500">Model: </span>
                        <span className="text-slate-300">{inv.model}</span>
                      </div>
                      <FullDetailPanel invocationId={inv.id} />
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
