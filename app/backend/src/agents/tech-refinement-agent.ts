/**
 * Tech Refinement Agent — parallel engineering stream review.
 *
 * Runs iOS, Android, and Backend engineer agents in parallel. Each annotates
 * every backlog story with platform-specific implementation notes. A final
 * reconciliation pass merges all three into the output artifact.
 */

import * as fs from 'fs';
import * as fsAsync from 'fs/promises';
import * as path from 'path';
import db from '../data/database';
import { sessionManager } from '../session/session-manager';
import { streamAI, resolveAgentModel, type TokenUsage } from '../utils/ai-provider';
import { getLatestArtifactPathByType } from './artifact-helpers';
import {
  PROJECT_ROOT, logger as baseLogger, stmts, insertEvent, addWorkflowCost, workflowOps,
} from './workflow-db';
import { isDemoMode, demoSleep, DEMO_STAGE_DELAY_MS } from '../demo/demo-mode';
import Logger from '../utils/logger';

const logger = new Logger('TECH-REFINEMENT');

// ── Types ─────────────────────────────────────────────────────────────────────

type StreamId = 'ios' | 'android' | 'backend';

interface StoryNote {
  story_title: string;
  technical_notes: string;
}

interface StreamReviewResult {
  stream: StreamId;
  story_notes: StoryNote[];
}

// ── Persona loader ─────────────────────────────────────────────────────────────

const PERSONA_FILES: Record<StreamId, string> = {
  ios:     'ios-engineer.md',
  android: 'android-engineer.md',
  backend: 'backend-engineer.md',
};

const STREAM_NAMES: Record<StreamId, string> = {
  ios:     'Finn (iOS)',
  android: 'Remi (Android)',
  backend: 'Cole (Backend)',
};

function loadStreamPersona(stream: StreamId): string {
  const filePath = path.join(PROJECT_ROOT, 'agents', 'personas', PERSONA_FILES[stream]);
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return raw.replace(/^---[\s\S]*?---\n?/, '').trim();
  } catch {
    return `You are a ${stream} engineer reviewing a product backlog for implementation feasibility.`;
  }
}

// ── Individual stream review ───────────────────────────────────────────────────

async function runStreamReview(
  stream: StreamId,
  backlogJson: object,
  onTokens: (usage: TokenUsage) => void
): Promise<StreamReviewResult> {
  const persona = loadStreamPersona(stream);
  const model = resolveAgentModel('coordinator');

  const systemPrompt = `${persona}

---

## Your task

Review the product backlog below. For every story, add a concise technical note from your platform's perspective.

Output ONLY valid JSON matching this exact schema — no prose, no markdown code fences:

{
  "stream": "${stream}",
  "story_notes": [
    {
      "story_title": "<exact story title from the backlog>",
      "technical_notes": "<2-4 sentence implementation note for the ${stream} platform/layer>"
    }
  ]
}

Rules:
- Include an entry for EVERY story in the backlog
- Match story_title exactly (copy-paste from the backlog)
- Keep technical_notes to 2-4 sentences: specific class/library/pattern names, key constraints, one pitfall
- If a story has no meaningful ${stream} work, write "No ${stream}-specific implementation. Depends on [X] API/service being available."
- Do NOT suggest scope changes or add new requirements`;

  const userMessage = `Here is the product backlog:\n\n${JSON.stringify(backlogJson, null, 2)}\n\nProvide your technical review in JSON format.`;

  let fullResponse = '';
  for await (const chunk of streamAI(model, systemPrompt, [{ role: 'user', content: userMessage }], 6000, { onTokens })) {
    fullResponse += chunk;
  }

  try {
    const cleaned = fullResponse
      .replace(/^```(?:json)?\s*\n?/m, '')
      .replace(/\n?```\s*$/m, '')
      .trim();
    return JSON.parse(cleaned) as StreamReviewResult;
  } catch {
    logger.warn(`${stream} engineer returned non-JSON — using empty review`);
    return { stream, story_notes: [] };
  }
}

