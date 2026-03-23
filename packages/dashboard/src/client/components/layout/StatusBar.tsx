import { useSSE } from '../../hooks/useSSE';
import { useApi } from '../../hooks/useApi';

export function StatusBar() {
  const { connected } = useSSE();
  const { data: status } = useApi<{ running: boolean; pid: number | null; agentCount: number }>('/api/status', { refreshInterval: 5000 });

  return (
    <header className="h-10 bg-slate-900 border-b border-slate-800 flex items-center px-4 justify-between shrink-0">
      <div className="flex items-center gap-3">
        <span className="text-xs text-slate-500">Hive Dashboard</span>
        {status && (
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            status.running
              ? 'bg-green-500/10 text-green-400'
              : 'bg-slate-700/50 text-slate-400'
          }`}>
            {status.running ? `Running (${status.agentCount} agents)` : 'Stopped'}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
        <span className="text-xs text-slate-500">
          {connected ? 'Connected' : 'Reconnecting...'}
        </span>
      </div>
    </header>
  );
}
