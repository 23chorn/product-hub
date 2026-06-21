import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import type { WorkflowRow } from '../../stores/workflowStore';

interface ArtifactSyncActionsProps {
  artifactType: string;
  activeWorkflow: WorkflowRow | null;
  /** True when the backlog/epic_features artifact may be pushed to the board. */
  showPushButton: boolean;
  /** True when the QA tests artifact may be pushed to test plans. */
  showTestPlanButton: boolean;
  /** True when a document artifact (research/PRD/architecture) may be synced to the wiki. */
  showWikiSyncButton: boolean;
  onMessage: (content: string) => void;
  onError: (msg: string) => void;
}

const spinner = (
  <svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

/**
 * Header actions that push an artifact to external systems: backlog → ADO board,
 * QA tests → ADO test plans, documents → wiki. Owns its own push state and the
 * "already-synced" mapping lookups; reports outcomes up via onMessage/onError.
 */
export function ArtifactSyncActions({
  artifactType,
  activeWorkflow,
  showPushButton,
  showTestPlanButton,
  showWikiSyncButton,
  onMessage,
  onError,
}: ArtifactSyncActionsProps) {
  const [pushLoading, setPushLoading] = useState(false);
  const [pushResult, setPushResult] = useState<{ epicUrl: string; featureCount?: number; storyCount?: number; created?: number; updated?: number; synced?: boolean } | null>(null);
  const [testPlanPushLoading, setTestPlanPushLoading] = useState(false);
  const [testPlanResult, setTestPlanResult] = useState<{ planUrl: string; created: number; updated: number } | null>(null);
  const [hasTestPlanMappings, setHasTestPlanMappings] = useState(false);
  const [hasAdoMappings, setHasAdoMappings] = useState(false);
  const [wikiSyncLoading, setWikiSyncLoading] = useState(false);
  const [wikiSyncResult, setWikiSyncResult] = useState<{ synced: number; results: Array<{ stage: string; pageName: string; url: string }> } | null>(null);

  // Look up existing mappings so buttons read "Sync" vs "Push"
  useEffect(() => {
    if (!activeWorkflow) return;
    let stale = false;
    api.getAdoMappings(activeWorkflow.id)
      .then(({ hasMappings }) => { if (!stale) setHasAdoMappings(hasMappings); })
      .catch(() => {});
    api.getQATestPlanMappings(activeWorkflow.id)
      .then(({ hasMappings }) => { if (!stale) setHasTestPlanMappings(hasMappings); })
      .catch(() => {});
    return () => { stale = true; };
  }, [activeWorkflow?.id]);

  async function pushToBoard() {
    if (!activeWorkflow) return;
    setPushLoading(true);
    try {
      const result = await api.pushToBoard(activeWorkflow.id);
      setPushResult(result);
      const msg = result.synced
        ? `Backlog synced to board: **${result.updated ?? 0} updated**, **${result.created ?? 0} created**. [View in Azure DevOps](${result.epicUrl})`
        : `Backlog pushed to board: **Epic #${result.epicId}** with ${result.featureCount} features and ${result.storyCount} stories. [View in Azure DevOps](${result.epicUrl})`;
      onMessage(msg);
    } catch (err: any) {
      onError(err.response?.data?.error ?? err.message ?? 'Failed to push to board');
    } finally {
      setPushLoading(false);
    }
  }

  async function pushToTestPlans() {
    if (!activeWorkflow) return;
    setTestPlanPushLoading(true);
    try {
      const result = await api.pushToTestPlans(activeWorkflow.id);
      setTestPlanResult(result);
      const wasSync = hasTestPlanMappings;
      setHasTestPlanMappings(true);
      const msg = wasSync
        ? `Test plan synced: **${result.updated} updated**, **${result.created} created**. [View in ADO](${result.planUrl})`
        : `Test plan created with **${result.testCaseCount} test cases**. [View in ADO](${result.planUrl})`;
      onMessage(msg);
    } catch (err: any) {
      onError(err.response?.data?.error ?? err.message ?? 'Failed to push test plan');
    } finally {
      setTestPlanPushLoading(false);
    }
  }

  async function syncToWiki() {
    if (!activeWorkflow) return;
    setWikiSyncLoading(true);
    try {
      // Determine which stage to sync based on artifact type
      const stageMap: Record<string, string> = {
        research: 'analyst',
        prd: 'pm_prd',
        architecture: 'solution_architect',
      };
      const stage = stageMap[artifactType];
      const result = await api.syncToWiki(activeWorkflow.id, stage ? [stage] : undefined);
      setWikiSyncResult(result);
      const msg = result.results.length > 0
        ? `Wiki synced: ${result.results.map(r => `[${r.pageName}](${r.url})`).join(', ')}`
        : 'Wiki sync completed';
      onMessage(msg);
    } catch (err: any) {
      onError(err.response?.data?.error ?? err.message ?? 'Failed to sync to wiki');
    } finally {
      setWikiSyncLoading(false);
    }
  }

  return (
    <>
      {showPushButton && !pushResult && (
        <button
          onClick={pushToBoard}
          disabled={pushLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-brand-600 hover:bg-brand-700 disabled:bg-surface-300 dark:disabled:bg-surface-700 text-white transition-colors"
        >
          {pushLoading ? (
            <>{spinner}Pushing...</>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              {hasAdoMappings ? 'Sync to Board' : 'Push to Board'}
            </>
          )}
        </button>
      )}
      {pushResult && (
        <a
          href={pushResult.epicUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          {pushResult.synced
            ? `Synced (${pushResult.updated ?? 0} updated, ${pushResult.created ?? 0} new)`
            : `View in Board (${pushResult.featureCount}F / ${pushResult.storyCount}S)`
          }
        </a>
      )}
      {showTestPlanButton && !testPlanResult && (
        <button
          onClick={pushToTestPlans}
          disabled={testPlanPushLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-brand-600 hover:bg-brand-700 disabled:bg-surface-300 dark:disabled:bg-surface-700 text-white transition-colors"
        >
          {testPlanPushLoading ? (
            <>{spinner}Pushing...</>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              {hasTestPlanMappings ? 'Sync Test Plan' : 'Push to Test Plans'}
            </>
          )}
        </button>
      )}
      {testPlanResult && (
        <a
          href={testPlanResult.planUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          View Test Plan ↗
        </a>
      )}
      {showWikiSyncButton && !wikiSyncResult && (
        <button
          onClick={syncToWiki}
          disabled={wikiSyncLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-cyan-600 hover:bg-cyan-700 disabled:bg-surface-300 dark:disabled:bg-surface-700 text-white transition-colors"
        >
          {wikiSyncLoading ? (
            <>{spinner}Syncing...</>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              Sync to Wiki
            </>
          )}
        </button>
      )}
      {wikiSyncResult && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Synced to Wiki
        </div>
      )}
    </>
  );
}
