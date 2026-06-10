import https from 'https';
import Logger from './logger';
import db from '../data/database';

const logger = new Logger('SLACK');

const STAGE_LABELS: Record<string, string> = {
  analyst: 'Research Brief',
  pm_prd: 'PRD',
  solution_architect: 'Architecture',
  pm_backlog: 'Backlog',
  qa_engineer: 'QA Tests',
  tech_refinement: 'Tech Refinement',
  curator: 'Context Update',
};

function getWebhookUrl(): string | null {
  try {
    const row = db.prepare(`SELECT rule_value FROM policies WHERE scope = 'global' AND rule_key = 'slack_webhook_url'`).get() as { rule_value: string } | undefined;
    if (row?.rule_value) return row.rule_value;
  } catch { /* DB not yet initialised */ }
  return process.env.SLACK_WEBHOOK_URL ?? null;
}

function post(payload: object): void {
  const webhookUrl = getWebhookUrl();
  if (!webhookUrl) return;

  try {
    const url = new URL(webhookUrl);
    const body = JSON.stringify(payload);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          logger.warn(`Slack webhook returned HTTP ${res.statusCode}`);
        }
      }
    );
    req.on('error', (err) => logger.warn(`Slack webhook request error: ${err.message}`));
    req.write(body);
    req.end();
  } catch (err: any) {
    logger.warn(`Failed to post Slack notification: ${err.message}`);
  }
}

export function notifyCheckpointPending(initiativeTitle: string, stage: string): void {
  const label = STAGE_LABELS[stage] ?? stage;
  post({
    text: `${label} ready for review — ${initiativeTitle}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:eyes: *${label}* is ready for your review\n*Initiative:* ${initiativeTitle}`,
        },
      },
    ],
  });
}

export function notifyWikiPublished(initiativeTitle: string, pageName: string, wikiUrl: string): void {
  post({
    text: `${pageName} published to Azure Wiki — ${initiativeTitle}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:page_facing_up: *${pageName}* published to Azure Wiki\n*Initiative:* ${initiativeTitle}`,
        },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: 'Open in Azure' },
          url: wikiUrl,
        },
      },
    ],
  });
}

export function notifyWorkflowComplete(initiativeTitle: string): void {
  post({
    text: `Workflow complete — ${initiativeTitle}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:white_check_mark: *Workflow complete*\n*Initiative:* ${initiativeTitle}`,
        },
      },
    ],
  });
}
