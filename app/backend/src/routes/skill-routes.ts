import { Router } from 'express';
import {
  getActiveSkill, getSkill, listSkills, listSkillVersions,
  publishSkill, deprecateSkill,
} from '../agents/skill-registry';
import { syncPersonaMarkdownFromSkill } from '../utils/persona-file-sync';
import { hasAnyUsers } from '../data/users';
import { isViewOnly } from '../middleware/auth';
import type { AuthRequest } from '../middleware/auth';

export const skillRoutes = Router();

/**
 * Which roles may edit each agent skill. null = any authenticated user.
 * [] = admin only. Agents not listed here default to null (unrestricted).
 */
const AGENT_EDIT_ROLES: Record<string, string[]> = {
  // Product agents
  analyst:              ['product'],
  pm_prd:               ['product'],
  epic_feature_planner: ['product'],
  story_decomposition:  ['product'],
  curator:              ['product'],
  // Technical agents
  solution_architect:   ['tech_lead'],
  'ios-engineer':       ['tech_lead'],
  'android-engineer':   ['tech_lead'],
  'backend-engineer':   ['tech_lead'],
  'web-engineer':       ['tech_lead'],
  qa_engineer:          ['qa'],
  'tech-refinement':    ['tech_lead'],
  'figma-designer':     ['design'],
  // Meta / infrastructure agents — admin only
  coordinator:          [],
  critic:               [],
  prototype:            [],
};

function canEditSkill(user: AuthRequest['user'], skillName: string): boolean {
  if (!hasAnyUsers()) return true;
  if (!user) return false;
  if (user.is_admin) return true;
  if (isViewOnly(user)) return false;
  const roles = AGENT_EDIT_ROLES[skillName];
  if (roles === undefined) return true;   // unknown skill — unrestricted
  if (roles.length === 0) return false;   // admin only
  return roles.some(r => user.roles.includes(r));
}

function editRolesForSkill(skillName: string): string[] | null {
  const roles = AGENT_EDIT_ROLES[skillName];
  return roles === undefined ? null : roles;
}

skillRoutes.get('/', (req, res) => {
  const discipline = typeof req.query.discipline === 'string' ? req.query.discipline : undefined;
  const skills = listSkills(discipline).map(s => ({ ...s, editRoles: editRolesForSkill(s.skill_name) }));
  res.json(skills);
});

skillRoutes.get('/:name', (req, res) => {
  const skill = getActiveSkill(req.params.name);
  if (!skill) return res.status(404).json({ error: `Skill "${req.params.name}" not found` });
  res.json(skill);
});

skillRoutes.get('/:name/versions', (req, res) => {
  res.json(listSkillVersions(req.params.name));
});

skillRoutes.post('/', (req: AuthRequest, res) => {
  const { skill_name, agent_type, version, owner_team, discipline, persona_prompt } = req.body;
  if (!skill_name || !version) {
    return res.status(400).json({ error: 'skill_name and version are required' });
  }

  if (!canEditSkill(req.user, skill_name)) {
    return res.status(403).json({ error: 'You do not have permission to edit this agent', code: 'INSUFFICIENT_ROLE' });
  }
  // Agent-discipline skills require a persona_prompt; others default to empty string
  const resolvedDiscipline = discipline ?? 'agent';
  const resolvedPersona = persona_prompt ?? '';
  if (resolvedDiscipline === 'agent' && !resolvedPersona) {
    return res.status(400).json({ error: 'persona_prompt is required for agent-discipline skills' });
  }

  const existing = getSkill(skill_name, version);
  if (existing) {
    return res.status(409).json({ error: `Skill "${skill_name}" version "${version}" already exists` });
  }

  try {
    if (resolvedDiscipline === 'agent') {
      syncPersonaMarkdownFromSkill(skill_name, agent_type ?? 'general', resolvedPersona);
    }
    const id = publishSkill({
      skill_name,
      agent_type: agent_type ?? 'general',
      version,
      owner_team: owner_team ?? 'core',
      discipline: resolvedDiscipline,
      persona_prompt: resolvedPersona,
      output_format_template: req.body.output_format_template ?? null,
      stage_brief_label: req.body.stage_brief_label ?? null,
      stage_brief_format: req.body.stage_brief_format ?? null,
      development_context: req.body.development_context ?? null,
      tool_definitions: req.body.tool_definitions ?? null,
      deprecated_at: null,
    });
    res.status(201).json({ id, skill_name, version });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

skillRoutes.delete('/:name/versions/:version', (req: AuthRequest, res) => {
  const skill = getSkill(req.params.name, req.params.version);
  if (!skill) {
    return res.status(404).json({ error: `Skill "${req.params.name}" version "${req.params.version}" not found` });
  }

  if (!canEditSkill(req.user, req.params.name)) {
    return res.status(403).json({ error: 'You do not have permission to deprecate this agent', code: 'INSUFFICIENT_ROLE' });
  }

  deprecateSkill(req.params.name, req.params.version);
  res.json({ deprecated: true, skill_name: req.params.name, version: req.params.version });
});
