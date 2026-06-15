/**
 * tool-validators — per-stage structural JSON validators registered as tools the
 * specialist agents call before returning output. Each checks field presence,
 * array minimums, length/format limits, and flags TBD/vague language. Pure
 * functions over the tool input; registered in tool-registry.ts.
 */

// ── Shared helpers ────────────────────────────────────────────────────────────

function ok(): string {
  return JSON.stringify({ valid: true });
}

function fail(issues: string[]): string {
  return JSON.stringify({ valid: false, issues });
}

function result(issues: string[]): string {
  return issues.length === 0 ? ok() : fail(issues);
}

function parseJson(input: Record<string, unknown>): { parsed: any; issues: string[] } | { parsed: null; issues: string[] } {
  const raw = input.json;
  if (typeof raw !== 'string' || !raw.trim()) {
    return { parsed: null, issues: ['Input "json" must be a non-empty string'] };
  }
  // Strip markdown code fences if the model wrapped the JSON
  const stripped = raw.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
  try {
    return { parsed: JSON.parse(stripped), issues: [] };
  } catch (e: any) {
    return { parsed: null, issues: [`Invalid JSON: ${e.message}`] };
  }
}

function req(obj: any, field: string, label: string, issues: string[]): boolean {
  if (obj == null || obj[field] == null || obj[field] === '') {
    issues.push(`${label}: missing or empty "${field}"`);
    return false;
  }
  return true;
}

