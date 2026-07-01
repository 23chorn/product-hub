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
  tryParseResearchBrief, tryParsePRD, tryParseArchitecture,
  TICKET_PLATFORMS,
  type TicketPlatform, type BacklogData, type TestCase, type InitiativeContext,
  type FunctionalRequirement, type NonFunctionalRequirement,
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

/** Parse the `phase` query param (comma-separated and/or repeated) into a Set,
 *  or null when absent — null means "no filter, every phase included". Phase names
 *  are case-insensitive but preserved as entered. */
export function parsePhaseFilter(raw: unknown): Set<string> | null {
  if (raw == null) return null;
  const values = (Array.isArray(raw) ? raw : [raw])
    .flatMap(v => String(v).split(','))
    .map(v => v.trim())
    .filter(Boolean);
  if (values.length === 0) return null;
  // Normalize to lowercase for matching, but keep original case for display
  return new Set(values.map(v => v.toLowerCase()));
}

/** A story/test-case "matches" an active stream filter if it's tagged with one of the
 *  requested platforms, OR if it carries no resolvable platform info at all — the filter
 *  narrows out confirmed non-matches, it doesn't require positive proof of a match, so
 *  untagged legacy content (predating platform tagging) is never silently dropped. */
export function matchesStream(platforms: TicketPlatform[], streamFilter: Set<TicketPlatform> | null): boolean {
  return !streamFilter || platforms.length === 0 || platforms.some(p => streamFilter.has(p));
}

/** Strip long-form LLM phase descriptions after a dash separator — used as a fallback
 *  when no canonical epic_features map is available.
 *  "MVP — Circuit Limit Display & Cache Infrastructure" → "mvp"
 *  "Phase 1 — Client-Side Validation" → "phase 1" */
function normPhase(phase: string): string {
  return phase.split(/\s+[—–-]\s+/)[0].trim().toLowerCase();
}

/** A feature "matches" an active phase filter if its normalised phase label is in the set.
 *  Features with no phase assigned are excluded when a filter is active. */
export function matchesPhase(featurePhase: string | null | undefined, phaseFilter: Set<string> | null): boolean {
  return !phaseFilter || (!!featurePhase && phaseFilter.has(normPhase(featurePhase)));
}

/**
 * Build a feature-title → canonical phase label map from a parsed epic_features artifact.
 * The `phases[].label` field (e.g. "MVP", "Phase 1") is the authoritative phase name;
 * the backlog artifact's per-feature `.phase` string is often a long LLM description
 * ("MVP — Circuit Limit Display & Cache Infrastructure") that doesn't match CLI filters.
 * Matching is case-insensitive on the title key.
 */
export function buildTitleToPhaseMap(epicFeaturesContent: string | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!epicFeaturesContent) return map;
  try {
    const stripped = epicFeaturesContent.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
    const parsed = JSON.parse(stripped);
    if (Array.isArray(parsed.phases)) {
      for (const phase of parsed.phases) {
        for (const feature of (phase.features ?? []) as Array<{ title?: string }>) {
          if (feature.title) map.set(feature.title.toLowerCase(), phase.label);
        }
      }
    } else if (Array.isArray(parsed.features)) {
      // legacy flat format: each feature has its own .phase field
      for (const feature of parsed.features as Array<{ title?: string; phase?: string }>) {
        if (feature.title && feature.phase) map.set(feature.title.toLowerCase(), feature.phase);
      }
    }
  } catch {}
  return map;
}

/** Resolve a feature's canonical phase label.
 *  Prefers the epic_features title→phase map; falls back to the raw backlog .phase string. */
function resolvePhase(
  featureTitle: string | undefined,
  rawPhase: string | undefined,
  titleToPhase: Map<string, string> | null,
): string | null {
  if (featureTitle && titleToPhase) {
    const canonical = titleToPhase.get(featureTitle.toLowerCase());
    if (canonical) return canonical;
  }
  return rawPhase ?? null;
}

/** Load and parse the epic_features artifact. Returns both the epic-level description/businessValue
 *  (for the epic card) and the raw content string (so buildTitleToPhaseMap can derive canonical
 *  phase labels without loading the file a second time). */
