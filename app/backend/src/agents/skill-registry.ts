import db from '../data/database';
import * as fs from 'fs';
import * as path from 'path';
import { STAGE_OUTPUT_FORMATS } from './stage-metadata';
import Logger from '../utils/logger';

const logger = new Logger('SKILL-REGISTRY');

const PROJECT_ROOT = path.resolve(__dirname, '../../../../');
const PERSONAS_DIR = path.join(PROJECT_ROOT, 'agents', 'personas');
const TEMPLATES_DIR = path.join(PROJECT_ROOT, 'agents', 'templates');

const STAGE_PERSONA_MAP: Record<string, string> = {
  analyst:            'analyst',
  pm_prd:             'pm',
  solution_architect: 'architect',
  pm_backlog:         'pm',
  gtm_strategy:       'gtm',
  feature_marketing:  'marketer',
  prototype:          'prototype-builder',
  coordinator:        'coordinator',
  critic:             'critic',
  curator:            'curator',
};

const STAGE_TEMPLATE_FILE_MAP: Record<string, string | null> = {
  analyst:            'research.template.md',
  pm_prd:             'prd.template.md',
  solution_architect: 'architecture.template.md',
  pm_backlog:         'backlog.template.md',
  gtm_strategy:       'gtm.template.md',
  feature_marketing:  'feature_marketing.template.md',
  prototype:          'prototype.template.md',
  coordinator:        null,
  critic:             null,
  curator:            null,
};

export interface SkillVersion {
  id: number;
  skill_name: string;
  agent_type: string;
  version: string;
  owner_team: string;
  discipline: string;
  persona_prompt: string;
  output_format_template: string | null;
  stage_brief_label: string | null;
  stage_brief_format: string | null;
  development_context: string | null;
  tool_definitions: string | null;
  created_at: number;
  deprecated_at: number | null;
}

export function getActiveSkill(skillName: string): SkillVersion | null {
  return db.prepare<[string], SkillVersion>(
    `SELECT * FROM skill_versions
     WHERE skill_name = ? AND deprecated_at IS NULL
     ORDER BY created_at DESC LIMIT 1`
  ).get(skillName) ?? null;
}

export function getSkill(skillName: string, version: string): SkillVersion | null {
  return db.prepare<[string, string], SkillVersion>(
    `SELECT * FROM skill_versions WHERE skill_name = ? AND version = ? LIMIT 1`
  ).get(skillName, version) ?? null;
}

export function listSkills(discipline?: string): SkillVersion[] {
  if (discipline) {
    return db.prepare<[string], SkillVersion>(
      `SELECT s.*
       FROM skill_versions s
       INNER JOIN (
         SELECT skill_name, MAX(created_at) as max_created_at
         FROM skill_versions
         WHERE deprecated_at IS NULL AND discipline = ?
         GROUP BY skill_name
       ) latest ON s.skill_name = latest.skill_name AND s.created_at = latest.max_created_at
       ORDER BY s.discipline, s.skill_name`
    ).all(discipline);
  }
  return db.prepare<[], SkillVersion>(
    `SELECT s.*
     FROM skill_versions s
     INNER JOIN (
       SELECT skill_name, MAX(created_at) as max_created_at
       FROM skill_versions
       WHERE deprecated_at IS NULL
       GROUP BY skill_name
     ) latest ON s.skill_name = latest.skill_name AND s.created_at = latest.max_created_at
     ORDER BY s.discipline, s.skill_name`
  ).all();
}

export function listSkillVersions(skillName: string): SkillVersion[] {
  return db.prepare<[string], SkillVersion>(
    `SELECT * FROM skill_versions WHERE skill_name = ? ORDER BY created_at DESC`
  ).all(skillName);
}

