/**
 * dev-tickets-routes — read-only ticket export for developer/QA tooling. Lets a script,
 * CI job, or IDE integration fetch everything Product Hub generated for an initiative by
 * its displayed "#<seqNum>" id, without going through Azure DevOps. ADO stays the system
 * of record for ticket state transitions, comments, and history; this just eases the
 * handoff of the generated content itself.
 *
 * No ADO calls here — ticket state is whatever was last cached by a completed-initiatives
 * refresh or the original push. Mounted at /api/dev/initiatives, under the same auth as
 * every other /api/* route (cookie session when users exist, open in no-auth mode).
 */
import { Router, Request, Response } from 'express';
import db from '../data/database';
import Logger from '../utils/logger';
import {
  tryParseBacklog, tryParseQATests, mergeQaTests, getStoryPlatforms,
  featureLocalKey, storyLocalKey, parseFeatureLocalKey, parseStoryLocalKey,
  TICKET_PLATFORMS,
  type TicketPlatform, type BacklogData, type TestCase,
} from '@pap/shared';
import { bucketWorkItemState } from '../integrations/azure-devops-format';
import { getWorkItemRowsByItem, getTestPlanRowsByItem, getDocumentArtifactIds, type AdoWorkItemRow } from '../data/work-item-queries';
import { loadArtifactContentById } from '../agents/artifact-helpers';

const logger = new Logger('DEV-TICKETS');
const router = Router();

type Mode = 'dev' | 'qa';

interface InitiativeRow {
  id: string;
  title: string;
  seq_num: number;
}

export function findInitiativeBySeqNum(seqNum: number): InitiativeRow | undefined {
  return db.prepare(`
    SELECT id, title, seq_num FROM items WHERE seq_num = ? AND status != 'archived'
  `).get(seqNum) as InitiativeRow | undefined;
}

/** Parse the `stream` query param (comma-separated and/or repeated) into a validated Set,
 *  or null when absent — null means "no filter, every stream included". Throws on a value
 *  outside TICKET_PLATFORMS so a typo'd stream name fails loudly instead of silently
 *  returning everything. */
export function parseStreamFilter(raw: unknown): Set<TicketPlatform> | null {
  if (raw == null) return null;
  const values = (Array.isArray(raw) ? raw : [raw])
    .flatMap(v => String(v).split(','))
    .map(v => v.trim().toLowerCase())
    .filter(Boolean);
  if (values.length === 0) return null;
  const invalid = values.find(v => !TICKET_PLATFORMS.includes(v as TicketPlatform));
  if (invalid) throw new Error(`Unknown stream "${invalid}" — valid values are ${TICKET_PLATFORMS.join(', ')}`);
  return new Set(values as TicketPlatform[]);
}

/** A story/test-case "matches" an active stream filter if it's tagged with one of the
 *  requested platforms, OR if it carries no resolvable platform info at all — the filter
 *  narrows out confirmed non-matches, it doesn't require positive proof of a match, so
 *  untagged legacy content (predating platform tagging) is never silently dropped. */
export function matchesStream(platforms: TicketPlatform[], streamFilter: Set<TicketPlatform> | null): boolean {
  return !streamFilter || platforms.length === 0 || platforms.some(p => streamFilter.has(p));
}

/** Overlay an ADO tracking row's id/url/state on top of whatever rich content the backlog
 *  artifact has for the same local key — ADO wins on title (the canonical ticket title),
 *  the artifact contributes everything else (description, acceptance criteria, estimates...). */
function mergeAdoAndContent<T extends object>(row: AdoWorkItemRow, content: T | undefined) {
  return {
    ...(content ?? {}),
    localKey: row.local_key,
    adoId: row.ado_id,
    adoUrl: row.ado_url,
    title: row.title,
    state: row.state,
    stateBucket: row.state != null ? bucketWorkItemState(row.state) : null,
  };
}

/** Builds the dev-mode feature/story tree: ado_work_item_map rows carry the live tracking
 *  fields, the backlog artifact (matched by parsing each row's "F<n>"/"F<n>.S<m>" local key
 *  back to its array position — same encoding pushFeatureToADO/pushEpicAndFeaturesToADO use
 *  to write it) carries the content. A feature that had stories but lost every one of them
 *  to the stream filter is dropped rather than returned as an empty shell. */
export function buildFeatures(workItemRows: AdoWorkItemRow[], backlog: BacklogData | null, streamFilter: Set<TicketPlatform> | null) {
  const featureRows = workItemRows.filter(r => r.ado_type === 'feature');
  const storyRows = workItemRows.filter(r => r.ado_type === 'story');

  const features: Array<Record<string, unknown>> = [];
  for (const featureRow of featureRows) {
    const featureIndex = parseFeatureLocalKey(featureRow.local_key);
    const featureContent = featureIndex != null ? backlog?.features?.[featureIndex] : undefined;
    const storiesForFeature = storyRows.filter(r => parseStoryLocalKey(r.local_key)?.featureIndex === featureIndex);

    const stories = storiesForFeature
      .map(storyRow => {
        const parsed = parseStoryLocalKey(storyRow.local_key);
        const storyContent = parsed != null ? featureContent?.stories?.[parsed.storyIndex] : undefined;
        const platforms = storyContent ? getStoryPlatforms(storyContent) : [];
        return { node: mergeAdoAndContent(storyRow, storyContent), platforms };
      })
      .filter(s => matchesStream(s.platforms, streamFilter))
      .map(s => s.node);

    if (streamFilter && storiesForFeature.length > 0 && stories.length === 0) continue;

    features.push({ ...mergeAdoAndContent(featureRow, featureContent), stories });
  }
  return features;
}

