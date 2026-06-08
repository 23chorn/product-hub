import { Router, Request, Response } from 'express';
import db from '../data/database';
import { insertEvent } from '../agents/workflow-db';
import { isDemoMode } from '../demo/demo-mode';
import Logger from '../utils/logger';

const logger = new Logger('AI-CODING');
export const aiCodingRoutes = Router();

/**
 * POST /api/workflow/:id/trigger-ai-coding
 *
 * Tags ADO work items with "ai-ready" to trigger the Azure pipeline that
 * hosts the Claude Code agent. In demo mode, returns mock data immediately.
 *
 * Returns: { epicId, epicUrl, taggedCount, pipelineUrl, demo? }
 */
aiCodingRoutes.post('/workflow/:id/trigger-ai-coding', async (req: Request, res: Response) => {
  const workflowId = req.params.id;

  try {
    const workflow = db.prepare<[string], { item_id: string; goal: string; summary: string | null }>(
      'SELECT item_id, goal, summary FROM workflows WHERE id = ?'
    ).get(workflowId);

    if (!workflow) return res.status(404).json({ error: 'Workflow not found' });

    const mappings = db.prepare<[string], { local_key: string; ado_id: number; title: string; ado_type: string; ado_url: string }>(
      'SELECT local_key, ado_id, title, ado_type, ado_url FROM ado_work_item_map WHERE workflow_id = ?'
    ).all(workflowId);

    const epicMapping = mappings.find(m => m.ado_type === 'epic' || m.local_key === 'epic');

    // ── Demo mode ──────────────────────────────────────────────────────────
    if (isDemoMode() || mappings.length === 0) {
      const org = process.env.AZURE_DEVOPS_ORG ?? 'contoso';
      const project = process.env.AZURE_DEVOPS_PROJECT ?? 'MobileApp';
      const epicId = epicMapping?.ado_id ?? Math.floor(10000 + Math.random() * 90000);
      const epicUrl = epicMapping?.ado_url ?? `https://dev.azure.com/${org}/${project}/_workitems/edit/${epicId}`;
      const pipelineRunId = Math.floor(4000 + Math.random() * 1000);

      insertEvent(workflowId, 'ai_coding_triggered', null,
        `AI coding pipeline triggered — Epic #${epicId} tagged with ai-ready`,
        { epic_id: epicId, epic_url: epicUrl, pipeline_run: pipelineRunId, demo: true }
      );

      logger.info(`[DEMO] AI coding triggered for workflow ${workflowId}, Epic #${epicId}`);
      return res.json({
        epicId,
        epicUrl,
        taggedCount: mappings.length || 1,
        pipelineRunId,
        pipelineUrl: `https://dev.azure.com/${org}/${project}/_build/results?buildId=${pipelineRunId}`,
        demo: true,
      });
    }

    // ── Real ADO: tag items with ai-ready ──────────────────────────────────
    const { appConfig } = require('../config/app-config');
    if (appConfig.integrations.workItems !== 'ado') {
      return res.status(400).json({ error: 'ADO integration not configured' });
    }

    const { AzureDevOpsClient } = require('../integrations/azure-devops');
    const client = new AzureDevOpsClient();

    let taggedCount = 0;
    const itemsToTag = mappings.filter(m => m.ado_type === 'epic' || m.ado_type === 'feature');

    for (const item of itemsToTag) {
      try {
        await client.addTag(item.ado_id, 'ai-ready');
        taggedCount++;
      } catch (err: any) {
        logger.warn(`Failed to tag item #${item.ado_id}: ${err.message}`);
      }
    }

    const epicId = epicMapping?.ado_id;
    const epicUrl = epicMapping?.ado_url ?? (epicId ? client.getEpicUrl(epicId) : '');

    // ── Optionally trigger ADO pipeline run via REST API ───────────────────
    let pipelineRunId: number | null = null;
    let pipelineUrl: string | null = null;
    const pipelineId = process.env.AZURE_DEVOPS_AI_PIPELINE_ID;

    if (pipelineId && epicId) {
      try {
        const org = encodeURIComponent(process.env.AZURE_DEVOPS_ORG!);
        const project = encodeURIComponent(process.env.AZURE_DEVOPS_PROJECT!);
        const apiVersion = '7.1';
        const pat = Buffer.from(`:${process.env.AZURE_DEVOPS_PAT}`).toString('base64');

        const epicTitle = epicMapping?.title ?? workflow.goal ?? 'Feature';
        const body = {
          resources: { repositories: { self: { refName: 'refs/heads/main' } } },
          templateParameters: {
            epicId: String(epicId),
            workflowId,
            epicTitle,
          },
        };

        const runRes = await fetch(
          `https://dev.azure.com/${org}/${project}/_apis/pipelines/${pipelineId}/runs?api-version=${apiVersion}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Basic ${pat}`,
            },
            body: JSON.stringify(body),
          }
        );

        if (runRes.ok) {
          const run = await runRes.json() as { id: number; _links?: { web?: { href?: string } } };
          pipelineRunId = run.id;
          pipelineUrl = run._links?.web?.href ?? null;
          logger.info(`ADO pipeline run #${pipelineRunId} started`);
        } else {
          const errText = await runRes.text();
          logger.warn(`Failed to trigger pipeline: ${runRes.status} ${errText}`);
        }
      } catch (pipelineErr: any) {
        logger.warn(`Pipeline trigger error: ${pipelineErr.message}`);
      }
    }

    insertEvent(workflowId, 'ai_coding_triggered', null,
      `${taggedCount} ADO item${taggedCount !== 1 ? 's' : ''} tagged with ai-ready${pipelineRunId ? ` — pipeline run #${pipelineRunId} started` : ' — Azure pipeline will trigger automatically'}`,
      { epic_id: epicId, epic_url: epicUrl, tagged_count: taggedCount, pipeline_run: pipelineRunId, pipeline_url: pipelineUrl }
    );

    logger.info(`AI coding triggered for workflow ${workflowId} — ${taggedCount} items tagged`);
    return res.json({ epicId, epicUrl, taggedCount, pipelineRunId, pipelineUrl });
  } catch (err: any) {
    logger.error('Failed to trigger AI coding', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/workflow/:id/ai-coding/status
 * Returns whether an AI coding session has been triggered for this workflow.
 */
aiCodingRoutes.get('/workflow/:id/ai-coding/status', (req: Request, res: Response) => {
  const workflowId = req.params.id;
  try {
    const event = db.prepare<[string], { details: string | null; created_at: number }>(
      `SELECT details, created_at FROM workflow_events
       WHERE workflow_id = ? AND event_type = 'ai_coding_triggered'
       ORDER BY created_at DESC LIMIT 1`
    ).get(workflowId);

    if (!event) return res.json({ triggered: false });

    const details = event.details ? JSON.parse(event.details) : {};
    return res.json({
      triggered: true,
      triggeredAt: event.created_at,
      epicId: details.epic_id,
      epicUrl: details.epic_url,
      pipelineRunId: details.pipeline_run,
      pipelineUrl: details.pipeline_url,
      demo: details.demo ?? false,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});
