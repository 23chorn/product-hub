import * as fs from 'fs';
import db from '../data/database';
import { stripJsonFence } from './json-repair';

// ── PRD document shape ────────────────────────────────────────────────────────
// The PRD artifact on disk is raw JSON (see agents/templates/prd.template.md /
// prdToMarkdown in @pap/shared) — NOT markdown. Enrichment below parses these
// fields directly rather than scanning for markdown headings.

interface PrdFunctionalRequirement { id: string; requirement: string }
interface PrdNonFunctionalRequirement { id: string; category?: string; requirement: string; priority?: string }
interface PrdUserJourney { id?: string; name?: string; steps?: string[] }
interface PrdMetric { metric?: string; baseline?: string; target?: string; timeframe?: string; measurement?: string }

interface PrdDocument {
  problem_statement?: string;
  success_metrics?: { primary?: PrdMetric; secondary?: PrdMetric[] };
  out_of_scope?: string[];
  functional_requirements?: PrdFunctionalRequirement[];
  non_functional_requirements?: PrdNonFunctionalRequirement[];
  user_journeys?: PrdUserJourney[];
}

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Normalise a requirement ID for comparison, e.g. "FR-01" / "FR1" → "FR1", "NFR-1" / "NFR1" → "NFR1". */
export function normalizeReqId(id: string): string {
  const m = id.match(/^([A-Za-z]+)-?0*(\d+)$/);
  return m ? `${m[1].toUpperCase()}${parseInt(m[2], 10)}` : id.toUpperCase();
}

/** Filter a list of {id, ...} requirements to the ones referenced in `ids`. Falls back to the full list when `ids` is empty or nothing matches. */
function filterById<T extends { id?: string }>(items: T[] | undefined, ids: Set<string>): T[] {
  if (!items?.length) return [];
  if (!ids.size) return items;
  const normalizedIds = new Set([...ids].map(normalizeReqId));
  const matched = items.filter(item => item.id && normalizedIds.has(normalizeReqId(item.id)));
  return matched.length > 0 ? matched : items;
}

// ── PRD ref collection ────────────────────────────────────────────────────────

/**
 * Collect the FR/NFR IDs a feature's stories trace back to, from each story's
 * `prd_ref` (the multi-agent refinement's live schema) or `prdRef` (legacy
 * single-shot schema) — both field-name and case variants are handled since
 * artifacts from either pipeline shape can still be in play.
 */
export function collectFeaturePrdRefs(feature: { stories?: any[] }): { frIds: Set<string>; nfrIds: Set<string> } {
  const frIds = new Set<string>();
  const nfrIds = new Set<string>();
  for (const story of feature.stories ?? []) {
    const ref = story.prd_ref ?? story.prdRef;
    if (!ref) continue;
    for (const fr of (ref.functional_requirements ?? ref.functionalRequirements ?? []) as string[]) frIds.add(fr);
    for (const nfr of (ref.non_functional_requirements ?? ref.nonFunctionalRequirements ?? []) as string[]) nfrIds.add(nfr);
  }
  return { frIds, nfrIds };
}

// ── Artifact loading ─────────────────────────────────────────────────────────

/** Load the latest PRD artifact content (raw JSON) for a workflow item. Returns '' if absent. */
export function loadPrdForItem(itemId: string): string {
  const row = db.prepare<[string], { file_path: string }>(`
    SELECT a.file_path
    FROM artifacts a
    JOIN sessions s ON a.session_id = s.id
    WHERE s.item_id = ? AND a.type = 'prd'
    ORDER BY a.created_at DESC LIMIT 1
  `).get(itemId);
  if (!row?.file_path) return '';
  try {
    return fs.readFileSync(row.file_path, 'utf-8');
  } catch {
    return '';
  }
}

function parsePrd(prdContent: string): PrdDocument | null {
  try {
    return JSON.parse(stripJsonFence(prdContent));
  } catch {
    return null;
  }
}

// ── Top-level enrichment builders ────────────────────────────────────────────

/**
 * Build the HTML block to append to an epic description.
 * Includes: Problem Statement, primary Success Metric, Out of Scope.
 */
export function buildEpicEnrichment(prdContent: string): string {
  const prd = parsePrd(prdContent);
  if (!prd) return '';

  const parts: string[] = [];

  if (prd.problem_statement) {
    parts.push(`<h4>Problem Statement</h4><p>${esc(prd.problem_statement)}</p>`);
  }

  const primary = prd.success_metrics?.primary;
  if (primary?.metric) {
    parts.push(
      `<h4>Success Metrics</h4><p><b>${esc(primary.metric)}</b>: ${esc(primary.baseline ?? '')} → ${esc(primary.target ?? '')}` +
      (primary.timeframe ? ` (${esc(primary.timeframe)})` : '') + `</p>`
    );
  }

  if (prd.out_of_scope?.length) {
    parts.push(`<h4>Out of Scope</h4><ul>${prd.out_of_scope.map(o => `<li>${esc(o)}</li>`).join('')}</ul>`);
  }

  return parts.join('');
}

/**
 * Build the HTML block to append to a feature description: full detail (not just
 * IDs) for the FRs and NFRs this feature's stories trace back to.
 *
 * @param prdContent - full PRD JSON artifact content
 * @param frIds      - FR IDs collected from this feature's stories (see collectFeaturePrdRefs)
 * @param nfrIds     - NFR IDs collected from this feature's stories
 */
export function buildFeatureEnrichment(
  prdContent: string,
  frIds: Set<string>,
  nfrIds: Set<string>
): string {
  const prd = parsePrd(prdContent);
  if (!prd) return '';

  const parts: string[] = [];

  const frs = filterById(prd.functional_requirements, frIds);
  if (frs.length) {
    parts.push(
      `<h4>Functional Requirements</h4><table><tr><th>ID</th><th>Requirement</th></tr>` +
      frs.map(f => `<tr><td>${esc(f.id)}</td><td>${esc(f.requirement)}</td></tr>`).join('') +
      `</table>`
    );
  }

  const nfrs = filterById(prd.non_functional_requirements, nfrIds);
  if (nfrs.length) {
    parts.push(
      `<h4>Non-Functional Requirements</h4><table><tr><th>ID</th><th>Category</th><th>Requirement</th><th>Priority</th></tr>` +
      nfrs.map(n => `<tr><td>${esc(n.id)}</td><td>${esc(n.category ?? '')}</td><td>${esc(n.requirement)}</td><td>${esc(n.priority ?? '')}</td></tr>`).join('') +
      `</table>`
    );
  }

  return parts.join('');
}
