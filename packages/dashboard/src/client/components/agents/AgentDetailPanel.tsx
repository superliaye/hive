import { useState } from 'react';
import { useApi } from '../../hooks/useApi';
import { StatusDot, timeAgo, EmptyState } from '../shared';
import { AgentMdViewer } from './AgentMdViewer';
import type { AgentDetail } from '../../types';

interface AgentDetailPanelProps {
  agentId: string;
  onClose: () => void;
}

type Tab = 'state' | 'files' | 'audit';

export function AgentDetailPanel({ agentId, onClose }: AgentDetailPanelProps) {
  const { data: agent } = useApi<AgentDetail>(`/api/agents/${agentId}`);
  const [tab, setTab] = useState<Tab>('state');

  if (!agent) return (
    <div className="w-[400px] border-l border-slate-800 bg-slate-900 p-4 shrink-0">
      <p className="text-sm text-slate-500">Loading...</p>
    </div>
  );

  const tabs: { key: Tab; label: string }[] = [
    { key: 'state', label: 'State' },
    { key: 'files', label: 'Files' },
    { key: 'audit', label: 'Audit' },
  ];

  return (
    <div className="w-[400px] border-l border-slate-800 bg-slate-900 flex flex-col shrink-0 overflow-hidden">
      <div className="p-4 border-b border-slate-800">
        <div className="flex items-center justify-between mb-1">
          <button onClick={onClose} className="text-xs text-slate-500 hover:text-slate-300">
            &larr; Back
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-lg">{agent.identity.emoji ?? '\u25B9'}</span>
          <div>
            <h2 className="text-sm font-medium text-slate-200">{agent.identity.name}</h2>
            <p className="text-xs text-slate-500">{agent.identity.role}</p>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <StatusDot status={agent.state.status} />
            <span className="text-xs text-slate-500 font-mono">{agent.identity.model}</span>
          </div>
        </div>
      </div>

      <div className="flex border-b border-slate-800">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 py-2 text-xs font-medium transition-colors ${
              tab === t.key
                ? 'text-amber-500 border-b-2 border-amber-500'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-4">
        {tab === 'state' && <StateTab agent={agent} />}
        {tab === 'files' && <FilesTab agent={agent} />}
        {tab === 'audit' && <AuditTab agent={agent} />}
      </div>
    </div>
  );
}

function StateTab({ agent }: { agent: AgentDetail }) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wide">Status</h4>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <p className="text-slate-500">Status</p>
            <p className="text-slate-200">{agent.state.status}</p>
          </div>
          <div>
            <p className="text-slate-500">Last heartbeat</p>
            <p className="text-slate-200">{timeAgo(agent.state.lastHeartbeat)}</p>
          </div>
          <div>
            <p className="text-slate-500">Last invocation</p>
            <p className="text-slate-200">{timeAgo(agent.state.lastInvocation)}</p>
          </div>
          <div>
            <p className="text-slate-500">Current task</p>
            <p className="text-slate-200 truncate">{agent.state.currentTask ?? '\u2014'}</p>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wide">Token Usage</h4>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <p className="text-slate-500">Tokens in</p>
            <p className="text-lg font-bold text-slate-200">{agent.tokenTotals.totalIn.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-slate-500">Tokens out</p>
            <p className="text-lg font-bold text-slate-200">{agent.tokenTotals.totalOut.toLocaleString()}</p>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-medium text-slate-400 uppercase tracking-wide">Recent Invocations</h4>
        {agent.recentInvocations.length > 0 ? (
          <div className="space-y-1">
            {agent.recentInvocations.slice(0, 10).map(inv => (
              <div key={inv.id} className="flex items-center gap-2 text-xs py-1 border-b border-slate-800/50">
                <span className="text-slate-500 font-mono w-14">{inv.invocationType}</span>
                <span className="text-slate-600">{inv.model}</span>
                <span className="ml-auto text-slate-500">
                  {inv.durationMs ? `${(inv.durationMs / 1000).toFixed(1)}s` : '-'}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-500">No invocations recorded</p>
        )}
      </div>
    </div>
  );
}

function FilesTab({ agent }: { agent: AgentDetail }) {
  const files = [
    { name: 'IDENTITY.md', content: agent.files.identity },
    { name: 'SOUL.md', content: agent.files.soul },
    { name: 'BUREAU.md', content: agent.files.bureau },
    { name: 'PRIORITIES.md', content: agent.files.priorities },
    { name: 'ROUTINE.md', content: agent.files.routine },
    { name: 'MEMORY.md', content: agent.files.memory },
  ];

  return (
    <div className="space-y-4">
      {files.map(f => (
        <div key={f.name}>
          <h4 className="text-xs font-medium text-amber-500 font-mono mb-1">{f.name}</h4>
          {f.content ? (
            <AgentMdViewer content={f.content} />
          ) : (
            <p className="text-xs text-slate-600 italic">Empty</p>
          )}
        </div>
      ))}
    </div>
  );
}

function AuditTab({ agent }: { agent: AgentDetail }) {
  return (
    <div>
      {agent.recentInvocations.length > 0 ? (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-800">
              <th className="py-1 pr-2">Type</th>
              <th className="py-1 pr-2">Model</th>
              <th className="py-1 pr-2">Tokens</th>
              <th className="py-1">Duration</th>
            </tr>
          </thead>
          <tbody>
            {agent.recentInvocations.map(inv => (
              <tr key={inv.id} className="border-b border-slate-800/50 text-slate-400">
                <td className="py-1 pr-2 font-mono">{inv.invocationType}</td>
                <td className="py-1 pr-2">{inv.model}</td>
                <td className="py-1 pr-2">{(inv.tokensIn ?? 0) + (inv.tokensOut ?? 0)}</td>
                <td className="py-1">{inv.durationMs ? `${(inv.durationMs / 1000).toFixed(1)}s` : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <EmptyState message="No invocations recorded" />
      )}
    </div>
  );
}
