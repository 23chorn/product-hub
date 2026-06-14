import https from 'https';
import Logger from './logger';
import db from '../data/database';
import { getUsersByRole, getAdminUsers, hasAnyUsers } from '../data/users';

const logger = new Logger('SLACK');

const STAGE_LABELS: Record<string, string> = {
  analyst: 'Research Brief',
  pm_prd: 'PRD',
  solution_architect: 'Architecture',
  story_decomposition: 'Backlog',
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

function buildMentions(stage: string): string {
  if (!hasAnyUsers()) return '';
  try {
    // Look up which role owns this stage
    const stageRole = db.prepare<[string], { role_name: string }>(
      'SELECT role_name FROM stage_roles WHERE stage = ? LIMIT 1'
    ).get(stage);

    const users = stageRole?.role_name
      ? getUsersByRole(stageRole.role_name)
      : getAdminUsers();

    const mentions = users
      .filter(u => u.slack_user_id)
      .map(u => `<@${u.slack_user_id}>`)
      .join(' ');

    return mentions;
  } catch {
    return '';
  }
}

function getAppUrl(): string {
  return process.env.APP_URL || 'http://localhost:5173';
}

export function notifyCheckpointPending(initiativeTitle: string, stage: string, workflowId?: string): void {
  const label = STAGE_LABELS[stage] ?? stage;
  const mentions = buildMentions(stage);
  const appUrl = getAppUrl();

  const text = mentions
    ? `${mentions} — *${label}* ready for review on "${initiativeTitle}"`
    : `${label} ready for review — ${initiativeTitle}`;

  const blocks: object[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: mentions
          ? `:eyes: *${label}* is ready for review\n*Initiative:* ${initiativeTitle}\n${mentions}`
          : `:eyes: *${label}* is ready for your review\n*Initiative:* ${initiativeTitle}`,
      },
    },
  ];

  if (workflowId) {
    blocks.push({
      type: 'actions',
      elements: [{
        type: 'button',
        text: { type: 'plain_text', text: 'Open Review' },
        url: `${appUrl}`,
        style: 'primary',
      }],
    });
  }

  post({ text, blocks });
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