export function publishSkill(skill: Omit<SkillVersion, 'id' | 'created_at'>): number {
  const result = db.prepare(
    `INSERT INTO skill_versions
     (skill_name, agent_type, version, owner_team, discipline, persona_prompt,
      output_format_template, stage_brief_label, stage_brief_format,
      development_context, tool_definitions, created_at, deprecated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    skill.skill_name, skill.agent_type, skill.version, skill.owner_team,
    skill.discipline ?? 'agent', skill.persona_prompt,
    skill.output_format_template ?? null,
    skill.stage_brief_label ?? null, skill.stage_brief_format ?? null,
    skill.development_context ?? null, skill.tool_definitions ?? null,
    Date.now(), skill.deprecated_at ?? null
  );
  return result.lastInsertRowid as number;
}

export function deprecateSkill(skillName: string, version: string): void {
  db.prepare(
    `UPDATE skill_versions SET deprecated_at = ? WHERE skill_name = ? AND version = ?`
  ).run(Date.now(), skillName, version);
}

// Tool definitions seeded per skill (JSON strings).
// syncSeedSkillTools() applies these to existing installs that pre-date the tool additions.
const SEED_TOOL_DEFINITIONS: Record<string, string> = {
  analyst: JSON.stringify([
    {
      name: 'validate_research_brief',
      description: 'Validate your research brief before returning it. Checks inline citation format ([N]), References section completeness, and minimum source count. Call after drafting to catch citation issues early.',
      input_schema: { type: 'object', properties: { text: { type: 'string', description: 'The complete research brief text to validate' } }, required: ['text'] },
    },
  ]),

  pm_prd: JSON.stringify([
    {
      name: 'validate_prd',
      description: 'Validate your PRD before returning it. Checks that Out of Scope is present, success metrics have baselines and targets, counter-metrics exist, and NFRs have measurable thresholds. Call after drafting.',
      input_schema: { type: 'object', properties: { text: { type: 'string', description: 'The complete PRD text to validate' } }, required: ['text'] },
    },
  ]),

  solution_architect: JSON.stringify([
    {
      name: 'validate_architecture',
      description: 'Validate your architecture document before returning it. Checks for unresolved TBD decisions, missing cost estimates, undocumented failure modes, and absent scalability assumptions. Call after drafting.',
      input_schema: { type: 'object', properties: { text: { type: 'string', description: 'The complete architecture document text to validate' } }, required: ['text'] },
    },
    {
      name: 'get_domain_skill_context',
      description: 'Retrieve development context for a domain skill by name (e.g. "payments-dev"). Use this to look up service-specific patterns, API contracts, or conventions before making technology decisions.',
      input_schema: { type: 'object', properties: { skill_name: { type: 'string', description: 'The domain skill name to look up' } }, required: ['skill_name'] },
    },
  ]),

  pm_backlog: JSON.stringify([
    {
      name: 'validate_backlog_json',
      description: 'Validate your backlog JSON structure before returning it. Checks required fields, Fibonacci effort scores, AC count (2–4 per story), Given/When/Then format, and story/feature count limits. Call after drafting.',
      input_schema: { type: 'object', properties: { json: { type: 'string', description: 'The complete backlog JSON string to validate' } }, required: ['json'] },
    },
    {
      name: 'get_domain_skill_context',
      description: 'Retrieve development context for a domain skill by name (e.g. "payments-qa"). Use this to look up service-specific testing patterns or dev conventions when writing acceptance criteria.',
      input_schema: { type: 'object', properties: { skill_name: { type: 'string', description: 'The domain skill name to look up' } }, required: ['skill_name'] },
    },
  ]),

  gtm_strategy: JSON.stringify([
    {
      name: 'validate_gtm_strategy',
      description: 'Validate your GTM strategy before returning it. Checks Moore positioning template format, presence of all three launch phases with success signals, leading/lagging indicator distinction, and channel recommendations. Call after drafting.',
      input_schema: { type: 'object', properties: { text: { type: 'string', description: 'The complete GTM strategy text to validate' } }, required: ['text'] },
    },
  ]),
};

function bumpPatch(version: string): string {
  const parts = version.split('.').map(Number);
  if (parts.length === 3 && parts.every((n) => !isNaN(n))) {
    return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
  }
  return `${version}.1`;
}

/**
 * Runs at server startup. For each skill that has a SEED_TOOL_DEFINITIONS entry but
 * currently has no tool_definitions in the DB, publishes a new patch version with the
 * tools added. Safe to call on existing installs — only acts when tool_definitions is null.
 */
export function syncSeedSkillTools(): void {
  let synced = 0;
  for (const [skillName, toolDefs] of Object.entries(SEED_TOOL_DEFINITIONS)) {
    const current = getActiveSkill(skillName);
    if (!current) continue;
    if (current.tool_definitions) continue; // already has tools — don't overwrite
    const newVersion = bumpPatch(current.version);
    publishSkill({
      ...current,
      version: newVersion,
      tool_definitions: toolDefs,
      deprecated_at: null,
    });
    logger.info(`Synced tool_definitions for "${skillName}" → v${newVersion}`);
    synced++;
  }
  if (synced > 0) logger.info(`Tool sync complete: updated ${synced} skill(s)`);
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---[\s\S]*?---\s*\n?/, '').trim();
}

export function seedSkills(): void {
  const row = db.prepare('SELECT COUNT(*) as count FROM skill_versions').get() as { count: number };
  if (row.count > 0) return;

  let seeded = 0;
  for (const skillName of Object.keys(STAGE_PERSONA_MAP)) {
    const agentType = STAGE_PERSONA_MAP[skillName];
    const personaFile = path.join(PERSONAS_DIR, `${agentType}.md`);

    let personaPrompt = '';
    try {
      personaPrompt = stripFrontmatter(fs.readFileSync(personaFile, 'utf-8'));
    } catch {
      logger.warn(`Persona file not found for skill "${skillName}": ${personaFile}`);
      continue;
    }

    const templateFileName = STAGE_TEMPLATE_FILE_MAP[skillName];
    let outputFormatTemplate: string | null = null;
    if (templateFileName) {
      try {
        outputFormatTemplate = fs.readFileSync(path.join(TEMPLATES_DIR, templateFileName), 'utf-8');
      } catch {
        logger.warn(`Template file not found for skill "${skillName}": ${templateFileName}`);
      }
    }

    const stageFormat = STAGE_OUTPUT_FORMATS[skillName];
    const toolDefinitions = SEED_TOOL_DEFINITIONS[skillName] ?? null;

    publishSkill({
      skill_name: skillName,
      agent_type: agentType,
      version: '1.0.0',
      owner_team: 'core',
      discipline: 'agent',
      persona_prompt: personaPrompt,
      output_format_template: outputFormatTemplate,
      stage_brief_label: stageFormat?.label ?? null,
      stage_brief_format: stageFormat?.format ?? null,
      development_context: null,
      tool_definitions: toolDefinitions,
      deprecated_at: null,
    });

    seeded++;
  }

  logger.info(`Seeded ${seeded} skills as v1.0.0`);
}
