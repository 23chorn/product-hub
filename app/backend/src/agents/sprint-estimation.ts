import * as fsAsync from 'fs/promises';
import * as path from 'path';
import Logger from '../utils/logger';

const logger = new Logger('SPRINT-ESTIMATION');

const AGENTS_ROOT = path.resolve(__dirname, '../../../../agents');

/** Default hours-per-point mapping (non-linear — larger stories have more overhead). */
export const DEFAULT_HOURS_PER_POINT: Record<number, number> = { 1: 2, 2: 4, 3: 8, 5: 16, 8: 28 };

/** Default AI-assisted hours-per-point mapping (AI accelerates routine work more than complex work). */
export const DEFAULT_AI_HOURS_PER_POINT: Record<number, number> = { 1: 0.5, 2: 1.5, 3: 3, 5: 8, 8: 18 };

/** Read sprint_velocity, capacity_factor, hours_per_point, and ai_assisted_development from agents/config.yaml. */
export async function loadSprintConfig(): Promise<{
  sprintVelocity: number;
  capacityFactor: number;
  hoursPerPoint: Record<number, number>;
  aiAssisted: boolean;
  aiHoursPerPoint: Record<number, number>;
  testFraction: number;
  aiTestReductionFactor: number;
}> {
  let sprintVelocity = 25;
  let capacityFactor = 0.7;
  const hoursPerPoint: Record<number, number> = { ...DEFAULT_HOURS_PER_POINT };
  let aiAssisted = false;
  const aiHoursPerPoint: Record<number, number> = { ...DEFAULT_AI_HOURS_PER_POINT };
  let testFraction = 0.25;
  let aiTestReductionFactor = 0.10;
  try {
    const raw = await fsAsync.readFile(path.join(AGENTS_ROOT, 'config.yaml'), 'utf-8');
    let inHoursPerPoint = false;
    let inAiSection = false;
    let inAiHoursPerPoint = false;
    for (const line of raw.split('\n')) {
      const intMatch = line.match(/^sprint_velocity:\s*(\d+)/);
      if (intMatch) { sprintVelocity = parseInt(intMatch[1], 10); inHoursPerPoint = false; inAiSection = false; inAiHoursPerPoint = false; continue; }
      const floatMatch = line.match(/^capacity_factor:\s*([\d.]+)/);
      if (floatMatch) { capacityFactor = parseFloat(floatMatch[1]); inHoursPerPoint = false; inAiSection = false; inAiHoursPerPoint = false; continue; }
      if (/^hours_per_point:\s*$/.test(line)) { inHoursPerPoint = true; inAiSection = false; inAiHoursPerPoint = false; continue; }
      if (/^ai_assisted_development:\s*$/.test(line)) { inAiSection = true; inHoursPerPoint = false; inAiHoursPerPoint = false; continue; }
      if (inHoursPerPoint) {
        const hppMatch = line.match(/^\s+(\d+):\s*([\d.]+)/);
        if (hppMatch) {
          hoursPerPoint[parseInt(hppMatch[1], 10)] = parseFloat(hppMatch[2]);
        } else if (/^\S/.test(line)) {
          inHoursPerPoint = false;
        }
      }
      if (inAiSection) {
        const enabledMatch = line.match(/^\s+enabled:\s*(true|false)/);
        if (enabledMatch) { aiAssisted = enabledMatch[1] === 'true'; continue; }
        if (/^\s+ai_hours_per_point:\s*$/.test(line)) { inAiHoursPerPoint = true; continue; }
        const testFractionMatch = line.match(/^\s+test_fraction:\s*([\d.]+)/);
        if (testFractionMatch) { testFraction = parseFloat(testFractionMatch[1]); inAiHoursPerPoint = false; continue; }
        const aiTestRedMatch = line.match(/^\s+ai_test_reduction_factor:\s*([\d.]+)/);
        if (aiTestRedMatch) { aiTestReductionFactor = parseFloat(aiTestRedMatch[1]); inAiHoursPerPoint = false; continue; }
        if (inAiHoursPerPoint) {
          const hppMatch = line.match(/^\s+(\d+):\s*([\d.]+)/);
          if (hppMatch) {
            aiHoursPerPoint[parseInt(hppMatch[1], 10)] = parseFloat(hppMatch[2]);
          } else if (/^\S/.test(line)) {
            inAiSection = false;
            inAiHoursPerPoint = false;
          }
        }
        if (/^\S/.test(line)) { inAiSection = false; inAiHoursPerPoint = false; }
      }
    }
  } catch { /* fall through */ }
  return { sprintVelocity, capacityFactor, hoursPerPoint, aiAssisted, aiHoursPerPoint, testFraction, aiTestReductionFactor };
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
  const { sprintVelocity, capacityFactor, hoursPerPoint, aiAssisted, aiHoursPerPoint, testFraction, aiTestReductionFactor } = await loadSprintConfig();

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
