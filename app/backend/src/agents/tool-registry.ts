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

  function validateStory(story: any, p: string): void {
    for (const field of ['title', 'persona', 'goal', 'benefit', 'acceptanceCriteria', 'effort']) {
      if (story[field] === undefined || story[field] === null || story[field] === '') {
        issues.push(`${p}: missing required field "${field}"`);
      }
    }

    if (!Array.isArray(story.acceptanceCriteria) || story.acceptanceCriteria.length === 0) {
      issues.push(`${p}: acceptanceCriteria must be a non-empty array`);
    } else {
      const ac = story.acceptanceCriteria;
      if (ac.length < 2) issues.push(`${p}: too few acceptance criteria (${ac.length}) — minimum 2 required`);
      if (ac.length > 4) issues.push(`${p}: too many acceptance criteria (${ac.length}) — split the story if it needs more than 4`);
      ac.forEach((criterion: any, i: number) => {
        if (typeof criterion === 'string' && !GWT_RE.test(criterion)) {
          issues.push(`${p}.acceptanceCriteria[${i}]: must start with Given / When / Then`);
        }
      });
    }

    if (typeof story.effort !== 'number' || !FIBONACCI.has(story.effort)) {
      issues.push(`${p}: effort must be a Fibonacci number (1, 2, 3, 5, or 8)`);
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

  if (parsed.story) {
    validateStory(parsed.story, 'story');
  } else if (parsed.feature) {
    validateFeature(parsed.feature, 'feature');
  } else if (parsed.epic && parsed.features) {
    if (!parsed.epic.title) issues.push('epic: missing title');
    if (!Array.isArray(parsed.features) || parsed.features.length === 0) {
      issues.push('features must be a non-empty array');
    } else {
      if (parsed.features.length > 6) {
        issues.push(`${parsed.features.length} features exceeds the 6-feature limit — scope is too large for a single backlog`);
      }
      parsed.features.forEach((f: any, i: number) => validateFeature(f, `features[${i}]`));
    }
  } else {
    issues.push('Root must have one of: "story", "feature" (with stories), or "epic" + "features"');
  }

  return result(issues);
}

// ── validate_research_brief ───────────────────────────────────────────────────

function validateResearchBrief(input: Record<string, unknown>): string {
  const text = textInput(input);
  if (!text) return result(['Input "text" must be a non-empty string']);

  const issues: string[] = [];

  // Inline citations [N]
  const inlineCitations = text.match(/\[\d+\]/g) ?? [];
  if (inlineCitations.length < 5) {
    issues.push(`Only ${inlineCitations.length} inline citation(s) [N] found — minimum 5 required. Add a bracketed number immediately after every factual claim.`);
  }

  // References section
  const refSectionMatch = text.split(/^#{1,3}\s*references/im);
  if (refSectionMatch.length < 2) {
    issues.push('Missing References section. Add "## References" at the end listing all sources with matching [N] numbers.');
  } else {
    const refBody = refSectionMatch[1].split(/^#{1,3}\s/m)[0] ?? '';
    const refEntries = refBody.match(/^\[?\d+\]?[\.\)\s]/gm) ?? [];
    if (refEntries.length < 5) {
      issues.push(`References section has ${refEntries.length} entry/entries — minimum 5 required.`);
    }
    // Citation number vs reference count mismatch
    if (inlineCitations.length > 0 && refEntries.length > 0) {
      const maxNum = Math.max(...inlineCitations.map(c => parseInt(c.replace(/\[|\]/g, ''))));
      if (maxNum > refEntries.length) {
        issues.push(`Highest inline citation is [${maxNum}] but only ${refEntries.length} reference entries found — every [N] must have a matching entry.`);
      }
    }
  }

  // Suspicious / fabricated URLs
  const urls = text.match(/https?:\/\/[^\s\)>\]]+/g) ?? [];
  const fakeDomains = /\b(example|placeholder|fake|sample|test|foo|bar|yourdomain)\.com\b/i;
  for (const url of urls) {
    if (fakeDomains.test(url)) {
      issues.push(`Suspicious URL detected: ${url} — replace with a real source or use "[Assumption — no source found]".`);
    }
  }

  // Too many unverified assumptions
  const assumptions = (text.match(/\[assumption/gi) ?? []).length;
  if (assumptions > 3) {
    issues.push(`${assumptions} "[Assumption — no source found]" markers — try to find real citations for at least some of these before submitting.`);
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

  // Cost estimates
  if (!/cost estimate|estimated cost|monthly cost|per month|infrastructure cost|\$\d/i.test(text)) {
    issues.push('No cost estimates found — infrastructure costs must be estimated for all major components so the PM can evaluate the architecture.');
  }

  // Failure modes / resilience
  if (!/failure mode|failover|fallback|circuit.breaker|retry|timeout|unavailable|what happens (if|when)/i.test(text)) {
    issues.push('No failure mode documentation found — document how each core integration fails and what the system does in response.');
  }

  // Scalability assumptions
  if (!/scal|load|concurrent users|throughput|rps|rpm|peak (load|traffic)|requests per/i.test(text)) {
    issues.push('No scalability or load assumptions stated — define expected peak load and scaling approach for user-facing components.');
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
