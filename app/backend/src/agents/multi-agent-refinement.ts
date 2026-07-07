/**
 * Multi-Agent Story Refinement — dynamic collaborative session.
 *
 * Replaces the sequential story_decomposition → qa_engineer → tech_refinement flow
 * with a single collaborative session. The participant set is resolved from the
 * initiative's productArea: Shard - Product Owner (story_decomposition), QA (Vera), and Backend (Finn) are always
 * present; Web (Remi), iOS, and Android engineers are included only when their platform
 * is in scope. This reduces token cost for single-platform features.
 *
 * Pattern: Draft (parallel) → Refine (2 rounds) → Synthesize (merge)
 */

import { logger, insertEvent, touchWorkflow } from './workflow-db';
import { getDemoFixture, demoSleep, DEMO_STAGE_DELAY_MS, isDemoWorkflow } from '../demo/demo-mode';
import { loadLatestArtifactContent } from './artifact-helpers';
import { SpecialistAgent } from './specialist-agent';
import { resolveAgentModel } from '../utils/ai-provider';
import { progressHeartbeatLine, collectStreamWithHeartbeat, STAGE_MAX_OUTPUT_TOKENS } from './stage-metadata';
import { stripJsonFence, parseJsonLoose } from '../utils/json-repair';
import { loadEpicFeatures } from './feature-decomposition';
import { readProductArea } from './item-metadata';
import { featureLocalKey, type AgentType } from '@pap/shared';
import * as fs from 'fs';
import * as path from 'path';
import { findRepoRoot } from '../utils/find-repo-root';
import db from '../data/database';

interface RefinementParticipant {
  name: string;
  agentType: AgentType;
  role: string; // What they focus on in the session
}

const PARTICIPANTS: RefinementParticipant[] = [
  { name: 'Shard - Product Owner', agentType: 'story-decomposition', role: 'Product Lead — Facilitator' },
  { name: 'Vera', agentType: 'qa-engineer', role: 'QA Engineer — Testability & Quality' },
  { name: 'Finn', agentType: 'backend-engineer', role: 'Backend Engineer — APIs & Data' },
  { name: 'Remi', agentType: 'web-engineer', role: 'Web Engineer — Frontend & UX' },
  { name: 'Cole', agentType: 'ios-engineer', role: 'iOS Engineer — Swift & Apple Platforms' },
  { name: 'Dex', agentType: 'android-engineer', role: 'Android Engineer — Kotlin & Android Platforms' },
];

export interface ProductAreaScope {
  /** Raw productArea label from item metadata (e.g. "Mobile App"), or null when unset/unrecognised. */
  area: string | null;
  hasWeb: boolean;
  hasIOS: boolean;
  hasAndroid: boolean;
}

/**
 * Resolve the platform scope from the productArea stored in items.metadata.
 * Used to (a) filter which engineer participants join the refinement session,
 * (b) tell every participant which platform(s) are in scope, and (c) enforce
 * that scope on the synthesized artifacts as a backstop against the model
 * ignoring the instruction. Exported so feature-stage-runner.ts's revision
 * paths can apply the same scope when surgically editing a single feature.
 *
 * When productArea is unset or doesn't match a recognised platform keyword,
 * all platforms are treated as in-scope (no enforcement).
 */
export function resolveProductAreaScope(itemId: string): ProductAreaScope {
  const unscoped: ProductAreaScope = { area: null, hasWeb: true, hasIOS: true, hasAndroid: true };
  const area = readProductArea(itemId);
  if (!area) return unscoped;

  const lower = area.toLowerCase();
  const hasWeb = /web|browser|desktop/.test(lower);
  const hasIOS = /\bmobile\b|\bios\b/.test(lower);
  const hasAndroid = /\bmobile\b|\bandroid\b/.test(lower);

  // No recognised platform signal — treat as unscoped (all platforms allowed)
  if (!hasWeb && !hasIOS && !hasAndroid) return { area, hasWeb: true, hasIOS: true, hasAndroid: true };

  return { area, hasWeb, hasIOS, hasAndroid };
}

/**
 * Filter the participant list to the platforms in scope.
 * - Shard - Product Owner (Product), Vera (QA), and Finn (Backend) are always included.
 * - Remi (Web), Cole (iOS), and Dex (Android) are included only when their platform is in scope.
 */
function resolveRefinementParticipants(itemId: string): RefinementParticipant[] {
  const scope = resolveProductAreaScope(itemId);
  if (!scope.area) return PARTICIPANTS;

  return PARTICIPANTS.filter(p => {
    if (p.agentType === 'web-engineer') return scope.hasWeb;
    if (p.agentType === 'ios-engineer') return scope.hasIOS;
    if (p.agentType === 'android-engineer') return scope.hasAndroid;
    return true; // facilitator, QA, and backend are always included
  });
}

/** Find a participant by agentType rather than display name, so a persona rename can't silently break routing. */
function findParticipant(participants: RefinementParticipant[], agentType: AgentType): RefinementParticipant | undefined {
  return participants.find(p => p.agentType === agentType);
}

/**
 * Build the "## Platform Scope" brief section that tells every participant which
 * platform(s) are in scope and which to leave out entirely. Returns '' when unscoped.
 * Exported so feature-stage-runner.ts's revision paths render the identical wording.
 */
export function buildPlatformScopeSection(scope: ProductAreaScope): string {
  if (!scope.area) return '';

  const excludedPlatforms = [
    !scope.hasWeb ? 'web' : null,
    !scope.hasIOS ? 'iOS' : null,
    !scope.hasAndroid ? 'Android' : null,
  ].filter((p): p is string => p !== null);
  const inScopeChannels = [
    'backend',
    scope.hasWeb ? 'web' : null,
    scope.hasIOS ? 'ios' : null,
    scope.hasAndroid ? 'android' : null,
  ].filter(Boolean).join(', ');

  return `
## Platform Scope
**This feature is scoped to:** ${scope.area}
- In-scope channels: ${inScopeChannels}${excludedPlatforms.length ? `
- Do NOT create stories, tickets, or test cases for ${excludedPlatforms.join(' or ')} — not even as "nice to have" or "future work". Leave excluded channels out entirely, not just deprioritized.
- This applies to every contributor, including Shard's story list and Vera's test suite.` : ''}`;
}

