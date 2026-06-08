import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../data/database';
import { createWorkflow, advanceStage } from '../agents/workflow-router';
import Logger from '../utils/logger';

const logger = new Logger('DEMO-WEBHOOK');
export const demoWebhookRoutes = Router();

const WEBHOOK_SAMPLES = [
  {
    title: 'In-App Messaging & Trade Chat — TradeEasy',
    description: `Add a real-time in-app messaging feature so users can discuss trades and market ideas within the TradeEasy app.

Who it's for: Active retail traders (ages 22–40) who currently use external chats (Discord, WhatsApp groups) to share trade ideas and miss the opportunity to act immediately.

Core problem: Users switch between TradeEasy and external messaging apps to share trade setups. The context-switching leads to missed execution windows and increases app abandonment. There is no way to share a specific ticker or open position directly into a conversation.

Key outcomes:
- Users can create and join topic-based chat rooms (e.g. "AAPL watchers")
- Share a live ticker card directly from the instrument page into any chat
- Message latency under 500ms at peak load (market open)

Scope: MVP — text messages and ticker-card sharing only. No voice, no DMs. iOS and Android.

Constraints:
- Messages must be retained for 7 years (MiFID II record-keeping requirement)
- Content moderation required before public launch (hate speech, pump-and-dump signals)
- Team: 2 iOS, 2 Android, 2 backend, 1 compliance liaison`,
  },
  {
    title: 'Onboarding Redesign — TradeEasy',
    description: `Redesign the new user onboarding flow to reduce drop-off and improve time-to-first-trade.

Who it's for: New retail investors (ages 22–35) signing up for TradeEasy for the first time. Many are first-time investors unfamiliar with trading terminology.

Core problem: Current 14-step KYC + account setup flow has a 68% drop-off rate. Users abandon most often at document upload (step 7) and risk questionnaire (step 11). Competitors complete onboarding in under 5 minutes.

Key outcomes:
- Reduce onboarding drop-off from 68% to under 40%
- Achieve time-to-first-trade under 8 minutes for 70% of completions
- Increase completion of the risk questionnaire by 50%

Scope: MVP — iOS and Android. Redesign steps 1–12 only. Backend KYC provider unchanged.

Constraints:
- Regulatory KYC requirements cannot be skipped or reordered
- Must support 12 languages at launch
- Team: 1 iOS, 1 Android, 1 backend, 1 UX designer`,
  },
  {
    title: 'Portfolio Analytics Dashboard — TradeEasy',
    description: `Build a portfolio performance analytics view that helps users understand their returns and risk exposure.

Who it's for: Intermediate retail investors (ages 30–50) with portfolios of 5+ holdings who want to track performance beyond simple P&L.

Core problem: The current portfolio view shows only unrealised P&L and position size. Users can't see realised returns, compare against benchmarks, or understand concentration risk — so they export to Excel for analysis.

Key outcomes:
- Show time-weighted return (TWR) vs benchmark (S&P 500 / custom)
- Visualise sector and geography concentration
- Export report as PDF for sharing with advisors

Scope: MVP — web only. Historical data for the past 3 years. Equities and ETFs only.

Constraints:
- TWR calculation must match brokerage statement to 2 decimal places
- Data latency acceptable at T+1 (end of day)
- Team: 2 frontend, 1 backend, 1 data engineer`,
  },
  {
    title: 'Social Trading & Copy Features — TradeEasy',
    description: `Allow users to follow top traders and optionally auto-copy their trades in real time.

Who it's for: Novice investors (ages 20–30) who want market exposure but lack confidence to pick stocks themselves. They follow finance influencers on social media.

Core problem: Users want to invest but don't know where to start. Competitor apps with copy-trading features see 2.5× higher retention among novice cohorts. TradeEasy has no social layer.

Key outcomes:
- Users can browse and follow verified top traders
- Optional auto-copy with configurable allocation cap (e.g. max 10% portfolio per trader)
- Followed traders earn a fee share from copy profits

Scope: MVP — view and manual-copy only. Auto-copy deferred to Phase 2. iOS and Android.

Constraints:
- Regulatory approval required before auto-copy goes live (FCA)
- Trader verification requires 6-month performance history minimum
- Team: 2 iOS, 2 Android, 2 backend, 1 compliance liaison`,
  },
];

let sampleIndex = 0;

const DEFAULT_STAGES = ['analyst', 'pm_prd', 'solution_architect', 'pm_backlog', 'qa_engineer', 'tech_refinement', 'curator'];

/**
 * POST /api/demo/webhook/trigger
 *
 * Simulates an Airtable webhook event: creates a new initiative and
 * immediately kicks off the full workflow pipeline without any human
 * confirmation step. Cycles through pre-defined sample initiatives so
 * multiple triggers produce distinct parallel workflows.
 */
demoWebhookRoutes.post('/demo/webhook/trigger', async (req: Request, res: Response) => {
  try {
    const sample = WEBHOOK_SAMPLES[sampleIndex % WEBHOOK_SAMPLES.length];
    sampleIndex++;

    const itemId = `item-${uuidv4()}`;
    const now = Date.now();

    // Create the initiative in the items table
    db.prepare(
      `INSERT INTO items (id, type, title, description, status, source, airtable_id, created_at, updated_at)
       VALUES (?, 'initiative', ?, ?, 'active', 'local', NULL, ?, ?)`
    ).run(itemId, sample.title, sample.description, now, now);

    // Build goal string (same format as manual launch path)
    const goal = `${sample.title}\n\n${sample.description}`;

    // Create workflow and kick off first stage
    const workflow = createWorkflow(itemId, goal, DEFAULT_STAGES, { demo_auto_approve: 'true' });
    advanceStage(workflow.id).catch((err: Error) =>
      logger.error(`advanceStage failed for demo webhook workflow ${workflow.id}`, err)
    );

    logger.info(`Demo webhook: created initiative "${sample.title}" → workflow ${workflow.id}`);

    return res.json({
      workflowId: workflow.id,
      itemId,
      initiative: sample.title,
      stages: DEFAULT_STAGES,
    });
  } catch (err: any) {
    logger.error('Demo webhook trigger failed', err);
    return res.status(500).json({ error: err.message });
  }
});
