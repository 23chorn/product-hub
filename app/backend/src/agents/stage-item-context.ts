/**
 * Per-stage builders for the "itemContext" injected into each specialist's brief.
 *
 * Each builder produces the prior stage's artifact(s), formatted for that
 * specialist's needs. Keyed by stage name and looked up by runAutonomousStage
 * (workflow-stage-runner.ts); a stage with no entry here (e.g. the critic) simply
 * gets no itemContext. Feature-specific stages (story_decomposition_F1,
 * qa_engineer_F1, etc.) never reach this dispatch — they're routed to the
 * multi-agent pipeline, or rejected by the STAGE_SESSION_MAP check earlier in
 * runAutonomousStage, before itemContext is ever built.
 *
 * Lives in its own leaf module (depends only on db + sibling agent helpers, never
 * back on the runner) so it can be imported without cycle risk.
 */

import * as fs from 'fs';
import * as path from 'path';
import db from '../data/database';
import { loadLatestArtifactContent } from './artifact-helpers';
import {
  loadWorkflowArtifacts, loadLocalDesignSystem, loadFigmaDesignSystem,
  getFigmaFileKey, setFigmaFileKey, createFigmaFile, resolveItemPlatform, platformHintFor,
} from './prototype-agent';
import { PROJECT_ROOT, insertEvent } from './workflow-db';

export interface ItemContextParams {
  itemId: string;
  workflowId: string;
  stage: string;
  goalText: string | null;
  addPlatformScope: (base: string) => string;
  figmaBypass: boolean;
}

export const ITEM_CONTEXT_BUILDERS: Record<string, (params: ItemContextParams) => Promise<string | undefined>> = {
  async analyst({ goalText, addPlatformScope }) {
    if (!goalText) return undefined;
    return addPlatformScope(`## THIS IS YOUR RESEARCH TOPIC\nThe task below defines exactly what to research. The company context above is background only — your output must be about this specific goal, NOT about the company's existing products.\n\n**Goal:** ${goalText}`);
  },

  async pm_prd({ itemId, goalText, addPlatformScope }) {
    const analystContent = await loadLatestArtifactContent(itemId, 'analyst');
    const parts: string[] = [];
    if (analystContent) parts.push(`**Research Brief (use as background for the PRD):**\n\n${analystContent}`);

    const { loadRelevantBehaviourDocs } = await import('./behaviour-context');
    const behaviourDocs = await loadRelevantBehaviourDocs(`${goalText ?? ''} ${analystContent ?? ''}`);
    if (behaviourDocs) parts.push(behaviourDocs);

    return parts.length > 0 ? addPlatformScope(parts.join('\n\n---\n\n')) : undefined;
  },

  async epic_feature_planner({ itemId, addPlatformScope }) {
    const prdContent = await loadLatestArtifactContent(itemId, 'prd');
    if (!prdContent) return undefined;
    return addPlatformScope(`**PRD Document (use as source of functional requirements to decompose into epic and features):**\n\n${prdContent}`);
  },

  async solution_architect({ itemId, addPlatformScope }) {
    const parts: string[] = [];
    const prdContent = await loadLatestArtifactContent(itemId, 'prd');
    if (prdContent) parts.push(`**PRD Document (use as source of requirements for the architecture):**\n\n${prdContent}`);

    const techStackPath = path.join(PROJECT_ROOT, 'context', 'tech-stack.md');
    let techStackNote = '';
    try {
      const techStack = fs.readFileSync(techStackPath, 'utf-8');
      techStackNote = `**Existing Tech Stack (align your architecture with this):**\n\n${techStack}`;
    } catch {
      techStackNote = `**Note:** No existing tech stack document found at context/tech-stack.md. You should recommend technology choices with tradeoffs for each decision.`;
    }
    parts.push(techStackNote);
    return addPlatformScope(parts.join('\n\n---\n\n'));
  },

  async prototype({ itemId, addPlatformScope }) {
    // Deliberately no design system context here — the prototype stage builds a
    // generic, brand-neutral wireframe (see prototype-builder persona), not a
    // branded mock. Real design tokens are only loaded later for figma_design.
    const artifacts = await loadWorkflowArtifacts(itemId);
    const parts: string[] = [];
    if (artifacts) parts.push(`## Workflow Artifacts\n\nUse these documents to understand the change being prototyped:\n\n${artifacts}`);
    // Built for exactly one platform (mobile or web) — no dual-variant generation,
    // since there's no UI to switch between two generated versions anyway.
    parts.push(platformHintFor(resolveItemPlatform(itemId)));
    return parts.length > 0 ? addPlatformScope(parts.join('\n\n---\n\n')) : undefined;
  },

  async figma_design({ itemId, workflowId, stage, addPlatformScope, figmaBypass }) {
    // Read design tokens from the Figma design system file via MCP
    const figma = await loadFigmaDesignSystem((msg) => {
      insertEvent(workflowId, 'stage_progress', stage, msg.trim());
    });
    const designSystem = figma || await loadLocalDesignSystem();
    const [prdContent, protoContent] = await Promise.all([
      loadLatestArtifactContent(itemId, 'prd'),
      loadLatestArtifactContent(itemId, 'prototype'),
    ]);
    const parts: string[] = [];
    if (designSystem) parts.push(`## Design System\n\n${designSystem}`);
    if (prdContent) parts.push(`## PRD\n\nUse this to identify user journeys each screen must cover:\n\n${prdContent}`);
    if (protoContent) parts.push(`## Prototype\n\nUse this as a reference for the screens and navigation flows to visualise:\n\n${protoContent}`);
    if (!figmaBypass) {
      let mockupFile = getFigmaFileKey(itemId);
      if (!mockupFile) {
        const item = db.prepare<[string], { title: string }>('SELECT title FROM items WHERE id = ?').get(itemId);
        const fileName = item ? `${item.title} — Mockups` : 'Initiative Mockups';
        insertEvent(workflowId, 'stage_progress', stage, `Creating Figma file "${fileName}"...`);
        const created = await createFigmaFile(fileName);
        if (created) {
          setFigmaFileKey(itemId, created);
          mockupFile = created;
          insertEvent(workflowId, 'stage_progress', stage, `Figma file created: ${created}`);
        }
      }
      if (mockupFile) parts.push(`## Target Figma File\n\nCreate mockup frames in Figma file key: \`${mockupFile}\`\nFile URL: https://www.figma.com/file/${mockupFile}/`);
    }
    return parts.length > 0 ? addPlatformScope(parts.join('\n\n---\n\n')) : undefined;
  },
};
