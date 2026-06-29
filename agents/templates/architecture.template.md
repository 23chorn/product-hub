Output a single valid JSON object wrapped in a ```json code block. No prose before or after the block.

Schema:

```json
{
  "title": "[Initiative Name] — Solution Architecture",
  "overview": "2–3 sentences: what is being built, platforms in scope, core architectural approach, target scale.",
  "technology_decisions": {
    "backend": [{ "decision": "Decision area", "choice": "Chosen technology", "alternatives": "Alternatives considered", "rationale": "Why this wins (1 sentence max)" }],
    "web": [{ "decision": "", "choice": "", "alternatives": "", "rationale": "" }],
    "ios": [{ "decision": "", "choice": "", "alternatives": "", "rationale": "" }],
    "android": [{ "decision": "", "choice": "", "alternatives": "", "rationale": "" }],
    "infrastructure": [{ "decision": "", "choice": "", "alternatives": "", "rationale": "" }]
  },
  "data_model": {
    "entities": [
      { "name": "Entity name", "primary_key": "pk field", "key_fields": "field1, field2, field3", "relationships": "1:N with OtherEntity", "notes": "Constraints, indexing, soft-delete" }
    ],
    "entity_relationship_diagram": "ASCII diagram showing relationships and cardinality. MUST be drawn vertically (top-to-bottom) with each box/node on its own line, and the JSON string MUST use literal \\n newline escapes between every line — never emit the diagram as a single flat line, or it will not render."
  },
  "api_surface": [
    {
      "service": "Service name (repo: reponame)",
      "endpoints": [
        { "method": "GET|POST|PUT|DELETE|PATCH", "path": "/path", "purpose": "What it does", "request": "Key request fields", "response": "Key response fields", "notes": "Auth, idempotency, rate limits (brief, no exhaustive enumerations)" }
      ]
    }
  ],
  "repository_impact": [
    { "repo": "repo-name", "changes_required": "One-line summary of what changes", "notes": "Blocking gate or critical constraint (1 sentence max, omit if none)" }
  ],
  "infrastructure": {
    "hosting": "Hosting topology — 3–4 sentences max, high-level only (where each service runs and how it scales; no alert configurations, no load test specifications, no exhaustive component-by-component walkthrough).",
    "cost_estimate": "1–2 sentences max, high-level ballpark only (rough monthly range and the main cost drivers; not a per-component breakdown, no line-item calculations)."
  },
  "security_considerations": ["Security point 1 (1 sentence each)", "Security point 2"],
  "new_dependencies": [
    {
      "name": "LibraryOrServiceName",
      "type": "npm-package | cloud-service | third-party-api | infrastructure",
      "not_solvable_with_existing_stack_because": "Specific reason the existing tech cannot do this",
      "existing_alternatives_evaluated": "What was tried or considered from the current stack first",
      "cost_or_risk": "Licensing cost, operational overhead, or security surface added"
    }
  ],
  "open_questions": [
    { "decision": "Unresolved decision", "recommendation": "Recommended resolution (1 sentence max)", "risk": "Risk if unresolved (1 sentence max)" }
  ],
  "epic_features_enriched": {
    "epic": { "title": "Epic title from prior stage" },
    "features": [
      {
        "title": "Feature title (preserve exactly from epic_feature_planner output)",
        "target_repos": ["repo1", "repo2"],
        "technical_notes": "MAXIMUM 3 bullet points. Each bullet: one line stating repo/module, what changes, and critical constraint if any. No parenthetical clarifications, no GATE conditions expanded inline (reference them by decision number instead), no implementation recipes. Format: '• Repo/Module: what changes + constraint'. Implementation details belong in backlog stories, not here."
      }
    ]
  }
}
```

Rules:
- Only include platform keys (backend/web/ios/android/infrastructure) that are in scope.
- For every repo in context/repos.md, include a repository_impact entry (use "No changes" if unaffected).
- epic_features_enriched must reference the exact feature titles from the epic_feature_planner output.
- new_dependencies: list every technology that does NOT already appear in context/tech-stack.md. If all choices reuse the existing stack, set this to an empty array `[]`. An empty array is a deliberate statement — it will be shown prominently to the PM reviewer as confirmation that no new dependencies are introduced.
- BREVITY IS MANDATORY: This document is for tech team buy-in, not implementation handoff. Every field has explicit length constraints above. Rationales are 1 sentence. Technical notes are max 3 bullets. Infrastructure sections strictly honor their sentence caps. No exhaustive enumerations, no inline implementation guidance, no repeated content. The `entity_relationship_diagram` is the one permitted diagram — include it as specified above. Other diagrams, data-flow walkthroughs, deployment pipelines, failure-mode tables, alert configurations, and load test specifications are out of scope.