/**
 * Build the "## Feature Platform Scope" brief section for when THIS feature (as
 * opposed to the whole initiative) is declared to cover only specific platforms —
 * e.g. one sibling feature owns the iOS/Android UI and another owns the Web UI for
 * the same functional area. Returns '' when the feature has no declared restriction
 * (it inherits only the initiative-wide Platform Scope section above).
 */
export function buildFeaturePlatformScopeSection(platforms: string[] | undefined): string {
  if (!Array.isArray(platforms) || platforms.length === 0) return '';

  const labels: Record<string, string> = { web: 'Web', ios: 'iOS', android: 'Android' };
  const included = new Set(platforms.map(p => p.toLowerCase()));
  const excluded = (['web', 'ios', 'android'] as const).filter(p => !included.has(p));
  if (excluded.length === 0) return '';

  return `
## Feature Platform Scope
**This feature covers ONLY:** ${platforms.join(', ')}
- Do NOT create stories for ${excluded.map(p => labels[p]).join(' or ')} in this feature — another feature in this phase already owns that platform's UI. Backend/API stories are still fine if this feature genuinely needs its own backend work.
- This applies to every contributor, including Shard's story list.`;
}

/**
 * Shared core for the platform-scope backstops below: drop any stories whose
 * `platform` isn't in `allowed` from a backlog JSON artifact (epic + features +
 * stories). Stories with no platform set always pass through unfiltered.
 */
function filterStoriesByAllowedPlatforms(
  backlog: string,
  allowed: Set<string>
): { backlog: string; survivorStoryIds: Set<string> | null; dropped: number } {
  const backlogJson = parseJsonLoose(backlog);
  if (!backlogJson || !Array.isArray(backlogJson.features)) return { backlog, survivorStoryIds: null, dropped: 0 };

  const survivorStoryIds = new Set<string>();
  let dropped = 0;
  for (const feature of backlogJson.features) {
    if (!Array.isArray(feature.stories)) continue;
    const before = feature.stories.length;
    feature.stories = feature.stories.filter((story: any) => {
      const platformRaw = story?.platform;
      const platformStr = typeof platformRaw === 'string' ? platformRaw : Array.isArray(platformRaw) ? platformRaw[0] : null;
      const keep = !platformStr || allowed.has(platformStr);
      if (keep && story?.story_id) survivorStoryIds.add(story.story_id);
      return keep;
    });
    dropped += before - feature.stories.length;
  }

  if (dropped === 0) return { backlog, survivorStoryIds, dropped: 0 };
  return { backlog: JSON.stringify(backlogJson, null, 2), survivorStoryIds, dropped };
}

/**
 * Strip any stories whose platform falls outside the resolved scope from a backlog
 * JSON artifact (epic + features + stories). This is a backstop: the brief already
 * instructs participants to stay in scope, but this guarantees it even if a model
 * ignores the instruction. Returns the surviving story_ids so QA test cases that
 * reference a dropped story can be cleaned up too.
 */
export function filterBacklogStoriesByScope(
  backlog: string,
  scope: ProductAreaScope
): { backlog: string; survivorStoryIds: Set<string> | null; dropped: number } {
  if (!scope.area) return { backlog, survivorStoryIds: null, dropped: 0 }; // unscoped — nothing to enforce

  const allowed = new Set<string>(['backend']); // backend work is always in scope regardless of channel
  if (scope.hasWeb) allowed.add('web');
  if (scope.hasIOS) allowed.add('ios');
  if (scope.hasAndroid) allowed.add('android');

  const { backlog: filtered, survivorStoryIds, dropped } = filterStoriesByAllowedPlatforms(backlog, allowed);
  if (dropped > 0) {
    logger.warn(`[MULTI-AGENT] Platform scope "${scope.area}" — stripped ${dropped} out-of-scope story/stories from the backlog`);
  }
  return { backlog: filtered, survivorStoryIds, dropped };
}

/**
 * Strip any stories whose UI platform falls outside a feature's own declared platform
 * scope (epic_features' optional `platforms` field on a feature). This is the backstop
 * for the case where sibling features split the same functional area by platform — e.g.
 * one feature owns the iOS/Android UI, another owns the Web UI — and the model drafts
 * stories for a platform outside the one this specific feature was scoped to. Backend is
 * always allowed since a UI-scoped feature can still need its own backend work. Returns
 * the backlog unchanged when the feature declared no platform restriction.
 */
export function filterBacklogStoriesByFeaturePlatforms(
  backlog: string,
  featurePlatforms: string[] | undefined
): { backlog: string; dropped: number } {
  if (!Array.isArray(featurePlatforms) || featurePlatforms.length === 0) return { backlog, dropped: 0 };

  const allowed = new Set<string>(['backend', ...featurePlatforms.map(p => p.toLowerCase())]);
  const { backlog: filtered, dropped } = filterStoriesByAllowedPlatforms(backlog, allowed);
  if (dropped > 0) {
    logger.warn(`[MULTI-AGENT] Feature platform scope [${featurePlatforms.join(', ')}] — stripped ${dropped} out-of-scope story/stories from the backlog`);
  }
  return { backlog: filtered, dropped };
}

/**
 * Strip QA test cases whose story_ref no longer points at a surviving story (i.e. its
 * story was dropped by filterBacklogStoriesByScope). Pass survivorStoryIds = null to
 * skip filtering (unscoped feature).
 *
 * currentFeatureKey scopes the check to THIS feature's own refs only — survivorStoryIds
 * only ever holds this feature's own story_ids, so a cross-feature ref (e.g. "F1.S5"
 * cited from F2's test suite) was never going to be in there. Validating it against
 * this guard would wrongly strip a legitimate cross-feature link; that ref's integrity
 * isn't this guard's concern, so refs outside currentFeatureKey pass through untouched.
 */