function reqArray(obj: any, field: string, label: string, issues: string[], minLen = 1): any[] | null {
  const arr = obj?.[field];
  if (!Array.isArray(arr)) { issues.push(`${label}: "${field}" must be an array`); return null; }
  if (arr.length < minLen) { issues.push(`${label}: "${field}" must have at least ${minLen} item(s) (got ${arr.length})`); }
  return arr;
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function hasTBD(obj: any): boolean {
  if (typeof obj === 'string') return /\bTBD\b|\bto be determined\b|\bto be decided\b/i.test(obj);
  if (Array.isArray(obj)) return obj.some(hasTBD);
  if (obj && typeof obj === 'object') return Object.values(obj).some(hasTBD);
  return false;
}

const FAKE_URL_RE = /\b(example|placeholder|fake|sample|test\.com|foo\.com|bar\.com|yourdomain)\.com\b/i;
const GWT_RE = /^\s*(given|when|then)\b/i;
const FIBONACCI = new Set([1, 2, 3, 5, 8]);
const STORY_ID_RE = /^F\d+\.S\d+$/;
const VALID_PLATFORMS = new Set(['backend', 'web', 'ios', 'android']);

// ── validate_analyst_json ─────────────────────────────────────────────────────

export function validateAnalystJson(input: Record<string, unknown>): string {
  const { parsed, issues } = parseJson(input);
  if (parsed === null) return fail(issues);

  const p = parsed;
  req(p, 'title', 'root', issues);
  req(p, 'executive_summary', 'root', issues);
  req(p, 'problem_space', 'root', issues);
  req(p, 'conclusion', 'root', issues);

  // market_size
  if (!p.market_size || typeof p.market_size !== 'object') {
    issues.push('root: "market_size" object is required');
  } else {
    ['tam', 'growth_cagr', 'key_driver'].forEach(f => req(p.market_size, f, 'market_size', issues));
  }

  // target_users
  const users = reqArray(p, 'target_users', 'root', issues, 1);
  users?.forEach((u: any, i: number) => {
    const lp = `target_users[${i}]`;
    req(u, 'segment', lp, issues);
    req(u, 'job_to_be_done', lp, issues);
    req(u, 'current_workaround', lp, issues);
    req(u, 'key_frustration', lp, issues);
  });

  // competitive_landscape — need at least 2 players (product itself + ≥1 competitor)
  const comp = reqArray(p, 'competitive_landscape', 'root', issues, 2);
  comp?.forEach((c: any, i: number) => {
    const lp = `competitive_landscape[${i}]`;
    req(c, 'player', lp, issues);
    req(c, 'strength', lp, issues);
    req(c, 'gap', lp, issues);
  });

  // constraints_and_risks
  const risks = reqArray(p, 'constraints_and_risks', 'root', issues, 1);
  risks?.forEach((r: any, i: number) => {
    req(r, 'risk', `constraints_and_risks[${i}]`, issues);
    req(r, 'mitigation', `constraints_and_risks[${i}]`, issues);
  });

  // strategic_recommendations
  const recs = reqArray(p, 'strategic_recommendations', 'root', issues, 2);
  recs?.forEach((r: any, i: number) => {
    if (typeof r !== 'string' || !r.trim()) {
      issues.push(`strategic_recommendations[${i}]: must be a non-empty string`);
    }
  });

  // references + citation check
  const refs = reqArray(p, 'references', 'root', issues, 1);
  refs?.forEach((r: any, i: number) => {
    const lp = `references[${i}]`;
    if (typeof r.id !== 'number') issues.push(`${lp}: "id" must be a number`);
    req(r, 'title', lp, issues);
    req(r, 'url', lp, issues);
    if (r.url && FAKE_URL_RE.test(r.url)) {
      issues.push(`${lp}: suspicious placeholder URL "${r.url}" — only include URLs returned by web search`);
    }
  });

  // Inline citation check — executive_summary should reference at least one [N]
  if (refs && refs.length > 0 && typeof p.executive_summary === 'string') {
    if (!p.executive_summary.includes('[')) {
      issues.push('executive_summary: no inline citations found (e.g. [1]) — every factual claim must be cited with an inline [N] reference');
    }
  }

  return result(issues);
}

// ── validate_prd_json ─────────────────────────────────────────────────────────

export function validatePrdJson(input: Record<string, unknown>): string {
  const { parsed, issues } = parseJson(input);
  if (parsed === null) return fail(issues);

  const p = parsed;
  req(p, 'title', 'root', issues);
  req(p, 'status', 'root', issues);
  req(p, 'problem_statement', 'root', issues);

  // personas
  const personas = reqArray(p, 'personas', 'root', issues, 1);
  personas?.forEach((pe: any, i: number) => {
    const lp = `personas[${i}]`;
    req(pe, 'name', lp, issues);
    req(pe, 'description', lp, issues);
    req(pe, 'goal', lp, issues);
    req(pe, 'pain', lp, issues);
  });

  // user_journeys
  const journeys = reqArray(p, 'user_journeys', 'root', issues, 1);
  journeys?.forEach((j: any, i: number) => {
    const lp = `user_journeys[${i}]`;
    req(j, 'id', lp, issues);
    req(j, 'name', lp, issues);
    const steps = j?.steps;
    if (!Array.isArray(steps) || steps.length < 2) {
      issues.push(`${lp}: "steps" must have at least 2 steps`);
    }
  });

  // success_metrics
  if (!p.success_metrics || typeof p.success_metrics !== 'object') {
    issues.push('root: "success_metrics" object is required');
  } else {
    const sm = p.success_metrics;
    // primary
    if (!sm.primary || typeof sm.primary !== 'object') {
      issues.push('success_metrics: "primary" object is required');
    } else {
      ['metric', 'baseline', 'target', 'timeframe', 'measurement'].forEach(f => req(sm.primary, f, 'success_metrics.primary', issues));
      if (sm.primary.baseline === sm.primary.target && sm.primary.baseline === '') {
        issues.push('success_metrics.primary: baseline and target are both empty — provide real numbers');
      }
    }
    // secondary
    if (!Array.isArray(sm.secondary)) {
      issues.push('success_metrics: "secondary" must be an array');
    }
    // counter metrics — required guardrail
    const counter = sm.counter;
    if (!Array.isArray(counter) || counter.length === 0) {
      issues.push('success_metrics: "counter" must be a non-empty array — at least one guardrail metric is required to protect against regressions');
    } else {
      counter.forEach((c: any, i: number) => {
        req(c, 'metric', `success_metrics.counter[${i}]`, issues);
        req(c, 'acceptable_floor', `success_metrics.counter[${i}]`, issues);
        req(c, 'measurement', `success_metrics.counter[${i}]`, issues);
      });
    }
  }

  // non_functional_requirements
  const nfrs = reqArray(p, 'non_functional_requirements', 'root', issues, 1);
  const VAGUE_NFR = /\b(should feel|feel fast|feel smooth|feel responsive|be fast|be smooth|be responsive|be snappy|be reliable|seem fast|appear fast)\b/i;
  const HAS_THRESHOLD = /\d+\s*(ms|s|sec|min|%|req|rps|concurrent|users?|connections?|kb|mb|gb)/i;
  nfrs?.forEach((n: any, i: number) => {
    const lp = `non_functional_requirements[${i}]`;
    req(n, 'id', lp, issues);
    req(n, 'category', lp, issues);
    req(n, 'requirement', lp, issues);
    req(n, 'priority', lp, issues);
    if (n.priority && !['Must', 'Should', 'Nice-to-have'].includes(n.priority)) {
      issues.push(`${lp}: "priority" must be Must | Should | Nice-to-have (got "${n.priority}")`);
    }
    if (typeof n.requirement === 'string') {
      if (VAGUE_NFR.test(n.requirement)) {
        issues.push(`${lp}: vague NFR language detected — replace with a specific measurable threshold (e.g. "P95 latency < 200ms")`);
      }
      if (n.priority === 'Must' && !HAS_THRESHOLD.test(n.requirement)) {
        issues.push(`${lp}: Must-priority NFR has no measurable threshold — add a specific number and unit`);
      }
    }
  });

  // NFR category coverage — Performance and Security are mandatory
  if (Array.isArray(p.non_functional_requirements)) {
    const presentCategories = new Set(
      p.non_functional_requirements
        .map((n: any) => (typeof n.category === 'string' ? n.category.toLowerCase() : ''))
    );
    const required = ['performance', 'security'];
    const missing = required.filter(cat => !presentCategories.has(cat));
    if (missing.length > 0) {
      issues.push(`non_functional_requirements: missing required categories: ${missing.join(', ')} — every PRD must cover Performance and Security NFRs`);
    }
  }

  // functional_requirements — aim for 10–20
  const frs = reqArray(p, 'functional_requirements', 'root', issues, 5);
  if (frs) {
    if (frs.length < 10) issues.push(`functional_requirements: only ${frs.length} requirements — aim for 10–20 for a complete MVP scope`);
    if (frs.length > 20) issues.push(`functional_requirements: ${frs.length} requirements exceeds 20 — consider deferring lower-priority items to out_of_scope`);
    frs.forEach((fr: any, i: number) => {
      req(fr, 'id', `functional_requirements[${i}]`, issues);
      req(fr, 'requirement', `functional_requirements[${i}]`, issues);
    });
  }

  // out_of_scope — required
  const oos = reqArray(p, 'out_of_scope', 'root', issues, 1);
  oos?.forEach((item: any, i: number) => {
    if (typeof item !== 'string' || !item.trim()) {
      issues.push(`out_of_scope[${i}]: must be a non-empty string`);
    }
  });

  // open_questions
  if (!Array.isArray(p.open_questions)) {
    issues.push('root: "open_questions" must be an array (can be empty)');
  }

  return result(issues);
}

// ── validate_architecture_json ────────────────────────────────────────────────

export function validateArchitectureJson(input: Record<string, unknown>): string {
  const { parsed, issues } = parseJson(input);
  if (parsed === null) return fail(issues);

  const p = parsed;
  req(p, 'title', 'root', issues);
  req(p, 'overview', 'root', issues);
  req(p, 'system_diagram', 'root', issues);

  // TBD scan across the whole document
  if (hasTBD(p)) {
    issues.push('Unresolved "TBD" or "to be determined" found — the architecture must make definitive technology choices, not defer them');
  }

  // technology_decisions — at least one platform key with entries
  if (!p.technology_decisions || typeof p.technology_decisions !== 'object' || Array.isArray(p.technology_decisions)) {
    issues.push('root: "technology_decisions" must be an object keyed by platform');
  } else {
    const platforms = Object.keys(p.technology_decisions);
    if (platforms.length === 0) {
      issues.push('technology_decisions: must include at least one platform section');
    }
    platforms.forEach(pl => {
      const decisions = p.technology_decisions[pl];
      if (!Array.isArray(decisions) || decisions.length === 0) return;
      decisions.forEach((d: any, i: number) => {
        const lp = `technology_decisions.${pl}[${i}]`;
        req(d, 'decision', lp, issues);
        req(d, 'choice', lp, issues);
        req(d, 'rationale', lp, issues);
        // alternatives must be substantive — not empty, "None", "N/A", or fewer than 15 chars
        if (!d.alternatives || typeof d.alternatives !== 'string' || d.alternatives.trim() === '') {
          issues.push(`${lp}: "alternatives" is required — document at least one alternative considered`);
        } else {
          const altTrimmed = d.alternatives.trim().toLowerCase();
          if (['none', 'n/a', 'na', '-', 'none considered'].includes(altTrimmed) || d.alternatives.trim().length < 15) {
            issues.push(`${lp}: "alternatives" is too thin ("${d.alternatives.trim()}") — name specific alternatives evaluated (e.g. "Evaluated SignalR — ruled out because web stack already uses native WebSocket")`);
          }
        }
      });
    });
  }

  // new_dependencies — required field; validate structure if non-empty
  if (!Array.isArray(p.new_dependencies)) {
    issues.push('root: "new_dependencies" must be an array — use [] if all technology choices reuse the existing stack, or list each new technology with its justification');
  } else {
    p.new_dependencies.forEach((dep: any, i: number) => {
      const lp = `new_dependencies[${i}]`;
      req(dep, 'name', lp, issues);
      req(dep, 'type', lp, issues);
      req(dep, 'not_solvable_with_existing_stack_because', lp, issues);
      req(dep, 'existing_alternatives_evaluated', lp, issues);
      req(dep, 'cost_or_risk', lp, issues);
      // justification must be substantive
      const justification = dep.not_solvable_with_existing_stack_because;
      if (typeof justification === 'string' && justification.trim().length < 20) {
        issues.push(`${lp}: "not_solvable_with_existing_stack_because" is too vague — explain specifically what the existing stack cannot do`);
      }
    });
  }

  // data_model
  if (!p.data_model || typeof p.data_model !== 'object') {
    issues.push('root: "data_model" object is required');
  } else {
    req(p.data_model, 'entity_relationship_diagram', 'data_model', issues);
    const entities = reqArray(p.data_model, 'entities', 'data_model', issues, 1);
    entities?.forEach((e: any, i: number) => {
      const lp = `data_model.entities[${i}]`;
      req(e, 'name', lp, issues);
      req(e, 'primary_key', lp, issues);
      req(e, 'key_fields', lp, issues);
      req(e, 'relationships', lp, issues);
    });
  }

  // api_surface
  const apis = reqArray(p, 'api_surface', 'root', issues, 1);
  apis?.forEach((svc: any, i: number) => {
    const lp = `api_surface[${i}]`;
    req(svc, 'service', lp, issues);
    const eps = svc?.endpoints;
    if (!Array.isArray(eps) || eps.length === 0) {
      issues.push(`${lp}: "endpoints" must be a non-empty array`);
    } else {
      eps.forEach((ep: any, j: number) => {
        const elp = `${lp}.endpoints[${j}]`;
        req(ep, 'method', elp, issues);
        req(ep, 'path', elp, issues);
        req(ep, 'purpose', elp, issues);
        req(ep, 'request', elp, issues);
        req(ep, 'response', elp, issues);
      });
    }
  });

  // repository_impact
  const repos = reqArray(p, 'repository_impact', 'root', issues, 1);
  repos?.forEach((r: any, i: number) => {
    const lp = `repository_impact[${i}]`;
    req(r, 'repo', lp, issues);
    req(r, 'changes_required', lp, issues);
  });

  // data_flows
  const flows = reqArray(p, 'data_flows', 'root', issues, 1);
  flows?.forEach((f: any, i: number) => {
    const lp = `data_flows[${i}]`;
    req(f, 'name', lp, issues);
    const steps = f?.steps;
    if (!Array.isArray(steps) || steps.length < 2) {
      issues.push(`${lp}: "steps" must have at least 2 steps`);
    }
  });

  // infrastructure
  if (!p.infrastructure || typeof p.infrastructure !== 'object') {
    issues.push('root: "infrastructure" object is required');
  } else {
    const infra = p.infrastructure;
    req(infra, 'hosting', 'infrastructure', issues);
    req(infra, 'cost_estimate', 'infrastructure', issues);
    if (!Array.isArray(infra.deployment_pipeline) || infra.deployment_pipeline.length === 0) {
      issues.push('infrastructure: "deployment_pipeline" must be a non-empty array');
    }
    const fms = reqArray(infra, 'failure_modes', 'infrastructure', issues, 1);
    fms?.forEach((fm: any, i: number) => {
      req(fm, 'mode', `infrastructure.failure_modes[${i}]`, issues);
      req(fm, 'mitigation', `infrastructure.failure_modes[${i}]`, issues);
    });
  }

  // security_considerations
  reqArray(p, 'security_considerations', 'root', issues, 1);

  // epic_features_enriched
  if (!p.epic_features_enriched || typeof p.epic_features_enriched !== 'object') {
    issues.push('root: "epic_features_enriched" object is required — story decomposition agents depend on this field');
  } else {
    const efe = p.epic_features_enriched;
    if (!efe.epic?.title) issues.push('epic_features_enriched.epic: "title" is required');
    const features = reqArray(efe, 'features', 'epic_features_enriched', issues, 1);
    features?.forEach((f: any, i: number) => {
      const lp = `epic_features_enriched.features[${i}]`;
      req(f, 'title', lp, issues);
      req(f, 'cross_repo_boundaries', lp, issues);
      req(f, 'technical_notes', lp, issues);
      if (!Array.isArray(f.target_repos) || f.target_repos.length === 0) {
        issues.push(`${lp}: "target_repos" must be a non-empty array`);
      }
      if (!Array.isArray(f.data_contracts) || f.data_contracts.length === 0) {
        issues.push(`${lp}: "data_contracts" must be a non-empty array`);
      }
      if (!Array.isArray(f.risks) || f.risks.length === 0) {
        issues.push(`${lp}: "risks" must be a non-empty array — document at least one technical risk per feature`);
      }
    });
  }

  return result(issues);
}

// ── validate_backlog_json ─────────────────────────────────────────────────────

export function validateBacklogJson(input: Record<string, unknown>): string {
  const raw = input.json;
  if (typeof raw !== 'string') {
    return fail(['Input "json" must be a string']);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (e: any) {
    return fail([`Invalid JSON: ${e.message}`]);
  }

  const issues: string[] = [];
  const allStoryIds: string[] = [];

  function validateStory(story: any, p: string): void {
    if (!story.story_id) {
      issues.push(`${p}: missing story_id`);
    } else if (!STORY_ID_RE.test(story.story_id)) {
      issues.push(`${p}: story_id "${story.story_id}" must follow F?.S? format (e.g. F1.S2)`);
    } else {
      allStoryIds.push(story.story_id);
    }

    if (!story.title) issues.push(`${p}: missing title`);

    const asA   = story.as_a   ?? story.persona;
    const iWant = story.i_want ?? story.goal;
    const soThat = story.so_that ?? story.benefit;
    if (!asA)    issues.push(`${p}: missing as_a`);
    if (!iWant)  issues.push(`${p}: missing i_want`);
    if (!soThat) issues.push(`${p}: missing so_that`);

    const ac = story.acceptance_criteria ?? story.acceptanceCriteria;
    if (!Array.isArray(ac) || ac.length === 0) {
      issues.push(`${p}: acceptance_criteria must be a non-empty array`);
    } else {
      if (ac.length < 2) issues.push(`${p}: too few acceptance criteria (${ac.length}) — minimum 2`);
      if (ac.length > 5) issues.push(`${p}: too many acceptance criteria (${ac.length}) — maximum 5`);
      ac.forEach((c: any, i: number) => {
        if (typeof c === 'string' && !GWT_RE.test(c)) {
          issues.push(`${p}.acceptance_criteria[${i}]: must start with Given / When / Then`);
        }
      });
    }

    if (!Array.isArray(story.technical_acceptance_criteria) || story.technical_acceptance_criteria.length === 0) {
      issues.push(`${p}: missing technical_acceptance_criteria`);
    }

    const platforms = story.platform;
    if (!Array.isArray(platforms) || platforms.length === 0) {
      issues.push(`${p}: missing platform array`);
    } else {
      const invalid = platforms.filter((pl: any) => !VALID_PLATFORMS.has(pl));
      if (invalid.length > 0) {
        issues.push(`${p}: invalid platform value(s): ${invalid.join(', ')}`);
      }
    }

    const points = story.estimated_points ?? story.effort ?? story.storyPoints;
    if (typeof points !== 'number' || !FIBONACCI.has(points)) {
      issues.push(`${p}: estimated_points must be a Fibonacci number (1, 2, 3, 5, or 8)`);
    }

    if (!Array.isArray(story.test_cases)) {
      issues.push(`${p}: missing test_cases array`);
    }
  }

  function validateFeature(feature: any, p: string): void {
    if (!feature.title) issues.push(`${p}: missing title`);
    if (!Array.isArray(feature.stories) || feature.stories.length === 0) {
      issues.push(`${p}: stories must be a non-empty array`);
    } else {
      if (feature.stories.length > 12) {
        issues.push(`${p}: ${feature.stories.length} stories exceeds the 12-story limit`);
      }
      feature.stories.forEach((s: any, i: number) => validateStory(s, `${p}.stories[${i}]`));
    }
  }

  let allStories: any[] = [];

  if (parsed.epic && parsed.features) {
    if (!parsed.epic.title) issues.push('epic: missing title');
    if (!Array.isArray(parsed.features) || parsed.features.length === 0) {
      issues.push('features must be a non-empty array');
    } else {
      if (parsed.features.length > 6) {
        issues.push(`${parsed.features.length} features exceeds the 6-feature limit`);
      }
      parsed.features.forEach((f: any, i: number) => validateFeature(f, `features[${i}]`));
      allStories = parsed.features.flatMap((f: any) => Array.isArray(f.stories) ? f.stories : []);
    }
  } else if (parsed.feature) {
    validateFeature(parsed.feature, 'feature');
    allStories = Array.isArray(parsed.feature.stories) ? parsed.feature.stories : [];
  } else if (parsed.story) {
    validateStory(parsed.story, 'story');
    allStories = [parsed.story];
  } else {
    issues.push('Root must be one of: { epic, features[] }, { feature }, or { story }');
  }

  // Duplicate story_id detection
  const seenIds = new Set<string>();
  for (const id of allStoryIds) {
    if (seenIds.has(id)) {
      issues.push(`Duplicate story_id "${id}" — each story must have a unique ID`);
    }
    seenIds.add(id);
  }

  // depends_on referential integrity
  for (const story of allStories) {
    const deps: any[] = Array.isArray(story.depends_on) ? story.depends_on : [];
    for (const dep of deps) {
      if (typeof dep === 'string' && dep.trim() && !seenIds.has(dep)) {
        issues.push(`story "${story.story_id}": depends_on references unknown story_id "${dep}" — all dependencies must exist in this feature batch`);
      }
    }
  }

  // Sprint velocity ceiling — flag if total points exceed a 2-week sprint max
  const totalPoints = allStories.reduce((sum: number, s: any) => {
    const p = s.estimated_points ?? s.effort ?? s.storyPoints;
    return sum + (typeof p === 'number' ? p : 0);
  }, 0);
  if (allStories.length > 0 && totalPoints > 80) {
    issues.push(`Total story points (${totalPoints}) exceed the 80-point sprint ceiling — this feature batch cannot be completed in a single sprint. Split stories or defer lower-priority items.`);
  }

  return result(issues);
}

// ── validate_epic_features_json ───────────────────────────────────────────────

const VALID_PHASES = new Set(['MVP', 'Phase 1', 'Phase 2', 'Phase 3']);
const FR_ID_RE = /^FR-\d+$/;
const MAX_FEATURES_PER_PHASE = 5;
const MAX_PHASES = 4;

function validateFeature(f: any, lp: string, issues: string[]): void {
  req(f, 'title', lp, issues);
  req(f, 'description', lp, issues);

  // Acceptance criteria — feature level, 3–5
  const ac = f.acceptanceCriteria ?? f.acceptance_criteria;
  if (!Array.isArray(ac) || ac.length === 0) {
    issues.push(`${lp}: "acceptanceCriteria" must be a non-empty array`);
  } else {
    if (ac.length < 3) issues.push(`${lp}: only ${ac.length} acceptance criteria — minimum 3 feature-level ACs required`);
    if (ac.length > 5) issues.push(`${lp}: ${ac.length} acceptance criteria exceeds maximum of 5`);
    ac.forEach((c: any, j: number) => {
      if (typeof c === 'string' && (c.includes('As a user') || c.toLowerCase().startsWith('as a'))) {
        issues.push(`${lp}.acceptanceCriteria[${j}]: looks like a user story, not a feature-level AC — write testable outcome conditions`);
      }
    });
  }

  // prdRef with functional requirement IDs
  if (!f.prdRef || typeof f.prdRef !== 'object') {
    issues.push(`${lp}: "prdRef" object is required for PRD traceability`);
  } else {
    if (!Array.isArray(f.prdRef.functionalRequirements) || f.prdRef.functionalRequirements.length === 0) {
      issues.push(`${lp}: prdRef.functionalRequirements must reference at least one FR-XX from the PRD`);
    } else {
      f.prdRef.functionalRequirements.forEach((fr: any, j: number) => {
        if (typeof fr !== 'string' || !FR_ID_RE.test(fr)) {
          issues.push(`${lp}.prdRef.functionalRequirements[${j}]: "${fr}" must match FR-XX format`);
        }
      });
    }
  }

  // stories must be explicitly empty
  if (!Array.isArray(f.stories)) {
    issues.push(`${lp}: "stories" must be an empty array [] — user stories are added by the story decomposition agent`);
  } else if (f.stories.length > 0) {
    issues.push(`${lp}: "stories" must be empty [] at this stage — found ${f.stories.length} item(s). Story decomposition is a separate stage.`);
  }

  if (hasTBD(f)) {
    issues.push(`${lp}: contains unresolved "TBD" — every field must be a definitive decision`);
  }
}

export function validateEpicFeaturesJson(input: Record<string, unknown>): string {
  const { parsed, issues } = parseJson(input);
  if (parsed === null) return fail(issues);

  const p = parsed;

  // Epic header
  if (!p.epic || typeof p.epic !== 'object') {
    issues.push('root: "epic" object is required');
  } else {
    ['title', 'description', 'businessValue', 'prdLink'].forEach(f =>
      req(p.epic, f, 'epic', issues)
    );
    if (typeof p.epic.title === 'string' && p.epic.title.split(/\s+/).length > 6) {
      issues.push('epic.title: must be 3-6 words — keep it short and memorable');
    }
  }

  // New phases[] structure (required)
  if (!Array.isArray(p.phases) || p.phases.length === 0) {
    issues.push('root: "phases" array is required — features must be nested under phases (MVP, Phase 1, Phase 2, Phase 3)');
  } else {
    if (p.phases.length > MAX_PHASES) {
      issues.push(`phases: ${p.phases.length} phases exceeds the maximum of ${MAX_PHASES} — consolidate or defer to outOfScope`);
    }

    const hasMvp = p.phases.some((ph: any) => ph.label === 'MVP');
    if (!hasMvp) {
      issues.push('phases: no MVP phase found — the first phase must be labeled "MVP"');
    }

    let totalFeatures = 0;
    let allMvp = true;

    p.phases.forEach((phase: any, i: number) => {
      const pp = `phases[${i}]`;
      req(phase, 'label', pp, issues);
      req(phase, 'epicTitle', pp, issues);
      req(phase, 'deliverable', pp, issues);

      if (phase.label && !VALID_PHASES.has(phase.label)) {
        issues.push(`${pp}: "label" must be exactly "MVP", "Phase 1", "Phase 2", or "Phase 3" (got "${phase.label}")`);
      }
      if (phase.label !== 'MVP') allMvp = false;

      if (!Array.isArray(phase.features) || phase.features.length === 0) {
        issues.push(`${pp}: "features" must be a non-empty array — each phase must have at least 1 feature`);
      } else {
        if (phase.features.length > MAX_FEATURES_PER_PHASE) {
          issues.push(`${pp}: ${phase.features.length} features exceeds the ${MAX_FEATURES_PER_PHASE}-per-phase limit — split into an additional phase or defer to outOfScope`);
        }
        totalFeatures += phase.features.length;
        phase.features.forEach((f: any, j: number) => {
          validateFeature(f, `${pp}.features[${j}]`, issues);
        });
      }

      if (hasTBD(phase)) {
        issues.push(`${pp}: contains unresolved "TBD" — every field must be a definitive decision`);
      }
    });

    if (allMvp && p.phases.length === 1 && totalFeatures > MAX_FEATURES_PER_PHASE) {
      issues.push(`phases: all ${totalFeatures} features are in MVP — apply phase discipline. Split post-MVP work into Phase 1.`);
    }
  }

  // outOfScope
  const oos = reqArray(p, 'outOfScope', 'root', issues, 1);
  oos?.forEach((item: any, i: number) => {
    if (typeof item !== 'string' || !item.trim()) {
      issues.push(`outOfScope[${i}]: must be a non-empty string`);
    }
  });

  return result(issues);
}

// ── validate_qa_tests_json ────────────────────────────────────────────────────

const TC_ID_RE = /^TC-F\d+-\d{3}$/;
const VALID_TEST_TYPES = new Set(['happy_path', 'negative', 'edge', 'boundary', 'security', 'performance']);
const VALID_PRIORITIES = new Set(['critical', 'high', 'medium', 'low']);
const VAGUE_THEN = /\bshould work\s*(correctly)?\b|\bshould function\b|\bshould be fine\b|\bshould succeed\b/i;
const VALID_TAGS = new Set(['@smoke', '@regression', '@negative', '@edge', '@security', '@accessibility', '@performance']);

export function validateQaTestsJson(input: Record<string, unknown>): string {
  const { parsed, issues } = parseJson(input);
  if (parsed === null) return fail(issues);

  const p = parsed;
  req(p, 'suite', 'root', issues);
  req(p, 'version', 'root', issues);

  const testCases = reqArray(p, 'test_cases', 'root', issues, 5);
  if (!testCases) return fail(issues);

  if (testCases.length < 5) {
    issues.push(`test_cases: only ${testCases.length} test cases — a complete QA suite requires at least 5`);
  }

  const seenIds = new Set<string>();
  let smokeCount = 0;
  let negativeCount = 0;
  const criticalIds: string[] = [];

  testCases.forEach((tc: any, i: number) => {
    const lp = `test_cases[${i}]`;

    // ID format
    if (!tc.id) {
      issues.push(`${lp}: missing "id"`);
    } else if (!TC_ID_RE.test(tc.id)) {
      issues.push(`${lp}: id "${tc.id}" must follow TC-F?-??? format (e.g. TC-F1-001)`);
    } else if (seenIds.has(tc.id)) {
      issues.push(`${lp}: duplicate test case id "${tc.id}"`);
    } else {
      seenIds.add(tc.id);
    }

    req(tc, 'title', lp, issues);
    req(tc, 'description', lp, issues);
    req(tc, 'category', lp, issues);
    req(tc, 'prd_ref', lp, issues);

    // type
    if (!tc.type) {
      issues.push(`${lp}: "type" is required (happy_path | negative | edge | boundary | security | performance)`);
    } else if (!VALID_TEST_TYPES.has(tc.type)) {
      issues.push(`${lp}: invalid type "${tc.type}" — must be one of: ${[...VALID_TEST_TYPES].join(', ')}`);
    } else if (tc.type === 'negative') {
      negativeCount++;
    }

    // priority
    if (!tc.priority) {
      issues.push(`${lp}: "priority" is required (critical | high | medium | low)`);
    } else if (!VALID_PRIORITIES.has(tc.priority)) {
      issues.push(`${lp}: invalid priority "${tc.priority}" — must be critical, high, medium, or low`);
    } else if (tc.priority === 'critical') {
      criticalIds.push(tc.id ?? lp);
    }

    // scenario — Given/When/Then must all be non-empty arrays
    if (!tc.scenario || typeof tc.scenario !== 'object') {
      issues.push(`${lp}: "scenario" object with given/when/then arrays is required`);
    } else {
      const { given, when, then } = tc.scenario;
      if (!Array.isArray(given) || given.length === 0) issues.push(`${lp}.scenario: "given" must be a non-empty array`);
      if (!Array.isArray(when) || when.length === 0)  issues.push(`${lp}.scenario: "when" must be a non-empty array`);
      if (!Array.isArray(then) || then.length === 0)  issues.push(`${lp}.scenario: "then" must be a non-empty array`);

      // Vague "then" clause detection
      if (Array.isArray(then)) {
        then.forEach((step: any, j: number) => {
          if (typeof step === 'string' && VAGUE_THEN.test(step)) {
            issues.push(`${lp}.scenario.then[${j}]: vague assertion "${step}" — every Then step must describe a specific, observable outcome`);
          }
        });
      }
    }

    // Tags
    if (!Array.isArray(tc.tags) || tc.tags.length === 0) {
      issues.push(`${lp}: "tags" must be a non-empty array (e.g. ["@smoke", "@regression"])`);
    } else {
      if (tc.tags.includes('@smoke')) smokeCount++;
      const invalidTags = tc.tags.filter((t: any) => !VALID_TAGS.has(t));
      if (invalidTags.length > 0) {
        issues.push(`${lp}: unknown tag(s): ${invalidTags.join(', ')} — valid tags: ${[...VALID_TAGS].join(', ')}`);
      }
    }
  });

  // Suite-level checks
  if (criticalIds.length > 0 && smokeCount === 0) {
    issues.push(`No @smoke tests found — at least one critical test case must be tagged @smoke to define the core regression gate (critical tests: ${criticalIds.slice(0, 3).join(', ')})`);
  }

  if (negativeCount === 0) {
    issues.push('No negative test cases found — at least one "negative" type test is required to verify error handling and rejection behavior');
  }

  const negativePercent = Math.round((negativeCount / testCases.length) * 100);
  if (negativePercent < 20 && testCases.length >= 5) {
    issues.push(`Only ${negativePercent}% of test cases are negative paths (${negativeCount}/${testCases.length}) — aim for at least 20% negative/edge coverage`);
  }

  return result(issues);
}
