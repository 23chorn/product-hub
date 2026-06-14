import * as fs from 'fs';
import * as path from 'path';
import Logger from './logger';

const logger = new Logger('PERSONA-SYNC');

const PROJECT_ROOT = path.resolve(__dirname, '../../../../');
const PERSONAS_DIR = path.join(PROJECT_ROOT, 'agents', 'personas');

const STAGE_PERSONA_FILE_MAP: Record<string, string> = {
  analyst: 'analyst.md',
  pm_prd: 'pm.md',
  solution_architect: 'architect.md',
  story_decomposition: 'story-decomposition.md',
  prototype: 'prototype-builder.md',
  coordinator: 'coordinator.md',
  critic: 'critic.md',
  curator: 'curator.md',
  'epic-feature-planner': 'epic-feature-planner.md',
  'tech-refinement': 'tech-refinement.md',
};

const SAFE_FILE_NAME = /^[a-z0-9][a-z0-9-_]*\.md$/;

function stripFrontmatter(content: string): { frontmatter: string; body: string } {
  if (!content.startsWith('---')) return { frontmatter: '', body: content };
  const end = content.indexOf('\n---', 3);
  if (end === -1) return { frontmatter: '', body: content };
  const frontmatter = content.slice(0, end + 4);
  const body = content.slice(end + 4).replace(/^\n/, '');
  return { frontmatter, body };
}

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function resolvePersonaFileName(skillName: string, agentType: string): string | null {
  const directMap = STAGE_PERSONA_FILE_MAP[skillName] ?? STAGE_PERSONA_FILE_MAP[agentType];
  if (directMap) return directMap;

  const slug = slugify(agentType || skillName);
  const fileName = slug.endsWith('.md') ? slug : `${slug}.md`;
  return SAFE_FILE_NAME.test(fileName) ? fileName : null;
}

export function syncPersonaMarkdownFromSkill(skillName: string, agentType: string, personaPrompt: string): void {
  const fileName = resolvePersonaFileName(skillName, agentType);
  if (!fileName) {
    logger.warn(`Skipping persona sync for "${skillName}" — could not resolve a safe filename`);
    return;
  }

  const filePath = path.join(PERSONAS_DIR, fileName);
  try {
    const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : '';
    const { frontmatter } = stripFrontmatter(existing);
    const nextContent = frontmatter ? `${frontmatter}\n\n${personaPrompt}` : personaPrompt;
    fs.mkdirSync(PERSONAS_DIR, { recursive: true });
    fs.writeFileSync(filePath, nextContent, 'utf-8');
    logger.info(`Synced persona markdown: ${fileName} <- ${skillName}`);
  } catch (err: any) {
    logger.error(`Failed to sync persona markdown for ${skillName}: ${err.message}`);
    throw err;
  }
}
