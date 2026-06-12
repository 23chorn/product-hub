/**
 * Multi-Agent Story Refinement — dynamic collaborative session.
 *
 * Replaces the sequential story_decomposition → qa_engineer → tech_refinement flow
 * with a single collaborative session. The participant set is resolved from the
 * initiative's productArea: Product (Shard), QA (Vera), and Backend (Finn) are always
 * present; Web (Remi), iOS, and Android engineers are included only when their platform
 * is in scope. This reduces token cost for single-platform features.
 *
 * Pattern: Draft (parallel) → Refine (2 rounds) → Synthesize (merge)
 */

import { logger, insertEvent, touchWorkflow } from './workflow-db';
import { isDemoMode, getDemoFixture } from '../demo/demo-mode';
import { loadLatestArtifactContent } from './artifact-helpers';
import { SpecialistAgent } from './specialist-agent';
import type { AgentType } from '@pap/shared';
import db from '../data/database';

interface RefinementParticipant {
  name: string;
  agentType: AgentType;
  role: string; // What they focus on in the session
}

const PARTICIPANTS: RefinementParticipant[] = [
  { name: 'Shard', agentType: 'story-decomposition', role: 'Product Lead — Facilitator' },
  { name: 'Vera', agentType: 'qa-engineer', role: 'QA Engineer — Testability & Quality' },
  { name: 'Finn', agentType: 'backend-engineer', role: 'Backend Engineer — APIs & Data' },
  { name: 'Remi', agentType: 'web-engineer', role: 'Web Engineer — Frontend & UX' },
  { name: 'Cole', agentType: 'ios-engineer', role: 'Mobile Engineer — iOS & Android Native' },
];

/**
 * Filter the participant list based on the productArea stored in items.metadata.
 * - Shard (Product) and Vera (QA) are always included.
 * - Finn (Backend) is always included.
 * - Remi (Web) only when productArea includes web/browser/desktop.
 * - iOS Cole only when productArea includes mobile/ios/app.
 * - Android Cole only when productArea includes mobile/android/app.
 * Falls back to all participants when productArea is unset or unrecognised.
 */
function resolveRefinementParticipants(itemId: string): RefinementParticipant[] {
  try {
    const row = db
      .prepare<[string], { metadata: string | null }>('SELECT metadata FROM items WHERE id = ?')
      .get(itemId);
    if (!row?.metadata) return PARTICIPANTS;
    const meta = JSON.parse(row.metadata) as Record<string, unknown>;

    // productArea may be a string or an array of strings
    const rawArea = meta.productArea;
    const area = Array.isArray(rawArea)
      ? rawArea.join(' ').toLowerCase()
      : typeof rawArea === 'string'
        ? rawArea.toLowerCase()
        : '';
    if (!area) return PARTICIPANTS;

    const hasWeb = /web|browser|desktop/.test(area);
    const hasMobile = /\bmobile\b|\bios\b|\bandroid\b/.test(area);

    // If neither signal is present default to all platforms
    if (!hasWeb && !hasMobile) return PARTICIPANTS;

    return PARTICIPANTS.filter(p => {
      if (p.name === 'Shard' || p.name === 'Vera' || p.name === 'Finn') return true;
      if (p.name === 'Remi') return hasWeb;
      if (p.name === 'Cole') return hasMobile;
      return true;
    });
  } catch {
    return PARTICIPANTS;
  }
}

/**
 * Run a multi-agent collaborative story refinement session for a single feature.
 *
 * @param workflowId - The workflow ID
 * @param itemId - The initiative ID
 * @param stage - The stage name (e.g., 'story_decomposition_F1')
 * @param featureIndex - 0-based feature index
 * @returns Combined artifact content (backlog JSON + embedded test cases)
 */
