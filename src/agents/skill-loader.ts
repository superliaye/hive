import fs from 'fs';
import path from 'path';

const ROLE_MAPPING: Record<string, string> = {
  'chief-executive': 'chief-executive',
  'ceo': 'chief-executive',
  'agent-resources': 'agent-resources',
  'department-head': 'department-head',
  'software-engineer': 'software-engineer',
  'engineer': 'software-engineer',
  'developer': 'software-engineer',
  'product-analyst': 'product-analyst',
  'product-manager': 'product-manager',
  'designer': 'designer',
  'qa-engineer': 'qa-engineer',
  'qa': 'qa-engineer',
  'tester': 'qa-engineer',
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

export function resolveSkillsForAgent(
  role: string,
  skillsRoot: string,
  declaredSkills?: string[],
): SkillResolution {
  // Explicit skills take precedence over role-based mapping
  if (declaredSkills && declaredSkills.length > 0) {
    const skillPaths: string[] = [];
    const dirs = fs.existsSync(skillsRoot)
      ? fs.readdirSync(skillsRoot, { withFileTypes: true }).filter(e => e.isDirectory())
      : [];
    for (const skillName of declaredSkills) {
      const candidates = [
        path.join(skillsRoot, 'shared', skillName),
        ...dirs.filter(d => d.name !== 'shared').map(d => path.join(skillsRoot, d.name, skillName)),
      ];
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
          skillPaths.push(candidate);
          break;
        }
      }
    }
    return { roleDir: 'explicit', shared: [], role: skillPaths };
  }

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
