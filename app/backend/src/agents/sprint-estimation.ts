import * as fsAsync from 'fs/promises';
import * as path from 'path';
import Logger from '../utils/logger';

const logger = new Logger('SPRINT-ESTIMATION');

const AGENTS_ROOT = path.resolve(__dirname, '../../../../../agents');

/** Default hours-per-point mapping (non-linear — larger stories have more overhead). */
export const DEFAULT_HOURS_PER_POINT: Record<number, number> = { 1: 2, 2: 4, 3: 8, 5: 16, 8: 28 };

/** Read sprint_velocity, capacity_factor, and hours_per_point from agents/config.yaml. */
export async function loadSprintConfig(): Promise<{
  sprintVelocity: number;
  capacityFactor: number;
  hoursPerPoint: Record<number, number>;
}> {
  let sprintVelocity = 25;
  let capacityFactor = 0.7;
  const hoursPerPoint: Record<number, number> = { ...DEFAULT_HOURS_PER_POINT };
  try {
    const raw = await fsAsync.readFile(path.join(AGENTS_ROOT, 'config.yaml'), 'utf-8');
    let inHoursPerPoint = false;
    for (const line of raw.split('\n')) {
      const intMatch = line.match(/^sprint_velocity:\s*(\d+)/);
      if (intMatch) { sprintVelocity = parseInt(intMatch[1], 10); continue; }
      const floatMatch = line.match(/^capacity_factor:\s*([\d.]+)/);
      if (floatMatch) { capacityFactor = parseFloat(floatMatch[1]); continue; }
      if (/^hours_per_point:\s*$/.test(line)) { inHoursPerPoint = true; continue; }
      if (inHoursPerPoint) {
        const hppMatch = line.match(/^\s+(\d+):\s*(\d+)/);
        if (hppMatch) {
          hoursPerPoint[parseInt(hppMatch[1], 10)] = parseInt(hppMatch[2], 10);
        } else if (/^\S/.test(line)) {
          inHoursPerPoint = false;
        }
      }
    }
  } catch { /* fall through */ }
  return { sprintVelocity, capacityFactor, hoursPerPoint };
}

/**
 * Inject sprint estimates into a parsed backlog JSON object.
 * Mutates the parsed object in place and returns the serialised JSON string.
 */
export async function injectSprintEstimates(parsed: any): Promise<string> {
  // Normalise: stories can live in features[].stories, feature.stories, epic.stories, or as a single story
  const allStories: any[] = parsed.features
    ? (parsed.features as any[]).flatMap((f: any) => f.stories ?? [])
    : parsed.feature?.stories
    ? (parsed.feature.stories as any[])
    : parsed.epic?.stories
    ? (parsed.epic.stories as any[])
    : parsed.story
    ? [parsed.story]
    : [];
  const { sprintVelocity, capacityFactor, hoursPerPoint } = await loadSprintConfig();

  // Inject estimatedHours on each story based on effort → hours mapping
  const pointToHours = (effort: number): number => {
    if (hoursPerPoint[effort] != null) return hoursPerPoint[effort];
    // Interpolate: find nearest lower and upper keys
    const keys = Object.keys(hoursPerPoint).map(Number).sort((a, b) => a - b);
    const lower = keys.filter(k => k <= effort).pop();
    const upper = keys.find(k => k >= effort);
    if (lower != null && upper != null && lower !== upper) {
      const ratio = (effort - lower) / (upper - lower);
      return Math.round(hoursPerPoint[lower] + ratio * (hoursPerPoint[upper] - hoursPerPoint[lower]));
    }
    // Fallback: linear extrapolation from highest known
    const highest = keys[keys.length - 1];
    return Math.round((effort / highest) * hoursPerPoint[highest]);
  };
  for (const s of allStories) {
    const effort = Number(s.effort) || 0;
    if (effort > 0) s.estimatedHours = pointToHours(effort);
  }

  const totalEffort: number = allStories
    .reduce((sum: number, s: any) => sum + (Number(s.effort) || 0), 0);
  const totalHours: number = allStories
    .reduce((sum: number, s: any) => sum + (Number(s.estimatedHours) || 0), 0);
  const effectiveVelocity = Math.round(sprintVelocity * capacityFactor * 10) / 10;
  const sprintsRequired = effectiveVelocity > 0
    ? Math.round((totalEffort / effectiveVelocity) * 10) / 10
    : null;
  // Inject sprint metadata into the appropriate top-level object
  const sprintMeta = { totalEffort, totalHours, sprintsRequired, sprintVelocity, capacityFactor, effectiveVelocity };
  if (parsed.epic) {
    parsed.epic = { ...parsed.epic, ...sprintMeta };
  } else if (parsed.feature) {
    parsed.feature = { ...parsed.feature, ...sprintMeta };
  } else if (parsed.story) {
    parsed.story = { ...parsed.story, ...sprintMeta };
  }

  logger.info(`Backlog sprint estimate: ${totalEffort} pts (${totalHours}h) / ${effectiveVelocity} effective velocity (${sprintVelocity} × ${capacityFactor}) = ${sprintsRequired} sprints`);

  return JSON.stringify(parsed, null, 2);
}