export async function runMultiAgentRefinement(
  workflowId: string,
  itemId: string,
  stage: string,
  featureIndex: number
): Promise<string> {
  const featureNum = featureIndex + 1;
  logger.info(`[MULTI-AGENT] Starting collaborative refinement for Feature ${featureNum} (stage: ${stage})`);

  // ── Demo Mode: Return fixture immediately ──────────────────────────────────
  const demoModeActive = isDemoMode();
  logger.info(`[MULTI-AGENT] Demo mode check result: ${demoModeActive}`);

  if (demoModeActive) {
    logger.info(`[MULTI-AGENT] Demo mode enabled — returning fixture for ${stage}`);
    const fixture = getDemoFixture(stage);

    if (fixture) {
      logger.info(`[MULTI-AGENT] Demo fixture found for ${stage} (${fixture.length} chars) — skipping LLM calls`);
      insertEvent(workflowId, 'stage_progress', stage,
        `Demo fixture loaded for Feature ${featureNum} — multi-agent refinement skipped in demo mode`);
      return fixture;
    }

    logger.warn(`[MULTI-AGENT] No demo fixture found for ${stage}, falling back to real workflow`);
  } else {
    logger.warn(`[MULTI-AGENT] Demo mode is DISABLED — will make real LLM calls (expensive!)`);
  }

  // ── Resolve active participants based on productArea ───────────────────────
  const activeParticipants = resolveRefinementParticipants(itemId);
  const participantNames = activeParticipants.map(p => p.name).join(', ');
  logger.info(`[MULTI-AGENT] Active participants for Feature ${featureNum}: ${participantNames}`);

  // ── Load Context ────────────────────────────────────────────────────────────
  const [prdContent, archContent, epicFeaturesContent] = await Promise.all([
    loadLatestArtifactContent(itemId, 'prd'),
    loadLatestArtifactContent(itemId, 'architecture'),
    loadLatestArtifactContent(itemId, 'epic_features'), // Epic + features from epic_feature_planner
  ]);

  // Extract the target feature from the epic_features artifact
  let targetFeature: any = null;
  if (epicFeaturesContent) {
    try {
      const epicFeatures = JSON.parse(epicFeaturesContent);
      if (epicFeatures.features && epicFeatures.features[featureIndex]) {
        targetFeature = epicFeatures.features[featureIndex];
      }
    } catch (err: any) {
      logger.warn(`[MULTI-AGENT] Failed to parse epic_features: ${err.message}`);
    }
  }

  if (!targetFeature) {
    throw new Error(`Feature ${featureNum} not found in epic_features artifact (featureIndex=${featureIndex})`);
  }

  const featureBrief = `
# Feature Refinement Session

**Feature ${featureNum}: ${targetFeature.title}**

${targetFeature.description || ''}

**User Stories to Refine:**
${targetFeature.user_stories?.map((s: any, i: number) => `${i + 1}. ${s}`).join('\n') || '(No user stories provided)'}

**Functional Requirements (from PRD):**
${prdContent ? '(See full PRD below)' : '(No PRD available)'}

**Architecture Guidance:**
${archContent ? '(See architecture document below)' : '(No architecture available)'}
`.trim();

  // ── Phase 1: Draft (Parallel) ──────────────────────────────────────────────
  insertEvent(workflowId, 'stage_progress', stage,
    `Phase 1: Draft — ${activeParticipants.length} agents proposing initial contributions in parallel (${participantNames})...`);

  const draftPrompts = buildDraftPrompts(featureNum, featureBrief, prdContent, archContent, activeParticipants);
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
    `Phase 3: Synthesize — Shard (facilitator) merging all contributions into final backlog...`);

  const finalArtifact = await synthesizeFinalArtifact(workflowId, stage, featureBrief, refined2);

  logger.info(`[MULTI-AGENT] Feature ${featureNum} refinement complete (${finalArtifact.length} chars)`);
  return finalArtifact;
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
        undefined, // model override
        undefined, // onTokens
        8_000 // max tokens per agent
      )) {
        fullResponse += chunk;
      }

      results.set(participant.name, fullResponse.trim());
      logger.info(`[MULTI-AGENT] ${phaseName} | ${participant.name} complete (${fullResponse.length} chars)`);
    } catch (err: any) {
      logger.error(`[MULTI-AGENT] ${phaseName} | ${participant.name} failed: ${err.message}`);
      results.set(participant.name, `[ERROR: ${err.message}]`);
    }
  });

  await Promise.all(promises);
  return results;
}

/**
 * Phase 1: Build draft prompts for each agent.
 */