/** Local key → platforms lookup built from the backlog artifact, used to filter QA test
 *  cases by stream via their `story_ref` (new-format story_ref values are exactly this same
 *  "F<n>.S<m>" local key — see STORY_ID_RE in tool-validators.ts). */
export function buildStoryPlatformMap(backlog: BacklogData | null): Map<string, TicketPlatform[]> {
  const map = new Map<string, TicketPlatform[]>();
  (backlog?.features ?? []).forEach((feature, fi) => {
    const featureKey = featureLocalKey(fi);
    (feature.stories ?? []).forEach((story, si) => {
      map.set(storyLocalKey(featureKey, si), getStoryPlatforms(story));
    });
  });
  return map;
}

/**
 * GET /api/dev/initiatives/:seqNum/tickets
 * Mandatory: seqNum (the "#<N>" id on the initiative card). Optional: mode=dev|qa (default
 * dev — full epic/feature/story content; qa returns test cases only), stream=<platform list>
 * (comma-separated and/or repeated, one or more of backend/web/ios/android — filters which
 * tickets/test-cases come back; omit for every stream).
 */
router.get('/:seqNum/tickets', async (req: Request, res: Response) => {
  const seqNum = Number(req.params.seqNum);
  if (!Number.isInteger(seqNum) || seqNum <= 0) {
    res.status(400).json({ error: 'seqNum must be a positive integer — the "#<N>" id shown on the initiative card' });
    return;
  }

  const modeRaw = (req.query.mode as string | undefined)?.toLowerCase();
  if (modeRaw != null && modeRaw !== 'dev' && modeRaw !== 'qa') {
    res.status(400).json({ error: `Unknown mode "${modeRaw}" — valid values are dev, qa` });
    return;
  }
  const mode: Mode = modeRaw === 'qa' ? 'qa' : 'dev';

  let streamFilter: Set<TicketPlatform> | null;
  try {
    streamFilter = parseStreamFilter(req.query.stream);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
    return;
  }

  try {
    const initiative = findInitiativeBySeqNum(seqNum);
    if (!initiative) {
      res.status(404).json({ error: `Initiative #${seqNum} not found` });
      return;
    }

    const workItemRows = getWorkItemRowsByItem([initiative.id]).get(initiative.id) ?? [];
    if (workItemRows.length === 0) {
      res.status(404).json({ error: `Initiative #${seqNum} has no tickets pushed to Azure DevOps yet` });
      return;
    }

    const { ticketArtifactId, testArtifactIds } = getDocumentArtifactIds(initiative.id);
    const backlogContent = ticketArtifactId != null ? await loadArtifactContentById(ticketArtifactId) : null;
    const backlog = backlogContent != null ? tryParseBacklog(backlogContent) : null;

    const initiativeHeader = { seqNum: initiative.seq_num, id: initiative.id, title: initiative.title };
    const stream = streamFilter ? Array.from(streamFilter) : null;

    if (mode === 'qa') {
      const testPlanRows = getTestPlanRowsByItem([initiative.id]).get(initiative.id) ?? [];
      const qaParts = await Promise.all(testArtifactIds.map(async (artifactId, num) => {
        const content = await loadArtifactContentById(artifactId);
        const data = content != null ? tryParseQATests(content) : null;
        return data ? { num, data } : null;
      }));
      const merged = mergeQaTests(qaParts.filter((p): p is { num: number; data: NonNullable<ReturnType<typeof tryParseQATests>> } => p != null));
      const storyPlatforms = buildStoryPlatformMap(backlog);
      const testCases = (merged?.test_cases ?? []).filter((tc: TestCase) => {
        const ref = tc.story_ref ?? tc.linkedStory;
        const platforms = ref ? storyPlatforms.get(ref) ?? [] : [];
        return matchesStream(platforms, streamFilter);
      });

      res.json({
        initiative: initiativeHeader,
        mode,
        stream,
        testCases,
        testPlans: testPlanRows.map(r => ({ planId: r.plan_id, planUrl: r.plan_url, testCaseCount: r.test_case_count })),
      });
      return;
    }

    const epics = workItemRows
      .filter(r => r.ado_type === 'epic')
      .map(r => mergeAdoAndContent(r, r.local_key === 'epic' ? backlog?.epic : undefined));

    res.json({
      initiative: initiativeHeader,
      mode,
      stream,
      epics,
      features: buildFeatures(workItemRows, backlog, streamFilter),
    });
  } catch (error: any) {
    logger.error(`Failed to export tickets for initiative #${seqNum}`, error);
    res.status(500).json({ error: error.message || 'Failed to export tickets' });
  }
});

export default router;
