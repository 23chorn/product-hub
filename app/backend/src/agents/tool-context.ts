/**
 * tool-context — context-retrieval tools the agents can call: read a project
 * context file by name, or fetch a domain skill's development context. Registered
 * in tool-registry.ts.
 */
import * as fs from 'fs';
import * as path from 'path';
import { getActiveSkill } from './skill-registry';

const PROJECT_ROOT = path.resolve(__dirname, '../../../../');

// ── get_context_file ──────────────────────────────────────────────────────────

export function getContextFile(input: Record<string, unknown>): string {
  const filename = input.filename;
  if (typeof filename !== 'string' || !filename) {
    return 'Error: filename must be a non-empty string';
  }

  const safe = path.basename(filename);
  if (safe !== filename || filename.includes('..') || filename.includes('/')) {
    return 'Error: invalid filename — provide only the filename, not a path';
  }

  const filePath = path.join(PROJECT_ROOT, 'context', safe);
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return `Error: context file "${safe}" not found`;
  }
}

// ── get_domain_skill_context ──────────────────────────────────────────────────

export function getDomainSkillContext(input: Record<string, unknown>): string {
  const skillName = input.skill_name;
  if (typeof skillName !== 'string' || !skillName.trim()) {
    return 'Error: skill_name must be a non-empty string';
  }

  const skill = getActiveSkill(skillName.trim());
  if (!skill) {
    return `No active skill found with name "${skillName}". Check the Skill Editor for available skill names.`;
  }

  if (skill.discipline === 'agent') {
    return `"${skillName}" is an agent skill, not a domain skill. Use a dev/qa/design/general discipline skill for domain context.`;
  }

  if (!skill.development_context) {
    return `Skill "${skillName}" exists (${skill.discipline}, v${skill.version}) but has no development context defined yet.`;
  }

  return `## Domain Context: ${skillName} (${skill.discipline}, v${skill.version})\n\n${skill.development_context}`;
}
