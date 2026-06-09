import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import db from '../data/database';
import { insertEvent } from '../agents/workflow-db';
import { isDemoMode } from '../demo/demo-mode';
import { getLatestArtifactPathByType } from '../agents/artifact-helpers';
import Logger from '../utils/logger';

const PROJECT_ROOT = path.resolve(__dirname, '../../../../');
const CONTEXT_DIR  = path.join(PROJECT_ROOT, 'context');

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

/**
 * GET /api/workflow/:id/ticket-context
 *
 * Assembles the Claude Code prompt for this workflow. Called by the
 * CI pipeline (or demo script) to get implementation context before
 * running `claude --print` with the result piped via stdin.
 *
 * Optional query param: ?workItemId=<ado_id> — scopes backlog to that story.
 *
 * Returns: { prompt: string, workflowId, title }
 */
aiCodingRoutes.get('/workflow/:id/ticket-context', (req: Request, res: Response) => {
  const workflowId = req.params.id;
  const workItemId = req.query.workItemId ? Number(req.query.workItemId) : null;

  try {
    const workflow = db.prepare<[string], { goal: string; summary: string | null }>(
      'SELECT goal, summary FROM workflows WHERE id = ?'
    ).get(workflowId);
    if (!workflow) return res.status(404).json({ error: 'Workflow not found' });

    const title = workflow.summary ?? workflow.goal.split('\n')[0].slice(0, 80);
    const sections: string[] = [
      `You are a software engineer implementing a product feature.`,
      `Read the context below, explore the codebase, then implement the feature.`,
      ``,
      `## Feature: ${title}`,
      ``,
      workflow.goal.slice(0, 1500),
    ];

    // ── PRD artifact ───────────────────────────────────────────────────────
    try {
      const row = db.prepare<[string], { file_path: string }>(
        `SELECT a.file_path FROM artifacts a JOIN sessions s ON a.session_id = s.id
         WHERE s.workflow_id = ? AND a.type = 'prd' ORDER BY a.created_at DESC LIMIT 1`
      ).get(workflowId);
      if (row?.file_path && fs.existsSync(row.file_path)) {
        const content = fs.readFileSync(row.file_path, 'utf-8').slice(0, 3000);
        sections.push('', '## PRD Summary', content);
      }
    } catch { /* artifact missing */ }

    // ── Architecture artifact ──────────────────────────────────────────────
    try {
      const row = db.prepare<[string], { file_path: string }>(
        `SELECT a.file_path FROM artifacts a JOIN sessions s ON a.session_id = s.id
         WHERE s.workflow_id = ? AND a.type = 'architecture' ORDER BY a.created_at DESC LIMIT 1`
      ).get(workflowId);
      if (row?.file_path && fs.existsSync(row.file_path)) {
        const content = fs.readFileSync(row.file_path, 'utf-8').slice(0, 2000);
        sections.push('', '## Architecture Decisions', content);
      }
    } catch { /* artifact missing */ }

    // ── Backlog stories ────────────────────────────────────────────────────
    try {
      const backlogPath = getLatestArtifactPathByType(
        (db.prepare<[string], { item_id: string }>('SELECT item_id FROM workflows WHERE id = ?').get(workflowId))?.item_id ?? '',
        'backlog'
      );
      if (backlogPath && fs.existsSync(backlogPath)) {
        const raw = fs.readFileSync(backlogPath, 'utf-8');
        const parsed = JSON.parse(raw);
        const stories: string[] = [];

        // If workItemId given, look up the matching story key in ado_work_item_map
        let targetKey: string | null = null;
        if (workItemId) {
          const mapping = db.prepare<[number, string], { local_key: string }>(
            'SELECT local_key FROM ado_work_item_map WHERE ado_id = ? AND workflow_id = ?'
          ).get(workItemId, workflowId);
          targetKey = mapping?.local_key ?? null;
        }

        const features = parsed.features ?? (parsed.epic ? [{ stories: parsed.epic.stories ?? [] }] : [{ stories: parsed.stories ?? [] }]);
        for (const f of features) {
          for (const s of (f.stories ?? [])) {
            if (targetKey && s.key !== targetKey) continue;
            const ac = (s.acceptanceCriteria ?? []).slice(0, 3).map((a: string) => `  - ${a}`).join('\n');
            stories.push(`### ${s.key ?? ''} ${s.title} (${s.storyPoints ?? '?'}pt)\n${s.userStory ?? ''}\n${ac}`);
          }
        }
        if (stories.length > 0) sections.push('', '## Stories & Acceptance Criteria', stories.slice(0, 5).join('\n\n'));
      }
    } catch { /* backlog missing or malformed */ }

    // ── QA test cases ──────────────────────────────────────────────────────
    try {
      const row = db.prepare<[string], { file_path: string }>(
        `SELECT a.file_path FROM artifacts a JOIN sessions s ON a.session_id = s.id
         WHERE s.workflow_id = ? AND a.type = 'qa_tests' ORDER BY a.created_at DESC LIMIT 1`
      ).get(workflowId);
      if (row?.file_path && fs.existsSync(row.file_path)) {
        const raw = fs.readFileSync(row.file_path, 'utf-8').replace(/^```(?:json)?\s*/m, '').replace(/\n?```\s*$/m, '').trim();
        const qa = JSON.parse(raw);
        const cases = (qa.test_cases ?? []).slice(0, 10).map((tc: any) =>
          `  ${tc.id} [${tc.priority}/${tc.type}]: ${tc.title}`
        ).join('\n');
        if (cases) sections.push('', '## QA Test Cases (implement tests matching these TC-IDs)', cases);
      }
    } catch { /* qa artifact missing */ }

    // ── Tech stack context file ────────────────────────────────────────────
    try {
      const techStackPath = path.join(CONTEXT_DIR, 'tech-stack.md');
      if (fs.existsSync(techStackPath)) {
        sections.push('', '## Tech Stack', fs.readFileSync(techStackPath, 'utf-8').slice(0, 1500));
      }
    } catch { /* context file missing */ }

    // ── Implementation instructions ────────────────────────────────────────
    sections.push(
      '',
      '## Instructions',
      '1. Use Glob to explore the project structure and understand existing patterns',
      '2. Read key source files relevant to this feature',
      '3. Implement the first story following existing code conventions',
      '4. Write or update tests using TC-IDs from the QA section above',
      '5. Summarise what you changed and which files were modified',
    );

    return res.json({ prompt: sections.join('\n'), workflowId, title });
  } catch (err: any) {
    logger.error('Failed to build ticket context', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/workflow/:id/pipeline-result
 *
 * Called by the CI pipeline (or demo script) to report progress or final
 * results. Creates a new pipeline_runs row on first call (status=running),
 * then upserts on subsequent calls to advance stage or mark complete.
 *
 * Body: {
 *   stage?:       'triggered' | 'cloning' | 'analyzing' | 'generating' | 'pr_created',
 *   status?:      'running' | 'complete' | 'failed',
 *   prUrl?:       string,
 *   branch?:      string,
 *   pipelineId?:  string,
 *   testResults?: { passed: number, failed: number, total: number,
 *                   cases: Array<{ id, title, passed, type, priority }> }
 * }
 */
aiCodingRoutes.post('/workflow/:id/pipeline-result', (req: Request, res: Response) => {
  const workflowId = req.params.id;
  const { stage = 'triggered', status = 'running', prUrl, branch, pipelineId, testResults } = req.body ?? {};
  const now = Date.now();

  try {
    const workflow = db.prepare<[string], { id: string }>('SELECT id FROM workflows WHERE id = ?').get(workflowId);
    if (!workflow) return res.status(404).json({ error: 'Workflow not found' });

    const existing = db.prepare<[string], { id: number }>(
      'SELECT id FROM pipeline_runs WHERE workflow_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(workflowId);

    if (existing) {
      db.prepare(
        `UPDATE pipeline_runs SET stage=?, status=?, pr_url=COALESCE(?,pr_url),
         branch=COALESCE(?,branch), pipeline_id=COALESCE(?,pipeline_id),
         test_results=COALESCE(?,test_results), updated_at=? WHERE id=?`
      ).run(stage, status, prUrl ?? null, branch ?? null, pipelineId ?? null,
            testResults ? JSON.stringify(testResults) : null, now, existing.id);
    } else {
      db.prepare(
        `INSERT INTO pipeline_runs (workflow_id,stage,status,pr_url,branch,pipeline_id,test_results,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).run(workflowId, stage, status, prUrl ?? null, branch ?? null, pipelineId ?? null,
            testResults ? JSON.stringify(testResults) : null, now, now);
    }

    if (status === 'complete') {
      insertEvent(workflowId, 'pipeline_complete', null,
        `Pipeline complete — ${testResults?.passed ?? 0}/${testResults?.total ?? 0} tests passed${prUrl ? ` — PR: ${prUrl}` : ''}`,
        { pr_url: prUrl, branch, test_results: testResults }
      );
    }

    logger.info(`Pipeline result for ${workflowId}: stage=${stage} status=${status}`);
    return res.json({ ok: true });
  } catch (err: any) {
    logger.error('Failed to store pipeline result', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/workflow/:id/pipeline-media
 *
 * Receives a base64-encoded screenshot or video from the demo pipeline and
 * saves it to data/pipeline-media/<workflowId>/<filename>.
 * Returns { url } where url is the path to serve the file.
 */
aiCodingRoutes.post('/workflow/:id/pipeline-media', (req: Request, res: Response) => {
  const workflowId = req.params.id;
  const { type, filename, data } = req.body ?? {};
  if (!filename || !data) return res.status(400).json({ error: 'filename and data required' });

  try {
    const safeFilename = path.basename(filename).replace(/[^a-z0-9._-]/gi, '-');
    const mediaDir = path.join(PROJECT_ROOT, 'data', 'pipeline-media', workflowId);
    fs.mkdirSync(mediaDir, { recursive: true });
    fs.writeFileSync(path.join(mediaDir, safeFilename), Buffer.from(data, 'base64'));
    logger.info(`Saved pipeline media: ${workflowId}/${safeFilename} (${type})`);
    return res.json({ url: `/api/pipeline-media/${workflowId}/${safeFilename}` });
  } catch (err: any) {
    logger.error('Failed to save pipeline media', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/pipeline-media/:workflowId/:filename
 *
 * Serves screenshot and video files saved by the demo pipeline.
 */
aiCodingRoutes.get('/pipeline-media/:workflowId/:filename', (req: Request, res: Response) => {
  const { workflowId, filename } = req.params;
  const safeFilename = path.basename(filename);
  const filePath = path.join(PROJECT_ROOT, 'data', 'pipeline-media', workflowId, safeFilename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
  const ext = path.extname(safeFilename).toLowerCase();
  const contentType = ext === '.webm' ? 'video/webm' : ext === '.mp4' ? 'video/mp4' : 'image/png';
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(filePath);
});

/**
 * GET /api/workflow/:id/pipeline-runs
 *
 * Returns the latest pipeline run for a workflow, or null if none exists.
 * Polled by PipelineStatusSection every few seconds to detect real results.
 */
aiCodingRoutes.get('/workflow/:id/pipeline-runs', (req: Request, res: Response) => {
  const workflowId = req.params.id;
  try {
    const run = db.prepare<[string], {
      id: number; workflow_id: string; stage: string; status: string;
      pr_url: string | null; branch: string | null; pipeline_id: string | null;
      test_results: string | null; created_at: number; updated_at: number;
    }>('SELECT * FROM pipeline_runs WHERE workflow_id = ? ORDER BY created_at DESC LIMIT 1').get(workflowId);

    return res.json({ run: run ?? null });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});
