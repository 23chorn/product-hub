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
import { syncSwaggerDoc, type SwaggerDocRow } from '../integrations/swagger-sync';
import Logger from '../utils/logger';

const logger = new Logger('STAGE-ITEM-CONTEXT');
import {
  loadWorkflowArtifacts, loadLocalDesignSystem, loadFigmaDesignSystem,
  getFigmaFileKey, setFigmaFileKey, createFigmaFile, resolveItemPlatform, platformHintFor,
} from './prototype-agent';
import { loadFigmaFrameData } from './figma-design-agent';
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

    const swaggerDocs = db.prepare(`
      SELECT label, content FROM swagger_api_docs WHERE active = 1 AND content IS NOT NULL
    `).all() as Array<{ label: string; content: string }>;
    if (swaggerDocs.length > 0) {
      const docsBlock = swaggerDocs.map((d) => `### ${d.label}\n\n${d.content}`).join('\n\n');
      parts.push(`**Current API Surface (live Swagger/OpenAPI docs for existing services — extend or align with these, don't duplicate or break them):**\n\n${docsBlock}`);
    }

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

  async api_spec({ itemId, addPlatformScope }) {
    const parts: string[] = [];

    // Re-sync active swagger docs at stage execution time so Kira always sees the
    // current state of the existing API. Errors are non-fatal — fall back to last cache.
    const activeDocs = db.prepare<[], SwaggerDocRow & { label: string; content: string | null }>(
      'SELECT id, doc_url, label, content FROM swagger_api_docs WHERE active = 1'
    ).all();
    if (activeDocs.length > 0) {
      await Promise.all(activeDocs.map(async (doc) => {
        try {
          await syncSwaggerDoc({ id: doc.id, doc_url: doc.doc_url });
        } catch (err: any) {
          logger.warn(`api_spec: failed to re-sync swagger doc #${doc.id} — using cached content. Error: ${err.message}`);
        }
      }));
      // Read fresh content after sync
      const freshDocs = db.prepare<[], { label: string; content: string }>(
        'SELECT label, content FROM swagger_api_docs WHERE active = 1 AND content IS NOT NULL'
      ).all();
      if (freshDocs.length > 0) {
        const MAX_CHARS_PER_DOC = 8_000;
        const docsBlock = freshDocs.map((d) => {
          const truncated = d.content.length > MAX_CHARS_PER_DOC;
          const body = truncated ? d.content.slice(0, MAX_CHARS_PER_DOC) + '\n... [truncated — extract auth scheme, error format, and pagination convention from the excerpt above]' : d.content;
          return `### ${d.label}\n\n${body}`;
        }).join('\n\n');
        parts.push(`**Existing API (derive auth scheme, error response format, server base path, and pagination convention from this — do not duplicate existing endpoints):**\n\n${docsBlock}`);
      }
    }

    const [architectureContent, prdContent, epicContent, figmaBriefContent] = await Promise.all([
      loadLatestArtifactContent(itemId, 'architecture'),
      loadLatestArtifactContent(itemId, 'prd'),
      loadLatestArtifactContent(itemId, 'epic_features'),
      loadLatestArtifactContent(itemId, 'figma_design'),
    ]);

    if (architectureContent) parts.push(`**Architecture Brief (derive all component schemas from the data model entities here — use exact entity names as schema names):**\n\n${architectureContent}`);
    if (prdContent) parts.push(`**PRD (source of functional requirements — every endpoint must satisfy a named FR from this document; cite the FR-ID in the endpoint description):**\n\n${prdContent}`);
    if (epicContent) parts.push(`**Epic & Features (scope of this initiative — only endpoints needed for these features belong in the contract):**\n\n${epicContent}`);

    // Load Figma screen data: parse Bora's frame_url per screen and fetch each frame
    // via MCP for actual component/field detail. Falls back to Bora's brief if frame
    // URLs aren't populated yet (designer hasn't built screens).
    if (figmaBriefContent) {
      let fetchedFrames = false;
      try {
        const figmaArtifact = JSON.parse(figmaBriefContent) as { screens_created?: Array<{ name: string; frame_url?: string }> };
        const frameEntries = (figmaArtifact.screens_created ?? [])
          .filter(s => s.frame_url && s.frame_url.length > 0)
          .map(s => ({ name: s.name, url: s.frame_url! }));

        if (frameEntries.length > 0) {
          const frameResults = await Promise.all(
            frameEntries.map(async ({ name, url }) => {
              const data = await loadFigmaFrameData(url);
              return data ? `### ${name}\n\n${data}` : null;
            })
          );
          const validFrames = frameResults.filter((r): r is string => r !== null);
          if (validFrames.length > 0) {
            parts.push(`**Figma Screens (live frame data — response schemas must include exactly the fields shown in these screens, no more):**\n\n${validFrames.join('\n\n')}`);
            fetchedFrames = true;
          }
        }
      } catch { /* JSON parse failed — fall through to brief */ }

      if (!fetchedFrames) {
        // Designer hasn't built the frames yet — use Bora's text brief as a fallback
        parts.push(`**Figma Design Brief (frame URLs not yet populated — use screen descriptions to infer response shapes):**\n\n${figmaBriefContent}`);
      }
    }

    return parts.length > 0 ? addPlatformScope(parts.join('\n\n---\n\n')) : undefined;
  },
};