// ── Reconciliation ─────────────────────────────────────────────────────────────

async function reconcile(
  backlogJson: object,
  reviews: StreamReviewResult[],
  onTokens: (usage: TokenUsage) => void
): Promise<object> {
  // Build a lookup: story title → { ios, android, backend }
  const notesByTitle = new Map<string, { ios?: string; android?: string; backend?: string }>();

  for (const review of reviews) {
    for (const note of review.story_notes) {
      const existing = notesByTitle.get(note.story_title) ?? {};
      notesByTitle.set(note.story_title, {
        ...existing,
        [review.stream]: note.technical_notes,
      });
    }
  }

  // Deep-clone and annotate the backlog in-place
  const annotated: Record<string, unknown> = JSON.parse(JSON.stringify(backlogJson));

  function annotateStory(story: Record<string, unknown>): void {
    const title = story.title as string | undefined;
    if (!title) return;

    // Match by exact title, then by prefix (handles minor LLM variations)
    let notes = notesByTitle.get(title);
    if (!notes) {
      for (const [key, val] of notesByTitle.entries()) {
        if (key.startsWith(title.slice(0, 20)) || title.startsWith(key.slice(0, 20))) {
          notes = val;
          break;
        }
      }
    }

    if (notes && (notes.ios || notes.android || notes.backend)) {
      story.technical_notes = {
        ios: notes.ios ?? null,
        android: notes.android ?? null,
        backend: notes.backend ?? null,
      };
    }
  }

  function annotateStories(obj: Record<string, unknown>): void {
    if (obj.features && Array.isArray(obj.features)) {
      for (const feature of obj.features as Record<string, unknown>[]) {
        if (feature.stories && Array.isArray(feature.stories)) {
          for (const story of feature.stories as Record<string, unknown>[]) {
            annotateStory(story);
          }
        }
      }
    } else if (obj.feature && typeof obj.feature === 'object') {
      const feat = obj.feature as Record<string, unknown>;
      if (feat.stories && Array.isArray(feat.stories)) {
        for (const story of feat.stories as Record<string, unknown>[]) {
          annotateStory(story);
        }
      }
    } else if (obj.epic && typeof obj.epic === 'object') {
      const epic = obj.epic as Record<string, unknown>;
      if (epic.stories && Array.isArray(epic.stories)) {
        for (const story of epic.stories as Record<string, unknown>[]) {
          annotateStory(story);
        }
      }
    } else if (obj.story && typeof obj.story === 'object') {
      annotateStory(obj.story as Record<string, unknown>);
    }
  }

  annotateStories(annotated);
  return annotated;
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function runTechRefinementStage(
  workflowId: string,
  itemId: string,
  autoApprove = false
): Promise<void> {
  const onTokens = (usage: TokenUsage) => addWorkflowCost(workflowId, usage.estimatedCost);

  try {
    // ── Demo mode fast-path ──────────────────────────────────────────────────
    // Annotate the ACTUAL pm_backlog in-place rather than loading a static
    // fixture — the fixture was a different set of infra tasks, not the backlog.
    if (isDemoMode()) {
      const backlogPath = getLatestArtifactPathByType(itemId, 'backlog');
      if (backlogPath) {
        const delay = DEMO_STAGE_DELAY_MS['tech_refinement'] ?? 2_500;

        let backlogJson: object;
        try {
          backlogJson = JSON.parse(fs.readFileSync(backlogPath, 'utf-8'));
        } catch {
          backlogJson = {};
        }
        const storyCount = countStories(backlogJson);

        insertEvent(workflowId, 'stage_progress', 'tech_refinement',
          `Finn (iOS), Remi (Android), and Cole (Backend) reviewing ${storyCount} stories in parallel...`);
        await demoSleep(Math.floor(delay * 0.4));
        insertEvent(workflowId, 'stage_progress', 'tech_refinement',
          `All streams complete (iOS: ${storyCount}, Android: ${storyCount}, Backend: ${storyCount} notes). Merging into final backlog...`);
        await demoSleep(Math.floor(delay * 0.6));

        // Inject hardcoded demo technical notes onto every story in-place
        const annotated = injectDemoTechNotes(backlogJson);

        const session = sessionManager.createSpecialistSession(itemId, 'backlog' as any, 'pm' as any);
        const artifactDir = path.join(PROJECT_ROOT, 'data', 'sessions', itemId, 'backlog', 'artifacts');
        await fsAsync.mkdir(artifactDir, { recursive: true });
        const artifactPath = path.join(artifactDir, `${Date.now()}-tech_refinement.json`);

        await fsAsync.writeFile(artifactPath, JSON.stringify(annotated, null, 2), 'utf-8');

        const artifactResult = db.prepare(`
          INSERT INTO artifacts (session_id, type, file_path, created_at)
          VALUES (?, ?, ?, ?)
        `).run(session.id, 'backlog', artifactPath, Date.now());
        const artifactId = artifactResult.lastInsertRowid as number;

        insertEvent(workflowId, 'stage_completed', 'tech_refinement',
          `Technical refinement complete — ${storyCount} stories annotated with iOS, Android, and Backend implementation notes.`,
          { artifact_id: artifactId });

        const now = Date.now();
        stmts.insertCheckpoint.run(
          workflowId, 'tech_refinement', artifactId, autoApprove ? 'approved' : 'pending',
          JSON.stringify({ session_id: session.id, autonomous: true, demo_mode: true, auto_approved: autoApprove }),
          now
        );
        if (autoApprove) {
          logger.info(`[DEMO] Tech refinement complete — auto-advancing`);
          workflowOps.advanceStage(workflowId).catch(err => {
            if (!err.message?.startsWith('WORKFLOW_COMPLETE')) {
              logger.error(`Auto-advance after tech_refinement failed: ${err.message}`);
              stmts.updateWorkflowStatus.run('paused_at_checkpoint', Date.now(), workflowId);
            }
          });
        } else {
          stmts.updateWorkflowStatus.run('paused_at_checkpoint', now, workflowId);
          logger.info(`[DEMO] Tech refinement complete — backlog annotated, checkpoint created`);
        }
        return;
      }
    }

    // Load the latest backlog artifact
    const backlogPath = getLatestArtifactPathByType(itemId, 'backlog');
    if (!backlogPath) {
      throw new Error('No backlog artifact found — run pm_backlog stage first');
    }

    const backlogContent = fs.readFileSync(backlogPath, 'utf-8');
    let backlogJson: object;
    try {
      backlogJson = JSON.parse(backlogContent);
    } catch {
      throw new Error('Backlog artifact is not valid JSON — cannot annotate');
    }

    // Count stories for progress message
    const totalStories = countStories(backlogJson);
    insertEvent(workflowId, 'stage_progress', 'tech_refinement',
      `${STREAM_NAMES.ios}, ${STREAM_NAMES.android}, and ${STREAM_NAMES.backend} reviewing ${totalStories} stor${totalStories !== 1 ? 'ies' : 'y'} in parallel...`);

    // Run 3 stream agents in parallel
    const [iosReview, androidReview, backendReview] = await Promise.all([
      runStreamReview('ios', backlogJson, onTokens),
      runStreamReview('android', backlogJson, onTokens),
      runStreamReview('backend', backlogJson, onTokens),
    ]);

    const iosCount = iosReview.story_notes.length;
    const androidCount = androidReview.story_notes.length;
    const backendCount = backendReview.story_notes.length;

    insertEvent(workflowId, 'stage_progress', 'tech_refinement',
      `All streams complete (iOS: ${iosCount}, Android: ${androidCount}, Backend: ${backendCount} notes). Merging into final backlog...`);

    // Merge all annotations into the final backlog
    const annotatedBacklog = await reconcile(backlogJson, [iosReview, androidReview, backendReview], onTokens);

    // Save artifact — type 'backlog' so downstream stages and push-to-board pick it up
    const session = sessionManager.createSpecialistSession(itemId, 'backlog' as any, 'pm' as any);
    const artifactDir = path.join(PROJECT_ROOT, 'data', 'sessions', itemId, 'backlog', 'artifacts');
    await fsAsync.mkdir(artifactDir, { recursive: true });
    const artifactPath = path.join(artifactDir, `${Date.now()}-tech_refinement.json`);
    const artifactContent = JSON.stringify(annotatedBacklog, null, 2);
    await fsAsync.writeFile(artifactPath, artifactContent, 'utf-8');

    const artifactResult = db.prepare(`
      INSERT INTO artifacts (session_id, type, file_path, created_at)
      VALUES (?, ?, ?, ?)
    `).run(session.id, 'backlog', artifactPath, Date.now());
    const artifactId = artifactResult.lastInsertRowid as number;

    insertEvent(workflowId, 'stage_completed', 'tech_refinement',
      `Technical refinement complete — ${totalStories} stor${totalStories !== 1 ? 'ies' : 'y'} annotated with iOS, Android, and Backend implementation notes.`,
      { artifact_id: artifactId });

    const now = Date.now();
    stmts.insertCheckpoint.run(
      workflowId, 'tech_refinement', artifactId, autoApprove ? 'approved' : 'pending',
      JSON.stringify({
        session_id: session.id,
        autonomous: true,
        auto_approved: autoApprove,
        ios_notes: iosCount,
        android_notes: androidCount,
        backend_notes: backendCount,
      }),
      now
    );
    if (autoApprove) {
      logger.info(`Tech refinement complete for workflow ${workflowId} — auto-advancing`);
      workflowOps.advanceStage(workflowId).catch(err => {
        if (!err.message?.startsWith('WORKFLOW_COMPLETE')) {
          logger.error(`Auto-advance after tech_refinement failed: ${err.message}`);
          stmts.updateWorkflowStatus.run('paused_at_checkpoint', Date.now(), workflowId);
        }
      });
    } else {
      stmts.updateWorkflowStatus.run('paused_at_checkpoint', now, workflowId);
      logger.info(`Tech refinement complete for workflow ${workflowId} — checkpoint created`);
    }
  } catch (err: any) {
    logger.error(`Tech refinement failed for workflow ${workflowId}: ${err.message}`);
    insertEvent(workflowId, 'error', 'tech_refinement',
      `Tech refinement failed: ${err.message}`, { error: err.message });
    const now = Date.now();
    stmts.insertCheckpoint.run(
      workflowId, 'tech_refinement', null, 'pending',
      JSON.stringify({ error: err.message, autonomous: true }),
      now
    );
    stmts.updateWorkflowStatus.run('paused_at_checkpoint', now, workflowId);
  }
}

// ── Demo annotation helper ────────────────────────────────────────────────────

/**
 * Injects hardcoded but plausible demo technical notes onto every story in the
 * backlog, based on common patterns for a mobile trading app (iOS/Android/Backend).
 * Preserves the original story structure exactly — only adds `technical_notes`.
 */
function injectDemoTechNotes(backlog: object): object {
  const clone: Record<string, unknown> = JSON.parse(JSON.stringify(backlog));

  const IOS_NOTES = [
    'Implement in SwiftUI. Add view to MainTabView or present as sheet. Handle loading/empty states with ProgressView and placeholder. Unit test ViewModel with XCTest; snapshot test with XCUITest.',
    'Build as SwiftUI view backed by a Combine-based ViewModel. Inject service via environment object. Cache responses in NSCache for offline resilience. Accessibility: VoiceOver label required on all interactive elements.',
    'Use UIKit for complex gesture-driven interactions; wrap in UIViewRepresentable for SwiftUI integration. Handle orientation changes. Submit to TestFlight before merge.',
    'SwiftUI composable component. Accept data via @Binding. Add haptic feedback on user actions using UIImpactFeedbackGenerator. Unit test with Quick/Nimble.',
    'Implement using async/await with Swift Concurrency. Add retry logic with exponential back-off on network failure. Store auth tokens in Keychain, never UserDefaults.',
  ];

  const ANDROID_NOTES = [
    'Implement as Jetpack Compose screen. Add route to NavHost in AppNavigation.kt. Handle loading/error states with UiState sealed class. Unit test ViewModel with JUnit4 + Mockk; UI test with Espresso.',
    'Jetpack Compose with Material3 components. ViewModel backed by StateFlow. Repository pattern with Room for local persistence. Add WorkManager job for background sync if offline capability is needed.',
    'Compose screen with custom modifier for touch feedback. Handle back-stack correctly in NavController. Add accessibility contentDescription on all Icon components. Test on API 26 minimum.',
    'Use Kotlin coroutines (viewModelScope) for async operations. Retrofit + OkHttp for API calls; use interceptor for auth header injection. ProGuard rules needed if model classes are serialized.',
    'Jetpack Compose LazyColumn for list rendering. Implement DiffUtil in ListAdapter for efficient updates. Add pull-to-refresh with SwipeRefreshLayout wrapper. Unit test repository layer with JUnit4.',
  ];

  const BACKEND_NOTES = [
    'Add Express route in src/routes/. Validate request body with zod schema. Service layer handles business logic; repository layer handles DB queries. Add integration test covering happy path and 400/401 error cases.',
    'Create or extend REST endpoint. Add DB migration script if schema changes required. Use parameterised queries — no raw string interpolation. Add rate limiting middleware (express-rate-limit) for public endpoints.',
    'Extend existing service or create new one in src/services/. Add input sanitisation. Emit WebSocket event via ws-broadcast if real-time update is needed. Log all mutations with audit trail entry.',
    'REST endpoint returning paginated results (cursor-based). Add index on frequently-queried columns. Cache hot data in Redis with 30s TTL. Document endpoint in OpenAPI spec.',
    'Background job via node-cron or queue (Bull/BullMQ). Add dead-letter queue for failed jobs. Expose health-check endpoint at /health that verifies DB and Redis connectivity. Add Datadog metric on job completion.',
  ];

  let storyIndex = 0;

  function annotateStory(story: Record<string, unknown>): void {
    const i = storyIndex++ % 5;
    story.technical_notes = {
      ios:     IOS_NOTES[i],
      android: ANDROID_NOTES[i],
      backend: BACKEND_NOTES[i],
    };
  }

  function walk(obj: Record<string, unknown>): void {
    if (Array.isArray(obj.features)) {
      for (const feature of obj.features as Record<string, unknown>[]) {
        if (Array.isArray(feature.stories)) {
          for (const story of feature.stories as Record<string, unknown>[]) annotateStory(story);
        }
      }
    } else if (obj.feature && typeof obj.feature === 'object') {
      const feat = obj.feature as Record<string, unknown>;
      if (Array.isArray(feat.stories)) {
        for (const story of feat.stories as Record<string, unknown>[]) annotateStory(story);
      }
    } else if (obj.story && typeof obj.story === 'object') {
      annotateStory(obj.story as Record<string, unknown>);
    }
  }

  walk(clone);
  return clone;
}

// ── Helper ─────────────────────────────────────────────────────────────────────

function countStories(backlog: object): number {
  const b = backlog as Record<string, unknown>;
  if (Array.isArray(b.features)) {
    return (b.features as Array<Record<string, unknown>>)
      .reduce((sum, f) => sum + (Array.isArray(f.stories) ? (f.stories as unknown[]).length : 0), 0);
  }
  if (b.feature && typeof b.feature === 'object') {
    const f = b.feature as Record<string, unknown>;
    return Array.isArray(f.stories) ? (f.stories as unknown[]).length : 0;
  }
  if (b.epic && typeof b.epic === 'object') {
    const e = b.epic as Record<string, unknown>;
    return Array.isArray(e.stories) ? (e.stories as unknown[]).length : 0;
  }
  if (b.story) return 1;
  return 0;
}
