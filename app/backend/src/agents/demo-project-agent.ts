/**
 * Demo Project Agent
 *
 * Generates a real Vite + React + Tailwind + Playwright project from a completed
 * workflow's artifacts. Reads the PRD, backlog, and QA test cases, then asks the
 * LLM to write App.tsx and a Playwright test file. Merges with the fixed template
 * in agents/templates/project-template/ and writes to data/demos/<workflowId>/.
 *
 * The generated project is runnable: `npm install && npm run dev`
 */

import * as fs from 'fs';
import * as fsAsync from 'fs/promises';
import * as path from 'path';
import db from '../data/database';
import { streamAI, resolveAgentModel } from '../utils/ai-provider';
import { getLatestArtifactPathByType } from './artifact-helpers';
import Logger from '../utils/logger';

const logger = new Logger('DEMO-PROJECT');

const PROJECT_ROOT  = path.resolve(__dirname, '../../../../');
const TEMPLATE_DIR  = path.join(PROJECT_ROOT, 'agents/templates/project-template');
const DEMOS_DIR     = path.join(PROJECT_ROOT, 'data/demos');

// ── Types ────────────────────────────────────────────────────────────────────

export interface DemoProjectStatus {
  phase: 'queued' | 'generating' | 'writing' | 'done' | 'error';
  message: string;
  projectPath?: string;
  error?: string;
}

type StatusCallback = (status: DemoProjectStatus) => void;

// ── Helpers ──────────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

function loadArtifactText(filePath: string): string {
  try { return fs.readFileSync(filePath, 'utf-8'); } catch { return ''; }
}

function extractField(content: string, label: string): string {
  const re = new RegExp(`##\\s+${label}[\\s\\S]*?(?=\\n##|$)`, 'i');
  const m = content.match(re);
  return m ? m[0].slice(0, 1500) : content.slice(0, 1500);
}

interface QATestCase {
  id: string;
  title: string;
  type: string;
  priority: string;
  given?: string;
  when?: string;
  then?: string;
}

function extractTestCases(qaContent: string): QATestCase[] {
  try {
    const json = JSON.parse(qaContent);
    const cases: QATestCase[] = json.test_cases ?? json.testCases ?? json.tests ?? [];
    return cases.slice(0, 12);
  } catch {
    return [];
  }
}

async function copyTemplate(dest: string, title: string, slug: string): Promise<void> {
  const walk = async (src: string, dst: string) => {
    await fsAsync.mkdir(dst, { recursive: true });
    for (const entry of await fsAsync.readdir(src, { withFileTypes: true })) {
      const s = path.join(src, entry.name);
      const d = path.join(dst, entry.name);
      if (entry.isDirectory()) {
        await walk(s, d);
      } else {
        let content = await fsAsync.readFile(s, 'utf-8');
        content = content.replace(/\{\{PROJECT_TITLE\}\}/g, title);
        content = content.replace(/\{\{PROJECT_SLUG\}\}/g, slug);
        await fsAsync.writeFile(d, content, 'utf-8');
      }
    }
  };
  await walk(TEMPLATE_DIR, dest);
}

// ── LLM generation ────────────────────────────────────────────────────────────

async function generateAppTsx(
  goal: string,
  prdSummary: string,
  storySummary: string,
): Promise<string> {
  const prompt = `You are generating a demo React web application.

Initiative: ${goal}

PRD summary:
${prdSummary}

Key user stories:
${storySummary}

Write a complete, self-contained src/App.tsx React component that:
1. Demonstrates the core user journey for this feature
2. Uses React hooks (useState, useEffect where appropriate)
3. Uses Tailwind CSS for all styling — make it look polished and professional
4. Has realistic mock data hardcoded (no fetch calls, no external APIs)
5. Includes 2–4 meaningful UI states (e.g. loading, empty, populated, error)
6. Has clear section headings, proper spacing, and a consistent colour scheme

Rules:
- Output ONLY valid TypeScript/TSX — no markdown fences, no explanation
- Start with imports, end with export default
- Self-contained: no imports other than react and react-dom
- Use Tailwind classes directly on JSX elements`;

  let output = '';
  for await (const token of streamAI(
    resolveAgentModel('analyst'),
    'You write clean, production-quality React TypeScript components.',
    [{ role: 'user', content: prompt }],
    4000,
  )) {
    output += token;
  }

  // Strip any accidental markdown fences
  return output
    .replace(/^```(?:tsx?|javascript|jsx?)?\s*/m, '')
    .replace(/\n?```\s*$/m, '')
    .trim();
}

