import { Router, Request, Response } from 'express';
import { initSSE, sseSend } from '../utils/sse';
import { streamAI, resolveAgentModel } from '../utils/ai-provider';
import { buildAcceptanceCriteriaHtml } from '../integrations/azure-devops-format';
import Logger from '../utils/logger';
import db from '../data/database';

const logger = new Logger('QUICK-FEATURE-ROUTES');

export const quickFeatureRoutes = Router();

const STREAM_LABELS: Record<string, string> = { backend: 'Backend', web: 'Web', ios: 'iOS', android: 'Android' };

function buildSystemPrompt(enabledStreams: string[]): string {
  const streamList = enabledStreams.map(s => `"${s}"`).join(', ');
  return `You are an expert product manager. Your job is to decompose a small feature into properly structured Azure DevOps work items ready for a sprint.

Given a feature title and description, produce:
- A polished feature description (2–3 sentences)
- 1 to 2 Functional Requirements (FRs) depending on scope
- Stream-specific User Stories per FR — one story per stream per requirement

Write a 2-sentence overview of what you are building, then end with a JSON block in a fenced \`\`\`json block exactly as shown:

\`\`\`json
{
  "feature": {
    "title": "concise feature title",
    "description": "2–3 sentence feature description explaining what it delivers and why"
  },
  "functionalRequirements": [
    {
      "id": "FR1",
      "title": "FR title describing the functional area",
      "stories": [
        {
          "title": "[Backend] story title",
          "persona": "type of user — do NOT include 'As a'",
          "goal": "what they want to do — do NOT include 'I want'",
          "benefit": "the business value — do NOT include 'So that'",
          "acceptanceCriteria": [
            "Given [context] When [action] Then [outcome]"
          ],
          "storyPoints": 3,
          "platform": "backend"
        }
      ]
    }
  ]
}
\`\`\`

## Rules
- 1 to 3 FRs — use judgment based on scope; don't force a third if the feature is simple
- Each story belongs to EXACTLY ONE stream — if a requirement needs both backend and web work, generate two separate stories (one per stream), not one story covering both
- Enabled streams for this feature: ${streamList}
- Only generate stories for the enabled streams above — do not generate stories for any other stream
- Prefix each story title with the stream in brackets: "[Backend]", "[Web]", "[iOS]", "[Android]"
- platform must be exactly one of the enabled streams
- Aim for 2–4 stories per FR but use judgment — don't pad or cut stories just to hit a number
- storyPoints must be exactly one of: 1, 2, 3, 5, 8 (if a story needs 13, split it)
- acceptanceCriteria must use Given / When / Then format, 2–3 criteria per story
- Strip role prefixes from persona/goal/benefit (e.g. "Product Manager", not "As a Product Manager")
- Keep scope tight — this is a quick feature, not a full product initiative`;
}

export interface QuickStory {
  title: string;
  persona: string;
  goal: string;
  benefit: string;
  acceptanceCriteria: string[];
  storyPoints: number;
  platform: string;
}

export interface QuickFR {
  id: string;
  title: string;
  stories: QuickStory[];
}

export interface QuickFeatureResult {
  feature: { title: string; description: string };
  functionalRequirements: QuickFR[];
}

interface QuickFeaturePushRow {
  id: number;
  title: string;
  description: string;
  result_json: string;
  ado_feature_id: number | null;
  ado_feature_url: string | null;
  ado_stories_json: string | null;
  pushed_at: number;
}

function buildUserMessage(title: string, description: string, enabledStreams: string[], previousResult?: QuickFeatureResult, revisionFeedback?: string): string {
  const parts = [`Feature: ${title}`, `Description:\n${description}`, `Enabled streams: ${enabledStreams.join(', ')}`];
  if (previousResult && revisionFeedback?.trim()) {
    parts.push(`\nPrevious output:\n\`\`\`json\n${JSON.stringify(previousResult, null, 2)}\n\`\`\``);
    parts.push(`\nRevision feedback:\n${revisionFeedback.trim()}`);
    parts.push('\nPlease revise the output based on the feedback above, keeping only stories for the enabled streams.');
  }
  return parts.join('\n');
}

/**
 * POST /api/quick-feature/generate
 * Body: { title, description, model?, previousResult?, revisionFeedback? }
 * SSE: streams AI reasoning, then fires a done event with { result: QuickFeatureResult }
 */
const DEFAULT_STREAMS = ['backend', 'web'];

quickFeatureRoutes.post('/quick-feature/generate', async (req: Request, res: Response) => {
  const { title, description, model, enabledStreams, previousResult, revisionFeedback } = req.body as {
    title?: string;
    description?: string;
    model?: string;
    enabledStreams?: string[];
    previousResult?: QuickFeatureResult;
    revisionFeedback?: string;
  };

  if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
  if (!description?.trim()) return res.status(400).json({ error: 'context description is required' });

  const streams = Array.isArray(enabledStreams) && enabledStreams.length > 0 ? enabledStreams : DEFAULT_STREAMS;
  const userMessage = buildUserMessage(title.trim(), description.trim(), streams, previousResult, revisionFeedback);
  const resolvedModel = model || resolveAgentModel('coordinator');

  initSSE(res);
  let fullContent = '';

  try {
    for await (const chunk of streamAI(
      resolvedModel,
      buildSystemPrompt(streams),
      [{ role: 'user', content: userMessage }],
      2048
    )) {
      fullContent += chunk;
      sseSend(res, { type: 'content', content: chunk });
    }

    const jsonMatch = fullContent.match(/```json\s*([\s\S]*?)```/);
    let result: QuickFeatureResult | null = null;
    if (jsonMatch) {
      try {
        result = JSON.parse(jsonMatch[1].trim());
      } catch {
        logger.warn('Failed to parse quick feature JSON from AI response');
      }
    }

    sseSend(res, { type: 'done', result });
  } catch (err: any) {
    logger.error('Failed to generate quick feature', err);
    sseSend(res, { type: 'error', error: err.message });
  } finally {
    res.end();
  }
});

