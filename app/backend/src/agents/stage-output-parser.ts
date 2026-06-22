/**
 * Cleanup of raw specialist LLM output before it is saved as an artifact.
 *
 * Two stages of cleanup, kept as separate exports because the runner reuses the
 * de-duplicated `fullResponse` (for the completion excerpt, critic review, and
 * revision threads) independently of the parsed JSON artifact:
 *   1. stripWholeResponseDuplication — drop a whole-response echo.
 *   2. cleanStageArtifactJson        — strip fences, repair/extract, pretty-print.
 *
 * Leaf module: depends only on the json-repair utils and the logger, never back
 * on the runner.
 */

import { repairTruncatedJson, stripJsonFence, extractFirstJsonObject } from '../utils/json-repair';
import { logger } from './workflow-db';

/**
 * Detects and strips a known LLM failure mode where the entire response echoes
 * itself twice in a single completion — most often seen on revision turns, where
 * the prior draft already sits in context and the model re-states it in full
 * before producing the "real" answer. Looks for the response's own opening line
 * recurring partway through; if that split produces two near-equal, near-identical
 * halves, only the first copy is kept. This runs before any JSON/markdown-specific
 * parsing so it catches the duplication regardless of output format.
 */
export function stripWholeResponseDuplication(text: string, stage: string): string {
  const trimmed = text.trim();
  if (trimmed.length < 200) return text;

  const firstLineEnd = trimmed.indexOf('\n');
  const anchor = (firstLineEnd > 10 ? trimmed.slice(0, firstLineEnd) : trimmed.slice(0, 40)).trim();
  if (anchor.length < 8) return text;

  const secondOccurrence = trimmed.indexOf(anchor, anchor.length + 1);
  if (secondOccurrence === -1) return text;

  const firstHalf = trimmed.slice(0, secondOccurrence);
  const secondHalf = trimmed.slice(secondOccurrence);
  // Guard against the anchor line coincidentally reappearing later in a legitimately
  // long document — only treat as a true duplicate if the halves are near-equal length
  // and match content once whitespace differences (missing/extra newlines at the glue
  // point) are normalized away.
  const lenRatio = secondHalf.length / firstHalf.length;
  if (lenRatio < 0.85 || lenRatio > 1.15) return text;

  const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
  if (normalize(firstHalf) !== normalize(secondHalf)) return text;

  logger.warn(`Stage "${stage}" response echoed the full document twice — stripping the duplicate copy (${trimmed.length} → ${firstHalf.length} chars)`);
  return firstHalf.trimEnd();
}

/**
 * Turn a (de-duplicated) raw response into the JSON artifact string to save.
 * The prototype stage may emit truncated JSON, so it gets a repair pass; every
 * other stage strips fences/preamble and, if a valid object is followed by extra
 * content, recovers just the first complete object. Always falls back to the raw
 * (fence-stripped) content when nothing parses.
 */
export function cleanStageArtifactJson(stage: string, fullResponse: string): string {
  if (stage === 'prototype') {
    // Strip code fences, repair truncated JSON, pretty-print
    const repaired = repairTruncatedJson(fullResponse);
    try {
      return JSON.stringify(JSON.parse(repaired), null, 2);
    } catch {
      return repaired;
    }
  }

  // Strip code fences, skip any preamble before {, pretty-print
  const jsonContent = stripJsonFence(fullResponse);
  try {
    return JSON.stringify(JSON.parse(jsonContent), null, 2);
  } catch (firstErr: any) {
    // If parse failed because the model appended trailing content after a valid object
    // (or echoed its answer twice), recover just the first complete object. Falls back to
    // the raw content for any other parse error.
    const jsonOnly = firstErr.message?.includes('after JSON')
      ? extractFirstJsonObject(jsonContent)
      : null;
    if (jsonOnly) {
      logger.warn(`Extra content after JSON detected in stage "${stage}", extracting first complete object`);
      try {
        const extracted = JSON.stringify(JSON.parse(jsonOnly), null, 2);
        logger.info(`Successfully extracted and parsed JSON object (${jsonOnly.length} chars)`);
        return extracted;
      } catch {
        return jsonContent;
      }
    }
    return jsonContent;
  }
}