function buildDraftPrompts(
  featureNum: number,
  featureBrief: string,
  prdContent: string | null,
  archContent: string | null,
  participants: RefinementParticipant[] = PARTICIPANTS
): Array<{ participant: RefinementParticipant; prompt: string }> {
  return participants.map(participant => {
    let prompt = `${featureBrief}\n\n`;

    if (participant.name === 'Shard') {
      // Product Lead: Draft initial stories
      prompt += `
**Your Role:** You are the **Product Lead and Facilitator** of this refinement session.

**Phase 1 Task — Draft Stories:**
1. Break this feature into 2-12 user stories (format: "As a [persona], I want [capability], so that [benefit]")
2. Each story should be independently deliverable and testable
3. Add product acceptance criteria (Given/When/Then format) to each story
4. Estimate story points (1-2-3-5-8 scale) based on scope
5. Don't add technical details yet — that's what the engineers will contribute in the next round

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
      "estimated_points": 3
    }
  ]
}
\`\`\`
`;
    } else if (participant.name === 'Vera') {
      // QA Engineer: Testability concerns
      prompt += `
**Your Role:** You are the **QA Engineer** in this refinement session.

**Phase 1 Task — Testability Review:**
1. Review the feature brief and user stories (you'll see the Product Lead's draft in Round 2)
2. List potential **testability concerns** for this feature:
   - What will be hard to test?
   - What edge cases need coverage?
   - What test data or environments are needed?
3. Propose test case categories (happy path, error handling, edge cases, performance, accessibility)

**Output Format:**
Plain text list of concerns and recommendations. Example:
- Concern: "Price validation needs boundary testing (zero, negative, very large numbers)"
- Recommendation: "Each story should specify valid input ranges in ACs"
`;
    } else {
      // Engineers: Technical needs
      const platformFocus = participant.name === 'Finn' ? 'Backend APIs, data models, authentication'
        : participant.name === 'Remi' ? 'Frontend components, state management, forms'
        : participant.name === 'iOS Cole' ? 'iOS native implementation, offline support, push notifications'
        : 'Android native implementation, platform-specific UI, background services';

      prompt += `
**Your Role:** You are the **${participant.role}** in this refinement session.

**Phase 1 Task — Technical Needs:**
1. Review the feature brief
2. List what you'll need to build this feature:
   - ${platformFocus}
3. Flag any technical constraints or complexities (e.g., "Offline mode will require local DB sync")
4. Suggest story splits if a feature needs multiple platform-specific implementations

**Output Format:**
Plain text list of technical requirements. Example:
- API needed: POST /api/alerts (create price alert)
- Data model: New alerts table (user_id, ticker, target_price, condition)
- Complexity: Real-time price checks require WebSocket or polling
`;
    }

    if (prdContent) {
      prompt += `\n\n**PRD Reference:**\n${prdContent.slice(0, 4000)}...`;
    }
    if (archContent) {
      prompt += `\n\n**Architecture Reference:**\n${archContent.slice(0, 4000)}...`;
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

    if (participant.name === 'Shard') {
      prompt += `
**Phase 2.1 Task — Incorporate Feedback:**
1. Review the technical concerns from Finn, Remi, iOS Cole, Android Cole
2. Review the testability concerns from Vera
3. Adjust your story breakdown if needed (split oversized stories, adjust ACs)
4. Add technical acceptance criteria to each story based on engineer input
5. Update estimated points if technical complexity is higher than expected

**Output Format:** Same JSON structure as Phase 1, but with technical_acceptance_criteria added.
`;
    } else if (participant.name === 'Vera') {
      prompt += `
**Phase 2.1 Task — Testability Review:**
1. Review Shard's story breakdown and each story's acceptance criteria
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
**Phase 2.1 Task — Add Technical Details:**
1. Review Shard's story breakdown
2. For stories that touch your platform, add specific technical acceptance criteria
3. Propose story splits if needed (e.g., "Backend API" + "Frontend UI" as separate stories)
4. Flag dependencies (e.g., "Frontend story depends on Backend API story")

**Output Format:**
Plain text mapping of story_id → technical ACs. Example:
- F?.S1 (Backend): "POST /api/alerts endpoint returns 201 with alert ID in JSON"
- F?.S2 (Web): "AlertForm component validates ticker symbol before submit"
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

    if (participant.name === 'Shard') {
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
1. Review Shard's latest story breakdown
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
 * Phase 3: Shard (facilitator) synthesizes all contributions into final backlog artifact.
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
    "business_value": "...",
    "definition_of_done": "...",
    "out_of_scope": ["..."]
  },
  "features": [
    {
      "key": "F?",
      "title": "...",
      "description": "...",
      "phase": "MVP | Phase 2 | Phase 3",
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
          "technical_acceptance_criteria": ["Backend: ...", "Web: ...", "Mobile: ..."],
          "platform": ["backend", "web", "ios", "android"],
          "estimated_points": 5,
          "depends_on": [],
          "technical_notes": "..."
        }
      ]
    }
  ]
}
\`\`\`

**Important:**
- Include ONLY the JSON artifact in your response (no explanatory text before or after)
- Carry forward epic fields (business_value, definition_of_done, out_of_scope) and feature fields (phase, acceptance_criteria) from the Epic & Features artifact — do not drop them
- Feature acceptance_criteria are high-level "done" conditions for the whole feature, not story-level Gherkin
- Apply Vera's AC improvements — sharpen any vague acceptance criteria language she flagged
- Ensure all story_id references are consistent (F?.S1, F?.S2, etc.)
- Platform tags should reflect which engineers contributed technical ACs
- Do NOT include a test_cases field — the QA engineer stage owns the full test suite as a separate artifact
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

  let finalArtifact = '';
  let lastHeartbeat = Date.now();
  const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // touch updated_at every 5 minutes

  for await (const chunk of facilitator.streamResponse(
    systemPrompt,
    [{ role: 'user', content: synthesisPrompt }],
    undefined,
    undefined,
    32_000 // Large output for full backlog
  )) {
    finalArtifact += chunk;
    const now = Date.now();
    if (now - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
      touchWorkflow(workflowId);
      insertEvent(workflowId, 'stage_progress', stage,
        `Phase 3: Synthesize — still merging contributions (${Math.round(finalArtifact.length / 1000)}k chars so far)...`);
      lastHeartbeat = now;
    }
  }

  return finalArtifact.trim();
}
