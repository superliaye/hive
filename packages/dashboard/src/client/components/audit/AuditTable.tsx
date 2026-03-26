import { useState } from 'react';
import { timeAgo } from '../shared';
import type { Invocation } from '../../types';

function formatTokenTooltip(inv: Invocation): string {
  const parts = [`In: ${(inv.tokensIn ?? 0).toLocaleString()}`, `Out: ${(inv.tokensOut ?? 0).toLocaleString()}`];
  if (inv.cacheReadTokens) parts.push(`Cache read: ${inv.cacheReadTokens.toLocaleString()}`);
  if (inv.cacheCreationTokens) parts.push(`Cache creation: ${inv.cacheCreationTokens.toLocaleString()}`);
  return parts.join(' | ');
}

export function AuditTable({ invocations }: { invocations: Invocation[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Only show invocations where agents actually did something (not comms logging)
  const actionable = invocations.filter(inv => inv.invocationType === 'checkWork');

  if (actionable.length === 0) {
    return <p className="text-sm text-slate-500 py-8 text-center">No agent activity recorded</p>;
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500 border-b border-slate-800 bg-slate-900/50">
            <th className="px-4 py-2">Agent</th>
            <th className="px-4 py-2">What it did</th>
            <th className="px-4 py-2">Channel</th>
            <th className="px-4 py-2">Tokens</th>
            <th className="px-4 py-2">Duration</th>
            <th className="px-4 py-2">When</th>
          </tr>
        </thead>
        <tbody>
          {actionable.map((inv) => (
            <>
              <tr
                key={inv.id}
                onClick={() => setExpandedId(expandedId === inv.id ? null : inv.id)}
                className="border-b border-slate-800/50 text-slate-400 hover:bg-slate-800/30 cursor-pointer transition-colors"
              >
                <td className="px-4 py-2 font-mono text-xs">{inv.agentId}</td>
                <td className="px-4 py-2 text-xs max-w-xs truncate">
                  {inv.actionSummary
                    ? <span className="text-slate-200">{inv.actionSummary}</span>
                    : inv.outputSummary ? inv.outputSummary.slice(0, 80) : inv.inputSummary ?? '-'}
                </td>
                <td className="px-4 py-2 text-xs">
                  {inv.channel ? <span className="text-amber-500 font-mono">#{inv.channel}</span> : '-'}
                </td>
                <td className="px-4 py-2 text-xs">
                  <span title={formatTokenTooltip(inv)}>
                    {(inv.tokensIn ?? 0).toLocaleString()} / {(inv.tokensOut ?? 0).toLocaleString()}
                    {(inv.cacheReadTokens || inv.cacheCreationTokens) ? (
                      <span className="text-slate-600 ml-1">
                        ({[
                          inv.cacheReadTokens ? `${inv.cacheReadTokens.toLocaleString()} cached` : '',
                          inv.cacheCreationTokens ? `${inv.cacheCreationTokens.toLocaleString()} new cache` : '',
                        ].filter(Boolean).join(', ')})
                      </span>
                    ) : null}
                  </span>
                </td>
                <td className="px-4 py-2 text-xs">
                  {inv.durationMs ? `${(inv.durationMs / 1000).toFixed(1)}s` : '-'}
                </td>
                <td className="px-4 py-2 text-xs text-slate-500">{timeAgo(inv.timestamp)}</td>
              </tr>
              {expandedId === inv.id && (
                <tr key={`${inv.id}-detail`} className="border-b border-slate-800/50">
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
                    </div>
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}
