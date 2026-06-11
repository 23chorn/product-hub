import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import * as fsAsync from 'fs/promises';
import { generateDemoProject, generateSimpleFeature } from '../agents/demo-project-agent';
import { runDemoScript, getRunState, getDemoProjectPath } from '../demo/demo-runner';
import Logger from '../utils/logger';

const logger = new Logger('DEMO-PROJECT-ROUTES');
export const demoProjectRoutes = Router();

const PROJECT_ROOT = path.resolve(__dirname, '../../../../');
const DEMOS_DIR    = path.join(PROJECT_ROOT, 'data/demos');

// In-memory status store (survives the SSE stream lifecycle)
const projectStatus = new Map<string, { phase: string; message: string; projectPath?: string; error?: string }>();

/**
 * POST /api/workflow/:id/demo-project/generate
 * Kicks off background generation, returns immediately.
 */
demoProjectRoutes.post('/workflow/:id/demo-project/generate', async (req: Request, res: Response) => {
  const { id } = req.params;
  projectStatus.set(id, { phase: 'queued', message: 'Queued…' });

  generateDemoProject(id, (status) => {
    projectStatus.set(id, status);
  }).catch(err => {
    logger.error(`Demo project generation failed for ${id}: ${err.message}`);
    projectStatus.set(id, { phase: 'error', message: err.message, error: err.message });
  });

  res.json({ ok: true });
});

/**
 * GET /api/workflow/:id/demo-project/status
 * Returns current generation status.
 */
demoProjectRoutes.get('/workflow/:id/demo-project/status', (req: Request, res: Response) => {
  const { id } = req.params;
  const status = projectStatus.get(id) ?? { phase: 'idle', message: '' };
  res.json(status);
});

/**
 * GET /api/workflow/:id/demo-project/download
 * Streams the project as a zip archive.
 */
demoProjectRoutes.get('/workflow/:id/demo-project/download', async (req: Request, res: Response) => {
  const { id } = req.params;
  const projectDir = path.join(DEMOS_DIR, id);

  if (!fs.existsSync(projectDir)) {
    return res.status(404).json({ error: 'Project not generated yet' });
  }

  try {
    // Zip via shell (no external archiver dep needed)
    const { execSync } = await import('child_process');
    const zipPath = path.join(DEMOS_DIR, `${id}.zip`);
    execSync(`cd "${projectDir}" && zip -r "${zipPath}" .`, { stdio: 'pipe' });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${id}.zip"`);
    fs.createReadStream(zipPath).pipe(res);
  } catch (err: any) {
    logger.error(`Download failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/workflow/:id/demo-project/files
 * Returns the list of generated file paths relative to the project root.
 */
demoProjectRoutes.get('/workflow/:id/demo-project/files', async (req: Request, res: Response) => {
  const { id } = req.params;
  const projectDir = path.join(DEMOS_DIR, id);

  if (!fs.existsSync(projectDir)) {
    return res.json({ files: [] });
  }

  const walk = async (dir: string, base: string): Promise<string[]> => {
    const results: string[] = [];
    for (const entry of await fsAsync.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel  = path.join(base, entry.name);
      if (entry.isDirectory() && entry.name !== 'node_modules') {
        results.push(...await walk(full, rel));
      } else if (entry.isFile()) {
        results.push(rel);
      }
    }
    return results;
  };

  const files = await walk(projectDir, '');
  res.json({ files, projectDir });
});

/**
 * GET /api/workflow/:id/demo-project/file?path=src/App.tsx
 * Returns the content of a single file.
 */
demoProjectRoutes.get('/workflow/:id/demo-project/file', async (req: Request, res: Response) => {
  const { id } = req.params;
  const relPath = req.query.path as string;
  if (!relPath) return res.status(400).json({ error: 'path required' });

  const filePath = path.join(DEMOS_DIR, id, relPath);
  if (!filePath.startsWith(path.join(DEMOS_DIR, id))) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  try {
    const content = await fsAsync.readFile(filePath, 'utf-8');
    res.json({ content, path: relPath });
  } catch {
    res.status(404).json({ error: 'File not found' });
  }
});

/**
 * POST /api/demo-project/quick-test
 * Generates a hardcoded demo project instantly (no LLM, no workflow).
 * Useful for testing the file-write pipeline. Body: { feature?: 'counter' | 'todo' }
 */
demoProjectRoutes.post('/demo-project/quick-test', async (req: Request, res: Response) => {
  const feature = (req.body?.feature as string) || 'counter';
  try {
    const result = await generateSimpleFeature(feature as any);
    projectStatus.set(result.workflowId, {
      phase: 'done',
      message: 'Quick-test project ready',
      projectPath: result.projectPath,
    });
    res.json({ workflowId: result.workflowId, phase: 'done', projectPath: result.projectPath });
  } catch (err: any) {
    logger.error(`Quick test generation failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/workflow/:id/demo-project/run
 * Triggers `npm run demo` in DEMO_PROJECT_PATH (fire-and-forget).
 */
demoProjectRoutes.post('/workflow/:id/demo-project/run', (req: Request, res: Response) => {
  const { id } = req.params;
  if (!getDemoProjectPath()) {
    return res.status(400).json({ error: 'DEMO_PROJECT_PATH is not configured in .env' });
  }
  // Fire-and-forget — client polls /run/status
  runDemoScript(id).catch(err =>
    logger.error(`Demo run failed for ${id}: ${err.message}`)
  );
  res.json({ ok: true, workflowId: id });
});

/**
 * GET /api/workflow/:id/demo-project/run/status
 * Returns current run state (status, lines, exitCode).
 */
demoProjectRoutes.get('/workflow/:id/demo-project/run/status', (req: Request, res: Response) => {
  const { id } = req.params;
  const state = getRunState(id);
  res.json({
    ...state,
    configured: !!getDemoProjectPath() && process.env.DEMO_CODE_PIPELINE_ENABLED === 'true',
  });
});
