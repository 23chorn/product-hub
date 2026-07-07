/**
 * Behaviour Docs Context — surfaces relevant context/behaviour/features/*.feature
 * docs into the PRD stage so PRDs stay consistent with current implementation and
 * business rules (see context/behaviour/USAGE.md, "PRD Phase" integration point).
 *
 * Relevance is resolved by keyword overlap against feature-map.json's search index
 * rather than full-corpus injection — the behaviour corpus can be large (100+ KB
 * across many docs) and most PRDs concern one or two feature areas.
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import Logger from '../utils/logger';
import { tokenize } from '../utils/text-tokens';
import { FEATURES_DIR, FEATURE_MAP_PATH } from './behaviour-files';

const logger = new Logger('BEHAVIOUR-CONTEXT');

interface FeatureMapIndexEntry { feature: string; file: string; category: string; keywords: string[] }
interface FeatureMap { index: FeatureMapIndexEntry[] }

const EXTRA_STOPWORDS = ['new', 'add', 'feature', 'build', 'create', 'support', 'user', 'users'];

/**
 * Find behaviour docs relevant to a free-text query (e.g. the initiative goal + research
 * brief) by keyword overlap against feature-map.json's index, and return their full
 * Gherkin content. Returns '' when no feature-map.json/features exist (e.g. a fresh
 * project with no imported behaviour corpus) or when nothing matches.
 */
export async function loadRelevantBehaviourDocs(query: string, maxDocs = 4): Promise<string> {
  let featureMap: FeatureMap;
  try {
    const raw = await fs.readFile(FEATURE_MAP_PATH, 'utf-8');
    featureMap = JSON.parse(raw);
  } catch {
    logger.info(`No behaviour docs loaded — no feature-map.json at ${FEATURE_MAP_PATH}`);
    return '';
  }
  if (!Array.isArray(featureMap.index) || featureMap.index.length === 0) {
    logger.info('No behaviour docs loaded — feature-map.json has an empty index');
    return '';
  }

  const queryWords = tokenize(query, EXTRA_STOPWORDS);
  if (queryWords.size === 0) {
    logger.info('No behaviour docs loaded — query produced no searchable keywords');
    return '';
  }

  const scored = featureMap.index
    .map(entry => ({ entry, score: entry.keywords.filter(k => queryWords.has(k)).length }))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxDocs);
  if (scored.length === 0) {
    logger.info(`No behaviour docs matched — searched ${featureMap.index.length} indexed doc(s), no keyword overlap`);
    return '';
  }

  const sections = await Promise.all(scored.map(async ({ entry }) => {
    try {
      const content = await fs.readFile(path.join(FEATURES_DIR, entry.file), 'utf-8');
      return `### ${entry.feature} (\`${entry.file}\`)\n\n${content.trim()}`;
    } catch {
      logger.warn(`Behaviour doc matched but could not be read: ${entry.file}`);
      return null;
    }
  }));
  const valid = sections.filter((s): s is string => s !== null);
  if (valid.length === 0) {
    logger.info('No behaviour docs loaded — all matched docs failed to read');
    return '';
  }

  logger.info(`Loaded ${valid.length} behaviour doc(s) for PRD context: ${scored.map(s => `${s.entry.file} (score ${s.score})`).join(', ')}`);

  return `## Current Implementation — Behaviour Docs\nThese describe how related features currently work in production today (business rules, screen flows, validation). Use them to keep this PRD consistent with existing patterns, reference existing business rule numbering when extending it, and explicitly call out where you're proposing something new or different from current behavior.\n\n${valid.join('\n\n---\n\n')}`;
}
