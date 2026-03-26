import { useState } from 'react';
import { OrgTree } from '../components/org/OrgTree';
import { AgentDetailPanel } from '../components/agents/AgentDetailPanel';
import { useApi } from '../hooks/useApi';
import { useSSEEvent } from '../hooks/useSSE';
import { EmptyState } from '../components/shared';
import type { OrgData, Agent } from '../types';

export function OrgPage() {
  const { data: org } = useApi<OrgData>('/api/org');
  const { data: agents, setData: setAgents } = useApi<Agent[]>('/api/agents');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  useSSEEvent('agent-state', (event) => {
    setAgents(prev => prev?.map(a =>
      a.id === event.agentId ? { ...a, status: event.status, currentTask: event.currentTask } : a
    ) ?? null);
  });

  if (!org || !agents) return <EmptyState message="Loading organization..." />;

  return (
    <div className="flex flex-col md:flex-row h-full -m-3 md:-m-6">
      {/* Tree view: hidden on mobile when detail panel is open */}
      <div className={`flex-1 overflow-auto p-3 md:p-6 ${selectedAgentId ? 'hidden md:block' : ''}`}>
        <h2 className="text-lg font-medium text-slate-200 mb-4">Organization</h2>
        <OrgTree
          org={org}
          agents={agents}
          onSelectAgent={setSelectedAgentId}
          selectedAgentId={selectedAgentId}
        />
      </div>
      {selectedAgentId && (
        <AgentDetailPanel
          agentId={selectedAgentId}
          onClose={() => setSelectedAgentId(null)}
        />
      )}
    </div>
  );
}
