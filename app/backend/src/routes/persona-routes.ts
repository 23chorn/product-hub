import { Router } from 'express';
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import path from 'path';

export const personaRoutes = Router();

const PERSONAS_DIR = path.resolve(__dirname, '../../../../agents/personas');

const PERSONA_DISPLAY: Record<string, { displayName: string; agentType: string }> = {
  analyst:          { displayName: 'Sage — Analyst',         agentType: 'analyst' },
  pm:               { displayName: 'Rex — Product Manager',  agentType: 'pm' },
  architect:        { displayName: 'Atlas — Architect',      agentType: 'solution_architect' },
  curator:          { displayName: 'Ivy — Curator',          agentType: 'curator' },
  coordinator:      { displayName: 'Chief of Staff',         agentType: 'coordinator' },
  critic:           { displayName: 'Critic',                 agentType: 'critic' },
  'prototype-builder': { displayName: 'Nova — Prototype',   agentType: 'prototype' },
  'ios-engineer':   { displayName: 'Finn — iOS Engineer',    agentType: 'ios_engineer' },
  'android-engineer': { displayName: 'Remi — Android Eng',  agentType: 'android_engineer' },
  'backend-engineer': { displayName: 'Cole — Backend Eng',  agentType: 'backend_engineer' },
  'qa-engineer':    { displayName: 'Vera — QA Engineer',     agentType: 'qa_engineer' },
  gtm:              { displayName: 'Quinn — GTM Strategy',   agentType: 'gtm_strategy' },
  marketer:         { displayName: 'Milo — Marketing',       agentType: 'feature_marketing' },
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
    const personas = files.map((file) => {
      const name = file.replace('.md', '');
      const raw = readFileSync(path.join(PERSONAS_DIR, file), 'utf-8');
      const { body, frontmatter } = stripFrontmatter(raw);
      const meta = PERSONA_DISPLAY[name] ?? { displayName: name, agentType: name };
      return { name, displayName: meta.displayName, agentType: meta.agentType, content: body, frontmatter };
    });
    // Sort by display name
    personas.sort((a, b) => a.displayName.localeCompare(b.displayName));
    res.json(personas);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

personaRoutes.put('/:name', (req, res) => {
  const { name } = req.params;
  const { content } = req.body;
  if (typeof content !== 'string') {
    return res.status(400).json({ error: 'content is required' });
  }
  const file = path.join(PERSONAS_DIR, `${name}.md`);
  try {
    const raw = readFileSync(file, 'utf-8');
    const { frontmatter } = stripFrontmatter(raw);
    const updated = frontmatter ? `${frontmatter}\n\n${content}` : content;
    writeFileSync(file, updated, 'utf-8');
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