export function filterQaTestCasesByStoryIds(
  qaTests: string,
  survivorStoryIds: Set<string> | null,
  currentFeatureKey: string
): { qaTests: string; dropped: number } {
  if (!survivorStoryIds) return { qaTests, dropped: 0 };

  const qaJson = parseJsonLoose(qaTests);
  if (!qaJson || !Array.isArray(qaJson.test_cases)) return { qaTests, dropped: 0 };

  const isOwnFeatureRef = (ref: unknown): ref is string =>
    typeof ref === 'string' && ref.startsWith(`${currentFeatureKey}.`);

  const before = qaJson.test_cases.length;
  qaJson.test_cases = qaJson.test_cases.filter((tc: any) => {
    if (!tc?.story_ref) return true;
    const refs = Array.isArray(tc.story_ref) ? tc.story_ref : [tc.story_ref];
    const ownRefs = refs.filter(isOwnFeatureRef);
    if (ownRefs.length === 0) return true; // no ref claims to be this feature's own — not our concern
    return ownRefs.some((r: string) => survivorStoryIds.has(r));
  });
  const dropped = before - qaJson.test_cases.length;
  if (dropped === 0) return { qaTests, dropped: 0 };

  return { qaTests: JSON.stringify(qaJson, null, 2), dropped };
}



export interface RefinementResult {
  /** Backlog JSON for this feature — saved as the checkpoint artifact. */
  backlog: string;
  // qaTests removed — QA is now generated once at epic level after all features are approved (epic_qa stage).
}

/**
 * Run a multi-agent collaborative story refinement session for a single feature.
 *
 * @param workflowId - The workflow ID
 * @param itemId - The initiative ID
 * @param stage - The stage name (e.g., 'story_decomposition_F1')
 * @param featureIndex - 0-based feature index
 * @returns RefinementResult with backlog JSON and standalone QA test suite JSON
 */
