import fs from 'fs';
import path from 'path';

export interface SkillResolution {
  skills: string[];    // Paths to resolved skill dirs
}

/**
 * Resolve skills for an agent from the top-level role-skills/ directory.
 *
 * @param roleSkillsDir - Path to role-skills/ directory at repo root
 * @param declaredSkills - Skill names from config.json (e.g. ["hive-comms", "board-protocol"])
 *
 * Directory layout:
 *   role-skills/<skill-name>/SKILL.md
 */
export function resolveSkillsForAgent(
  roleSkillsDir: string,
  declaredSkills: string[],
): SkillResolution {
  const skills: string[] = [];
  for (const skillName of declaredSkills) {
    const skillPath = path.join(roleSkillsDir, skillName);
    if (fs.existsSync(skillPath)) {
      skills.push(skillPath);
    }
  }
  return { skills };
}

export function copySkillsToAgent(
  skills: SkillResolution,
  agentClaudeDir: string,
): void {
  const skillsDir = path.join(agentClaudeDir, 'skills');
  fs.mkdirSync(skillsDir, { recursive: true });

  for (const skillPath of skills.skills) {
    const skillName = path.basename(skillPath);
    const targetDir = path.join(skillsDir, skillName);

    if (!fs.existsSync(targetDir)) {
      fs.cpSync(skillPath, targetDir, { recursive: true });
    }
  }
}
