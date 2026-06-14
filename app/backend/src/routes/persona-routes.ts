import { Router } from 'express';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';

export const personaRoutes = Router();

const PROJECT_ROOT = path.resolve(__dirname, '../../../../');
const PERSONAS_DIR = path.join(PROJECT_ROOT, 'agents', 'personas');

const PERSONA_DISPLAY: Record<string, { displayName: string; agentType: string; skillName: string }> = {
  analyst: { displayName: 'Sage - Analyst', agentType: 'analyst', skillName: 'analyst' },
  pm: { displayName: 'Rex - Product Manager', agentType: 'pm', skillName: 'pm_prd' },
  architect: { displayName: 'Atlas - Architect', agentType: 'architect', skillName: 'solution_architect' },
  curator: { displayName: 'Ivy - Context Curator', agentType: 'curator', skillName: 'curator' },
  coordinator: { displayName: 'Coordinator - Chief of Staff', agentType: 'coordinator', skillName: 'coordinator' },
  critic: { displayName: 'Flint - Adversarial Reviewer', agentType: 'critic', skillName: 'critic' },
  'prototype-builder': { displayName: 'Nova - Prototype', agentType: 'prototype', skillName: 'prototype' },
  'ios-engineer': { displayName: 'Cole - iOS Engineer', agentType: 'ios_engineer', skillName: 'ios-engineer' },
  'android-engineer': { displayName: 'Cole - Android Engineer', agentType: 'android_engineer', skillName: 'android-engineer' },
  'backend-engineer': { displayName: 'Finn - Backend Engineer', agentType: 'backend_engineer', skillName: 'backend-engineer' },
  'web-engineer': { displayName: 'Remi - Web Engineer', agentType: 'web_engineer', skillName: 'web-engineer' },
  'qa-engineer': { displayName: 'Vera - QA Engineer', agentType: 'qa_engineer', skillName: 'qa_engineer' },
  'epic-feature-planner': { displayName: 'Apex - Epic & Feature Planning Specialist', agentType: 'epic-feature-planner', skillName: 'epic_feature_planner' },
  'story-decomposition': { displayName: 'Shard - Product Owner', agentType: 'story-decomposition', skillName: 'story_decomposition' },
  'tech-refinement': { displayName: 'Tech Refinement Team', agentType: 'tech-refinement', skillName: 'tech-refinement' },
};

function stripFrontmatter(content: string): { body: string; frontmatter: string } {
  if (!content.startsWith('---')) return { body: content, frontmatter: '' };
  const end = content.indexOf('\n---', 3);
  if (end === -1) return { body: content, frontmatter: '' };
  const frontmatter = content.slice(0, end + 4);
  const body = content.slice(end + 4).replace(/^\n/, '');
  return { frontmatter, body };
}

personaRoutes.get('/', (_req, res) => {
  try {
    const files = readdirSync(PERSONAS_DIR).filter((f) => f.endsWith('.md'));
    const personas = files
      .filter((file) => PERSONA_DISPLAY[file.replace('.md', '')])
      .map((file) => {
        const name = file.replace('.md', '');
        const raw = readFileSync(path.join(PERSONAS_DIR, file), 'utf-8');
        const { body, frontmatter } = stripFrontmatter(raw);
        const meta = PERSONA_DISPLAY[name];
        return { name, displayName: meta.displayName, agentType: meta.agentType, skillName: meta.skillName, content: body, frontmatter };
      });
    personas.sort((a, b) => a.displayName.localeCompare(b.displayName));
    res.json(personas);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