export async function runMultiAgentRefinement(
  workflowId: string,
  itemId: string,
  stage: string,
  featureIndex: number
): Promise<RefinementResult> {
  const featureNum = featureIndex + 1;
  logger.info(`[MULTI-AGENT] Starting collaborative refinement for Feature ${featureNum} (stage: ${stage})`);

  // ── Demo Mode: Return fixture immediately ──────────────────────────────────
  // Use per-workflow policy_overrides (same source as runAutonomousStage) so that
  // demo and real workflows are distinguished consistently across all stage types.
  const workflow = db.prepare('SELECT policy_overrides FROM workflows WHERE id = ?').get(workflowId) as { policy_overrides: string | null } | undefined;
  const policyOverrides: Record<string, string> = workflow?.policy_overrides ? JSON.parse(workflow.policy_overrides) : {};
  const isDemo = isDemoWorkflow(policyOverrides);
  logger.info(`[MULTI-AGENT] Demo mode check result: ${isDemo}`);

  if (isDemo) {
    logger.info(`[MULTI-AGENT] Demo mode enabled — returning fixture for ${stage}`);
    const fixture = getDemoFixture(stage);

    if (fixture) {
      logger.info(`[MULTI-AGENT] Demo fixture found for ${stage} (${fixture.length} chars) — skipping LLM calls`);
      const demoParticipantNames = resolveRefinementParticipants(itemId).map(p => p.name).join(', ');
      insertEvent(workflowId, 'stage_progress', stage,
        `Demo fixture loaded for Feature ${featureNum} — simulating multi-agent refinement`);
      const delay = DEMO_STAGE_DELAY_MS[stage] ?? 2_000;
      await demoSleep(delay);
      return { backlog: fixture };
    }

    logger.warn(`[MULTI-AGENT] No demo fixture found for ${stage}, falling back to real workflow`);
  } else {
    logger.warn(`[MULTI-AGENT] Demo mode is DISABLED — will make real LLM calls (expensive!)`);
  }

  // ── Resolve active participants and platform scope based on productArea ────
  const platformScope = resolveProductAreaScope(itemId);
  const activeParticipants = resolveRefinementParticipants(itemId);
  const participantNames = activeParticipants.map(p => p.name).join(', ');
  logger.info(`[MULTI-AGENT] Active participants for Feature ${featureNum}: ${participantNames}`);

  // ── Load Context ────────────────────────────────────────────────────────────
  const wfRow = db.prepare('SELECT stage_sequence FROM workflows WHERE id = ?').get(workflowId) as { stage_sequence: string } | undefined;
  const apiSpecStageEnabled = wfRow ? (JSON.parse(wfRow.stage_sequence) as string[]).includes('api_spec') : false;

  const [prdContent, archContent, epicFeaturesLoaded, figmaContent, rawApiSpecContent] = await Promise.all([
    loadLatestArtifactContent(itemId, 'prd'),
    loadLatestArtifactContent(itemId, 'architecture'),
    // Epic + features from epic_feature_planner
    loadEpicFeatures(itemId).catch((err: any) => {
      logger.warn(`[MULTI-AGENT] Failed to parse epic_features: ${err.message}`);
      return null;
    }),
    loadLatestArtifactContent(itemId, 'figma_design'),  // Designer-approved screens from the figma_design stage, if it ran
    apiSpecStageEnabled ? loadLatestArtifactContent(itemId, 'api_spec') : Promise.resolve(null), // Proposed endpoint changes from api_spec, if it ran
  ]);
  const apiSpecContent = rawApiSpecContent?.trim() || null;

  // Extract the target feature from the epic_features artifact.
  // flattenFeatures handles both new phases[] and legacy features[] formats.
  let targetFeature: any = null;
  let epicContext: any = null;
  let phaseContext: { label: string; deliverable?: string; epicTitle?: string } | null = null;

  if (epicFeaturesLoaded) {
    const { raw: epicFeatures, features: allFeatures } = epicFeaturesLoaded;
    if (allFeatures[featureIndex]) {
      targetFeature = allFeatures[featureIndex];
    }

    epicContext = epicFeatures.epic || null;

    // Find which phase contains this feature by walking the phase list in order
    if (Array.isArray(epicFeatures.phases)) {
      let count = 0;
      for (const phase of epicFeatures.phases) {
        const features = Array.isArray(phase.features) ? phase.features : [];
        if (featureIndex < count + features.length) {
          phaseContext = {
            label: phase.label,
            deliverable: phase.deliverable,
            epicTitle: phase.epicTitle,
          };
          break;
        }
        count += features.length;
      }
    }
  }

  if (!targetFeature) {
    throw new Error(`Feature ${featureNum} not found in epic_features artifact (featureIndex=${featureIndex})`);
  }

  // acceptanceCriteria may be camelCase (from template) or snake_case (from older artifacts)
  const featureACs: string[] =
    targetFeature.acceptanceCriteria ?? targetFeature.acceptance_criteria ?? [];
  const prdRef = targetFeature.prdRef ?? targetFeature.prd_ref ?? null;
  const frIds: string[] =
    prdRef?.functionalRequirements ?? prdRef?.functional_requirements ?? [];
  const nfrIds: string[] =
    prdRef?.nonFunctionalRequirements ?? prdRef?.non_functional_requirements ?? [];
  const journeys: string[] =
    prdRef?.userJourneys ?? prdRef?.user_journeys ?? [];
  const outOfScope: string[] =
    epicContext?.outOfScope ?? epicContext?.out_of_scope ?? [];

  // ── Match Figma screens to this feature's PRD journeys ─────────────────────
  // Keeps designer-captured detail (frame links, interactions, layout notes) attached
  // to the right stories instead of dead-ending as a single hyperlink post-hoc.
  interface FigmaScreenRef {
    name: string;
    frame_url?: string;
    description?: string;
    layout_notes?: string;
    interactions?: Array<{ trigger?: string; target_screen?: string; notes?: string }>;
    prd_journeys?: string[];
  }
  let relevantScreens: FigmaScreenRef[] = [];
  if (figmaContent) {
    try {
      const figmaDesign = JSON.parse(stripJsonFence(figmaContent));
      const allScreens: FigmaScreenRef[] = Array.isArray(figmaDesign.screens_created) ? figmaDesign.screens_created : [];
      const journeySet = new Set(journeys.map(j => j.toLowerCase()));
      relevantScreens = journeySet.size > 0
        ? allScreens.filter(s => (s.prd_journeys ?? []).some(j => journeySet.has(j.toLowerCase())))
        : [];
      // No journey overlap found (or feature has no listed journeys) — fall back to
      // the full screen set so design detail isn't silently dropped from the brief.
      if (relevantScreens.length === 0) relevantScreens = allScreens;
    } catch (err: any) {
      logger.warn(`[MULTI-AGENT] Failed to parse figma_design artifact: ${err.message}`);
    }
  }

  const platformScopeSection = buildPlatformScopeSection(platformScope);
  const featurePlatforms: string[] | undefined = Array.isArray(targetFeature.platforms) ? targetFeature.platforms : undefined;
  const featurePlatformScopeSection = buildFeaturePlatformScopeSection(featurePlatforms);

  const featureBrief = `
# Feature Refinement Session

## Initiative Context
${epicContext ? `**Initiative:** ${epicContext.title || ''}
**Purpose:** ${epicContext.description || ''}
**Business Value:** ${epicContext.businessValue || epicContext.business_value || ''}` : ''}
${outOfScope.length ? `**Out of Scope (do NOT build these):** ${outOfScope.join('; ')}` : ''}
${platformScopeSection}
${featurePlatformScopeSection}

## Phase Context
${phaseContext ? `**Phase:** ${phaseContext.label}${phaseContext.epicTitle ? ` — ${phaseContext.epicTitle}` : ''}
**What ships in this phase:** ${phaseContext.deliverable || ''}` : ''}

## Feature to Decompose
**Feature ${featureNum}: ${targetFeature.title}**

${targetFeature.description || ''}

${targetFeature.rationale ? `**Why this feature / why now:** ${targetFeature.rationale}` : ''}

${featureACs.length ? `**Feature Acceptance Criteria (must be satisfied when this feature is fully complete):**
${featureACs.map((ac: string, i: number) => `${i + 1}. ${ac}`).join('\n')}` : ''}

${prdRef ? `**PRD Traceability:**
- Functional Requirements satisfied: ${frIds.length ? frIds.join(', ') : '(none listed)'}
- Non-Functional Requirements that constrain this feature: ${nfrIds.length ? nfrIds.join(', ') : '(none listed)'}
- User Journeys supported: ${journeys.length ? journeys.join(', ') : '(none listed)'}` : ''}

${relevantScreens.length ? `## Design Reference (Figma — designer-approved)
${relevantScreens.map(s => `**${s.name}**${s.frame_url ? ` — ${s.frame_url}` : ' (frame not yet created)'}
${s.description ? s.description : ''}${s.layout_notes ? `\nLayout: ${s.layout_notes}` : ''}${s.interactions?.length ? `\nInteractions: ${s.interactions.map(i => `${i.trigger ?? '?'} → ${i.target_screen ?? '?'}${i.notes ? ` (${i.notes})` : ''}`).join('; ')}` : ''}`).join('\n\n')}

Any story whose UI surfaces one of these screens must cite the screen's frame_url directly in its acceptance_criteria or technical_acceptance_criteria — don't leave the design link implicit.` : ''}

**Full PRD:** ${prdContent ? '(appended below)' : '(not available)'}
**Architecture:** ${archContent ? '(appended below)' : '(not available)'}
**API Contract:** ${apiSpecContent ? '(appended below)' : '(not available)'}
`.trim();

  // ── Phase 1: Draft (Parallel) ──────────────────────────────────────────────
  insertEvent(workflowId, 'stage_progress', stage,
    `Phase 1: Draft — ${activeParticipants.length} agents proposing initial contributions in parallel (${participantNames})...`);

  const draftPrompts = buildDraftPrompts(featureNum, featureBrief, prdContent, archContent, apiSpecContent, activeParticipants);
  const drafts = await runPhaseInParallel(workflowId, stage, 'Draft', draftPrompts);

  // ── Phase 2: Refine Round 1 ────────────────────────────────────────────────
  insertEvent(workflowId, 'stage_progress', stage,
    `Phase 2.1: Refine — All agents review each other's drafts and refine...`);

  const refine1Prompts = buildRefineRound1Prompts(featureNum, featureBrief, drafts, activeParticipants);
  const refined1 = await runPhaseInParallel(workflowId, stage, 'Refine-1', refine1Prompts);

  // ── Phase 2: Refine Round 2 ────────────────────────────────────────────────
  insertEvent(workflowId, 'stage_progress', stage,
    `Phase 2.2: Refine — Final polish and conflict resolution...`);

  const refine2Prompts = buildRefineRound2Prompts(featureNum, featureBrief, refined1, activeParticipants);
  const refined2 = await runPhaseInParallel(workflowId, stage, 'Refine-2', refine2Prompts);

  // ── Phase 3: Synthesize ────────────────────────────────────────────────────
  insertEvent(workflowId, 'stage_progress', stage,
    `Phase 3: Synthesize — merging final backlog...`);

  const rawBacklog = await synthesizeFinalArtifact(workflowId, stage, featureBrief, refined2);
  // Platform-scope backstops: drop any out-of-scope stories the model included despite the
  // brief — first against the initiative-wide scope, then against this feature's own
  // narrower platform declaration (e.g. a sibling feature already owns the other platform).
  const { backlog: itemScoped } = filterBacklogStoriesByScope(rawBacklog, platformScope);
  const { backlog } = filterBacklogStoriesByFeaturePlatforms(itemScoped, featurePlatforms);

  logger.info(`[MULTI-AGENT] Feature ${featureNum} refinement complete — backlog: ${backlog.length} chars`);
  return { backlog };
}

