import { AgentNode } from './AgentNode';
import type { OrgData, Agent } from '../../types';

interface OrgTreeProps {
  org: OrgData;
  agents: Agent[];
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
}

export function OrgTree({ org, agents, selectedAgentId, onSelectAgent }: OrgTreeProps) {
  const agentMap = new Map(org.agents.map(a => [a.id, a]));
  const stateMap = new Map(agents.map(a => [a.id, a]));

  function renderNode(id: string): React.ReactNode {
    const orgAgent = agentMap.get(id);
    if (!orgAgent) return null;

    const children = orgAgent.childIds;

    return (
      <div key={id} className="flex flex-col items-center">
        <AgentNode
          orgAgent={orgAgent}
          state={stateMap.get(id)}
          selected={selectedAgentId === id}
          onClick={() => onSelectAgent(id)}
        />
        {children.length > 0 && (
          <>
            <div className="w-px h-6 bg-slate-700" />
            <div className="flex gap-6 relative">
              {children.length > 1 && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 h-px bg-slate-700" style={{
                  width: `calc(100% - 140px)`,
                }} />
              )}
              {children.map(childId => (
                <div key={childId} className="flex flex-col items-center">
                  {children.length > 1 && <div className="w-px h-6 bg-slate-700" />}
                  {renderNode(childId)}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex justify-center py-8 overflow-auto">
      {renderNode(org.root)}
    </div>
  );
}
