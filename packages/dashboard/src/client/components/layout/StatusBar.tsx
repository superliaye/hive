import { useSSE } from '../../hooks/useSSE';
import { useApi } from '../../hooks/useApi';

interface StatusBarProps {
  onMenuToggle?: () => void;
}

export function StatusBar({ onMenuToggle }: StatusBarProps) {
  const { connected } = useSSE();
  const { data: status } = useApi<{ running: boolean; pid: number | null; agentCount: number }>('/api/status', { refreshInterval: 5000 });

  return (
    <header className="h-10 bg-slate-900 border-b border-slate-800 flex items-center px-3 md:px-4 justify-between shrink-0">
      <div className="flex items-center gap-2 md:gap-3">
        {/* Hamburger — mobile only */}
        <button
          onClick={onMenuToggle}
          className="md:hidden text-slate-400 hover:text-slate-200 p-1"
          aria-label="Toggle menu"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <span className="text-xs text-slate-500 hidden sm:inline">Hive Dashboard</span>
        {status && (
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            status.running
              ? 'bg-green-500/10 text-green-400'
              : 'bg-slate-700/50 text-slate-400'
          }`}>
            {status.running ? `Running (${status.agentCount})` : 'Stopped'}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
        <span className="text-xs text-slate-500 hidden sm:inline">
          {connected ? 'Connected' : 'Reconnecting...'}
        </span>
      </div>
    </header>
  );
}