async function generatePlaywrightTests(
  goal: string,
  testCases: QATestCase[],
): Promise<string> {
  const caseList = testCases.map(tc => {
    const steps = [
      tc.given ? `    Given: ${tc.given}` : '',
      tc.when  ? `    When:  ${tc.when}`  : '',
      tc.then  ? `    Then:  ${tc.then}`  : '',
    ].filter(Boolean).join('\n');
    return `  ${tc.id} [${tc.priority}/${tc.type}]: ${tc.title}\n${steps}`;
  }).join('\n\n');

  const prompt = `Write Playwright tests for this web app.

App: ${goal}

Test cases to implement:
${caseList}

Rules:
- Use @playwright/test (import { test, expect } from '@playwright/test')
- Name each test exactly as 'TC-XXX — <title>' matching the TC-IDs above
- Tests run against http://localhost:5173 (use page.goto('/'))
- Use realistic selectors (getByRole, getByText, getByLabel, getByPlaceholder)
- Each test should be independent and meaningful — actually test the behaviour
- Keep tests concise (5–15 lines each)
- Output ONLY valid TypeScript — no markdown fences, no explanation`;

  let output = '';
  for await (const token of streamAI(
    resolveAgentModel('analyst'),
    'You write precise, well-structured Playwright end-to-end tests.',
    [{ role: 'user', content: prompt }],
    3000,
  )) {
    output += token;
  }

  return output
    .replace(/^```(?:ts?|javascript)?\s*/m, '')
    .replace(/\n?```\s*$/m, '')
    .trim();
}

// ── Simple hardcoded features for instant testing ─────────────────────────────

