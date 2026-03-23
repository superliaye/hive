import { useState } from 'react';
import { timeAgo } from '../shared';
import type { Invocation } from '../../types';

export function AuditTable({ invocations }: { invocations: Invocation[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (invocations.length === 0) {
    return <p className="text-sm text-slate-500 py-8 text-center">No invocations recorded</p>;
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500 border-b border-slate-800 bg-slate-900/50">
            <th className="px-4 py-2">#</th>
            <th className="px-4 py-2">Agent</th>
            <th className="px-4 py-2">Type</th>
            <th className="px-4 py-2">Model</th>
            <th className="px-4 py-2">Tokens</th>
            <th className="px-4 py-2">Duration</th>
            <th className="px-4 py-2">Time</th>
          </tr>
        </thead>
        <tbody>
          {invocations.map((inv, i) => (
            <>
              <tr
                key={inv.id}
                onClick={() => setExpandedId(expandedId === inv.id ? null : inv.id)}
                className="border-b border-slate-800/50 text-slate-400 hover:bg-slate-800/30 cursor-pointer transition-colors"
              >
                <td className="px-4 py-2 text-xs text-slate-600">{i + 1}</td>
                <td className="px-4 py-2 font-mono text-xs">{inv.agentId}</td>
                <td className="px-4 py-2 text-xs">{inv.invocationType}</td>
                <td className="px-4 py-2 text-xs">{inv.model}</td>
                <td className="px-4 py-2 text-xs">
                  {(inv.tokensIn ?? 0).toLocaleString()} / {(inv.tokensOut ?? 0).toLocaleString()}
                </td>
                <td className="px-4 py-2 text-xs">
                  {inv.durationMs ? `${(inv.durationMs / 1000).toFixed(1)}s` : '-'}
                </td>
                <td className="px-4 py-2 text-xs text-slate-500">{timeAgo(inv.timestamp)}</td>
              </tr>
              {expandedId === inv.id && (
                <tr key={`${inv.id}-detail`} className="border-b border-slate-800/50">
                  <td colSpan={7} className="px-4 py-3 bg-slate-800/20">
                    <div className="space-y-2 text-xs">
                      {inv.inputSummary && (
                        <div>
                          <span className="text-slate-500">Input: </span>
                          <span className="text-slate-300">{inv.inputSummary}</span>
                        </div>
                      )}
                      {inv.outputSummary && (
                        <div>
                          <span className="text-slate-500">Output: </span>
                          <span className="text-slate-300">{inv.outputSummary}</span>
                        </div>
                      )}
                      {inv.channel && (
                        <div>
                          <span className="text-slate-500">Channel: </span>
                          <span className="text-amber-500 font-mono">#{inv.channel}</span>
                        </div>
                      )}
                      {!inv.inputSummary && !inv.outputSummary && !inv.channel && (
                        <p className="text-slate-500 italic">No additional details</p>
                      )}
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
