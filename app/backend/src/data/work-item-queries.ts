/**
 * work-item-queries — shared raw-row fetchers for ado_work_item_map / qa_test_plan_map
 * and the document-artifact-id resolution they depend on. Used by both the
 * completed-initiatives review page and the dev/QA ticket export route so the two
 * agree on how an item's pushed tickets and produced documents are found. Pure reads,
 * no "completed"/archived gating — callers decide which items qualify for their view.
 */
import db from './database';

export interface AdoWorkItemRow {
  itemId: string;
  ado_id: number;
  ado_type: 'epic' | 'feature' | 'story';
  ado_url: string | null;
  local_key: string;
  parent_local_key: string | null;
  title: string;
  state: string | null;
  state_synced_at: number | null;
  artifact_id: number | null;
  created_at: number;
}

export interface QaTestPlanRow {
  itemId: string;
  plan_id: number;
  plan_url: string;
  test_case_count: number | null;
  artifact_id: number | null;
}

/** All ado_work_item_map rows across every workflow of each item, grouped by item id. */
export function getWorkItemRowsByItem(itemIds: string[]): Map<string, AdoWorkItemRow[]> {
  const map = new Map<string, AdoWorkItemRow[]>();
  if (itemIds.length === 0) return map;
  const rows = db.prepare(`
    SELECT w.item_id as itemId, m.ado_id, m.ado_type, m.ado_url, m.local_key, m.parent_local_key, m.title, m.state, m.state_synced_at, m.artifact_id, m.created_at
    FROM ado_work_item_map m
    JOIN workflows w ON w.id = m.workflow_id
    WHERE w.item_id IN (${itemIds.map(() => '?').join(',')})
  `).all(...itemIds) as AdoWorkItemRow[];
  for (const row of rows) {
    if (!map.has(row.itemId)) map.set(row.itemId, []);
    map.get(row.itemId)!.push(row);
  }
  return map;
}

/** All qa_test_plan_map rows across every workflow of each item, grouped by item id. */
export function getTestPlanRowsByItem(itemIds: string[]): Map<string, QaTestPlanRow[]> {
  const map = new Map<string, QaTestPlanRow[]>();
  if (itemIds.length === 0) return map;
  const rows = db.prepare(`
    SELECT w.item_id as itemId, q.plan_id, q.plan_url, q.test_case_count, q.artifact_id
    FROM qa_test_plan_map q
    JOIN workflows w ON w.id = q.workflow_id
    WHERE w.item_id IN (${itemIds.map(() => '?').join(',')})
  `).all(...itemIds) as QaTestPlanRow[];
  for (const row of rows) {
    if (!map.has(row.itemId)) map.set(row.itemId, []);
    map.get(row.itemId)!.push(row);
  }
  return map;
}

/**
 * Document artifact ids for an item's produced documents, resolved independent of the ADO
 * push-tracking tables above. `ado_work_item_map.artifact_id` / `qa_test_plan_map.artifact_id`
 * are unreliable: the multi-feature push path (feature-decomposition.ts pushEpicAndFeaturesToADO
 * / pushFeatureToADO, used by every epic_feature_planner-based workflow) hardcodes them to NULL
 * for every epic/feature/story/test-plan row it inserts — it was simply never wired up there.
 * So every document here is instead resolved straight from artifacts/checkpoints:
 *  - research/PRD/architecture/figma: whole-initiative documents, one each — "latest artifact
 *    of this type for this item" (same query pushTestPlanToAdo's qa_tests lookup already uses).
 *  - tickets: the single backlog_merge output ('backlog' type) already combines every feature,
 *    so no per-feature merge is needed here the way the frontend has to for QA.
 *  - test cases: qa_tests is not a per-feature-suffixed type (unlike backlog_F<n>), so "latest"
 *    alone can't be trusted to mean "every feature's latest" — resolve one artifact id per
 *    story_decomposition_F<n>_qa checkpoint (legacy per-feature QA) plus the epic_qa checkpoint
 *    (current epic-level QA), mirroring how pushFeatureToADO itself looks up a single feature's
 *    QA checkpoint (feature-decomposition.ts).
 */
export function getDocumentArtifactIds(itemId: string): {
  researchArtifactId: number | null;
  prdArtifactId: number | null;
  architectureArtifactId: number | null;
  figmaArtifactId: number | null;
  epicFeaturesArtifactId: number | null;
  ticketArtifactId: number | null;
  testArtifactIds: number[];
} {
  const latestOfType = (types: string[]): number | null => {
    const row = db.prepare(`
      SELECT a.id FROM artifacts a
      JOIN sessions s ON a.session_id = s.id
      WHERE s.item_id = ? AND a.type IN (${types.map(() => '?').join(',')})
      ORDER BY a.created_at DESC LIMIT 1
    `).get(itemId, ...types) as { id: number } | undefined;
    return row?.id ?? null;
  };

  const qaCheckpointRows = db.prepare(`
    SELECT c.stage, c.artifact_id, c.created_at
    FROM checkpoints c
    JOIN workflows w ON w.id = c.workflow_id
    WHERE w.item_id = ? AND c.status = 'approved' AND c.artifact_id IS NOT NULL
  `).all(itemId) as Array<{ stage: string; artifact_id: number; created_at: number }>;

  const latestQaPerFeature = new Map<string, { artifact_id: number; created_at: number }>();
  for (const row of qaCheckpointRows) {
    const perFeatureMatch = /^story_decomposition_F(\d+)_qa$/.exec(row.stage);
    const key = perFeatureMatch ? perFeatureMatch[1] : row.stage === 'epic_qa' ? 'epic' : null;
    if (!key) continue;
    const existing = latestQaPerFeature.get(key);
    if (!existing || row.created_at > existing.created_at) latestQaPerFeature.set(key, row);
  }

  return {
    researchArtifactId: latestOfType(['analyst', 'research']),
    prdArtifactId: latestOfType(['prd']),
    architectureArtifactId: latestOfType(['architecture']),
    figmaArtifactId: latestOfType(['figma_design']),
    epicFeaturesArtifactId: latestOfType(['epic_features']),
    ticketArtifactId: latestOfType(['backlog']),
    testArtifactIds: Array.from(latestQaPerFeature.values()).map(r => r.artifact_id),
  };
}