const SIMPLE_FEATURES: Record<string, { title: string; appTsx: string; specTs: string }> = {
  counter: {
    title: 'Click Counter',
    appTsx: `import { useState } from 'react';

export default function App() {
  const [count, setCount] = useState(0);
  const [history, setHistory] = useState<{ action: string; value: number; at: string }[]>([]);

  const record = (action: string, next: number) => {
    setHistory(h => [{ action, value: next, at: new Date().toLocaleTimeString() }, ...h].slice(0, 10));
  };

  const inc = () => { const n = count + 1; setCount(n); record('increment', n); };
  const dec = () => { const n = count - 1; setCount(n); record('decrement', n); };
  const reset = () => { setCount(0); record('reset', 0); };

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center gap-8 p-8">
      <h1 className="text-3xl font-bold tracking-tight">Click Counter</h1>

      <div className="flex flex-col items-center gap-4 bg-slate-900 rounded-2xl p-10 border border-slate-800 shadow-xl">
        <span data-testid="count" className="text-8xl font-mono font-bold tabular-nums
          text-teal-400 drop-shadow-[0_0_20px_rgba(45,212,191,0.4)]">
          {count}
        </span>

        <div className="flex gap-3 mt-2">
          <button onClick={dec}
            className="px-6 py-2.5 bg-rose-600 hover:bg-rose-500 rounded-lg font-semibold transition-colors">
            − Decrement
          </button>
          <button onClick={reset}
            className="px-6 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-lg font-semibold transition-colors">
            Reset
          </button>
          <button onClick={inc}
            className="px-6 py-2.5 bg-teal-600 hover:bg-teal-500 rounded-lg font-semibold transition-colors">
            + Increment
          </button>
        </div>
      </div>

      {history.length > 0 && (
        <div className="w-full max-w-sm bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-800 text-xs font-semibold uppercase tracking-widest text-slate-500">
            History
          </div>
          <ul className="divide-y divide-slate-800/60">
            {history.map((h, i) => (
              <li key={i} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="font-mono text-slate-400">{h.action}</span>
                <span className="font-mono text-teal-400">{h.value}</span>
                <span className="text-xs text-slate-600">{h.at}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
`,
    specTs: `import { test, expect } from '@playwright/test';

test('TC-001 — counter starts at zero', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('count')).toHaveText('0');
});

test('TC-002 — increment increases count', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /increment/i }).click();
  await expect(page.getByTestId('count')).toHaveText('1');
});

test('TC-003 — decrement decreases count', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /increment/i }).click();
  await page.getByRole('button', { name: /decrement/i }).click();
  await expect(page.getByTestId('count')).toHaveText('0');
});

test('TC-004 — reset returns to zero', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /increment/i }).click();
  await page.getByRole('button', { name: /increment/i }).click();
  await page.getByRole('button', { name: /reset/i }).click();
  await expect(page.getByTestId('count')).toHaveText('0');
});

test('TC-005 — history records actions', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /increment/i }).click();
  await expect(page.getByText('increment')).toBeVisible();
});
`,
  },

  todo: {
    title: 'Task Manager',
    appTsx: `import { useState } from 'react';

interface Task { id: number; text: string; done: boolean; priority: 'high' | 'medium' | 'low' }

const PRIORITIES = ['high', 'medium', 'low'] as const;
const PRIORITY_COLORS = { high: 'bg-rose-500', medium: 'bg-amber-500', low: 'bg-teal-500' };

export default function App() {
  const [tasks, setTasks] = useState<Task[]>([
    { id: 1, text: 'Review PRD draft', done: false, priority: 'high' },
    { id: 2, text: 'Update design tokens', done: true, priority: 'medium' },
    { id: 3, text: 'Write Playwright tests', done: false, priority: 'high' },
  ]);
  const [input, setInput] = useState('');
  const [priority, setPriority] = useState<Task['priority']>('medium');
  const [filter, setFilter] = useState<'all' | 'active' | 'done'>('all');

  const add = () => {
    const text = input.trim();
    if (!text) return;
    setTasks(t => [...t, { id: Date.now(), text, done: false, priority }]);
    setInput('');
  };

  const toggle = (id: number) => setTasks(t => t.map(x => x.id === id ? { ...x, done: !x.done } : x));
  const remove  = (id: number) => setTasks(t => t.filter(x => x.id !== id));

  const visible = tasks.filter(t =>
    filter === 'all' ? true : filter === 'active' ? !t.done : t.done
  );
  const doneCount = tasks.filter(t => t.done).length;

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6 flex justify-center">
      <div className="w-full max-w-lg flex flex-col gap-5">
        <div className="flex items-baseline justify-between">
          <h1 className="text-2xl font-bold">Task Manager</h1>
          <span className="text-sm text-slate-500 font-mono">{doneCount}/{tasks.length} done</span>
        </div>

        {/* Add row */}
        <div className="flex gap-2">
          <input
            aria-label="New task"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && add()}
            placeholder="Add a task…"
            className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-sm placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
          <select
            value={priority}
            onChange={e => setPriority(e.target.value as Task['priority'])}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
          >
            {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <button onClick={add}
            className="px-4 py-2 bg-teal-600 hover:bg-teal-500 rounded-lg text-sm font-semibold transition-colors">
            Add
          </button>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 bg-slate-900 rounded-lg p-1 border border-slate-800">
          {(['all', 'active', 'done'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={\`flex-1 py-1.5 text-xs font-semibold rounded capitalize transition-colors \${filter === f ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}\`}>
              {f}
            </button>
          ))}
        </div>

        {/* Task list */}
        <ul className="flex flex-col gap-2">
          {visible.map(t => (
            <li key={t.id}
              className="flex items-center gap-3 bg-slate-900 rounded-xl px-4 py-3 border border-slate-800 group">
              <div className={\`w-1.5 h-1.5 rounded-full flex-shrink-0 \${PRIORITY_COLORS[t.priority]}\`} />
              <input type="checkbox" checked={t.done} onChange={() => toggle(t.id)}
                className="w-4 h-4 rounded accent-teal-500 flex-shrink-0" />
              <span className={\`flex-1 text-sm \${t.done ? 'line-through text-slate-600' : ''}\`}>{t.text}</span>
              <button onClick={() => remove(t.id)}
                className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-rose-400 transition-all text-xs px-1">✕</button>
            </li>
          ))}
          {visible.length === 0 && (
            <li className="text-center text-slate-600 text-sm py-8 font-mono">no tasks here</li>
          )}
        </ul>
      </div>
    </div>
  );
}
`,
    specTs: `import { test, expect } from '@playwright/test';

test('TC-001 — page loads with default tasks', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Task Manager' })).toBeVisible();
  await expect(page.getByText('Review PRD draft')).toBeVisible();
});

test('TC-002 — add a new task', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('New task').fill('Test the pipeline');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText('Test the pipeline')).toBeVisible();
});

test('TC-003 — mark task as done', async ({ page }) => {
  await page.goto('/');
  const first = page.getByRole('checkbox').first();
  await first.check();
  await expect(first).toBeChecked();
});

test('TC-004 — filter shows only active tasks', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'active' }).click();
  await expect(page.getByText('Update design tokens')).not.toBeVisible();
});

test('TC-005 — filter shows only done tasks', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'done' }).click();
  await expect(page.getByText('Update design tokens')).toBeVisible();
});
`,
  },
};

/**
 * Generate a hardcoded feature project for rapid testing — no LLM, no workflow.
 * Creates a real runnable Vite+React+Playwright project in data/demos/<testId>/.
 */
