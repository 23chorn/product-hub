import { Router, Request, Response } from 'express';
import { initSSE, sseSend } from '../utils/sse';
import { streamAI, resolveAgentModel } from '../utils/ai-provider';
import Logger from '../utils/logger';

const logger = new Logger('QUICK-FEATURE-ROUTES');

export const quickFeatureRoutes = Router();

const SYSTEM_PROMPT = `You are an expert product manager. Your job is to decompose a small feature into properly structured Azure DevOps work items ready for a sprint.

Given a feature title and description, produce:
- A polished feature description (2–3 sentences)
- 1 to 2 Functional Requirements (FRs) depending on scope
- 2–4 User Stories per FR with full sprint-ready detail

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
          "title": "story title",
          "persona": "type of user — do NOT include 'As a'",
          "goal": "what they want to do — do NOT include 'I want'",
          "benefit": "the business value — do NOT include 'So that'",
          "acceptanceCriteria": [
            "Given [context] When [action] Then [outcome]"
          ],
          "storyPoints": 3
        }
      ]
    }
  ]
}
\`\`\`

## Rules
- Maximum 2 FRs — only add a second if the scope genuinely covers separate functional areas
- 2–4 stories per FR
- storyPoints must be exactly one of: 1, 2, 3, 5, 8 (if a story needs 13, split it)
- acceptanceCriteria must use Given / When / Then format, 2–3 criteria per story
- Strip role prefixes from persona/goal/benefit (e.g. "Product Manager", not "As a Product Manager")
- Keep scope tight — this is a quick feature, not a full product initiative`;

export interface QuickStory {
  title: string;
  persona: string;
  goal: string;
  benefit: string;
  acceptanceCriteria: string[];
  storyPoints: number;
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

/**
 * POST /api/quick-feature/generate
 * Body: { title: string, description?: string, model?: string }
 * SSE: streams AI reasoning, then fires a done event with { result: QuickFeatureResult }
 */
quickFeatureRoutes.post('/quick-feature/generate', async (req: Request, res: Response) => {
  const { title, description, model } = req.body as {
    title?: string;
    description?: string;
    model?: string;
  };

  if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
  if (!description?.trim()) return res.status(400).json({ error: 'context description is required' });

  const userMessage = [
    `Feature: ${title}`,
    description?.trim() ? `\nDescription:\n${description.trim()}` : '',
  ].join('').trim();

  const resolvedModel = model || resolveAgentModel('coordinator');

  initSSE(res);

  let fullContent = '';

  try {
    for await (const chunk of streamAI(
      resolvedModel,
      SYSTEM_PROMPT,
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
 * Body: { result: QuickFeatureResult }
 * Creates 1 ADO Feature + stories grouped under it.
 * Returns { featureId, featureUrl, stories: [{ id, url, title }] }
 */
quickFeatureRoutes.post('/quick-feature/push', async (req: Request, res: Response) => {
  const { result } = req.body as { result?: QuickFeatureResult };

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

    // Build feature description HTML including FR summary
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

        let acHtml: string | undefined;
        if (Array.isArray(story.acceptanceCriteria) && story.acceptanceCriteria.length > 0) {
          acHtml = story.acceptanceCriteria
            .map((ac: string, i: number) => {
              const formatted = ac
                .replace(/\b(Given|When|Then|And|But)\b/gi, '\n$1')
                .trim()
                .split('\n')
                .filter((l: string) => l.trim())
                .map((l: string) => l.trim().replace(/^(Given|When|Then|And|But)\b/i, '<b>$1</b>'))
                .join('<br>');
              return `<b>AC ${i + 1}</b><br>${formatted}`;
            })
            .join('<br><br>');
        }

        const storyWorkItem = await client.createWorkItem({
          type: storyType as any,
          title: story.title.trim(),
          description: storyDescription,
          acceptanceCriteria: acHtml,
          parentId: featureId,
          effort: story.storyPoints,
          tags: fr.id,
        });

        pushedStories.push({
          id: storyWorkItem.id,
          url: client.getEpicUrl(storyWorkItem.id),
          title: story.title,
        });
      }
    }

    logger.info(`Quick feature pushed: Feature #${featureId} with ${pushedStories.length} stories`);
    res.json({ featureId, featureUrl, stories: pushedStories });
  } catch (err: any) {
    logger.error('Failed to push quick feature to ADO', err);
    res.status(500).json({ error: err.message });
  }
});
