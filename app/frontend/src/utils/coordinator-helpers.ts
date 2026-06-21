// Strip the COORDINATOR_READY marker from displayed coordinator text
export function stripReadyMarker(text: string): string {
  return text.replace(/\n*COORDINATOR_READY\s*\n\{[\s\S]*?\}\s*$/, '').trimEnd();
}

// Extract enriched_context, recommended_stages, and stage_rationale from a coordinator READY message
export function extractReadyPayload(text: string): {
  enrichedContext: string | null;
  recommendedStages: string[] | null;
  stageRationale: string | null;
} {
  const match = text.match(/COORDINATOR_READY\s*\n(\{[\s\S]*?\})\s*$/);
  if (!match) return { enrichedContext: null, recommendedStages: null, stageRationale: null };
  try {
    const parsed = JSON.parse(match[1]);
    return {
      enrichedContext: parsed.enriched_context ?? null,
      recommendedStages: Array.isArray(parsed.recommended_stages) ? parsed.recommended_stages : null,
      stageRationale: typeof parsed.stage_rationale === 'string' ? parsed.stage_rationale : null,
    };
  } catch {
    return { enrichedContext: null, recommendedStages: null, stageRationale: null };
  }
}

// Parse critic data from checkpoint coordinator_action JSON
export function parseCriticData(checkpoint: any): { questions: string[]; issues: Array<{ severity: string; description: string }>; verdict: string } | null {
  try {
    const parsed = checkpoint?.coordinator_action
      ? JSON.parse(checkpoint.coordinator_action)?.critic
      : null;
    return parsed ?? null;
  } catch { return null; }
}

// Build a 1-line critic summary for display in the chat
export function criticSummaryLine(criticData: ReturnType<typeof parseCriticData>): string | null {
  if (!criticData) return null;
  const { verdict, issues = [], questions = [] } = criticData;
  const majorCount = issues.filter((i: any) => i.severity === 'critical' || i.severity === 'major').length;
  const questionCount = questions.length;
  if (verdict === 'approve') {
    const minorCount = issues.filter((i: any) => i.severity === 'minor').length;
    return minorCount > 0 ? `Flint approved with ${minorCount} minor note${minorCount !== 1 ? 's' : ''}` : 'Flint approved — no issues found';
  }
  const parts: string[] = [];
  if (majorCount > 0) parts.push(`${majorCount} major issue${majorCount !== 1 ? 's' : ''}`);
  if (questionCount > 0) parts.push(`${questionCount} question${questionCount !== 1 ? 's' : ''}`);
  return parts.length > 0 ? `Flint flagged ${parts.join(' and has ')}` : 'Flint flagged issues';
}