export async function generateSimpleFeature(
  featureName: keyof typeof SIMPLE_FEATURES = 'counter',
): Promise<{ workflowId: string; projectPath: string }> {
  const testId = `quick-test-${featureName}-${Date.now()}`;
  const feature = SIMPLE_FEATURES[featureName] ?? SIMPLE_FEATURES.counter;
  const dest = path.join(DEMOS_DIR, testId);
  const slug = featureName;

  await fsAsync.rm(dest, { recursive: true, force: true });
  await copyTemplate(dest, feature.title, slug);
  await fsAsync.writeFile(path.join(dest, 'src/App.tsx'), feature.appTsx, 'utf-8');
  await fsAsync.writeFile(path.join(dest, 'e2e/feature.spec.ts'), feature.specTs, 'utf-8');

  const readme = `# ${feature.title}\n\nQuick-test demo project.\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n\nTests:\n\`\`\`bash\nnpx playwright install chromium\nnpm test\n\`\`\`\n`;
  await fsAsync.writeFile(path.join(dest, 'README.md'), readme, 'utf-8');

  logger.info(`Quick-test project written to ${dest}`);
  return { workflowId: testId, projectPath: dest };
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function generateDemoProject(
  workflowId: string,
  onStatus: StatusCallback,
): Promise<string> {
  const workflow = db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId) as any;
  if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);

  const goal  = workflow.summary ?? workflow.goal.split('\n')[0].slice(0, 80);
  const slug  = slugify(goal);
  const title = goal.length > 60 ? goal.slice(0, 60) + '…' : goal;
  const dest  = path.join(DEMOS_DIR, workflowId);

  // ── Load artifacts ────────────────────────────────────────────────────────
  onStatus({ phase: 'generating', message: 'Reading workflow artifacts…' });

  const prdPath     = db.prepare(`SELECT file_path FROM artifacts a JOIN sessions s ON a.session_id = s.id WHERE s.workflow_id = ? AND a.type = 'prd' ORDER BY a.created_at DESC LIMIT 1`).get(workflowId) as any;
  const backlogPath = getLatestArtifactPathByType(workflow.item_id, 'backlog');
  const qaPath      = db.prepare(`SELECT file_path FROM artifacts a JOIN sessions s ON a.session_id = s.id WHERE s.workflow_id = ? AND a.type = 'qa_tests' ORDER BY a.created_at DESC LIMIT 1`).get(workflowId) as any;

  const prdText     = prdPath     ? loadArtifactText(prdPath.file_path)     : '';
  const backlogText = backlogPath ? loadArtifactText(backlogPath)            : '';
  const qaText      = qaPath      ? loadArtifactText(qaPath.file_path)       : '';

  const prdSummary   = prdText     ? extractField(prdText, 'Problem|Overview|Goals') : `Feature: ${goal}`;
  const storyLines   = (() => {
    try {
      const b: any = JSON.parse(backlogText);
      const stories: string[] = [];
      const features = b.features ?? (b.epic ? [{ stories: b.epic.stories ?? [] }] : [{ stories: b.stories ?? [] }]);
      for (const f of features) {
        for (const s of (f.stories ?? [])) {
          if (s.title) stories.push(`- ${s.title}`);
          if (stories.length >= 8) break;
        }
        if (stories.length >= 8) break;
      }
      return stories.join('\n') || `- Core ${goal} functionality`;
    } catch { return `- Core ${goal} functionality`; }
  })();

  const testCases = qaText ? extractTestCases(qaText) : [];

  // ── Generate App.tsx ─────────────────────────────────────────────────────
  onStatus({ phase: 'generating', message: 'Generating App.tsx…' });
  const appTsx = await generateAppTsx(goal, prdSummary, storyLines);

  // ── Generate Playwright tests ─────────────────────────────────────────────
  onStatus({ phase: 'generating', message: 'Writing Playwright test suite…' });
  const playwrightTests = await generatePlaywrightTests(goal, testCases);

  // ── Write project to disk ─────────────────────────────────────────────────
  onStatus({ phase: 'writing', message: 'Writing project files…' });

  await fsAsync.rm(dest, { recursive: true, force: true });
  await copyTemplate(dest, title, slug);

  await fsAsync.writeFile(path.join(dest, 'src/App.tsx'), appTsx, 'utf-8');
  await fsAsync.writeFile(path.join(dest, 'e2e/feature.spec.ts'), playwrightTests, 'utf-8');

  // Write a short README
  const readme = `# ${title}\n\nAI-generated demo project. Run it:\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n\nRun tests:\n\`\`\`bash\nnpx playwright install chromium\nnpm test\n\`\`\`\n`;
  await fsAsync.writeFile(path.join(dest, 'README.md'), readme, 'utf-8');

  logger.info(`Demo project written to ${dest}`);
  onStatus({ phase: 'done', message: `Project ready — ${Object.keys(await fsAsync.readdir(dest)).length} files`, projectPath: dest });

  return dest;
}
