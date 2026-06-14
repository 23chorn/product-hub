/**
 * Shared types, constants, and helpers for the pipeline status panel and its
 * sub-components (StageIndicator, CheckSuiteRow, CollapsiblePanel, TestDetailsModal).
 */
export interface TestCase {
  id: string;
  title: string;
  type: 'happy_path' | 'bad_path' | 'edge_case' | string;
  priority: 'critical' | 'high' | 'medium' | 'low' | string;
  category?: string;
}

export interface TestResult {
  id: string;
  title: string;
  passed: boolean;
  type: string;
  priority: string;
}

export interface MediaItem {
  type: 'video' | 'screenshot';
  url: string;
  name: string;
}

export interface RealTestResults {
  passed: number;
  failed: number;
  total: number;
  cases: TestResult[];
  media?: MediaItem[];
}

export interface PipelineRun {
  id: number;
  stage: string;
  status: 'running' | 'complete' | 'failed';
  pr_url: string | null;
  branch: string | null;
  pipeline_id: string | null;
  test_results: string | null;
}

export type PipelineStage = 'idle' | 'triggered' | 'cloning' | 'analyzing' | 'generating' | 'pr_created';
export type SuiteState = 'idle' | 'running' | 'done';

// ── Constants ─────────────────────────────────────────────────────────────────

export const STAGE_ORDER: PipelineStage[] = ['triggered', 'cloning', 'analyzing', 'generating', 'pr_created'];

export const STAGE_DELAYS: Record<PipelineStage, number> = {
  idle: 0, triggered: 800, cloning: 3500, analyzing: 7000, generating: 13000, pr_created: 22000,
};

export const STAGE_LABELS: Record<PipelineStage, string> = {
  idle:       '',
  triggered:  'Pipeline triggered',
  cloning:    'Cloning repository…',
  analyzing:  'Reading ticket context…',
  generating: 'Writing implementation…',
  pr_created: 'PR created — ready for review',
};

export const SUITE_START: Record<string, number> = { ios: 300, android: 900, backend: 1600 };
export const SUITE_DONE:  Record<string, number> = { ios: 4200, android: 5800, backend: 7200 };
export const TESTS_START_AFTER_PR = 7500;

export const MOCK_TEST_CASES: TestCase[] = [
  { id: 'TC-001', title: 'User can send a message in a chat room',           type: 'happy_path', priority: 'critical' },
  { id: 'TC-002', title: 'Ticker card renders with live price data',          type: 'happy_path', priority: 'critical' },
  { id: 'TC-003', title: 'Chat room loads within 2s on 4G',                   type: 'happy_path', priority: 'high'     },
  { id: 'TC-004', title: 'User receives push notification for new message',   type: 'happy_path', priority: 'high'     },
  { id: 'TC-005', title: 'Message fails gracefully on network drop',          type: 'bad_path',   priority: 'high'     },
  { id: 'TC-006', title: 'Invalid ticker symbol shows error state',           type: 'bad_path',   priority: 'medium'   },
  { id: 'TC-007', title: '500 concurrent users — latency under 500ms',        type: 'edge_case',  priority: 'critical' },
  { id: 'TC-008', title: 'Message history truncates at 1000 items',           type: 'edge_case',  priority: 'medium'   },
  { id: 'TC-009', title: 'Chat room with 0 members shows empty state',        type: 'edge_case',  priority: 'low'      },
  { id: 'TC-010', title: 'Content moderation flag blocks delivery',           type: 'bad_path',   priority: 'critical' },
  { id: 'TC-011', title: 'VoiceOver reads message content correctly',         type: 'edge_case',  priority: 'medium'   },
  { id: 'TC-012', title: 'Back gesture closes chat without data loss',        type: 'happy_path', priority: 'high'     },
  { id: 'TC-013', title: 'Message retention — 7-year archive query succeeds', type: 'edge_case',  priority: 'critical' },
  { id: 'TC-014', title: 'Room join link expires after 24 hours',             type: 'bad_path',   priority: 'medium'   },
];

export const PRIORITY_COLOR: Record<string, string> = {
  critical: 'text-red-600 dark:text-red-400',
  high:     'text-amber-600 dark:text-amber-400',
  medium:   'text-blue-600 dark:text-blue-400',
  low:      'text-slate-400 dark:text-slate-500',
};

export const TYPE_LABEL: Record<string, string> = { happy_path: 'happy', bad_path: 'bad', edge_case: 'edge' };

export const TYPE_COLOR: Record<string, string> = {
  happy_path: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
  bad_path:   'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400',
  edge_case:  'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

export function suiteForTest(idx: number): string {
  return ['ios', 'android', 'backend'][idx % 3];
}

export function assignResults(tests: TestCase[]): Map<string, boolean> {
  const results = new Map<string, boolean>();
  const failCount = Math.max(2, Math.floor(tests.length * 0.13));
  const failSet = new Set(
    [...tests]
      .filter(t => !(t.type === 'happy_path' && t.priority === 'critical'))
      .slice(-failCount)
      .map(t => t.id)
  );
  for (const t of tests) results.set(t.id, !failSet.has(t.id));
  return results;
}

export function deriveNumbers(workflowId: string) {
  const hex = workflowId.replace(/-/g, '');
  const pipeNum = (parseInt(hex.slice(4, 8), 16) % 850) + 100;
  return { pipeNum };
}

export function slugify(text: string) {
  return 'feat/' + text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}