/**
 * Run a phase with all agents in parallel.
 */
async function runPhaseInParallel(
  workflowId: string,
  stage: string,
  phaseName: string,
  prompts: Array<{ participant: RefinementParticipant; prompt: string }>
): Promise<Map<string, string>> {
  const results = new Map<string, string>();

  // Aggregate live char counts across all concurrently-streaming agents so the heartbeat
  // reflects the whole phase's progress, not just whichever agent happens to tick last.
  const charsByAgent = new Map<string, number>();
  const phaseStart = Date.now();
  let lastHeartbeat = phaseStart;

  // Run all agents in parallel
  const promises = prompts.map(async ({ participant, prompt }) => {
    try {
      logger.info(`[MULTI-AGENT] ${phaseName} | ${participant.name} (${participant.agentType}) starting...`);
      const agent = new SpecialistAgent(participant.agentType);
      const persona = await agent.loadPersona(stage);

      // Build system prompt with persona + multi-agent context
      const systemPrompt = await agent.buildSystemPrompt(
        persona,
        undefined, // workflowContext
        undefined, // itemContext
        true, // autonomous
        stage
      );

      let fullResponse = '';
      for await (const chunk of agent.streamResponse(
        systemPrompt,
        [{ role: 'user', content: prompt }],
        resolveAgentModel(participant.agentType),
        undefined, // onTokens
        8_000 // max tokens per agent
      )) {
        fullResponse += chunk;
        charsByAgent.set(participant.name, fullResponse.length);

        const now = Date.now();
        if (now - lastHeartbeat > 12_000) {
          lastHeartbeat = now;
          const totalChars = Array.from(charsByAgent.values()).reduce((a, b) => a + b, 0);
          const elapsedSec = Math.round((now - phaseStart) / 1000);
          insertEvent(workflowId, 'stage_progress', stage,
            progressHeartbeatLine(`${phaseName} — ${charsByAgent.size}/${prompts.length} agent(s) responding`, elapsedSec, totalChars));
        }
      }

      results.set(participant.name, fullResponse.trim());
      logger.info(`[MULTI-AGENT] ${phaseName} | ${participant.name} complete (${fullResponse.length} chars)`);
    } catch (err: any) {
      // Deliberately don't store anything for this participant — an entry here would
      // flow verbatim into every downstream prompt and the final synthesis as if it
      // were real contribution text, rather than being recognized as a failure.
      // Omitting it just means this participant's section is absent from "All
      // Drafts"/"All Outputs", the same as a platform-excluded participant today.
      logger.error(`[MULTI-AGENT] ${phaseName} | ${participant.name} failed: ${err.message}`);
    }
  });

  await Promise.all(promises);
  return results;
}

/**
 * Shared rule for how a single acceptance_criteria array entry must be shaped — reused by
 * the initial draft prompt below and by the surgical revision directive in
 * feature-stage-runner.ts (STORY_REVISION_SPEC), since a revision asking for more detail on
 * an existing AC is just as likely to trigger the same over-splitting as the first draft.
 * Written from an observed failure mode: as an AC accumulates more And-clauses (edge cases,
 * localization, network states), the model drifts into emitting one array entry per clause
 * instead of one entry per scenario — which then renders as a wall of disconnected "AC N"
 * blocks in ADO instead of one coherent scenario.
 */
export const ACCEPTANCE_CRITERIA_FORMAT_RULE =
  `**Acceptance criteria structure — read carefully:** each \`acceptance_criteria\` array entry is ONE complete, self-contained scenario as a SINGLE string. A scenario's Given/When/Then/And chain must stay inside that one string, no matter how many And-clauses it needs (extra conditions, edge cases, localization) — never split it across multiple array entries.\n` +
  `- CORRECT (one array entry): "Given I am on the Referral Code Share screen\\nWhen I view my code\\nThen it is displayed in a distinct container\\nAnd if the network is unavailable but a cached code exists, the cached code is shown with a \\'last updated\\' subtitle\\nAnd if no cached code exists, an error message with a Retry button is shown"\n` +
  `- WRONG (never do this — same scenario fragmented across entries): ["Given I am on the Referral Code Share screen", "And my code is displayed", "When I tap Share", "Then the share sheet opens", "And the message is pre-populated"]\n` +
  `- A new array entry is only for a genuinely different scenario (different trigger or different starting state) — not a continuation of the one you're already writing.\n` +
  `- **Don't over-correct the other way.** One response producing one outcome (plus a directly-related fallback, like a cached-value or empty state) is still one scenario — keep it in one entry. But when the SAME trigger can produce several genuinely distinct outcomes (different HTTP status/error codes, success vs. each distinct failure mode), each outcome is its OWN scenario — write one array entry per outcome. Don't chain repeated "When X... Then Y... When Z... Then W..." pairs inside a single entry just because they share a triggering action.\n` +
  `- WRONG (4 distinct response-code branches merged into 1 entry): "When the app calls POST /ValidateCode and receives 200 Then it stores the code... When it receives 400 ATTRIBUTION_EXISTS Then it shows an error... When it receives 404 Then it shows a different error... When it receives 500 Then it shows a generic error" — this is 4 scenarios (success + 3 distinct failure modes), not 1.\n` +
  `- CORRECT (same case, split by outcome): a separate entry for the 200/success path, and a separate entry for each of the 400/404/500 failure paths — each a complete, self-contained Given/When/Then string.`;

