Output a single valid JSON object wrapped in a ```json code block. No prose before or after the block.

Schema:

```json
{
  "title": "[Initiative Name] — Solution Architecture",
  "overview": "2–3 sentences: what is being built, platforms in scope, core architectural approach, target scale.",
  "technology_decisions": {
    "backend": [{ "decision": "Decision area", "choice": "Chosen technology" }],
    "web": [{ "decision": "", "choice": "" }],
    "ios": [{ "decision": "", "choice": "" }],
    "android": [{ "decision": "", "choice": "" }],
    "infrastructure": [{ "decision": "", "choice": "" }]
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
  "new_dependencies": [
    {
      "name": "LibraryOrServiceName",
      "type": "npm-package | cloud-service | third-party-api | infrastructure",
      "not_solvable_with_existing_stack_because": "Specific reason the existing tech cannot do this"
    }
  ],
  "open_questions": [
    { "decision": "Unresolved decision", "recommendation": "Recommended resolution (1 sentence max, no line breaks)", "risk": "Risk if unresolved (1 sentence max, no line breaks)" }
  ]
}
```

Rules:
- Only include platform keys (backend/web/ios/android/infrastructure) that are in scope.
- For every repo in context/repos.md, include a repository_impact entry (use "No changes" if unaffected).
- new_dependencies: list every technology that does NOT already appear in context/tech-stack.md. If all choices reuse the existing stack, set this to an empty array `[]`. An empty array is a deliberate statement — it will be shown prominently to the PM reviewer as confirmation that no new dependencies are introduced.
- Infrastructure, hosting topology, deployment pipelines, cost estimates, and failure-mode tables are out of scope — do not include them.
- BREVITY IS MANDATORY: This document is for tech team buy-in, not implementation handoff. Every field has explicit length constraints above. No exhaustive enumerations, no inline implementation guidance, no repeated content. The `entity_relationship_diagram` is the one permitted diagram — include it as specified above. Other diagrams, data-flow walkthroughs, alert configurations, and load test specifications are out of scope.
- JSON VALIDITY: All string fields must be valid JSON strings. Never include literal newline characters (line breaks) in "recommendation", "risk", or any other string field. If you need to express multiple points, use semicolons or em-dashes within a single sentence, not line breaks. The entity_relationship_diagram field is the ONLY exception where \\n escapes are required.
