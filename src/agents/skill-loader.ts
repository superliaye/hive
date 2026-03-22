import fs from 'fs';
import path from 'path';

const ROLE_MAPPING: Record<string, string> = {
  'ceo': 'ceo',
  'chief executive': 'ceo',
  'vp': 'engineering',
  'engineer': 'engineering',
  'developer': 'engineering',
  'backend': 'engineering',
  'frontend': 'engineering',
  'product': 'product',
  'pm': 'product',
  'designer': 'design',
  'design': 'design',
  'qa': 'testing',
  'test': 'testing',
  'tester': 'testing',
};

function matchRoleDir(role: string): string {
  const roleLower = role.toLowerCase();
  for (const [keyword, dir] of Object.entries(ROLE_MAPPING)) {
    if (roleLower.includes(keyword)) return dir;
  }
  return 'shared';
}

export interface SkillResolution {
  roleDir: string;
  shared: string[];    // Paths to shared skill dirs
  role: string[];      // Paths to role-specific skill dirs
}

export function resolveSkillsForAgent(role: string, skillsRoot: string): SkillResolution {
  const roleDir = matchRoleDir(role);
  const shared: string[] = [];
  const rolePaths: string[] = [];

  // Shared skills
  const sharedDir = path.join(skillsRoot, 'shared');
  if (fs.existsSync(sharedDir)) {
    const entries = fs.readdirSync(sharedDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        shared.push(path.join(sharedDir, entry.name));
      }
    }
  }

  // Role-specific skills
  const roleSkillDir = path.join(skillsRoot, roleDir);
  if (fs.existsSync(roleSkillDir)) {
    const entries = fs.readdirSync(roleSkillDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        rolePaths.push(path.join(roleSkillDir, entry.name));
      }
    }
  }

  return { roleDir, shared, role: rolePaths };
}

export function copySkillsToAgent(
  skills: SkillResolution,
  agentClaudeDir: string,
): void {
  const skillsDir = path.join(agentClaudeDir, 'skills');
  fs.mkdirSync(skillsDir, { recursive: true });

  const allSkills = [...skills.shared, ...skills.role];
  for (const skillPath of allSkills) {
    const skillName = path.basename(skillPath);
    const targetDir = path.join(skillsDir, skillName);

    if (!fs.existsSync(targetDir)) {
      // Copy the skill directory
      fs.cpSync(skillPath, targetDir, { recursive: true });
    }
  }
}
