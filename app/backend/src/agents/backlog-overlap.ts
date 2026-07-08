/**
 * Deterministic cross-feature scope-overlap detection. Each story_decomposition_F* stage
 * refines its feature in isolation — nothing stops two features from independently
 * producing stories that cover the same capability. This does a cheap token-overlap pass
 * across every cross-feature story pair.
 *
 * Two call sites use it:
 *  - pushFeatureToADO (feature-decomposition.ts) — runs THIS feature against every
 *    already-approved (already-in-ADO) prior feature, right before its own stories are
 *    pushed. High-confidence matches (>= AUTO_RESOLVE_THRESHOLD) are dropped from this
 *    feature before anything is created, since the prior feature's story is already
 *    immutable in ADO — this is the only point in the pipeline before a duplicate would
 *    otherwise become two real ADO tickets.
 *  - runBacklogMerge (feature-stage-runner.ts) — the backstop, run once over the full
 *    merged backlog after every feature is approved. Catches same-wave races (two
 *    features approved from concurrent generation, so neither could see the other's
 *    output at push time) and anything below the auto-resolve bar; flags those for
 *    human review — it never blocks the merge or auto-removes anything itself.
 */
import db from '../data/database';
import { tokenize } from '../utils/text-tokens';
import { normalizeReqId } from '../utils/prd-enrichment';
import { featureLocalKey } from '@pap/shared';

const OVERLAP_THRESHOLD = 0.35;
/** Score at/above which a match is treated as certain enough to auto-drop instead of
 * flagging for human review. Deliberately high — a false-positive drop silently loses a
 * real story with no ADO ticket ever created for it, which is worse than a false-positive
 * flag (which just costs a human one extra look). */
export const AUTO_RESOLVE_THRESHOLD = 0.75;
const MAX_MATCHED_TERMS = 8;

// Gherkin/story scaffolding words that would otherwise dominate token overlap across
// unrelated stories (every acceptance criterion starts with these).
const EXTRA_STOPWORDS = ['given', 'when', 'then', 'and', 'app', 'system', 'able'];

interface StoryLike {
  story_id?: string;
  title?: string;
  as_a?: string;
  i_want?: string;
  so_that?: string;
  acceptance_criteria?: string[];
  platform?: string;
}

interface FeatureLike {
  key?: string;
  title?: string;
  stories?: StoryLike[];
}

export interface OverlapCandidate {
  featureKeyA: string;
  storyIdA: string;
  featureKeyB: string;
  storyIdB: string;
  score: number;
  matchedTerms: string[];
}

function storyText(story: StoryLike): string {
  return [story.title, story.i_want, story.so_that, ...(story.acceptance_criteria ?? [])]
    .filter(Boolean)
    .join(' ');
}

function jaccard(a: Set<string>, b: Set<string>): { score: number; matched: string[] } {
  const matched: string[] = [];
  for (const t of a) if (b.has(t)) matched.push(t);
  const unionSize = a.size + b.size - matched.length;
  return { score: unionSize === 0 ? 0 : matched.length / unionSize, matched };
}

/**
 * Compare every story pair across different features (same-feature pairs are ignored —
 * this is about cross-feature scope bleed, not intra-feature duplicates) and return
 * candidates whose token overlap clears OVERLAP_THRESHOLD, highest score first.
 *
 * Platform-tagged stories on different platforms are never compared, even if the wording
 * is near-identical — a "Confirmation Screen" story for iOS and one for Android are expected
 * parallel tickets (see the story-decomposition "one platform per ticket" rule), not a
 * duplicate. Only same-platform (or platform-untagged, for older artifacts) pairs are scored.
 */
export function detectBacklogOverlaps(features: FeatureLike[]): OverlapCandidate[] {
  const entries = features.flatMap((f, i) => {
    const featureKey = f.key || `F${i + 1}`;
    return (f.stories ?? []).map(story => ({
      featureKey,
      story,
      platform: story.platform,
      tokens: tokenize(storyText(story), EXTRA_STOPWORDS),
    }));
  });

  const candidates: OverlapCandidate[] = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i];
      const b = entries[j];
      if (a.featureKey === b.featureKey) continue;
      if (a.tokens.size === 0 || b.tokens.size === 0) continue;
      if (a.platform && b.platform && a.platform !== b.platform) continue;

      const { score, matched } = jaccard(a.tokens, b.tokens);
      if (score >= OVERLAP_THRESHOLD) {
        candidates.push({
          featureKeyA: a.featureKey,
          storyIdA: a.story.story_id ?? '',
          featureKeyB: b.featureKey,
          storyIdB: b.story.story_id ?? '',
          score,
          matchedTerms: matched.slice(0, MAX_MATCHED_TERMS),
        });
      }
    }
  }

  return candidates.sort((x, y) => y.score - x.score);
}

// ── FR-ownership scope-boundary check ────────────────────────────────────────
//
// detectBacklogOverlaps above catches two DIFFERENTLY-scoped stories that happen to read as
// near-duplicates. It can't catch a feature writing a story that's actually a sibling
// feature's job but worded nothing like it — e.g. a "set the expiry date" feature also
// writing "display the expiry date in the confirmation screen", which traces to a different
// FR than the one this feature owns. epic_feature_planner assigns each feature explicit FR
// ownership up front (see epic-features.template.md's prdRef.functionalRequirements), before
// any feature is even decomposed — so this check needs no wording similarity and no push
// order; it's a straight lookup against a boundary the epic plan already drew.

