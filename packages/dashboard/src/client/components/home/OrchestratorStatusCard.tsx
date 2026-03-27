import { useApi } from '../../hooks/useApi';

export function OrchestratorStatusCard() {
  const { data: status } = useApi<{ running: boolean; pid: number | null; agentCount: number; conversationCount: number }>('/api/status');

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
          Daemon {status.running ? 'Running' : 'Stopped'}
        </p>
        <p className="text-xs text-slate-500">
          {status.agentCount} agents, {status.conversationCount} conversations
          {status.pid ? ` (PID: ${status.pid})` : ''}
        </p>
      </div>
    </div>
  );
}