/**
 * Guardrail against analytics/tracking instrumentation leaking into a functional story's
 * acceptance criteria (e.g. an AC for "create a record" quietly also requiring a CleverTap
 * event fire). Mirrors the separation dedicated analytics features already get (see the
 * "Analytics/logging/monitoring features" draft-prompt rule below) at the story level too —
 * every ticket is either building the thing or instrumenting the thing, never both blended
 * into one AC list. Reused across the draft, technical-direction, and synthesis prompts so
 * the rule holds no matter which phase would otherwise introduce the leak.
 */
export const ANALYTICS_SEPARATION_RULE =
  `**Keep analytics/tracking out of functional stories:** unless a story exists specifically to add instrumentation (event firing, logging, tracking pixels), do not add acceptance criteria, technical acceptance criteria, or technical notes for firing an analytics/tracking event (e.g. "fires a CleverTap \`record_created\` event", "logs an analytics event to Segment/Mixpanel/Amplitude"). If new tracking is genuinely needed alongside this story's functionality, write it as its own separate story (e.g. "Track Record Creation Event [Backend]") rather than folding it into the AC of the story that builds the underlying functionality.`;

/**
 * Phase 1: Build draft prompts for each agent.
 */
function buildDraftPrompts(
  featureNum: number,
  featureBrief: string,
  prdContent: string | null,
  archContent: string | null,
  apiSpecContent: string | null,
  participants: RefinementParticipant[] = PARTICIPANTS
): Array<{ participant: RefinementParticipant; prompt: string }> {
  return participants.map(participant => {
    let prompt = `${featureBrief}\n\n`;

    if (participant.agentType === 'story-decomposition') {
      // Product Lead: Draft initial stories
      prompt += `
**Your Role:** You are the **Product Lead and Facilitator** of this refinement session.

**Phase 1 Task — Draft Stories:**
1. Break this feature into **6-8 user stories maximum** (format: "As a [persona], I want [capability], so that [benefit]")
   - Target 6-8. Never exceed 8. If you think you need more, the feature scope is too wide — scope down to the most valuable 8.
   - Each story must be independently deliverable and testable in isolation
   - Together the stories must fully cover the Feature Acceptance Criteria listed in the brief above
2. Add product acceptance criteria (Given/When/Then format) to each story

${ACCEPTANCE_CRITERIA_FORMAT_RULE}

3. Map each story to the Functional Requirements it satisfies (see PRD Traceability in the brief)
4. Estimate story points (1-2-3-5 scale) based on scope — prefer smaller estimates for atomic tasks
5. Don't add technical details yet — that's what the engineers will contribute in the next round
6. **CRITICAL — One stream per ticket:** Each story must belong to exactly ONE platform stream: \`backend\`, \`web\`, \`ios\`, or \`android\`. If a piece of work spans multiple platforms (e.g., an API + a UI), write a separate story for each platform. Name them descriptively: e.g. "Set Up Alert API [Backend]" and "Alert Creation Form [Web]".
7. Do not write accessibility-specific acceptance criteria or stories (screen reader support, TalkBack, VoiceOver, voice control, etc.) — this product does not target those use cases unless the PRD explicitly calls for them.
8. Never write a story whose persona is a QA/test engineer (e.g. "As a QA engineer, I want to test..."). Test coverage is owned entirely by the dedicated test-case creation stage — don't duplicate it as a backlog story.
9. **Analytics/logging/monitoring features:** if this feature's purpose is to instrument, track, log, or measure an existing or already-planned capability (e.g. "Referral Funnel Analytics", "Checkout Error Logging", "Trading Activity Dashboard"), every story must be about the instrumentation itself — event schema/taxonomy, event firing at the right trigger points, the data pipeline/aggregation, dashboards, alerting thresholds. Do not write stories that (re)build the underlying feature being measured (the referral flow, the checkout flow, the trading screen, etc.) — that's already in scope elsewhere unless the Feature Acceptance Criteria in the brief above explicitly says this feature includes building it.
10. ${ANALYTICS_SEPARATION_RULE}

**Output Format:**
Return a JSON structure (use F${featureNum} for all story IDs):
\`\`\`json
{
  "stories": [
    {
      "story_id": "F${featureNum}.S1",
      "title": "...",
      "as_a": "...",
      "i_want": "...",
      "so_that": "...",
      "acceptance_criteria": ["Given...", "When...", "Then..."],
      "prd_ref": {
        "functional_requirements": ["FR-01"],
        "non_functional_requirements": ["NFR1"]
      },
      "platform": "backend"
    }
  ]
}
\`\`\`

The \`platform\` value must be exactly one of: \`backend\`, \`web\`, \`ios\`, \`android\`.
`;
    } else if (participant.agentType === 'qa-engineer') {
      // QA Engineer: Testability concerns
      prompt += `
**Your Role:** You are the **QA Engineer** in this refinement session. Your suite covers user-facing flows (web/iOS/Android) — backend-only/API-only stories are a different specialist's concern and won't get dedicated test cases from you.

**Phase 1 Task — Testability Review:**
1. Review the feature brief and user stories (you'll see the Product Lead's draft in Round 2)
2. List potential **testability concerns** for this feature, focused on what a user would experience:
   - What user-facing behavior will be hard to verify?
   - What user-visible edge cases need coverage (validation messages, blocked actions, ambiguous states)?
   - What test data or environments are needed to exercise those user flows?
3. Propose test case categories grounded in user flows (happy path, validation/error messaging, edge cases the user can hit) — not backend/API contract categories

**Output Format:**
Plain text list of concerns and recommendations. Example:
- Concern: "Price validation needs boundary testing (zero, negative, very large numbers)"
- Recommendation: "Each story should specify valid input ranges in ACs"
`;
    } else {
      // Engineers: Technical needs
      const platformFocus = participant.agentType === 'backend-engineer' ? 'Backend APIs, data models, authentication'
        : participant.agentType === 'web-engineer' ? 'Frontend components, state management, forms'
        : participant.agentType === 'ios-engineer' ? 'iOS native implementation (Swift/SwiftUI), offline support, APNs push notifications, Apple platform patterns'
        : 'Android native implementation (Kotlin/Jetpack Compose), offline support, FCM push notifications, Material Design patterns';

      prompt += `
**Your Role:** You are the **${participant.role}** in this refinement session.

**Phase 1 Task — Technical Needs:**
1. Review the feature brief
2. List the high-level technical direction needed to build this feature — meaningful direction only, not a full spec:
   - ${platformFocus}
3. Flag any technical constraints or complexities (e.g., "Offline mode will require local DB sync")
4. Suggest story splits if a feature needs multiple platform-specific implementations

**Output Format:**
Plain text list of technical direction, kept high-level — exact endpoints, schemas, and component names can be worked out later during technical refinement. Example:
- API needed for creating price alerts
- New data model to track alert conditions per user
- Complexity: Real-time price checks require WebSocket or polling
`;
    }

    if (prdContent) {
      prompt += `\n\n**PRD Reference:**\n${prdContent.slice(0, 4000)}...`;
    }
    if (archContent) {
      prompt += `\n\n**Architecture Reference:**\n${archContent.slice(0, 4000)}...`;
    }
    if (apiSpecContent) {
      prompt += `\n\n**API Contract Reference (proposed endpoint changes/additions from the api_spec stage):**\n${apiSpecContent.slice(0, 4000)}...`;
    }

    return { participant, prompt };
  });
}