export interface FrOwnershipViolation {
  /** The feature the out-of-scope story currently lives under. */
  featureKey: string;
  storyId: string;
  /** The feature epic_feature_planner actually assigned this FR to. */
  owningFeatureKey: string;
  frId: string;
}

/** Build a normalized FR id -> owning feature key map from the epic_features artifact's
 *  flattened feature list. Feature key is positional (featureLocalKey(index)), matching the
 *  convention every other push-time/backlog-merge key derivation in this codebase uses. */
export function buildFrOwnershipMap(epicFeatures: Array<{ prdRef?: any; prd_ref?: any }>): Map<string, string> {
  const map = new Map<string, string>();
  epicFeatures.forEach((f, i) => {
    const featureKey = featureLocalKey(i);
    const ref = f.prdRef ?? f.prd_ref;
    const frIds: string[] = ref?.functionalRequirements ?? ref?.functional_requirements ?? [];
    for (const frId of frIds) map.set(normalizeReqId(frId), featureKey);
  });
  return map;
}

/**
 * Check one feature's stories against the FR-ownership map: a story whose prd_ref traces to
 * an FR owned by a DIFFERENT feature is scope creep, regardless of how differently worded it
 * is from anything that feature owns. An FR with no owner in the map (e.g. epic_features wasn't
 * available, or the FR genuinely isn't assigned to any feature) is silently skipped — this
 * check only fires on a positive, known ownership conflict, never on missing data.
 */
export function detectOutOfScopeFrReferences(
  featureKey: string,
  stories: StoryLike[],
  frOwnerByFrId: Map<string, string>,
): FrOwnershipViolation[] {
  const violations: FrOwnershipViolation[] = [];
  for (const story of stories) {
    const ref = (story as any).prd_ref ?? (story as any).prdRef;
    const frIds: string[] = ref?.functional_requirements ?? ref?.functionalRequirements ?? [];
    for (const frId of frIds) {
      const owner = frOwnerByFrId.get(normalizeReqId(frId));
      if (owner && owner !== featureKey) {
        violations.push({ featureKey, storyId: story.story_id ?? '', owningFeatureKey: owner, frId });
      }
    }
  }
  return violations;
}

// ── Persistence ────────────────────────────────────────────────────────────────

export interface OverlapFlagRecord {
  workflowId: string;
  itemId: string;
  featureKeyA: string;
  storyIdA: string;
  featureKeyB: string;
  storyIdB: string;
  score: number;
  matchedTerms: string[];
  status: 'pending' | 'auto_resolved';
  /** 'overlap' (default): wording-similarity match, storyIdA is a real story.
   *  'scope_violation': storyIdB traces to an FR owned by featureKeyA — storyIdA is a
   *  placeholder since there's no specific "other" story to compare against. */
  flagType?: 'overlap' | 'scope_violation';
}

/**
 * Persist overlap candidates as backlog_overlap_flags rows. For 'auto_resolved' records,
 * side A is the story that was kept (already immutable — already in ADO) and side B is
 * the one dropped — see the module doc comment above for why B is always the just-pushed
 * feature's story when this is called from pushFeatureToADO.
 */
export function recordOverlapFlags(records: OverlapFlagRecord[]): void {
  if (records.length === 0) return;
  const insert = db.prepare(`
    INSERT INTO backlog_overlap_flags
      (workflow_id, item_id, feature_key_a, story_id_a, feature_key_b, story_id_b, score, matched_terms, status, resolved_at, created_at, flag_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const now = Date.now();
  for (const r of records) {
    insert.run(
      r.workflowId, r.itemId, r.featureKeyA, r.storyIdA, r.featureKeyB, r.storyIdB,
      r.score, JSON.stringify(r.matchedTerms), r.status,
      r.status === 'auto_resolved' ? now : null, now, r.flagType ?? 'overlap'
    );
  }
}

/**
 * (featureKey, story_id) pairs already dropped by an earlier auto-resolution in this
 * workflow — keyed by the DROPPED side (feature_key_b/story_id_b, see recordOverlapFlags).
 * Consulted at backlog_merge time so the merged backlog / epic QA generation match what
 * actually reached ADO, without needing to mutate any already-approved artifact.
 */
export function loadAutoResolvedStoryKeys(workflowId: string): Set<string> {
  const rows = db.prepare<[string], { feature_key_b: string; story_id_b: string }>(
    `SELECT feature_key_b, story_id_b FROM backlog_overlap_flags WHERE workflow_id = ? AND status = 'auto_resolved'`
  ).all(workflowId);
  return new Set(rows.map(r => `${r.feature_key_b}::${r.story_id_b}`));
}

/** Filter a feature's stories against a previously-loaded auto-resolved key set. */
export function excludeAutoResolvedStories<T extends { story_id?: string }>(
  featureKey: string,
  stories: T[],
  autoResolvedKeys: Set<string>
): T[] {
  return stories.filter(s => !s.story_id || !autoResolvedKeys.has(`${featureKey}::${s.story_id}`));
}
