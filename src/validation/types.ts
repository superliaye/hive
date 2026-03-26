export type Severity = 'error' | 'warning' | 'info';

export type IssueCode =
  // Identity issues
  | 'MISSING_FOLDER'           // DB entry has no matching folder
  | 'ORPHANED_FOLDER'          // Folder exists but no DB entry
  | 'IDENTITY_PARSE_ERROR'     // IDENTITY.md can't be parsed
  | 'IDENTITY_FIELD_MISSING'   // Required frontmatter field missing
  | 'IDENTITY_DB_MISMATCH'     // Frontmatter doesn't match DB
  // Structural issues
  | 'MISSING_AGENT_FILE'       // Expected file missing (SOUL.md, BUREAU.md, etc.)
  | 'CIRCULAR_REPORTING'       // Reporting chain has a cycle
  | 'DANGLING_MANAGER'         // reports_to references non-existent person
  // Skill/MCP issues
  | 'SKILL_NOT_FOUND'          // Declared skill not in role-skills/
  | 'SKILL_NOT_COPIED'         // Skill exists in role-skills/ but missing from agent
  | 'MCP_UNKNOWN'              // Config declares MCP server not in registry
  | 'MCP_SETTINGS_MISSING';    // Agent should have .claude/settings.json but doesn't

export interface HealthIssue {
  severity: Severity;
  code: IssueCode;
  agent?: string;              // alias of affected agent
  message: string;
  autoFixable: boolean;
}
