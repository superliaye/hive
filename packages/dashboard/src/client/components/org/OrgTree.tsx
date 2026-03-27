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

  /** Desktop: horizontal tree layout (unchanged structure, with min-width preservation) */
  function renderTreeNode(id: string): React.ReactNode {
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
                  width: `calc(100% - 120px)`,
                }} />
              )}
              {children.map(childId => (
                <div key={childId} className="flex flex-col items-center">
                  {children.length > 1 && <div className="w-px h-6 bg-slate-700" />}
                  {renderTreeNode(childId)}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  /** Mobile: vertical indented list */
  function renderListNode(id: string, depth: number): React.ReactNode {
    const orgAgent = agentMap.get(id);
    if (!orgAgent) return null;

    const children = orgAgent.childIds;

    return (
      <div key={id}>
        <div
          className="relative"
          style={{ paddingLeft: `${depth * 24}px` }}
        >
          {/* Vertical connector line from parent */}
          {depth > 0 && (
            <div
              className="absolute top-0 bottom-1/2 w-px bg-slate-700"
              style={{ left: `${(depth - 1) * 24 + 12}px` }}
            />
          )}
          {/* Horizontal connector to this node */}
          {depth > 0 && (
            <div
              className="absolute top-1/2 h-px bg-slate-700"
              style={{ left: `${(depth - 1) * 24 + 12}px`, width: '12px' }}
            />
          )}
          <div className="py-1">
            <AgentNode
              orgAgent={orgAgent}
              state={stateMap.get(id)}
              selected={selectedAgentId === id}
              onClick={() => onSelectAgent(id)}
              compact
            />
          </div>
        </div>
        {children.map(childId => renderListNode(childId, depth + 1))}
      </div>
    );
  }

  return (
    <>
      {/* Mobile: vertical indented list */}
      <div className="block md:hidden py-4">
        {renderListNode(org.root, 0)}
      </div>
      {/* Desktop: horizontal tree with scroll */}
      <div className="hidden md:block py-8 overflow-x-auto">
        <div className="w-fit min-w-full px-4">
          <div className="flex justify-center">
            {renderTreeNode(org.root)}
          </div>
        </div>
      </div>
    </>
  );
}
