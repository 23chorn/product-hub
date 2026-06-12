import * as fs from 'fs';
import * as path from 'path';
import Logger from '../utils/logger';
import { getActiveSkill } from './skill-registry';

const logger = new Logger('TOOL-REGISTRY');

const PROJECT_ROOT = path.resolve(__dirname, '../../../../');

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export type ToolHandler = (input: Record<string, unknown>) => Promise<string> | string;

// ── Registry ──────────────────────────────────────────────────────────────────

const _registry = new Map<string, ToolHandler>();

export function registerTool(name: string, handler: ToolHandler): void {
  _registry.set(name, handler);
  logger.info(`Registered tool: ${name}`);
}

export function getRegisteredTools(): string[] {
  return Array.from(_registry.keys());
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>
): Promise<string> {
  const handler = _registry.get(name);
  if (!handler) throw new Error(`No handler registered for tool "${name}"`);
  logger.info(`[TOOL] ${name} called with: ${JSON.stringify(input).slice(0, 200)}`);
  const result = await handler(input);
  logger.info(`[TOOL] ${name} result: ${String(result).slice(0, 200)}`);
  return result;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function textInput(input: Record<string, unknown>, field = 'text'): string | null {
  const v = input[field];
  return typeof v === 'string' && v.trim() ? v : null;
}

function result(issues: string[]): string {
  return JSON.stringify(issues.length === 0 ? { valid: true } : { valid: false, issues });
}

// ── validate_backlog_json ─────────────────────────────────────────────────────

function validateBacklogJson(input: Record<string, unknown>): string {
  const raw = input.json;
  if (typeof raw !== 'string') {
    return result(['Input "json" must be a string']);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (e: any) {
    return result([`Invalid JSON: ${e.message}`]);
  }

  const issues: string[] = [];
  const FIBONACCI = new Set([1, 2, 3, 5, 8]);
  const GWT_RE = /^\s*(given|when|then)\b/i;
  const STORY_ID_RE = /^F\d+\.S\d+$/;
  const VALID_PLATFORMS = new Set(['backend', 'web', 'ios', 'android']);

  function validateStory(story: any, p: string): void {
    // story_id format
    if (!story.story_id) {
      issues.push(`${p}: missing story_id`);
    } else if (!STORY_ID_RE.test(story.story_id)) {
      issues.push(`${p}: story_id "${story.story_id}" must follow F?.S? format (e.g. F1.S2)`);
    }

    if (!story.title) issues.push(`${p}: missing title`);

    // Support both new canonical names and old aliases
    const asA = story.as_a ?? story.persona;
    const iWant = story.i_want ?? story.goal;
    const soThat = story.so_that ?? story.benefit;
    if (!asA)   issues.push(`${p}: missing as_a (who the story is for)`);
    if (!iWant) issues.push(`${p}: missing i_want (the capability requested)`);
    if (!soThat) issues.push(`${p}: missing so_that (the benefit)`);

    // acceptance_criteria (product ACs, Given/When/Then)
    const ac = story.acceptance_criteria ?? story.acceptanceCriteria;
    if (!Array.isArray(ac) || ac.length === 0) {
      issues.push(`${p}: acceptance_criteria must be a non-empty array`);
    } else {
      if (ac.length < 2) issues.push(`${p}: too few acceptance criteria (${ac.length}) — minimum 2 required`);
      if (ac.length > 5) issues.push(`${p}: too many acceptance criteria (${ac.length}) — split the story if it needs more than 5`);
      ac.forEach((criterion: any, i: number) => {
        if (typeof criterion === 'string' && !GWT_RE.test(criterion)) {
          issues.push(`${p}.acceptance_criteria[${i}]: must start with Given / When / Then`);
        }
      });
    }

    // technical_acceptance_criteria (engineer ACs)
    if (!Array.isArray(story.technical_acceptance_criteria) || story.technical_acceptance_criteria.length === 0) {
      issues.push(`${p}: missing technical_acceptance_criteria — backend/platform engineers must add technical ACs`);
    }

    // platform tags
    const platforms = story.platform;
    if (!Array.isArray(platforms) || platforms.length === 0) {
      issues.push(`${p}: missing platform array — must include at least one of: backend, web, ios, android`);
    } else {
      const invalid = platforms.filter((pl: any) => !VALID_PLATFORMS.has(pl));
      if (invalid.length > 0) {
        issues.push(`${p}: invalid platform value(s): ${invalid.join(', ')} — must be one of: backend, web, ios, android`);
      }
    }

    // estimated_points (Fibonacci)
    const points = story.estimated_points ?? story.effort ?? story.storyPoints;
    if (typeof points !== 'number' || !FIBONACCI.has(points)) {
      issues.push(`${p}: estimated_points must be a Fibonacci number (1, 2, 3, 5, or 8)`);
    }

    // test_cases should be present (can be empty but must exist)
    if (!Array.isArray(story.test_cases)) {
      issues.push(`${p}: missing test_cases array — QA engineer must populate test cases`);
    }
  }

  function validateFeature(feature: any, p: string): void {
    if (!feature.title) issues.push(`${p}: missing title`);
    if (!Array.isArray(feature.stories) || feature.stories.length === 0) {
      issues.push(`${p}: stories must be a non-empty array`);
    } else {
      if (feature.stories.length > 12) {
        issues.push(`${p}: ${feature.stories.length} stories exceeds the 12-story-per-feature limit — split into multiple features`);
      }
      feature.stories.forEach((s: any, i: number) => validateStory(s, `${p}.stories[${i}]`));
    }
  }

  if (parsed.epic && parsed.features) {
    if (!parsed.epic.title) issues.push('epic: missing title');
    if (!Array.isArray(parsed.features) || parsed.features.length === 0) {
      issues.push('features must be a non-empty array');
    } else {
      if (parsed.features.length > 6) {
        issues.push(`${parsed.features.length} features exceeds the 6-feature limit — scope is too large for a single backlog`);
      }
      parsed.features.forEach((f: any, i: number) => validateFeature(f, `features[${i}]`));
    }
  } else if (parsed.feature) {
    validateFeature(parsed.feature, 'feature');
  } else if (parsed.story) {
    validateStory(parsed.story, 'story');
  } else {
    issues.push('Root must be one of: { epic, features[] } (standard), { feature } (single feature), or { story } (single story)');
  }

  return result(issues);
}

// ── validate_research_brief ───────────────────────────────────────────────────

function validateResearchBrief(input: Record<string, unknown>): string {
  const text = textInput(input);
  if (!text) return result(['Input "text" must be a non-empty string']);

  const issues: string[] = [];

  // Required sections
  if (!/executive summary/i.test(text)) {
    issues.push('Missing "Executive Summary" section — required at the top of every research brief.');
  } else {
    const afterExec = text.split(/executive summary/i)[1] ?? '';
    const execBody = afterExec.split(/^#{1,3}\s/m)[0] ?? '';
    if (execBody.trim().length < 100) {
      issues.push('"Executive Summary" is too brief — summarise the key opportunity, top 2–3 findings, and the recommended PM action.');
    }
  }

  if (!/problem space/i.test(text)) {
    issues.push('Missing "Problem Space" section — explain the user problem and current friction before any solution discussion.');
  }

  if (!/market|competitive|landscape/i.test(text)) {
    issues.push('Missing market or competitive landscape section — include at least one of: Market Size & Growth, Competitive Landscape, or Market Context.');
  }

  if (!/recommendation|pm question/i.test(text)) {
    issues.push('Missing Recommendations or PM Questions section — the brief must close with actionable output for the PM.');
  }

  // Suspicious / fabricated URLs (if web search WAS used, ensure URLs look real)
  const urls = text.match(/https?:\/\/[^\s\)>\]]+/g) ?? [];
  const fakeDomains = /\b(example|placeholder|fake|sample|test|foo|bar|yourdomain)\.com\b/i;
  for (const url of urls) {
    if (fakeDomains.test(url)) {
      issues.push(`Suspicious URL detected: ${url} — replace with a real source or remove the link entirely.`);
    }
  }

  return result(issues);
}

// ── validate_prd ──────────────────────────────────────────────────────────────

function validatePrd(input: Record<string, unknown>): string {
  const text = textInput(input);
  if (!text) return result(['Input "text" must be a non-empty string']);

  const issues: string[] = [];

  // Out of scope section
  if (!/out[\s-]of[\s-]scope/i.test(text)) {
    issues.push('Missing "Out of Scope" section — required to prevent scope creep in the backlog. List what is explicitly excluded.');
  } else {
    const afterOos = text.split(/out[\s-]of[\s-]scope/i)[1] ?? '';
    const oosBody = afterOos.split(/^#{1,3}\s/m)[0] ?? '';
    if (oosBody.trim().length < 40) {
      issues.push('"Out of Scope" section is present but appears empty — explicitly list excluded functionality.');
    }
  }

  // Success metrics completeness
  if (!/success metric/i.test(text)) {
    issues.push('No "Success Metrics" section found — required.');
  } else {
    const afterMetrics = text.split(/success metric/i)[1] ?? '';
    const metricsBody = afterMetrics.split(/^#{1,3}\s/m)[0] ?? '';
    if (!/baseline/i.test(metricsBody)) {
      issues.push('Success metrics are missing a baseline — every metric needs: baseline, target, timeframe, and measurement method.');
    }
    if (!/%|\d+[kKmM]?\s*(users|sessions|requests|orders|signups|conversions)|\d+\s*(days?|hours?|ms|seconds?)/i.test(metricsBody)) {
      issues.push('Success metrics do not appear to have specific numeric targets — avoid aspirational language; use measurable numbers.');
    }
  }

  // Counter-metrics / guardrails
  if (!/counter.metric|guardrail|not degrad|regression/i.test(text)) {
    issues.push('No counter-metrics or guardrail metrics found — required to protect against regressions in existing behaviour.');
  }

  // NFR measurability
  if (/non.functional|nfr/i.test(text)) {
    const afterNfr = text.split(/non.functional requirement|nfr/i)[1] ?? '';
    const nfrBody = afterNfr.split(/^#{1,3}\s/m)[0] ?? '';
    if (/should (be|feel|seem|appear) (fast|smooth|responsive|reliable|scalable|snappy|quick)/i.test(nfrBody)) {
      issues.push('NFRs contain vague language without measurable thresholds (e.g. "should feel fast"). Replace with specific numbers (e.g. "P95 response < 2s under 1000 concurrent users").');
    }
  }

  // Personas present
  if (!/persona/i.test(text)) {
    issues.push('No personas section found — PRD must define who the target users are.');
  }

  // Open questions / risks section
  if (!/open questions?|open risks?/i.test(text)) {
    issues.push('Missing "Open Questions & Risks" section — unresolved questions and identified risks must be listed before handoff to architecture and backlog stages.');
  }

  return result(issues);
}

// ── validate_architecture ─────────────────────────────────────────────────────

function validateArchitecture(input: Record<string, unknown>): string {
  const text = textInput(input);
  if (!text) return result(['Input "text" must be a non-empty string']);

  const issues: string[] = [];

  // Unresolved TBD decisions
  const tbdMatches = text.match(/\bTBD\b|\bto be determined\b|\bto be decided\b/gi) ?? [];
  if (tbdMatches.length > 0) {
    issues.push(`${tbdMatches.length} unresolved "TBD" decision(s) found — the architecture must make definitive technology choices, not defer them.`);
  }

  // Repository Impact section — required for every initiative
  if (!/repository impact/i.test(text)) {
    issues.push('Missing "Repository Impact" section — every repo in repos.md must be listed with the changes required (or "No changes"). Story decomposition agents depend on this.');
  } else {
    const afterRepoImpact = text.split(/repository impact/i)[1] ?? '';
    const repoBody = afterRepoImpact.split(/^#{1,3}\s/m)[0] ?? '';
    // Should reference at least a few known repos
    const repoRefs = repoBody.match(/xcube-\w+/gi) ?? [];
    if (repoRefs.length < 3) {
      issues.push('Repository Impact section references fewer than 3 repos — ensure all repos in repos.md are accounted for, even if they have "No changes".');
    }
  }

  // Cross-Platform Contracts section — required when multiple platforms are involved
  if (!/cross.platform contracts/i.test(text)) {
    issues.push('Missing "Cross-Platform Contracts" section — shared DTOs, pub/sub channel names, and cross-repo API calls must be documented so platform engineers agree on interfaces before story decomposition.');
  }

  // Cost estimates (Estimated Cost table in Deployment section)
  if (!/cost estimate|estimated cost|monthly cost|per month|infrastructure cost|\$\d/i.test(text)) {
    issues.push('No cost estimates found — the Deployment section must include estimated infrastructure costs so the PM can evaluate build vs buy decisions.');
  }

  // Failure modes / resilience
  if (!/failure mode|failover|fallback|circuit.breaker|retry|timeout|unavailable/i.test(text)) {
    issues.push('No failure mode documentation found — the "Key Dependencies & Failure Modes" table must cover what happens when each external dependency is unavailable.');
  }

  return result(issues);
}

// ── validate_gtm_strategy ─────────────────────────────────────────────────────

function validateGtmStrategy(input: Record<string, unknown>): string {
  const text = textInput(input);
  if (!text) return result(['Input "text" must be a non-empty string']);

  const issues: string[] = [];

  // Moore positioning template: "For [X] who [Y], [product] is [category] that [benefit]. Unlike [Z], [product] [differentiator]."
  const hasFor   = /\bfor\b.{1,120}\bwho\b/i.test(text);
  const hasUnlike = /\bunlike\b/i.test(text);
  if (!hasFor || !hasUnlike) {
    issues.push(
      'Positioning statement does not follow the Geoffrey Moore template: ' +
      '"For [segment] who [need], [product] is [category] that [benefit]. Unlike [alternative], [product] [differentiator]." ' +
      `Missing: ${[!hasFor && '"For … who …"', !hasUnlike && '"Unlike …"'].filter(Boolean).join(', ')}.`
    );
  }

  // Three launch phases
  const missingPhases = [
    !(/pre.launch/i.test(text)) && 'Pre-launch',
    !(/launch week/i.test(text)) && 'Launch Week',
    !(/post.launch/i.test(text)) && 'Post-Launch',
  ].filter(Boolean) as string[];
  if (missingPhases.length > 0) {
    issues.push(`Missing launch phase(s): ${missingPhases.join(', ')} — all three phases are required, each with activities and a success signal.`);
  }

  // Leading and lagging indicators
  const hasLeading = /leading indicator/i.test(text);
  const hasLagging = /lagging indicator/i.test(text);
  if (!hasLeading || !hasLagging) {
    const missing = [!hasLeading && 'leading indicators', !hasLagging && 'lagging indicators'].filter(Boolean).join(' and ');
    issues.push(`GTM metrics are missing ${missing} — distinguish early traction signals (leading) from 30/60/90-day outcomes (lagging), each with a target and measurement method.`);
  }

  // Channel recommendations present
  if (!/channel/i.test(text)) {
    issues.push('No channel recommendations found — every target segment needs a prioritised channel with rationale and cost-to-reach tier.');
  }

  return result(issues);
}

// ── get_context_file ──────────────────────────────────────────────────────────

function getContextFile(input: Record<string, unknown>): string {
  const filename = input.filename;
  if (typeof filename !== 'string' || !filename) {
    return 'Error: filename must be a non-empty string';
  }

  // Prevent path traversal
  const safe = path.basename(filename);
  if (safe !== filename || filename.includes('..') || filename.includes('/')) {
    return 'Error: invalid filename — provide only the filename, not a path';
  }

  const filePath = path.join(PROJECT_ROOT, 'context', safe);
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return `Error: context file "${safe}" not found`;
  }
}

// ── get_domain_skill_context ──────────────────────────────────────────────────

function getDomainSkillContext(input: Record<string, unknown>): string {
  const skillName = input.skill_name;
  if (typeof skillName !== 'string' || !skillName.trim()) {
    return 'Error: skill_name must be a non-empty string';
  }

  const skill = getActiveSkill(skillName.trim());
  if (!skill) {
    return `No active skill found with name "${skillName}". Check the Skill Editor for available skill names.`;
  }

  if (skill.discipline === 'agent') {
    return `"${skillName}" is an agent skill, not a domain skill. Use a dev/qa/design/general discipline skill for domain context.`;
  }

  if (!skill.development_context) {
    return `Skill "${skillName}" exists (${skill.discipline}, v${skill.version}) but has no development context defined yet.`;
  }

  return `## Domain Context: ${skillName} (${skill.discipline}, v${skill.version})\n\n${skill.development_context}`;
}

// ── Register all tools ────────────────────────────────────────────────────────

registerTool('validate_backlog_json',   validateBacklogJson);
registerTool('validate_research_brief', validateResearchBrief);
registerTool('validate_prd',            validatePrd);
registerTool('validate_architecture',   validateArchitecture);
registerTool('validate_gtm_strategy',   validateGtmStrategy);
registerTool('get_context_file',        getContextFile);
registerTool('get_domain_skill_context', getDomainSkillContext);