/**
 * POST /api/quick-feature/push
 * Body: { title, description, result: QuickFeatureResult }
 * Creates 1 ADO Feature + stories, saves record to DB.
 * Returns { id, featureId, featureUrl, stories }
 */
quickFeatureRoutes.post('/quick-feature/push', async (req: Request, res: Response) => {
  const { title, description, result } = req.body as {
    title?: string;
    description?: string;
    result?: QuickFeatureResult;
  };

  if (!result?.feature?.title?.trim()) return res.status(400).json({ error: 'feature title is required' });
  if (!Array.isArray(result.functionalRequirements) || result.functionalRequirements.length === 0) {
    return res.status(400).json({ error: 'at least one functional requirement is required' });
  }

  try {
    const { appConfig } = require('../config/app-config');
    if (appConfig.integrations.workItems !== 'ado') {
      return res.status(400).json({ error: 'ADO integration is not configured' });
    }

    const { getAzureDevOpsClient } = require('../integrations/azure-devops');
    const client = getAzureDevOpsClient();

    const featureType: string = process.env.AZURE_DEVOPS_FEATURE_TYPE || 'Feature';
    const storyType: string = process.env.AZURE_DEVOPS_STORY_TYPE || 'User Story';

    const frSummaryLines = result.functionalRequirements
      .map(fr => `<li><b>${fr.id}:</b> ${fr.title}</li>`)
      .join('');
    const featureDescHtml = [
      `<p>${result.feature.description}</p>`,
      `<br><b>Functional Requirements</b><ul>${frSummaryLines}</ul>`,
    ].join('');

    const featureWorkItem = await client.createWorkItem({
      type: featureType as any,
      title: result.feature.title.trim(),
      description: featureDescHtml,
    });

    const featureId: number = featureWorkItem.id;
    const featureUrl: string = client.getEpicUrl(featureId);
    const pushedStories: Array<{ id: number; url: string; title: string }> = [];

    for (const fr of result.functionalRequirements) {
      for (const story of fr.stories) {
        const storyDescription = [
          story.persona ? `<b>As a</b> ${story.persona}` : '',
          story.goal ? `<b>I want</b> ${story.goal}` : '',
          story.benefit ? `<b>So that</b> ${story.benefit}` : '',
        ].filter(Boolean).join('<br>');

        const acHtml = buildAcceptanceCriteriaHtml(story.acceptanceCriteria);

        const platformLabel = story.platform ? (STREAM_LABELS[story.platform] ?? story.platform) : '';
        const storyTags = [fr.id, platformLabel].filter(Boolean).join('; ');

        const storyWorkItem = await client.createWorkItem({
          type: storyType as any,
          title: story.title.trim(),
          description: storyDescription,
          acceptanceCriteria: acHtml,
          parentId: featureId,
          effort: story.storyPoints,
          tags: storyTags,
        });

        pushedStories.push({
          id: storyWorkItem.id,
          url: client.getEpicUrl(storyWorkItem.id),
          title: story.title,
        });
      }
    }

    // Save to history
    const insertStmt = db.prepare(`
      INSERT INTO quick_feature_pushes (title, description, result_json, ado_feature_id, ado_feature_url, ado_stories_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertResult = insertStmt.run(
      (title || result.feature.title).trim(),
      (description || '').trim(),
      JSON.stringify(result),
      featureId,
      featureUrl,
      JSON.stringify(pushedStories)
    );

    logger.info(`Quick feature pushed: Feature #${featureId} with ${pushedStories.length} stories`);
    res.json({ id: insertResult.lastInsertRowid, featureId, featureUrl, stories: pushedStories });
  } catch (err: any) {
    logger.error('Failed to push quick feature to ADO', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/quick-feature/history
 * Returns the 50 most recent quick feature pushes, newest first.
 */
quickFeatureRoutes.get('/quick-feature/history', (_req: Request, res: Response) => {
  try {
    const rows = db.prepare(`
      SELECT id, title, description, result_json, ado_feature_id, ado_feature_url, ado_stories_json, pushed_at
      FROM quick_feature_pushes
      ORDER BY pushed_at DESC
      LIMIT 50
    `).all() as QuickFeaturePushRow[];

    const history = rows.map(row => ({
      id: row.id,
      title: row.title,
      description: row.description,
      result: JSON.parse(row.result_json) as QuickFeatureResult,
      adoFeatureId: row.ado_feature_id,
      adoFeatureUrl: row.ado_feature_url,
      adoStories: row.ado_stories_json ? JSON.parse(row.ado_stories_json) : [],
      pushedAt: row.pushed_at,
    }));

    res.json({ history });
  } catch (err: any) {
    logger.error('Failed to fetch quick feature history', err);
    res.status(500).json({ error: err.message });
  }
});
