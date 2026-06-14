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

  function validateStory(story: any, p: string): void {
    if (!story.story_id) {
      issues.push(`${p}: missing story_id`);
    } else if (!STORY_ID_RE.test(story.story_id)) {
      issues.push(`${p}: story_id "${story.story_id}" must follow F?.S? format (e.g. F1.S2)`);
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

  if (parsed.epic && parsed.features) {
    if (!parsed.epic.title) issues.push('epic: missing title');
    if (!Array.isArray(parsed.features) || parsed.features.length === 0) {
      issues.push('features must be a non-empty array');
    } else {
      if (parsed.features.length > 6) {
        issues.push(`${parsed.features.length} features exceeds the 6-feature limit`);
      }
      parsed.features.forEach((f: any, i: number) => validateFeature(f, `features[${i}]`));
    }
  } else if (parsed.feature) {
    validateFeature(parsed.feature, 'feature');
  } else if (parsed.story) {
    validateStory(parsed.story, 'story');
  } else {
    issues.push('Root must be one of: { epic, features[] }, { feature }, or { story }');
  }

  return result(issues);
}
