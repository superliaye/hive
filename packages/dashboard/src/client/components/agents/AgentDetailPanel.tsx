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
    <div className="w-full md:w-[400px] border-l border-slate-800 bg-slate-900 p-4 shrink-0">
      <p className="text-sm text-slate-500">Loading...</p>
    </div>
  );

  const tabs: { key: Tab; label: string }[] = [
    { key: 'state', label: 'State' },
    { key: 'files', label: 'Files' },
    { key: 'audit', label: 'Audit' },
  ];

  return (
    <div className="w-full md:w-[560px] border-l border-slate-800 bg-slate-900 flex flex-col shrink-0 overflow-hidden">
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
  const [openFile, setOpenFile] = useState<string | null>('IDENTITY.md');

  const files = [
    { name: 'IDENTITY.md', content: agent.files.identity },
    { name: 'SOUL.md', content: agent.files.soul },
    { name: 'BUREAU.md', content: agent.files.bureau },
    { name: 'PRIORITIES.md', content: agent.files.priorities },
    { name: 'ROUTINE.md', content: agent.files.routine },
    { name: 'MEMORY.md', content: agent.files.memory },
  ];

  return (
    <div className="space-y-1">
      {files.map(f => {
        const isOpen = openFile === f.name;
        const isEmpty = !f.content;
        return (
          <div key={f.name} className="border border-slate-800 rounded-lg overflow-hidden">
            <button
              onClick={() => setOpenFile(isOpen ? null : f.name)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-800/50 transition-colors"
            >
              <span className="text-[10px] text-slate-600">{isOpen ? '▼' : '▶'}</span>
              <span className="text-xs font-medium text-amber-500 font-mono">{f.name}</span>
              {isEmpty && <span className="text-[10px] text-slate-600 italic ml-auto">empty</span>}
            </button>
            {isOpen && f.content && (
              <div className="px-3 pb-3 border-t border-slate-800/50">
                <AgentMdViewer content={f.content} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AuditDetailInline({ invocationId }: { invocationId: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [detail, setDetail] = useState<{ fullInput: string | null; fullOutput: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = async () => {
    if (state === 'loaded') { setState('idle'); return; }
    setState('loading');
    try {
      const res = await fetch(`/api/audit/${invocationId}/detail`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Unknown error' }));
        setError(body.error ?? `HTTP ${res.status}`);
        setState('error');
        return;
      }
      setDetail(await res.json());
      setState('loaded');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
      setState('error');
    }
  };

  return (
    <div className="mt-1">
      <button
        onClick={fetchDetail}
        className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
      >
        {state === 'loading' ? '...' : state === 'loaded' ? 'Hide' : 'Full detail'}
      </button>
      {state === 'error' && <p className="text-[10px] text-red-400 mt-1">{error}</p>}
      {state === 'loaded' && detail && (
        <div className="mt-1 space-y-1">
          {detail.fullInput && (
            <pre className="p-2 bg-slate-950 border border-slate-700 rounded text-[10px] text-slate-300 overflow-auto max-h-48 whitespace-pre-wrap font-mono">
              {detail.fullInput}
            </pre>
          )}
          {detail.fullOutput && (
            <pre className="p-2 bg-slate-950 border border-slate-700 rounded text-[10px] text-slate-300 overflow-auto max-h-48 whitespace-pre-wrap font-mono">
              {detail.fullOutput}
            </pre>
          )}
          {!detail.fullInput && !detail.fullOutput && (
            <p className="text-[10px] text-slate-500">No detail available.</p>
          )}
        </div>
      )}
    </div>
  );
}

function AuditTab({ agent }: { agent: AgentDetail }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Filter to checkWork/followup invocations that may have full detail
  const spawnInvocations = agent.recentInvocations.filter(
    inv => inv.invocationType === 'checkWork' || inv.invocationType === 'followup'
  );

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
            {agent.recentInvocations.map(inv => {
              const isSpawn = inv.invocationType === 'checkWork' || inv.invocationType === 'followup';
              const isExpanded = expandedId === inv.id;
              return (
                <>
                  <tr
                    key={inv.id}
                    onClick={() => isSpawn && setExpandedId(isExpanded ? null : inv.id)}
                    className={`border-b border-slate-800/50 text-slate-400 ${isSpawn ? 'cursor-pointer hover:bg-slate-800/30' : ''} transition-colors`}
                  >
                    <td className="py-1 pr-2 font-mono">{inv.invocationType}</td>
                    <td className="py-1 pr-2">{inv.model}</td>
                    <td className="py-1 pr-2">{(inv.tokensIn ?? 0) + (inv.tokensOut ?? 0)}</td>
                    <td className="py-1">{inv.durationMs ? `${(inv.durationMs / 1000).toFixed(1)}s` : '-'}</td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${inv.id}-detail`}>
                      <td colSpan={4} className="py-1 px-1 bg-slate-800/20">
                        {inv.actionSummary && (
                          <p className="text-[10px] text-slate-300 mb-1">{inv.actionSummary}</p>
                        )}
                        <AuditDetailInline invocationId={inv.id} />
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      ) : (
        <EmptyState message="No invocations recorded" />
      )}
    </div>
  );
}
