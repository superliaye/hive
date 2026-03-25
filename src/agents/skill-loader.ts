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

/**
 * Resolve skills for an agent from role-templates.
 *
 * @param role - Agent's role (used to find role-specific skills)
 * @param roleTemplatesRoot - Path to role-templates/ directory
 * @param declaredSkills - Explicit skill names from IDENTITY.md frontmatter
 *
 * Directory layout:
 *   role-templates/shared/role-skills/<skill-name>/SKILL.md
 *   role-templates/<role>/role-skills/<skill-name>/SKILL.md
 */
export function resolveSkillsForAgent(
  role: string,
  roleTemplatesRoot: string,
  declaredSkills?: string[],
): SkillResolution {
  const sharedSkillsDir = path.join(roleTemplatesRoot, 'shared', 'role-skills');
  const roleDir = matchRoleDir(role);
  const roleSkillsDir = path.join(roleTemplatesRoot, roleDir, 'role-skills');

  // Explicit skills take precedence over role-based mapping
  if (declaredSkills && declaredSkills.length > 0) {
    const skillPaths: string[] = [];
    for (const skillName of declaredSkills) {
      const candidates = [
        path.join(sharedSkillsDir, skillName),
        path.join(roleSkillsDir, skillName),
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

  const shared: string[] = [];
  const rolePaths: string[] = [];

  // Shared skills
  if (fs.existsSync(sharedSkillsDir)) {
    const entries = fs.readdirSync(sharedSkillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        shared.push(path.join(sharedSkillsDir, entry.name));
      }
    }
  }

  // Role-specific skills
  if (fs.existsSync(roleSkillsDir)) {
    const entries = fs.readdirSync(roleSkillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        rolePaths.push(path.join(roleSkillsDir, entry.name));
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
