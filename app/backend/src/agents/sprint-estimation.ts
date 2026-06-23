import Logger from '../utils/logger';
import { getSprintSettings } from '../config/settings-store';

const logger = new Logger('SPRINT-ESTIMATION');

/** Default hours-per-point mapping (non-linear — larger stories have more overhead). */
const DEFAULT_HOURS_PER_POINT: Record<number, number> = { 1: 2, 2: 4, 3: 8, 5: 16, 8: 28 };

/** Default AI-assisted hours-per-point mapping (AI accelerates routine work more than complex work). */
const DEFAULT_AI_HOURS_PER_POINT: Record<number, number> = { 1: 0.5, 2: 1.5, 3: 3, 5: 8, 8: 18 };

/**
 * Resolve sprint config. Velocity, capacity, and the AI-assist toggle come from
 * the settings store (policies table). The hours-per-point curves and test
 * fractions are non-tunable defaults — they had no UI and are kept as constants.
 */
export function loadSprintConfig(): {
  sprintVelocity: number;
  capacityFactor: number;
  hoursPerPoint: Record<number, number>;
  aiAssisted: boolean;
  aiHoursPerPoint: Record<number, number>;
  testFraction: number;
  aiTestReductionFactor: number;
} {
  const { sprintVelocity, capacityFactor, aiAssisted } = getSprintSettings();
  return {
    sprintVelocity,
    capacityFactor,
    aiAssisted,
    hoursPerPoint: { ...DEFAULT_HOURS_PER_POINT },
    aiHoursPerPoint: { ...DEFAULT_AI_HOURS_PER_POINT },
    testFraction: 0.25,
    aiTestReductionFactor: 0.10,
  };
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
  const { sprintVelocity, capacityFactor, hoursPerPoint, aiAssisted, aiHoursPerPoint, testFraction, aiTestReductionFactor } = loadSprintConfig();

  // Build hours-from-effort mapper for a given mapping table
  const buildPointToHours = (mapping: Record<number, number>) => (effort: number): number => {
    if (mapping[effort] != null) return mapping[effort];
    // Interpolate: find nearest lower and upper keys
    const keys = Object.keys(mapping).map(Number).sort((a, b) => a - b);
    const lower = keys.filter(k => k <= effort).pop();
    const upper = keys.find(k => k >= effort);
    if (lower != null && upper != null && lower !== upper) {
      const ratio = (effort - lower) / (upper - lower);
      return Math.round((mapping[lower] + ratio * (mapping[upper] - mapping[lower])) * 10) / 10;
    }
    // Fallback: linear extrapolation from highest known
    const highest = keys[keys.length - 1];
    return Math.round(((effort / highest) * mapping[highest]) * 10) / 10;
  };

  const traditionalPointToHours = buildPointToHours(hoursPerPoint);
  const aiImplPointToHours = buildPointToHours(aiHoursPerPoint);

  // Inject estimatedHours on each story — use AI mapping when enabled, always include both.
  // AI total = AI implementation hours + traditional test hours × (1 - aiTestReductionFactor).
  // This reflects that AI speeds up implementation dramatically but manual testing overhead
  // persists (first-round QA, exploratory testing, regression checks).
  for (const s of allStories) {
    const effort = Number(s.effort) || 0;
    if (effort > 0) {
      const traditional = parseFloat(traditionalPointToHours(effort).toFixed(1));
      const aiImpl = parseFloat(aiImplPointToHours(effort).toFixed(1));
      const testComponent = parseFloat((traditional * testFraction * (1 - aiTestReductionFactor)).toFixed(1));
      const ai = parseFloat((aiImpl + testComponent).toFixed(1));
      s.estimatedHours = aiAssisted ? ai : traditional;
      // Always include both so the frontend can show the comparison
      s.traditionalHours = traditional;
      s.aiEstimatedHours = ai;
    }
  }

  const totalEffort: number = allStories
    .reduce((sum: number, s: any) => sum + (Number(s.effort) || 0), 0);
  const totalHours: number = allStories
    .reduce((sum: number, s: any) => sum + (Number(s.estimatedHours) || 0), 0);
  const totalTraditionalHours: number = allStories
    .reduce((sum: number, s: any) => sum + (Number(s.traditionalHours) || 0), 0);
  const totalAiHours: number = allStories
    .reduce((sum: number, s: any) => sum + (Number(s.aiEstimatedHours) || 0), 0);
  const effectiveVelocity = Math.round(sprintVelocity * capacityFactor * 10) / 10;
  const sprintsRequired = effectiveVelocity > 0
    ? Math.round((totalEffort / effectiveVelocity) * 10) / 10
    : null;
  // Inject sprint metadata into the appropriate top-level object
  const sprintMeta = {
    totalEffort, totalHours, sprintsRequired, sprintVelocity, capacityFactor, effectiveVelocity,
    aiAssisted, totalTraditionalHours, totalAiHours,
  };
  if (parsed.epic) {
    parsed.epic = { ...parsed.epic, ...sprintMeta };
  } else if (parsed.feature) {
    parsed.feature = { ...parsed.feature, ...sprintMeta };
  } else if (parsed.story) {
    parsed.story = { ...parsed.story, ...sprintMeta };
  }

  // ── Inject ordering into feature and story titles ─────────────────────────
  // Prepends "F{n}: " to feature titles and "S{f}.{s}: " to story titles so
  // the dependency order is explicit in the artifact and in exported work items.
  if (parsed.features) {
    for (let fi = 0; fi < parsed.features.length; fi++) {
      const feature = parsed.features[fi];
      feature.order = fi + 1;
      const fPrefix = `F${fi + 1}`;
      if (!feature.title.startsWith(fPrefix)) {
        feature.title = `${fPrefix}: ${feature.title}`;
      }
      for (let si = 0; si < (feature.stories?.length ?? 0); si++) {
        const story = feature.stories[si];
        story.order = si + 1;
        const sPrefix = `S${fi + 1}.${si + 1}`;
        if (!story.title.startsWith(sPrefix)) {
          story.title = `${sPrefix}: ${story.title}`;
        }
      }
    }
  } else if (parsed.feature?.stories) {
    parsed.feature.order = 1;
    for (let si = 0; si < parsed.feature.stories.length; si++) {
      const story = parsed.feature.stories[si];
      story.order = si + 1;
      const sPrefix = `S1.${si + 1}`;
      if (!story.title.startsWith(sPrefix)) {
        story.title = `${sPrefix}: ${story.title}`;
      }
    }
  } else if (parsed.epic?.stories) {
    for (let si = 0; si < parsed.epic.stories.length; si++) {
      const story = parsed.epic.stories[si];
      story.order = si + 1;
      const sPrefix = `S1.${si + 1}`;
      if (!story.title.startsWith(sPrefix)) {
        story.title = `${sPrefix}: ${story.title}`;
      }
    }
  } else if (parsed.story) {
    parsed.story.order = 1;
    const sPrefix = 'S1.1';
    if (!parsed.story.title.startsWith(sPrefix)) {
      parsed.story.title = `${sPrefix}: ${parsed.story.title}`;
    }
  }

  const aiTag = aiAssisted ? ` [AI-assisted: ${totalAiHours}h vs traditional ${totalTraditionalHours}h (test fraction ${testFraction}, test reduction ${aiTestReductionFactor})]` : '';
  logger.info(`Backlog sprint estimate: ${totalEffort} pts (${totalHours}h) / ${effectiveVelocity} effective velocity (${sprintVelocity} × ${capacityFactor}) = ${sprintsRequired} sprints${aiTag}`);

  return JSON.stringify(parsed, null, 2);
}
