import https from 'https';
import Logger from './logger';
import db from '../data/database';
import { getUserById, getUsersByRole, getAdminUsers } from '../data/users';
import { normalizeStageForRoles } from '../agents/workflow-db';
import { checkpointArtifactLabel } from '../agents/stage-metadata';
import { isDemoWorkflow } from '../demo/demo-mode';
import { getGlobalPolicy } from '../config/settings-store';

const logger = new Logger('SLACK');

function getWebhookUrl(): string | null {
  return process.env.SLACK_WEBHOOK_URL ?? null;
}

function post(payload: object): void {
  if (getGlobalPolicy('slack_notifications_enabled') === 'false') {
    logger.info('Slack notifications disabled globally — notification skipped');
    return;
  }

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

/**
 * Look up the item_id for a workflow. Returns null when the workflow doesn't exist
 * (e.g. called without a workflowId, which callers pass as optional).
 */
function lookupItemId(workflowId: string): string | null {
  return (db.prepare<[string], { item_id: string }>(
    'SELECT item_id FROM workflows WHERE id = ?'
  ).get(workflowId))?.item_id ?? null;
}

/**
 * Build Slack @-mentions for users who are both assigned to this initiative AND hold
 * the relevant stage role for the checkpoint. When `stage` is omitted (completion
 * notifications), all assigned users with a Slack ID are included.
 * Returns null when the filtered set is empty — caller should skip the notification.
 */
function buildAssignedMentions(itemId: string, stage?: string): string | null {
  try {
    const assignedRows = db.prepare<[string], { user_id: number }>(
      'SELECT user_id FROM item_assignments WHERE item_id = ?'
    ).all(itemId);

    if (assignedRows.length === 0) return null;

    const assignedIds = new Set(assignedRows.map(r => r.user_id));

    // For checkpoint notifications, intersect with stage-role holders.
    // For completion notifications (no stage), all assigned users are eligible.
    let candidates: Array<{ id: number; slack_user_id: string | null }>;
    if (stage) {
      const stageRoles = db.prepare<[string], { role_name: string }>(
        'SELECT role_name FROM stage_roles WHERE stage = ?'
      ).all(normalizeStageForRoles(stage));

      const roleUsers = stageRoles.length > 0
        ? stageRoles.flatMap(({ role_name }) => getUsersByRole(role_name))
        : getAdminUsers();

      candidates = roleUsers.filter(u => assignedIds.has(u.id));
    } else {
      candidates = assignedRows
        .map(r => getUserById(r.user_id))
        .filter((u): u is NonNullable<typeof u> => u !== null);
    }

    const seen = new Set<string>();
    const mentions = candidates
      .filter((u): u is typeof u & { slack_user_id: string } => !!u.slack_user_id)
      .filter(u => !seen.has(u.slack_user_id) && seen.add(u.slack_user_id))
      .map(u => `<@${u.slack_user_id}>`)
      .join(' ');

    return mentions || null;
  } catch {
    return null;
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

  // Only notify users assigned to this specific initiative — no assignment = no ping
  const itemId = workflowId ? lookupItemId(workflowId) : null;
  if (!itemId) {
    logger.info('Slack checkpoint notification skipped — no item_id resolved from workflowId');
    return;
  }
  const mentions = buildAssignedMentions(itemId, stage);
  if (!mentions) {
    logger.info(`Slack checkpoint notification skipped — no assigned users with the "${stage}" stage role for item ${itemId}`);
    return;
  }

  const label = checkpointArtifactLabel(stage);
  const appUrl = getAppUrl();

  // A revision return reads differently from a first-run review so the reviewer
  // knows their requested changes are back, not that a brand-new draft landed.
  const headline = revisionRequestedBy
    ? `*${label}* revision requested by ${revisionRequestedBy} is now ready for review`
    : `*${label}* ready for review`;
  const emoji = revisionRequestedBy ? ':arrows_counterclockwise:' : ':eyes:';

  const reviewUrl = workflowId ? `${appUrl}?workflowId=${workflowId}` : null;

  post({
    text: `${mentions} — ${headline} on "${initiativeTitle}"`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${emoji} ${headline}\n*Initiative:* ${initiativeTitle}\n${mentions}${reviewUrl ? `\n\n<${reviewUrl}|Open Review →>` : ''}`,
        },
      },
    ],
  });
}

export function notifyWorkflowComplete(initiativeTitle: string, workflowId?: string): void {
  // Skip Slack notifications for demo workflows
  if (workflowId && isDemoWorkflow(workflowId)) {
    logger.info('Skipping Slack notification for demo workflow');
    return;
  }

  // Only notify users assigned to this specific initiative — no assignment = no ping
  const itemId = workflowId ? lookupItemId(workflowId) : null;
  if (!itemId) {
    logger.info('Slack completion notification skipped — no item_id resolved from workflowId');
    return;
  }
  const mentions = buildAssignedMentions(itemId);
  if (!mentions) {
    logger.info(`Slack completion notification skipped — no assigned users with Slack IDs for item ${itemId}`);
    return;
  }

  post({
    text: `${mentions} — Workflow complete: ${initiativeTitle}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:white_check_mark: *Workflow complete*\n*Initiative:* ${initiativeTitle}\n${mentions}`,
        },
      },
    ],
  });
}
