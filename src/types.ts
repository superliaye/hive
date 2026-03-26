export interface Person {
  id: number;
  alias: string;
  name: string;
  roleTemplate?: string;
  status: 'active' | 'inactive';
  folder?: string;                 // org/{id}-{alias}
  reportsTo?: number;              // person ID of manager
  createdAt?: Date;
}

export interface AgentConfig {
  person: Person;                   // Source of truth from DB
  dir: string;                      // Absolute path to agent folder
  reportsTo: Person | null;         // Resolved manager
  directReports: Person[];          // People who report to this person
  files: {
    identity: string;               // Full content of IDENTITY.md
    soul: string;                   // Full content of SOUL.md
    bureau: string;                 // Full content of BUREAU.md
    priorities: string;             // Full content of PRIORITIES.md
    routine: string;                // Full content of ROUTINE.md
    memory: string;                 // Full content of MEMORY.md
    protocols: string;              // Full content of protocols/ (shared)
  };
  identity: AgentIdentity;         // Parsed from IDENTITY.md frontmatter
}

export interface AgentIdentity {
  name: string;
  role: string;
  model: string;
  emoji?: string;
  vibe?: string;
  skills?: string[];
}

export interface OrgChart {
  agents: Map<string, AgentConfig>;  // alias → config
  people: Person[];                  // All people from DB
}

export interface AuditEntry {
  id: string;
  agentId: string;                   // alias from people table
  invocationType: 'triage' | 'main' | 'memory' | 'proposal' | 'comms';
  model: string;
  tokensIn?: number;
  tokensOut?: number;
  durationMs?: number;
  inputSummary?: string;
  outputSummary?: string;
  channel?: string;
  timestamp: Date;
}

export interface AgentState {
  agentId: string;                   // alias from people table
  status: 'active' | 'idle' | 'working' | 'disposed' | 'errored';
  lastInvocation?: Date;
  lastHeartbeat?: Date;
  currentTask?: string;
  pid?: number;
}

export interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  tokensIn?: number;
  tokensOut?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

// Re-export comms types for convenience
export type { Message, Channel, ICommsProvider } from './comms/types.js';
