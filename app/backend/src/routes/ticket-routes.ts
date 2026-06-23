import { Router, Request, Response } from 'express';
import { initSSE, sseSend } from '../utils/sse';
import { streamAI, resolveAgentModel } from '../utils/ai-provider';
import Logger from '../utils/logger';

// Mirrors DEFAULT_AI_HOURS_PER_POINT in sprint-estimation.ts (non-linear: AI helps more on routine work)
const AI_HOURS_PER_POINT: Record<number, number> = { 1: 0.5, 2: 1.5, 3: 3, 5: 8, 8: 18 };

const logger = new Logger('TICKET-ROUTES');

export const ticketRoutes = Router();

const FIBONACCI = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144];

function toNearestFibonacci(n: number): number {
  if (n <= 0) return 1;
  return FIBONACCI.reduce((prev, curr) => (Math.abs(curr - n) < Math.abs(prev - n) ? curr : prev));
}

function computeAiEstimateDev(storyPoints: number): number {
  const mapping = AI_HOURS_PER_POINT;
  const keys = Object.keys(mapping).map(Number).sort((a, b) => a - b);
  if (mapping[storyPoints] != null) return toNearestFibonacci(mapping[storyPoints]);
  const lower = keys.filter(k => k <= storyPoints).pop();
  const upper = keys.find(k => k >= storyPoints);
  if (lower != null && upper != null && lower !== upper) {
    const ratio = (storyPoints - lower) / (upper - lower);
    return toNearestFibonacci(mapping[lower] + ratio * (mapping[upper] - mapping[lower]));
  }
  const highest = keys[keys.length - 1];
  return toNearestFibonacci((storyPoints / highest) * mapping[highest]);
}

const SYSTEM_PROMPT = `You are an expert product manager and delivery lead. Your job is to format a raw ticket into a proper Agile user story and estimate its complexity.

## Output structure

Write a brief complexity rationale (2–3 sentences), then end your response with a JSON block in a fenced \`\`\`json block, exactly as shown:

\`\`\`json
{
  "title": "concise story title",
  "persona": "type of user — do NOT include 'As a'",
  "goal": "what they want to do — do NOT include 'I want'",
  "benefit": "the business value — do NOT include 'So that'",
  "acceptanceCriteria": [
    "Given [context] When [action] Then [outcome]"
  ],
  "storyPoints": 3,
  "complexityRationale": "one sentence explaining the complexity choice"
}
\`\`\`

## Complexity guide (Fibonacci story points)
- 1: trivial — config or copy change
- 2: simple — clear implementation, no unknowns
- 3: small feature — minor design decisions
- 5: medium — multiple components, some unknowns
- 8: complex — significant design or integration work
- 13: very large — recommend splitting before starting

## Rules
- acceptanceCriteria must use "Given / When / Then" format per item
- Write 2–4 acceptance criteria
- storyPoints must be exactly one of: 1, 2, 3, 5, 8, 13
- Strip role prefixes from persona/goal/benefit fields`;

/**
 * POST /api/tickets/format-and-estimate
 * Body: { title: string, description?: string, model?: string }
 * SSE: streams AI reasoning, then fires a done event with { story, aiEstimateDevHours }
 */
ticketRoutes.post('/tickets/format-and-estimate', async (req: Request, res: Response) => {
  const { title, description, model } = req.body as {
    title?: string;
    description?: string;
    model?: string;
  };

  if (!title?.trim()) return res.status(400).json({ error: 'title is required' });

  const userMessage = [
    `Ticket title: ${title}`,
    description?.trim() ? `\nAdditional context:\n${description.trim()}` : '',
  ].join('').trim();

  const resolvedModel = model || resolveAgentModel('coordinator');

  initSSE(res);

  let fullContent = '';

  try {
    for await (const chunk of streamAI(
      resolvedModel,
      SYSTEM_PROMPT,
      [{ role: 'user', content: userMessage }],
      1024
    )) {
      fullContent += chunk;
      sseSend(res, { type: 'content', content: chunk });
    }

    const jsonMatch = fullContent.match(/```json\s*([\s\S]*?)```/);
    let story: any = null;
    let aiEstimateDevHours: number | null = null;

    if (jsonMatch) {
      try {
        story = JSON.parse(jsonMatch[1].trim());
        if (typeof story.storyPoints === 'number') {
          aiEstimateDevHours = computeAiEstimateDev(story.storyPoints);
        }
      } catch {
        logger.warn('Failed to parse story JSON from AI response');
      }
    }

    sseSend(res, { type: 'done', story, aiEstimateDevHours });
  } catch (err: any) {
    logger.error('Failed to format/estimate ticket', err);
    sseSend(res, { type: 'error', error: err.message });
  } finally {
    res.end();
  }
});

/**
 * POST /api/tickets/push-to-ado
 * Body: { title, persona?, goal?, benefit?, acceptanceCriteria?, storyPoints?, aiEstimateDevHours? }
 * Creates a standalone story in ADO.
 */
ticketRoutes.post('/tickets/push-to-ado', async (req: Request, res: Response) => {
  const { title, persona, goal, benefit, acceptanceCriteria, storyPoints, aiEstimateDevHours } = req.body as {
    title?: string;
    persona?: string;
    goal?: string;
    benefit?: string;
    acceptanceCriteria?: string[];
    storyPoints?: number;
    aiEstimateDevHours?: number;
  };

  if (!title?.trim()) return res.status(400).json({ error: 'title is required' });

  try {
    const { appConfig } = require('../config/app-config');
    if (appConfig.integrations.workItems !== 'ado') {
      return res.status(400).json({ error: 'ADO integration is not configured' });
    }

    const { getAzureDevOpsClient } = require('../integrations/azure-devops');
    const client = getAzureDevOpsClient();

    const storyDescription = [
      persona ? `<b>As a</b> ${persona}` : '',
      goal ? `<b>I want</b> ${goal}` : '',
      benefit ? `<b>So that</b> ${benefit}` : '',
    ].filter(Boolean).join('<br>');

    let acHtml: string | undefined;
    if (Array.isArray(acceptanceCriteria) && acceptanceCriteria.length > 0) {
      acHtml = acceptanceCriteria
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

    const storyType = process.env.AZURE_DEVOPS_STORY_TYPE || 'User Story';

    const workItem = await client.createWorkItem({
      type: storyType as any,
      title: title.trim(),
      description: storyDescription,
      acceptanceCriteria: acHtml,
      effort: storyPoints,
      aiEstimateDevHours,
    });

    logger.info(`Created standalone story #${workItem.id}: ${title}`);
    res.json({ id: workItem.id, url: client.getEpicUrl(workItem.id) });
  } catch (err: any) {
    logger.error('Failed to push ticket to ADO', err);
    res.status(500).json({ error: err.message });
  }
});
