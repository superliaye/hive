import { useApi } from '../../hooks/useApi';
import { useState } from 'react';

export function OrchestratorStatusCard() {
  const { data: status, refetch } = useApi<{ running: boolean; pid: number | null; agentCount: number; channelCount: number }>('/api/status', { refreshInterval: 5000 });
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    setLoading(true);
    try {
      const endpoint = status?.running ? '/api/orchestrator/stop' : '/api/orchestrator/start';
      await fetch(endpoint, { method: 'POST' });
      setTimeout(refetch, 1000);
    } finally {
      setLoading(false);
    }
  };

  if (!status) return null;

  return (
    <div className={`flex items-center gap-4 p-4 rounded-lg border ${
      status.running
        ? 'bg-green-500/5 border-green-500/20'
        : 'bg-slate-900 border-slate-800'
    }`}>
      <span className={`w-3 h-3 rounded-full ${status.running ? 'bg-green-500 animate-pulse' : 'bg-slate-600'}`} />
      <div className="flex-1">
        <p className="text-sm font-medium text-slate-200">
          Orchestrator {status.running ? 'Running' : 'Stopped'}
        </p>
        <p className="text-xs text-slate-500">
          {status.agentCount} agents, {status.channelCount} channels
          {status.pid ? ` (PID: ${status.pid})` : ''}
        </p>
      </div>
      <button
        onClick={toggle}
        disabled={loading}
        className={`px-3 py-1.5 text-xs rounded font-medium transition-colors disabled:opacity-50 ${
          status.running
            ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
            : 'bg-green-500/10 text-green-400 hover:bg-green-500/20'
        }`}
      >
        {loading ? '...' : status.running ? 'Stop' : 'Start'}
      </button>
    </div>
  );
}
