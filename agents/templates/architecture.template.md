Output a single valid JSON object wrapped in a ```json code block. No prose before or after the block.

Schema:

```json
{
  "title": "[Initiative Name] — Solution Architecture",
  "overview": "2–3 sentences: what is being built, platforms in scope, core architectural approach, target scale.",
  "technology_decisions": {
    "backend": [{ "decision": "Decision area", "choice": "Chosen technology", "alternatives": "Alternatives considered", "rationale": "Why this wins" }],
    "web": [{ "decision": "", "choice": "", "alternatives": "", "rationale": "" }],
    "ios": [{ "decision": "", "choice": "", "alternatives": "", "rationale": "" }],
    "android": [{ "decision": "", "choice": "", "alternatives": "", "rationale": "" }],
    "infrastructure": [{ "decision": "", "choice": "", "alternatives": "", "rationale": "" }]
  },
  "data_model": {
    "entities": [
      { "name": "Entity name", "primary_key": "pk field", "key_fields": "field1, field2, field3", "relationships": "1:N with OtherEntity", "notes": "Constraints, indexing, soft-delete" }
    ],
    "entity_relationship_diagram": "ASCII diagram showing relationships and cardinality"
  },
  "api_surface": [
    {
      "service": "Service name (repo: reponame)",
      "endpoints": [
        { "method": "GET|POST|PUT|DELETE|PATCH", "path": "/path", "purpose": "What it does", "request": "Key request fields", "response": "Key response fields", "notes": "Auth, idempotency, rate limits" }
      ]
    }
  ],
  "repository_impact": [
    { "repo": "repo-name", "changes_required": "What changes", "notes": "" }
  ],
  "infrastructure": {
    "hosting": "Hosting topology description",
    "cost_estimate": "Per-component cost estimates"
  },
  "security_considerations": ["Security point 1", "Security point 2"],
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
    { "decision": "Unresolved decision", "recommendation": "Recommended resolution", "risk": "Risk if unresolved" }
  ],
  "epic_features_enriched": {
    "epic": { "title": "Epic title from prior stage" },
    "features": [
      {
        "title": "Feature title (preserve exactly from epic_feature_planner output)",
        "target_repos": ["repo1", "repo2"],
        "technical_notes": "Implementation details that constrain story decomposition"
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
- This document is intentionally scoped down for reliability — keep every field concise (a few sentences, not essays). Diagrams, data-flow walkthroughs, deployment pipelines, and failure-mode tables are deferred for now and will be reintroduced once the stage is reliable at this smaller scope.