async function loadEpicFeaturesArtifact(
  artifactId: number | null
): Promise<{ epicMeta: { description?: string; businessValue?: string } | null; content: string | null }> {
  if (artifactId == null) return { epicMeta: null, content: null };
  const content = await loadArtifactContentById(artifactId);
  if (!content) return { epicMeta: null, content: null };
  try {
    const stripped = content.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
    const parsed = JSON.parse(stripped);
    return { epicMeta: parsed?.epic ?? null, content };
  } catch {
    return { epicMeta: null, content };
  }
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
export function buildFeatures(workItemRows: AdoWorkItemRow[], backlog: BacklogData | null, streamFilter: Set<TicketPlatform> | null, phaseFilter: Set<string> | null = null, titleToPhase: Map<string, string> | null = null) {
  const featureRows = workItemRows
    .filter(r => r.ado_type === 'feature')
    .sort((a, b) => (parseFeatureLocalKey(a.local_key) ?? 0) - (parseFeatureLocalKey(b.local_key) ?? 0));
  const storyRows = workItemRows
    .filter(r => r.ado_type === 'story')
    .sort((a, b) => {
      const pa = parseStoryLocalKey(a.local_key);
      const pb = parseStoryLocalKey(b.local_key);
      if (!pa || !pb) return 0;
      return pa.featureIndex !== pb.featureIndex
        ? pa.featureIndex - pb.featureIndex
        : pa.storyIndex - pb.storyIndex;
    });

  const features: Array<Record<string, unknown>> = [];
  for (const featureRow of featureRows) {
    const featureIndex = parseFeatureLocalKey(featureRow.local_key);
    const featureContent = featureIndex != null ? backlog?.features?.[featureIndex] : undefined;
    const phase = resolvePhase(featureContent?.title, featureContent?.phase, titleToPhase);

    // Skip feature if it doesn't match phase filter
    if (!matchesPhase(phase, phaseFilter)) continue;

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

/** Build a map from story_id → localKey for resolving depends_on references in the manifest. */
export function buildStoryIdToLocalKeyMap(backlog: BacklogData | null): Map<string, string> {
  const map = new Map<string, string>();
  (backlog?.features ?? []).forEach((feature, fi) => {
    const fKey = featureLocalKey(fi);
    (feature.stories ?? []).forEach((story, si) => {
      if (story.story_id) map.set(story.story_id, storyLocalKey(fKey, si));
    });
  });
  return map;
}

/** Topological sort (Kahn's algorithm) on ticket local keys ordered by depends_on.
 *  Unknown or cyclic deps are handled gracefully — unresolvable nodes append at the end. */
export function topoSortTickets(nodes: Array<{ localKey: string; dependsOn: string[] }>): string[] {
  const allKeys = new Set(nodes.map(n => n.localKey));
  const prereqs = new Map(nodes.map(n => [n.localKey, n.dependsOn.filter(d => allKeys.has(d))]));
  const inDegree = new Map(nodes.map(n => [n.localKey, prereqs.get(n.localKey)!.length]));
  const waiters = new Map<string, string[]>(nodes.map(n => [n.localKey, []]));
  for (const node of nodes) {
    for (const dep of prereqs.get(node.localKey)!) {
      waiters.get(dep)!.push(node.localKey);
    }
  }
  const queue = nodes.filter(n => inDegree.get(n.localKey) === 0).map(n => n.localKey);
  const result: string[] = [];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const key = queue.shift()!;
    result.push(key);
    visited.add(key);
    for (const waiter of waiters.get(key) ?? []) {
      const deg = (inDegree.get(waiter) ?? 1) - 1;
      inDegree.set(waiter, deg);
      if (deg === 0) queue.push(waiter);
    }
  }
  for (const n of nodes) if (!visited.has(n.localKey)) result.push(n.localKey);
  return result;
}

/** Aggregate initiative-level context from research/PRD/architecture artifacts. */
async function buildInitiativeContext(itemId: string): Promise<InitiativeContext | null> {
  const { researchArtifactId, prdArtifactId, architectureArtifactId } = getDocumentArtifactIds(itemId);

  const research = researchArtifactId != null
    ? tryParseResearchBrief(await loadArtifactContentById(researchArtifactId) ?? '')
    : null;
  const prd = prdArtifactId != null
    ? tryParsePRD(await loadArtifactContentById(prdArtifactId) ?? '')
    : null;
  const architecture = architectureArtifactId != null
    ? tryParseArchitecture(await loadArtifactContentById(architectureArtifactId) ?? '')
    : null;

  if (!research && !prd && !architecture) return null;

  const context: InitiativeContext = {
    overview: prd?.overview ?? research?.problem_statement ?? '',
    problemStatement: research?.problem_statement ?? prd?.problem_definition ?? undefined,
    targetUsers: prd?.target_users ?? research?.user_segments?.map((s: any) => s.name || s.segment) ?? undefined,
    successMetrics: prd?.success_metrics ? {
      primary: prd.success_metrics.primary?.metric ?? '',
      secondary: prd.success_metrics.secondary?.map((m: any) => m.metric || m) ?? [],
    } : undefined,
    strategicAlignment: research?.strategic_fit ?? prd?.strategic_alignment ?? undefined,
    constraints: prd?.constraints ?? architecture?.constraints ?? undefined,
    outOfScope: prd?.out_of_scope ?? architecture?.out_of_scope ?? undefined,
    references: research?.references?.map((r: any) => ({
      title: r.title ?? r.name ?? 'Reference',
      url: r.url ?? r.link ?? '',
    })) ?? undefined,
  };

  return context;
}

/** Build FR/NFR lookup maps from PRD artifact. */
function buildRequirementMaps(prd: Record<string, any> | null): {
  frs: Map<string, FunctionalRequirement>;
  nfrs: Map<string, NonFunctionalRequirement>;
} {
  const frs = new Map<string, FunctionalRequirement>();
  const nfrs = new Map<string, NonFunctionalRequirement>();

  if (!prd) return { frs, nfrs };

  (prd.functional_requirements ?? []).forEach((fr: any) => {
    if (fr.id && fr.requirement) {
      frs.set(fr.id, { id: fr.id, requirement: fr.requirement });
    }
  });

  (prd.non_functional_requirements ?? []).forEach((nfr: any) => {
    if (nfr.id && nfr.requirement) {
      nfrs.set(nfr.id, {
        id: nfr.id,
        category: nfr.category ?? 'Other',
        requirement: nfr.requirement,
        priority: nfr.priority ?? 'Should',
      });
    }
  });

  return { frs, nfrs };
}

/** Resolve FR/NFR IDs from feature prdRef to full requirement objects. */
function resolveRequirements(
  featureContent: any,
  frs: Map<string, FunctionalRequirement>,
  nfrs: Map<string, NonFunctionalRequirement>
): {
  functionalRequirements: FunctionalRequirement[];
  nonFunctionalRequirements: NonFunctionalRequirement[];
} {
  const frIds = featureContent?.prdRef?.functionalRequirements ?? [];
  const nfrIds = featureContent?.prdRef?.nonFunctionalRequirements ?? [];

  return {
    functionalRequirements: frIds.map((id: string) => frs.get(id)).filter(Boolean),
    nonFunctionalRequirements: nfrIds.map((id: string) => nfrs.get(id)).filter(Boolean),
  };
}

/**
 * GET /api/dev/initiatives/:seqNum/manifest?stream=backend&phase=mvp
 * Initiative-level overview for a dev agent: initiative context (research/PRD/architecture
 * summary), epic context, feature phasing, a compact flat ticket list with dependency metadata,
 * and a topologically-sorted implementation order.
 *
 * Optional `stream` param (backend/web/ios/android) filters tickets by platform and returns
 * a stream-specific implementation order that respects cross-stream dependencies (if backend
 * story F0.S2 depends on iOS story F1.S0, F0.S2 is marked as blocked and excluded from the order).
 *
 * Optional `phase` param (comma-separated, e.g. mvp,backend) filters features and their stories
 * to only those matching the specified phases (case-insensitive).
 *
 * Call this once to load the "big picture" before making batch payload pulls.
 */
router.get('/:seqNum/manifest', async (req: Request, res: Response) => {
  const seqNum = Number(req.params.seqNum);
  if (!Number.isInteger(seqNum) || seqNum <= 0) {
    res.status(400).json({ error: 'seqNum must be a positive integer — the "#<N>" id shown on the initiative card' });
    return;
  }

  let streamFilter: Set<TicketPlatform> | null;
  try {
    streamFilter = parseStreamFilter(req.query.stream);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
    return;
  }

  let phaseFilter: Set<string> | null;
  try {
    phaseFilter = parsePhaseFilter(req.query.phase);
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

    const initiativeContext = await buildInitiativeContext(initiative.id);
    const { epicFeaturesArtifactId, ticketArtifactId } = getDocumentArtifactIds(initiative.id);
    const backlogContent = ticketArtifactId != null ? await loadArtifactContentById(ticketArtifactId) : null;
    const backlog = backlogContent != null ? tryParseBacklog(backlogContent) : null;
    const { epicMeta: epicFeaturesEpic, content: epicFeaturesContent } = await loadEpicFeaturesArtifact(epicFeaturesArtifactId);
    const titleToPhase = buildTitleToPhaseMap(epicFeaturesContent);

    const epicRow = workItemRows.find(r => r.ado_type === 'epic');
    const epicContent = backlog?.epic;
    const epic = epicRow ? {
      localKey: epicRow.local_key,
      adoId: epicRow.ado_id,
      adoUrl: epicRow.ado_url,
      title: epicRow.title,
      description: epicContent?.description ?? epicFeaturesEpic?.description ?? null,
      businessValue: epicContent?.businessValue ?? epicFeaturesEpic?.businessValue ?? null,
      state: epicRow.state,
      stateBucket: epicRow.state != null ? bucketWorkItemState(epicRow.state) : null,
    } : null;

    const featureRows = workItemRows
      .filter(r => r.ado_type === 'feature')
      .sort((a, b) => (parseFeatureLocalKey(a.local_key) ?? 0) - (parseFeatureLocalKey(b.local_key) ?? 0));
    const storyRows = workItemRows
      .filter(r => r.ado_type === 'story')
      .sort((a, b) => {
        const pa = parseStoryLocalKey(a.local_key);
        const pb = parseStoryLocalKey(b.local_key);
        if (!pa || !pb) return 0;
        return pa.featureIndex !== pb.featureIndex
          ? pa.featureIndex - pb.featureIndex
          : pa.storyIndex - pb.storyIndex;
      });
    const storyIdToLocalKey = buildStoryIdToLocalKeyMap(backlog);

    const allFeatures = featureRows.map(featureRow => {
      const featureIndex = parseFeatureLocalKey(featureRow.local_key);
      const featureContent = featureIndex != null ? backlog?.features?.[featureIndex] : undefined;
      const storiesForFeature = storyRows.filter(r => parseStoryLocalKey(r.local_key)?.featureIndex === featureIndex);
      const totalPoints = storiesForFeature.reduce((sum, r) => {
        const parsed = parseStoryLocalKey(r.local_key);
        const storyContent = parsed != null ? featureContent?.stories?.[parsed.storyIndex] : undefined;
        return sum + (storyContent?.estimated_points ?? storyContent?.effort ?? 0);
      }, 0);
      return {
        localKey: featureRow.local_key,
        adoId: featureRow.ado_id,
        adoUrl: featureRow.ado_url,
        title: featureRow.title,
        description: featureContent?.description ?? null,
        phase: resolvePhase(featureContent?.title, featureContent?.phase, titleToPhase),
        storyCount: storiesForFeature.length,
        totalPoints,
        state: featureRow.state,
        stateBucket: featureRow.state != null ? bucketWorkItemState(featureRow.state) : null,
      };
    });

    // Filter features by phase if specified
    const features = phaseFilter
      ? allFeatures.filter(f => matchesPhase(f.phase, phaseFilter))
      : allFeatures;

    // Build set of feature local keys that passed the phase filter
    const allowedFeatureKeys = new Set(features.map(f => f.localKey));

    const allTickets = storyRows
      .map(storyRow => {
        const parsed = parseStoryLocalKey(storyRow.local_key);
        const featureIndex = parsed?.featureIndex;
        const featureRow = featureIndex != null ? featureRows.find(r => parseFeatureLocalKey(r.local_key) === featureIndex) : undefined;
        const featureContent = featureIndex != null ? backlog?.features?.[featureIndex] : undefined;
        const storyContent = parsed != null ? featureContent?.stories?.[parsed.storyIndex] : undefined;
        const platforms = storyContent ? getStoryPlatforms(storyContent) : [];
        const dependsOn = (storyContent?.depends_on ?? []).map(ref => storyIdToLocalKey.get(ref) ?? ref);
        return {
          localKey: storyRow.local_key,
          adoId: storyRow.ado_id,
          adoUrl: storyRow.ado_url,
          title: storyRow.title,
          featureLocalKey: featureRow?.local_key ?? null,
          featureTitle: featureContent?.title ?? null,
          phase: resolvePhase(featureContent?.title, featureContent?.phase, titleToPhase),
          estimatedPoints: storyContent?.estimated_points ?? storyContent?.effort ?? null,
          platform: platforms,
          dependsOn,
          state: storyRow.state,
          stateBucket: storyRow.state != null ? bucketWorkItemState(storyRow.state) : null,
        };
      })
      // Filter by phase (via parent feature)
      .filter(t => !phaseFilter || !t.featureLocalKey || allowedFeatureKeys.has(t.featureLocalKey));

    // Filter tickets by stream if specified
    const tickets = streamFilter
      ? allTickets.filter(t => matchesStream(t.platform, streamFilter))
      : allTickets;

    // Build stream-specific implementation order
    const streamTicketKeys = new Set(tickets.map(t => t.localKey));
    const blocked: string[] = [];
    const orderableTickets = tickets
      .map(t => {
        // Cross-stream dependencies: if this ticket depends on a ticket outside the stream filter,
        // mark it as blocked and exclude it from the implementation order
        const crossStreamDeps = t.dependsOn.filter(dep => !streamTicketKeys.has(dep));
        if (crossStreamDeps.length > 0) {
          blocked.push(t.localKey);
          return null;
        }
        return { localKey: t.localKey, dependsOn: t.dependsOn.filter(dep => streamTicketKeys.has(dep)) };
      })
      .filter((t): t is { localKey: string; dependsOn: string[] } => t !== null);

    const implementationOrder = topoSortTickets(orderableTickets);

    res.json({
      initiative: {
        seqNum: initiative.seq_num,
        id: initiative.id,
        title: initiative.title,
        context: initiativeContext,
      },
      epic,
      features,
      tickets,
      implementationOrder,
      ...(streamFilter ? { stream: Array.from(streamFilter) } : {}),
      ...(phaseFilter ? { phase: Array.from(phaseFilter) } : {}),
      ...(blocked.length > 0 ? { blockedTickets: blocked } : {}),
    });
  } catch (error: any) {
    logger.error(`Failed to build manifest for initiative #${seqNum}`, error);
    res.status(500).json({ error: error.message || 'Failed to build manifest' });
  }
});

/**
 * GET /api/dev/initiatives/:seqNum/tickets/payload?ids=F0.S0,F0.S1,F0.S2
 * Full ticket detail for a batch of local keys — intended for implementation pulls after the
 * dev agent has loaded the manifest and chosen which tickets to work on next.
 * ids: comma-separated local keys (e.g. F0.S0,F1.S2). May be repeated as multiple params.
 */
router.get('/:seqNum/tickets/payload', async (req: Request, res: Response) => {
  const seqNum = Number(req.params.seqNum);
  if (!Number.isInteger(seqNum) || seqNum <= 0) {
    res.status(400).json({ error: 'seqNum must be a positive integer — the "#<N>" id shown on the initiative card' });
    return;
  }

  const rawIds = req.query.ids;
  if (!rawIds) {
    res.status(400).json({ error: 'ids query param is required — comma-separated local keys, e.g. ids=F0.S0,F0.S1' });
    return;
  }
  const requestedKeys = new Set(
    (Array.isArray(rawIds) ? rawIds : [rawIds])
      .flatMap(v => String(v).split(','))
      .map(v => v.trim())
      .filter(Boolean)
  );

  try {
    const initiative = findInitiativeBySeqNum(seqNum);
    if (!initiative) {
      res.status(404).json({ error: `Initiative #${seqNum} not found` });
      return;
    }

    const workItemRows = getWorkItemRowsByItem([initiative.id]).get(initiative.id) ?? [];
    const { ticketArtifactId, prdArtifactId } = getDocumentArtifactIds(initiative.id);
    const backlogContent = ticketArtifactId != null ? await loadArtifactContentById(ticketArtifactId) : null;
    const backlog = backlogContent != null ? tryParseBacklog(backlogContent) : null;

    const prdContent = prdArtifactId != null ? await loadArtifactContentById(prdArtifactId) : null;
    const prd = prdContent != null ? tryParsePRD(prdContent) : null;
    const { frs, nfrs } = buildRequirementMaps(prd);

    const featureRows = workItemRows.filter(r => r.ado_type === 'feature');
    const storyRows = workItemRows.filter(r => r.ado_type === 'story' && requestedKeys.has(r.local_key));
    const storyIdToLocalKey = buildStoryIdToLocalKeyMap(backlog);

    const tickets = storyRows.map(storyRow => {
      const parsed = parseStoryLocalKey(storyRow.local_key);
      const featureIndex = parsed?.featureIndex;
      const featureRow = featureIndex != null ? featureRows.find(r => parseFeatureLocalKey(r.local_key) === featureIndex) : undefined;
      const featureContent = featureIndex != null ? backlog?.features?.[featureIndex] : undefined;
      const storyContent = parsed != null ? featureContent?.stories?.[parsed.storyIndex] : undefined;
      const dependsOn = (storyContent?.depends_on ?? []).map(ref => storyIdToLocalKey.get(ref) ?? ref);
      const { functionalRequirements, nonFunctionalRequirements } = resolveRequirements(featureContent, frs, nfrs);
      return {
        localKey: storyRow.local_key,
        adoId: storyRow.ado_id,
        adoUrl: storyRow.ado_url,
        state: storyRow.state,
        stateBucket: storyRow.state != null ? bucketWorkItemState(storyRow.state) : null,
        featureLocalKey: featureRow?.local_key ?? null,
        featureTitle: featureContent?.title ?? null,
        featureDescription: featureContent?.description ?? null,
        phase: featureContent?.phase ?? null,
        title: storyRow.title,
        storyId: storyContent?.story_id ?? null,
        persona: storyContent?.as_a ?? storyContent?.persona ?? null,
        goal: storyContent?.i_want ?? storyContent?.goal ?? null,
        benefit: storyContent?.so_that ?? storyContent?.benefit ?? null,
        acceptanceCriteria: storyContent?.acceptance_criteria ?? storyContent?.acceptanceCriteria ?? [],
        technicalAcceptanceCriteria: storyContent?.technical_acceptance_criteria ?? [],
        agentContext: storyContent?.agentContext ?? null,
        estimatedPoints: storyContent?.estimated_points ?? storyContent?.effort ?? null,
        estimatedHours: storyContent?.aiEstimatedHours ?? storyContent?.estimatedHours ?? null,
        platform: storyContent ? getStoryPlatforms(storyContent) : [],
        dependsOn,
        technicalNotes: storyContent?.technical_notes ?? null,
        functionalRequirements,
        nonFunctionalRequirements,
      };
    });

    const foundKeys = new Set(tickets.map(t => t.localKey));
    const notFound = [...requestedKeys].filter(k => !foundKeys.has(k));

    res.json({
      initiative: { seqNum: initiative.seq_num, id: initiative.id, title: initiative.title },
      tickets,
      ...(notFound.length > 0 ? { notFound } : {}),
    });
  } catch (error: any) {
    logger.error(`Failed to load ticket payload for initiative #${seqNum}`, error);
    res.status(500).json({ error: error.message || 'Failed to load ticket payload' });
  }
});

/**
 * GET /api/dev/initiatives/:seqNum/tickets
 * Mandatory: seqNum (the "#<N>" id on the initiative card). Optional: mode=dev|qa (default
 * dev — full epic/feature/story content; qa returns test cases only), stream=<platform list>
 * (comma-separated and/or repeated, one or more of backend/web/ios/android — filters which
 * tickets/test-cases come back; omit for every stream), phase=<phase list> (comma-separated,
 * filters features and their stories by phase).
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

  let phaseFilter: Set<string> | null;
  try {
    phaseFilter = parsePhaseFilter(req.query.phase);
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

    const { epicFeaturesArtifactId, ticketArtifactId, testArtifactIds } = getDocumentArtifactIds(initiative.id);
    const backlogContent = ticketArtifactId != null ? await loadArtifactContentById(ticketArtifactId) : null;
    const backlog = backlogContent != null ? tryParseBacklog(backlogContent) : null;
    const { epicMeta: epicFeaturesEpic, content: epicFeaturesContent } = await loadEpicFeaturesArtifact(epicFeaturesArtifactId);
    const titleToPhase = buildTitleToPhaseMap(epicFeaturesContent);

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
      .map(r => {
        const base = r.local_key === 'epic' ? backlog?.epic : undefined;
        const enriched = base || epicFeaturesEpic ? {
          ...(base ?? {}),
          description: base?.description ?? epicFeaturesEpic?.description,
          businessValue: base?.businessValue ?? epicFeaturesEpic?.businessValue,
        } : undefined;
        return mergeAdoAndContent(r, enriched);
      });

    res.json({
      initiative: initiativeHeader,
      mode,
      stream,
      ...(phaseFilter ? { phase: Array.from(phaseFilter) } : {}),
      epics,
      features: buildFeatures(workItemRows, backlog, streamFilter, phaseFilter, titleToPhase),
    });
  } catch (error: any) {
    logger.error(`Failed to export tickets for initiative #${seqNum}`, error);
    res.status(500).json({ error: error.message || 'Failed to export tickets' });
  }
});

export default router;