/**
 * Phase 2 Round 1: All agents see each other's drafts and refine.
 */
function buildRefineRound1Prompts(
  featureNum: number,
  featureBrief: string,
  drafts: Map<string, string>,
  participants: RefinementParticipant[] = PARTICIPANTS
): Array<{ participant: RefinementParticipant; prompt: string }> {
  const allDrafts = Array.from(drafts.entries())
    .map(([name, draft]) => `**${name}'s Draft:**\n${draft}`)
    .join('\n\n---\n\n');

  return participants.map(participant => {
    let prompt = `${featureBrief}\n\n**All Drafts from Phase 1:**\n\n${allDrafts}\n\n`;

    if (participant.agentType === 'story-decomposition') {
      prompt += `
**Phase 2.1 Task — Incorporate Feedback:**
1. Review the technical concerns from Finn, Remi, Cole (iOS), and Dex (Android)
2. Review the testability concerns from Vera
3. Adjust your story breakdown if needed (split oversized stories, adjust ACs)
4. Add technical acceptance criteria to each story based on engineer input
5. Update estimated points if technical complexity is higher than expected

**Output Format:** Same JSON structure as Phase 1, but with technical_acceptance_criteria added.
`;
    } else if (participant.agentType === 'qa-engineer') {
      prompt += `
**Phase 2.1 Task — Testability Review:**
1. Review Shard - Product Owner's story breakdown and each story's acceptance criteria
2. Flag any stories whose ACs are too vague to verify (missing observable outcome, no failure condition, untestable state)
3. Suggest specific AC improvements for clarity — do not write test cases, just sharpen the criteria language
4. Note any missing bad-path or edge-case scenarios that should be in the ACs

**Output Format:**
Plain text per-story feedback. Example:
- F?.S1: ACs are clear and testable — no changes needed
- F?.S2: AC 2 is vague ("loads quickly") — suggest "returns within 2 seconds under normal load"
- F?.S3: Missing failure path — add AC for what happens when the upstream service is unavailable
`;
    } else {
      prompt += `
**Phase 2.1 Task — Add Technical Direction:**
1. Review Shard - Product Owner's story breakdown
2. For each story that touches your platform, add a brief technical direction note — what needs to be built and any constraint worth flagging now, not a full implementation spec. Exact endpoints, schemas, and component names can be worked out later during technical refinement.
3. **CRITICAL — One stream per ticket:** If any story covers work on YOUR platform but is not already split into its own ticket, propose a new platform-specific story for it. Every story must belong to exactly ONE stream: \`backend\`, \`web\`, \`ios\`, or \`android\`. Shared logic (e.g. "user sees X") must be split into separate stories if it requires distinct implementation on each platform.
4. Flag dependencies (e.g., "Web story F?.S3 depends on Backend story F?.S2 being complete first")
5. ${ANALYTICS_SEPARATION_RULE}

**Output Format:**
Plain text mapping of story_id → technical direction, plus any proposed new platform-specific stories. Example:
- F?.S1 (Backend): "Needs an API to create an alert and persist it"
- F?.S2 (Web): "Form must validate the ticker symbol before submit"
- NEW story needed: "Alert Badge [iOS]" — the iOS app needs a native badge update on alert trigger, separate from the web notification story
`;
    }

    return { participant, prompt };
  });
}

/**
 * Phase 2 Round 2: Final polish and conflict resolution.
 */
function buildRefineRound2Prompts(
  featureNum: number,
  featureBrief: string,
  refined1: Map<string, string>,
  participants: RefinementParticipant[] = PARTICIPANTS
): Array<{ participant: RefinementParticipant; prompt: string }> {
  const allRefined1 = Array.from(refined1.entries())
    .map(([name, content]) => `**${name}'s Round 1 Output:**\n${content}`)
    .join('\n\n---\n\n');

  return participants.map(participant => {
    let prompt = `${featureBrief}\n\n**All Round 1 Outputs:**\n\n${allRefined1}\n\n`;

    if (participant.agentType === 'story-decomposition') {
      prompt += `
**Phase 2.2 Task — Final Polish & Conflict Resolution:**
1. Review all Round 1 feedback
2. Make final adjustments to stories (splits, dependencies, point estimates)
3. **Resolve conflicts** (you have authority as facilitator):
   - If QA says a story is untestable → either split it or reject it
   - If engineers disagree on technical approach → choose the safer/simpler option
   - If story points estimates vary wildly → use the highest estimate (pessimistic planning)
4. Produce the final story list with all acceptance criteria (product + technical)

**Output Format:** Final JSON backlog structure (same as Phase 1 but fully enriched).
`;
    } else {
      prompt += `
**Phase 2.2 Task — Final Confirmation:**
1. Review Shard - Product Owner's latest story breakdown
2. Confirm your technical ACs are correctly captured
3. Flag any remaining concerns or suggest minor tweaks

**Output Format:** Plain text confirmation or final concerns. Example:
- Confirmed: All backend ACs look correct
- Minor tweak: F?.S2 should also validate ticker format (not just non-empty)
`;
    }

    return { participant, prompt };
  });
}

