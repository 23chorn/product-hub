import https from 'https';
import Logger from './logger';
import db from '../data/database';
import { getUsersByRole, getAdminUsers, hasAnyUsers } from '../data/users';
import { checkpointArtifactLabel } from '../agents/stage-metadata';
import { normalizeStageForRoles } from '../agents/workflow-db';
import { isDemoWorkflow } from '../demo/demo-mode';

const logger = new Logger('SLACK');

function getWebhookUrl(): string | null {
  return process.env.SLACK_WEBHOOK_URL ?? null;
}

function post(payload: object): void {
  const webhookUrl = getWebhookUrl();
  if (!webhookUrl) {
    logger.warn('No Slack webhook URL configured (SLACK_WEBHOOK_URL env var) — notification skipped');
    return;
  }

  try {
    const url = new URL(webhookUrl);
    const body = JSON.stringify(payload);
    logger.info(`Posting Slack notification to ${url.hostname} (${body.length} bytes)`);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 10_000,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          let responseBody = '';
          res.on('data', (chunk) => { responseBody += chunk; });
          res.on('end', () => logger.warn(`Slack webhook returned HTTP ${res.statusCode}: ${responseBody.slice(0, 500)}`));
        } else {
          logger.info(`Slack webhook accepted notification (HTTP ${res.statusCode})`);
        }
      }
    );
    req.on('timeout', () => {
      logger.warn('Slack webhook request timed out after 10s');
      req.destroy();
    });
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
    const stageRoles = db.prepare<[string], { role_name: string }>(
      'SELECT role_name FROM stage_roles WHERE stage = ?'
    ).all(normalizeStageForRoles(stage));

    const users = stageRoles.length > 0
      ? stageRoles.flatMap(({ role_name }) => getUsersByRole(role_name))
      : getAdminUsers();

    const seen = new Set<string>();
    const mentions = users
      .filter(u => u.slack_user_id && !seen.has(u.slack_user_id) && seen.add(u.slack_user_id!))
      .map(u => `<@${u.slack_user_id}>`)
      .join(' ');

    return mentions;
  } catch {
    return '';
  }
}

function getAppUrl(): string {
  const raw = process.env.APP_URL || 'http://localhost:5173';
  // Trim whitespace and strip inline comments (some .env parsers don't handle them)
  return raw.split(/\s+#/)[0].trim();
}

export function notifyCheckpointPending(
  initiativeTitle: string,
  stage: string,
  workflowId?: string,
  revisionRequestedBy?: string,
): void {
  // Skip Slack notifications for demo workflows
  if (workflowId && isDemoWorkflow(workflowId)) {
    logger.info('Skipping Slack notification for demo workflow');
    return;
  }

  const label = checkpointArtifactLabel(stage);
  const mentions = buildMentions(stage);
  const appUrl = getAppUrl();

  // A revision return reads differently from a first-run review so the reviewer
  // knows their requested changes are back, not that a brand-new draft landed.
  const headline = revisionRequestedBy
    ? `*${label}* revision requested by ${revisionRequestedBy} is now ready for review`
    : `*${label}* ready for review`;
  const emoji = revisionRequestedBy ? ':arrows_counterclockwise:' : ':eyes:';

  const text = mentions
    ? `${mentions} — ${headline} on "${initiativeTitle}"`
    : `${headline} — ${initiativeTitle}`;

  const reviewUrl = workflowId ? `${appUrl}?workflowId=${workflowId}` : null;

  const blocks: object[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: mentions
          ? `${emoji} ${headline}\n*Initiative:* ${initiativeTitle}\n${mentions}${reviewUrl ? `\n\n<${reviewUrl}|Open Review →>` : ''}`
          : `${emoji} ${headline}\n*Initiative:* ${initiativeTitle}${reviewUrl ? `\n\n<${reviewUrl}|Open Review →>` : ''}`,
      },
    },
  ];

  post({ text, blocks });
}

export function notifyWorkflowComplete(initiativeTitle: string, workflowId?: string): void {
  // Skip Slack notifications for demo workflows
  if (workflowId && isDemoWorkflow(workflowId)) {
    logger.info('Skipping Slack notification for demo workflow');
    return;
  }

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
