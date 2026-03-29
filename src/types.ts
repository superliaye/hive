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
    memory: string;                 // Full content of MEMORY.md (agent-managed)
    triageLog: string;              // Recent triage results (daemon-managed, last N days)
    protocols: string;              // Full content of protocols/ (shared)
    skills: string;                 // Combined content of .claude/skills/*/SKILL.md
  };
  identity: AgentIdentity;         // Parsed from IDENTITY.md frontmatter
}

export interface AgentIdentity {
  id: number;                        // person ID from people table
  alias: string;                     // unique short identifier (e.g., "alice")
  name: string;                      // display name (e.g., "Alice Park")
  role: string;                      // role template name (e.g., "Software Engineer")
  title?: string;                    // position title, agent-defined (e.g., "Auth Team Lead")
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
  invocationType: 'checkWork' | 'followup' | 'triage' | 'followup-check';
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