/**
 * Phase 3: Shard - Product Owner (facilitator) synthesizes all contributions into final backlog artifact.
 */
async function synthesizeFinalArtifact(
  workflowId: string,
  stage: string,
  featureBrief: string,
  refined2: Map<string, string>
): Promise<string> {
  const allRefined2 = Array.from(refined2.entries())
    .map(([name, content]) => `**${name}'s Final Output:**\n${content}`)
    .join('\n\n---\n\n');

  const synthesisPrompt = `
${featureBrief}

**All Final Round Outputs:**

${allRefined2}

**Your Task — Synthesize Final Backlog:**
Merge all contributions into a single JSON artifact following the backlog template format:

\`\`\`json
{
  "epic": {
    "title": "...",
    "description": "...",
    "definition_of_done": "..."
  },
  "features": [
    {
      "key": "F?",
      "title": "...",
      "description": "...",
      "phase": "MVP | Phase 2 | Phase 3 | Phase 4",
      "acceptance_criteria": [
        "Feature-level condition 1 — what must be true when this feature is complete",
        "Feature-level condition 2",
        "Feature-level condition 3"
      ],
      "stories": [
        {
          "story_id": "F?.S1",
          "title": "...",
          "as_a": "...",
          "i_want": "...",
          "so_that": "...",
          "acceptance_criteria": ["Given...", "When...", "Then..."],
          "technical_acceptance_criteria": ["Specific to the one platform this story covers"],
          "prd_ref": {
            "functional_requirements": ["FR-01"],
            "non_functional_requirements": ["NFR1"]
          },
          "platform": "backend",
          "depends_on": [],
          "technical_notes": "..."
        }
      ]
    }
  ]
}
\`\`\`

${ACCEPTANCE_CRITERIA_FORMAT_RULE}

**Important:**
- Include ONLY the JSON artifact in your response (no explanatory text before or after)
- Carry forward epic fields (definition_of_done) and feature fields (phase, acceptance_criteria) from the Feature Brief at the top of this prompt — do not drop or weaken them
- ${ANALYTICS_SEPARATION_RULE}
- The feature acceptance_criteria array must match the Feature Acceptance Criteria from the brief verbatim — these are approved conditions, not suggestions
- The feature phase must match the Phase label from the brief
- Every story must include prd_ref with functional_requirements (the FR IDs from the PRD this story satisfies) and non_functional_requirements (the NFR IDs that constrain this story). Copy from the feature's prdRef where applicable and refine per story. Use [] for non_functional_requirements only if no NFR genuinely applies to this specific story.
- Feature acceptance_criteria are high-level "done" conditions for the whole feature, not story-level Gherkin
- Apply Vera's AC improvements — sharpen any vague acceptance criteria language she flagged
- Ensure all story_id references are consistent (F?.S1, F?.S2, etc.)
- **CRITICAL — One stream per ticket:** Each story's \`platform\` field MUST be a single string — exactly one of: \`"backend"\`, \`"web"\`, \`"ios"\`, \`"android"\`. Never use an array. If an engineer proposed work on your behalf that spans multiple platforms, split it into separate stories — one per platform. Each story's technical_acceptance_criteria must be specific to that one platform only. Stories that require work on multiple platforms must appear as multiple separate stories (e.g. "Create Alert API [Backend]" and "Create Alert Form [Web]"). Title each story to make the platform clear.
- **CRITICAL — Platform coverage:** Every in-scope mobile platform must be represented. If both ios and android appear in the Platform Scope section, every user-facing scenario must produce a separate story for each — do not write only iOS stories and skip Android (or vice versa). The iOS engineer and Android engineer each contributed separately; synthesize their work as separate stories. A mobile feature with 3 user scenarios must produce at minimum 3 ios stories AND 3 android stories.
- Do NOT include a test_cases field — the QA engineer stage owns the full test suite as a separate artifact
- Keep technical_acceptance_criteria and technical_notes to meaningful direction only — what needs to be built and any constraint worth flagging now. Do not write exhaustive implementation specs (exact endpoint signatures, full schemas, function names) — that level of detail gets filled in later as the work is picked up.
- Do not write accessibility-specific acceptance criteria, stories, or technical notes (screen reader support, TalkBack, VoiceOver, voice control, etc.) — this product does not target those use cases unless the PRD explicitly requires them.
`;

  const facilitator = new SpecialistAgent('story-decomposition');
  const persona = await facilitator.loadPersona(stage);

  // Build system prompt with persona
  const systemPrompt = await facilitator.buildSystemPrompt(
    persona,
    undefined, // workflowContext
    undefined, // itemContext
    true, // autonomous
    stage
  );

  // Single feature output (not accumulated), but story count + prd_ref/technical detail
  // can still exceed 8k — use the shared ceiling so this stays in sync with the revision flow.
  const maxTokens = STAGE_MAX_OUTPUT_TOKENS['story_decomposition'] ?? 16_000;

  const finalArtifact = await collectStreamWithHeartbeat(
    facilitator.streamResponse(systemPrompt, [{ role: 'user', content: synthesisPrompt }], resolveAgentModel('story-decomposition'), undefined, maxTokens),
    (elapsedSec, chars) => {
      touchWorkflow(workflowId);
      insertEvent(workflowId, 'stage_progress', stage,
        progressHeartbeatLine('Phase 3: Synthesize backlog — merging contributions', elapsedSec, chars));
    },
  );

  return finalArtifact.trim();
}

